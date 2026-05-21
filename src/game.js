import { CONFIG } from './config.js';
import Matter from 'matter-js';

/**
 * Orchestrates game rules, player active turns, coin toss,
 * and handles strategic safe-haven break rules and turnovers.
 */
export class GameEngine {
  /**
   * @param {Object} config The centralized CONFIG object
   */
  constructor(config = CONFIG) {
    this.config = config;

    this.player1Name = this.config.rules?.player1Name || 'Alice';
    this.player2Name = this.config.rules?.player2Name || 'Bob';

    // Game state
    this.activePlayer = this.player1Name;
    this.isBreakShot = true;
    this.isTossing = false;

    // Turn tracking counters
    this.consecutiveMisses = {
      [this.player1Name]: 0,
      [this.player2Name]: 0
    };

    // Card hands (Milestone 4/5)
    this.hands = {
      [this.player1Name]: [],
      [this.player2Name]: []
    };

    // References to core components
    this.controls = null;
    this.renderer = null;

    // Shot tracking registers
    this.pocketedBallsThisShot = [];
    this.pocketedBallsDetails = [];
    this.cueBallScratchThisShot = false;

    // Pocket mapping & phase transition states
    this.pocketSuits = new Array(6).fill(null);
    this.phase = 1;
  }

  /**
   * Triggers the virtual coin toss overlay and determines the starting active player.
   * @param {AimingControls} controls AimingControls controller instance
   * @param {CanvasRenderer} renderer CanvasRenderer view instance
   * @returns {Promise<string>} Resolves with the winner name
   */
  startMatch(controls, renderer) {
    this.controls = controls;
    this.renderer = renderer;
    this.renderer.gameRef = this;

    return new Promise((resolve) => {
      this.isTossing = true;
      this.controls.enabled = false;

      // Random 50/50 starting choice
      const winner = Math.random() < 0.5 ? this.player1Name : this.player2Name;
      this.activePlayer = winner;

      // Find the DOM container to inject our CSS-powered overlay
      const container = document.getElementById('game-container') || document.body;
      
      // 1. Construct overlay markup
      const overlay = document.createElement('div');
      overlay.className = 'coin-toss-overlay';
      overlay.innerHTML = `
        <div class="coin-toss-card">
          <h2 class="coin-toss-title">MATCH INITS</h2>
          <div class="coin-container">
            <div class="coin" id="coin-visual">
              <div class="coin-front">A</div>
              <div class="coin-back">B</div>
            </div>
          </div>
          <p class="coin-toss-status" id="coin-status-text">Tossing Coin to decide break choice...</p>
        </div>
      `;
      container.appendChild(overlay);

      // Trigger the spin transition in next render frame
      requestAnimationFrame(() => {
        const coinVisual = document.getElementById('coin-visual');
        if (coinVisual) {
          // If Player 1 (Alice) wins: rotate Y to a multiple of 360 (lands on A)
          // If Player 2 (Bob) wins: rotate Y to multiple of 360 + 180 (lands on B)
          const targetRot = winner === this.player1Name ? 1440 : 1620;
          coinVisual.style.transform = `rotateY(${targetRot}deg)`;
        }
      });

      // Sequence progress timeouts
      setTimeout(() => {
        const statusText = document.getElementById('coin-status-text');
        if (statusText) {
          statusText.innerHTML = `Coin landed on <span class="coin-winner-neon">${winner.toUpperCase()}</span>!<br>Preparing the Rack...`;
        }
      }, 1500);

      setTimeout(() => {
        // Fade out overlay beautifully
        overlay.style.opacity = '0';
        
        setTimeout(() => {
          // Cleanup DOM
          overlay.remove();
          this.isTossing = false;
          this.controls.enabled = true;
          
          // Align turn titles in renderer
          this.renderer.setActivePlayer(this.activePlayer);
          
          console.log(`Coin Toss Completed. Active Player is ${this.activePlayer}`);
          resolve(winner);
        }, 500);
      }, 3200);
    });
  }

  /**
   * Registers sensory pockets overlap events
   * @param {Matter.Body} ball The pocketed ball body
   */
  /**
   * Registers sensory pockets overlap events
   * @param {Matter.Body} ball The pocketed ball body
   * @param {number} pocketId The physical pocket index
   */
  handlePocketOverlap(ball, pocketId = -1) {
    if (ball.label === 'cue_ball') {
      this.cueBallScratchThisShot = true;
    } else {
      const ballId = ball.plugin.ballId;
      if (!this.pocketedBallsThisShot.includes(ballId)) {
        this.pocketedBallsThisShot.push(ballId);
        this.pocketedBallsDetails.push({ ballId, ball, pocketId });
      }
    }
  }

  /**
   * Reset tracking registers when a shot starts rolling
   */
  handleShotStart() {
    this.pocketedBallsThisShot = [];
    this.pocketedBallsDetails = [];
    this.cueBallScratchThisShot = false;
  }

  /**
   * Evaluates rules, turns, cushion contact validity, and safe-haven break rules.
   * @param {PhysicsEngine} physics The active PhysicsEngine instance
   */
  async handleShotEnd(physics) {
    console.log(`Evaluating Shot Outcome. Break: ${this.isBreakShot}, Pocketed: [${this.pocketedBallsThisShot.join(', ')}], Scratch: ${this.cueBallScratchThisShot}`);

    const opponent = this.activePlayer === this.player1Name ? this.player2Name : this.player1Name;

    if (this.isBreakShot) {
      // 1. Break Shot Evaluation
      const cushionContacts = physics.cushionContactSet.size;
      const ballsPocketedCount = this.pocketedBallsThisShot.length;
      
      const isLegalBreak = !this.cueBallScratchThisShot && (cushionContacts >= this.config.rules.minBreakCushionContacts || ballsPocketedCount > 0);

      console.log(`Break Cushion Contacts: ${cushionContacts}, Legal: ${isLegalBreak}`);

      // Safe-Haven Break Rule:
      // Any target balls pocketed on a legal break MUST respawn back to the table coordinates.
      // Opponent claims no cards, and the breaking player preserves turn.
      if (isLegalBreak) {
        if (ballsPocketedCount > 0) {
          // Relocate pocketed balls to free spots in the respawn matrix
          this.pocketedBallsThisShot.forEach((ballId) => {
            const originalBall = (physics.allTargetBalls || physics.targetBalls).find(b => b.plugin.ballId === ballId);
            if (originalBall) {
              physics.respawnBall(originalBall);
              this.renderer.setBallVisibility(originalBall.id, true);
            }
          });
          // Respawns occurred: maintain breaking player's turn!
          console.log(`Legal break with pocketed balls. Respawns completed. ${this.activePlayer} keeps turn.`);
        } else {
          // Legal break but no pocketed balls: pass turn cleanly to opponent
          this.activePlayer = opponent;
          console.log(`Legal break with zero balls pocketed. Turn passes to ${this.activePlayer}.`);
        }
      } else {
        // Illegal Break or Cue Ball Scratch:
        // Teleport any pocketed balls back to respawn spots, increment breaker's miss counter, and transfer turn with Ball-In-Hand in kitchen.
        this.consecutiveMisses[this.activePlayer]++;
        
        // Teleport pocketed balls to respawn spots
        this.pocketedBallsThisShot.forEach((ballId) => {
          const originalBall = (physics.allTargetBalls || physics.targetBalls).find(b => b.plugin.ballId === ballId);
          if (originalBall) {
            physics.respawnBall(originalBall);
            this.renderer.setBallVisibility(originalBall.id, true);
          }
        });

        // Pass turn to opponent with Ball-In-Hand behind head string (kitchen)
        this.activePlayer = opponent;
        
        console.log(`Illegal break or scratch. Turn passes to ${this.activePlayer} with Ball-in-Hand.`);
      }

      // Conclude break shot phase
      this.isBreakShot = false;
      physics.isBreakShot = false;

      // Update HUD interface with misses/players
      if (this.renderer) {
        this.renderer.updateHUD(this.hands, this.activePlayer, this.consecutiveMisses);
      }
    } else {
      // 2. Normal Shot Evaluation with State Transitions
      await this.processNormalPocketedBalls(physics);
    }

    // Synchronize renderer active player name display
    if (this.renderer) {
      this.renderer.setActivePlayer(this.activePlayer);
    }
  }

  /**
   * Processes normal target ball scoring, suit mapping, phase transitions, and wildcard drops.
   * @param {PhysicsEngine} physics The active PhysicsEngine instance
   */
  async processNormalPocketedBalls(physics) {
    const opponent = this.activePlayer === this.player1Name ? this.player2Name : this.player1Name;
    
    let anyValidScore = false;
    let anyInvalidDrop = false;

    // Process all pocketed target balls
    for (const detail of this.pocketedBallsDetails) {
      const { ballId, ball, pocketId } = detail;
      
      const originalBall = (physics.allTargetBalls || physics.targetBalls).find(b => b.plugin.ballId === ballId);
      if (!originalBall) continue;

      const suit = this.pocketSuits[pocketId];

      if (ballId >= 1 && ballId <= 13) {
        // Standard Rank Ball
        if (suit === null) {
          // Unmapped pocket
          if (this.phase === 1) {
            const selectedSuit = await this.promptSuitMapping(this.activePlayer, pocketId, ballId);
            this.pocketSuits[pocketId] = selectedSuit;

            // Register card if not already held
            const hand = this.hands[this.activePlayer] || [];
            const hasCard = hand.some(c => c.rank === ballId && c.suit === selectedSuit);
            if (!hasCard) {
              hand.push({ rank: ballId, suit: selectedSuit });
              anyValidScore = true;
            }

            if (this.renderer) {
              this.renderer.updatePocketGraphics(this.pocketSuits);
              this.renderer.updateHUD(this.hands, this.activePlayer, this.consecutiveMisses);
            }

            // Phase transition trigger: 4 distinct suits mapped
            const mappedCount = this.pocketSuits.filter(s => s !== null && s !== 'W').length;
            if (mappedCount === 4) {
              this.phase = 2;
              this.pocketSuits.forEach((s, idx) => {
                if (s === null) this.pocketSuits[idx] = 'W'; // Convert unmapped to Wild Pockets
              });
              if (this.renderer) {
                this.renderer.updatePocketGraphics(this.pocketSuits);
              }
            }

            physics.respawnBall(originalBall);
            if (this.renderer) this.renderer.setBallVisibility(originalBall.id, true);
          } else {
            physics.respawnBall(originalBall);
            if (this.renderer) this.renderer.setBallVisibility(originalBall.id, true);
            anyInvalidDrop = true;
          }
        } else if (suit === 'W') {
          // Standard ball entering wild pocket is INVALID
          physics.respawnBall(originalBall);
          if (this.renderer) this.renderer.setBallVisibility(originalBall.id, true);
          anyInvalidDrop = true;
        } else {
          // Mapped suit pocket
          const hand = this.hands[this.activePlayer] || [];
          const hasCard = hand.some(c => c.rank === ballId && c.suit === suit);
          
          if (!hasCard) {
            hand.push({ rank: ballId, suit });
            anyValidScore = true;
            if (this.renderer) {
              this.renderer.updateHUD(this.hands, this.activePlayer, this.consecutiveMisses);
            }
          } else {
            // Duplicate card is INVALID
            anyInvalidDrop = true;
          }

          physics.respawnBall(originalBall);
          if (this.renderer) this.renderer.setBallVisibility(originalBall.id, true);
        }
      } else if (ballId === 14 || ballId === 15) {
        // Wildcard Ball
        if (suit === 'W') {
          // Wildcard in wild pocket is VALID
          const chosenCard = await this.promptWildcardSelection(this.activePlayer);
          
          const hand = this.hands[this.activePlayer] || [];
          const hasCard = hand.some(c => c.rank === chosenCard.rank && c.suit === chosenCard.suit);
          
          if (!hasCard) {
            hand.push(chosenCard);
            anyValidScore = true;
            if (this.renderer) {
              this.renderer.updateHUD(this.hands, this.activePlayer, this.consecutiveMisses);
            }
          } else {
            // Duplicate wildcard is INVALID
            anyInvalidDrop = true;
          }

          // Wildcard is permanently removed from play: no respawn, hide view!
          if (this.renderer) {
            this.renderer.setBallVisibility(originalBall.id, false);
          }
          Matter.Composite.remove(physics.world, originalBall);
          physics.targetBalls = physics.targetBalls.filter(b => b.id !== originalBall.id);
        } else {
          // Wildcard in suit pocket is INVALID
          physics.respawnBall(originalBall);
          if (this.renderer) this.renderer.setBallVisibility(originalBall.id, true);
          anyInvalidDrop = true;
        }
      }
    }

    // Evaluate turn shifts and misses
    if (this.cueBallScratchThisShot) {
      this.consecutiveMisses[this.activePlayer]++;
      this.activePlayer = opponent;
      console.log(`Scratch! Turn transitions to ${this.activePlayer}`);
    } else if (anyInvalidDrop) {
      this.consecutiveMisses[this.activePlayer]++;
      this.activePlayer = opponent;
      console.log(`Invalid Drop occurred! Turn transitions to ${this.activePlayer}`);
    } else if (anyValidScore) {
      this.consecutiveMisses[this.activePlayer] = 0;
      console.log(`${this.activePlayer} scored a card and keeps their turn.`);
    } else {
      // Miss
      this.consecutiveMisses[this.activePlayer]++;
      this.activePlayer = opponent;
      console.log(`Miss. Turn transitions to ${this.activePlayer}`);
    }

    // Update HUD counters
    if (this.renderer) {
      this.renderer.updateHUD(this.hands, this.activePlayer, this.consecutiveMisses);
    }

    // 3-Miss Elimination Rule
    const p1Misses = this.consecutiveMisses[this.player1Name] || 0;
    const p2Misses = this.consecutiveMisses[this.player2Name] || 0;

    if (p1Misses >= 3) {
      this.showGameOver(this.player2Name, `${this.player1Name} hit 3 consecutive misses and is disqualified!`);
    } else if (p2Misses >= 3) {
      this.showGameOver(this.player1Name, `${this.player2Name} hit 3 consecutive misses and is disqualified!`);
    }
  }

  /**
   * Opens HTML blocking modal prompting active player to claim an unclaimed suit.
   */
  promptSuitMapping(player, pocketId, ballId) {
    return new Promise((resolve) => {
      this.controls.enabled = false;
      const container = document.getElementById('game-container') || document.body;

      const claimedSuits = this.pocketSuits.filter(s => s !== null && s !== 'W');
      const allSuits = ['S', 'H', 'D', 'C'];
      const remainingSuits = allSuits.filter(s => !claimedSuits.includes(s));

      const overlay = document.createElement('div');
      overlay.className = 'suit-mapping-overlay';

      const pocketNames = [
        'Top Left Corner', 'Top Right Corner',
        'Bottom Left Corner', 'Bottom Right Corner',
        'Top Side', 'Bottom Side'
      ];
      const pocketName = pocketNames[pocketId] || `Pocket ${pocketId}`;
      const ballName = ballId === 1 ? 'Ace' : ballId === 11 ? 'Jack' : ballId === 12 ? 'Queen' : ballId === 13 ? 'King' : ballId;

      overlay.innerHTML = `
        <div class="suit-mapping-card">
          <h2 class="suit-mapping-title">CLAIM SUIT</h2>
          <p class="suit-mapping-subtitle">${player.toUpperCase()} pocketed [${ballName}] in the ${pocketName}!<br>Map a suit to this pocket:</p>
          <div class="suit-buttons-grid">
            <button class="suit-btn spades" data-suit="S" ${!remainingSuits.includes('S') ? 'disabled' : ''}>
              <span class="suit-symbol">♠</span>
              <span class="suit-label">SPADES</span>
            </button>
            <button class="suit-btn hearts" data-suit="H" ${!remainingSuits.includes('H') ? 'disabled' : ''}>
              <span class="suit-symbol">♥</span>
              <span class="suit-label">HEARTS</span>
            </button>
            <button class="suit-btn diamonds" data-suit="D" ${!remainingSuits.includes('D') ? 'disabled' : ''}>
              <span class="suit-symbol">♦</span>
              <span class="suit-label">DIAMONDS</span>
            </button>
            <button class="suit-btn clubs" data-suit="C" ${!remainingSuits.includes('C') ? 'disabled' : ''}>
              <span class="suit-symbol">♣</span>
              <span class="suit-label">CLUBS</span>
            </button>
          </div>
        </div>
      `;
      container.appendChild(overlay);

      const buttons = overlay.querySelectorAll('.suit-btn');
      buttons.forEach(btn => {
        btn.addEventListener('click', () => {
          const selectedSuit = btn.getAttribute('data-suit');
          overlay.style.opacity = '0';
          setTimeout(() => {
            overlay.remove();
            this.controls.enabled = true;
            resolve(selectedSuit);
          }, 350);
        });
      });
    });
  }

  /**
   * Opens HTML blocking modal prompting player to configure custom rank/suit for wildcard ball.
   */
  promptWildcardSelection(player) {
    return new Promise((resolve) => {
      this.controls.enabled = false;
      const container = document.getElementById('game-container') || document.body;

      const overlay = document.createElement('div');
      overlay.className = 'wildcard-selector-overlay';

      overlay.innerHTML = `
        <div class="wildcard-selector-card" style="max-width: 420px;">
          <h2 class="suit-mapping-title" style="color: #ffd700; text-shadow: 0 0 15px rgba(255, 215, 0, 0.6);">WILDCARD!</h2>
          <p class="suit-mapping-subtitle">${player.toUpperCase()} scored in a Wild Pocket!<br>Customize your Wildcard card:</p>
          
          <div style="display: flex; gap: 15px; margin-bottom: 25px; width: 100%;">
            <div style="flex: 1; text-align: left;">
              <label style="color: #90caf9; font-size: 11px; font-weight: 700; letter-spacing: 1px; display: block; margin-bottom: 6px;">SELECT RANK</label>
              <select id="wild-rank-select" style="width: 100%; background: #0b0f19; border: 2px solid #213359; border-radius: 8px; color: white; padding: 10px; font-size: 14px; outline: none; cursor: pointer;">
                <option value="1">Ace (A)</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5</option>
                <option value="6">6</option>
                <option value="7">7</option>
                <option value="8">8</option>
                <option value="9">9</option>
                <option value="10">10</option>
                <option value="11">Jack (J)</option>
                <option value="12">Queen (Q)</option>
                <option value="13">King (K)</option>
              </select>
            </div>
            
            <div style="flex: 1; text-align: left;">
              <label style="color: #90caf9; font-size: 11px; font-weight: 700; letter-spacing: 1px; display: block; margin-bottom: 6px;">SELECT SUIT</label>
              <select id="wild-suit-select" style="width: 100%; background: #0b0f19; border: 2px solid #213359; border-radius: 8px; color: white; padding: 10px; font-size: 14px; outline: none; cursor: pointer;">
                <option value="S">Spades (♠)</option>
                <option value="H">Hearts (♥)</option>
                <option value="D">Diamonds (♦)</option>
                <option value="C">Clubs (♣)</option>
              </select>
            </div>
          </div>
          
          <button id="wild-confirm-btn" style="background: linear-gradient(135deg, #ffd700 0%, #ffb300 100%); color: #0d1527; border: none; border-radius: 8px; padding: 12px 25px; font-size: 14px; font-weight: bold; cursor: pointer; transition: all 0.25s; width: 100%; box-shadow: 0 4px 15px rgba(255, 215, 0, 0.4); letter-spacing: 1px;">
            ADD TO HAND
          </button>
        </div>
      `;
      container.appendChild(overlay);

      const confirmBtn = overlay.querySelector('#wild-confirm-btn');
      confirmBtn.addEventListener('click', () => {
        const rank = parseInt(overlay.querySelector('#wild-rank-select').value);
        const suit = overlay.querySelector('#wild-suit-select').value;
        
        overlay.style.opacity = '0';
        setTimeout(() => {
          overlay.remove();
          this.controls.enabled = true;
          resolve({ rank, suit });
        }, 350);
      });
    });
  }


  /**
   * Opens static HTML overlay for final Match Over.
   */
  showGameOver(winner, reason) {
    this.controls.enabled = false;
    const container = document.getElementById('game-container') || document.body;
    
    const existing = container.querySelector('.game-over-overlay');
    if (existing) return;

    const overlay = document.createElement('div');
    overlay.className = 'game-over-overlay';
    overlay.style.cssText = `
      position: absolute;
      top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(4, 6, 12, 0.95);
      backdrop-filter: blur(12px);
      display: flex; justify-content: center; align-items: center;
      z-index: 3000;
    `;
    
    overlay.innerHTML = `
      <div style="background: linear-gradient(135deg, #1f112e 0%, #0d0614 100%); border: 3px solid #b388ff; border-radius: 24px; padding: 40px; text-align: center; box-shadow: 0 25px 50px rgba(0,0,0,0.9), 0 0 50px rgba(179,136,255,0.4); max-width: 440px; width: 85%;">
        <h1 style="color: #b388ff; font-size: 32px; font-weight: 900; margin: 0 0 15px 0; letter-spacing: 5px; text-shadow: 0 0 15px rgba(179,136,255,0.6);">MATCH OVER</h1>
        <p style="color: #e040fb; font-size: 18px; font-weight: bold; margin: 0 0 10px 0; text-transform: uppercase; text-shadow: 0 0 8px rgba(224,64,251,0.5);">${winner.toUpperCase()} WINS!</p>
        <p style="color: #90caf9; font-size: 13px; line-height: 1.6; margin: 0 0 30px 0;">${reason}</p>
        <button onclick="window.location.reload()" style="background: linear-gradient(135deg, #b388ff 0%, #7c4dff 100%); color: white; border: none; border-radius: 12px; padding: 14px 30px; font-size: 14px; font-weight: 800; cursor: pointer; transition: all 0.25s; box-shadow: 0 4px 15px rgba(124,77,255,0.4); letter-spacing: 1px; width: 100%;">PLAY AGAIN</button>
      </div>
    `;
    
    container.appendChild(overlay);
  }
}
