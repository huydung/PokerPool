import { CONFIG } from './config.js';
import Matter from 'matter-js';
import { compareHands, evaluatePokerHand } from './poker.js';

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

    // Showdown & Standing States (Milestones 4 & 5)
    this.standingPlayer = null;
    this.firstToStand = null;
    this.firstToCompleteHand = null;
    this.standCountdown = -1;
    this.gameEnded = false;
    this.handsStood = {
      [this.player1Name]: false,
      [this.player2Name]: false
    };

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
          <h2 class="coin-toss-title">COIN TOSS</h2>
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

          // Inject persistent ? rules button into HUD
          this._injectRulesButton(container);

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
    if (this.gameEnded) return;

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
        if (this.controls) {
          this.controls.hasBallInHand = true;
        }
        
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

    if (this.gameEnded) return;

    // Stand countdown decrement — fires once per TURN (not per shot).
    // A turn ends when the active player changes back to the standing player,
    // meaning the opponent's uninterrupted run has finished (miss/invalid/scratch).
    // If the opponent keeps scoring bonus shots, they're still on the same turn and
    // the countdown doesn't tick down — matching GDD Section 5's "3-turn window."
    if (!this.isBreakShot && this.standingPlayer) {
      // After processNormalPocketedBalls, if activePlayer is now the standing player,
      // the opponent's turn just ended → decrement the countdown.
      if (this.activePlayer === this.standingPlayer) {
        this.standCountdown--;
        console.log(`Stand countdown: opponent's turn ended. ${this.standCountdown} turn(s) remaining.`);
        if (this.standCountdown <= 0) {
          this.triggerShowdown();
          return;
        }
        // Switch active player back to opponent so they can take their next turn
        const standOpponent = this.standingPlayer === this.player1Name ? this.player2Name : this.player1Name;
        this.activePlayer = standOpponent;
      } else {
        // Opponent kept their turn (bonus shot) — countdown doesn't tick
        console.log(`Stand countdown: ${this.standCountdown} turn(s) remaining (opponent still shooting).`);
      }
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
    if (this.gameEnded) return;

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
              if (hand.length < 5) {
                hand.push({ rank: ballId, suit: selectedSuit });
                anyValidScore = true;
                if (!this.firstToCompleteHand && hand.length === 5) {
                  this.firstToCompleteHand = this.activePlayer;
                }
              } else {
                hand.push({ rank: ballId, suit: selectedSuit });
                await this.promptCardSwap(this.activePlayer);
                anyValidScore = true;
              }
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
            if (hand.length < 5) {
              hand.push({ rank: ballId, suit });
              anyValidScore = true;
              if (!this.firstToCompleteHand && hand.length === 5) {
                this.firstToCompleteHand = this.activePlayer;
              }
            } else {
              hand.push({ rank: ballId, suit });
              await this.promptCardSwap(this.activePlayer);
              anyValidScore = true;
            }
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
            if (hand.length < 5) {
              hand.push(chosenCard);
              anyValidScore = true;
              if (!this.firstToCompleteHand && hand.length === 5) {
                this.firstToCompleteHand = this.activePlayer;
              }
            } else {
              hand.push(chosenCard);
              await this.promptCardSwap(this.activePlayer);
              anyValidScore = true;
            }
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

    const isOpponentStanding = this.handsStood[opponent];

    // ---------------------------------------------------------------
    // Turn shift & consecutive-miss resolution (GDD Section 4 rules):
    //
    //  • Scratch   → always ends turn, always increments miss counter.
    //  • Valid score only → keep turn (bonus loop), reset miss counter.
    //  • Valid score + invalid drop → valid score resets miss counter,
    //    but invalid drop still ends the turn (per GDD "turn shifts
    //    when a ball drops into an invalid pocket").
    //  • Invalid drop only → ends turn, increments miss counter.
    //  • Complete miss (nothing pocketed) → ends turn, increments miss counter.
    // ---------------------------------------------------------------
    if (this.cueBallScratchThisShot) {
      // Scratch overrides everything else — miss counter up, turn ends
      this.consecutiveMisses[this.activePlayer]++;
      if (!isOpponentStanding) this.activePlayer = opponent;
      if (this.controls) this.controls.hasBallInHand = true;
      console.log(`Scratch! Turn transitions to ${this.activePlayer}`);
    } else if (anyValidScore && !anyInvalidDrop) {
      // Clean successful shot: bonus loop, miss counter reset
      this.consecutiveMisses[this.activePlayer] = 0;
      console.log(`${this.activePlayer} scored a card and keeps their turn.`);
    } else if (anyValidScore && anyInvalidDrop) {
      // Mixed shot: scored at least one valid card so miss counter resets,
      // but also dropped at least one invalid ball so turn ends
      this.consecutiveMisses[this.activePlayer] = 0;
      if (!isOpponentStanding) this.activePlayer = opponent;
      console.log(`${this.activePlayer} had a mixed shot (valid + invalid). Miss counter reset, turn ends.`);
    } else if (anyInvalidDrop) {
      // Only invalid drops, no valid score
      this.consecutiveMisses[this.activePlayer]++;
      if (!isOpponentStanding) this.activePlayer = opponent;
      console.log(`Invalid drop! Turn transitions to ${this.activePlayer}`);
    } else {
      // Complete miss — nothing pocketed at all
      this.consecutiveMisses[this.activePlayer]++;
      if (!isOpponentStanding) this.activePlayer = opponent;
      console.log(`Miss. Turn transitions to ${this.activePlayer}`);
    }

    // Update HUD counters
    if (this.renderer) {
      this.renderer.updateHUD(this.hands, this.activePlayer, this.consecutiveMisses);
    }

    // Forced Showdown check: both players have exactly 5 cards
    const p1Hand = this.hands[this.player1Name] || [];
    const p2Hand = this.hands[this.player2Name] || [];
    if (p1Hand.length === 5 && p2Hand.length === 5) {
      this.triggerShowdown();
      return;
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
      const claimedSuits = this.pocketSuits.filter(s => s !== null && s !== 'W');
      const allSuits = ['S', 'H', 'D', 'C'];
      const remainingSuits = allSuits.filter(s => !claimedSuits.includes(s));

      if (remainingSuits.length === 1) {
        resolve(remainingSuits[0]);
        return;
      }

      this.controls.enabled = false;
      const container = document.getElementById('game-container') || document.body;

      const overlay = document.createElement('div');
      overlay.className = 'suit-mapping-overlay';

      const pocketNames = [
        'Top Left Corner', 'Top Right Corner',
        'Bottom Left Corner', 'Bottom Right Corner',
        'Top Side', 'Bottom Side'
      ];
      const pocketName = pocketNames[pocketId] || `Pocket ${pocketId}`;
      const ballName = ballId === 1 ? 'Ace' : ballId === 11 ? 'Jack' : ballId === 12 ? 'Queen' : ballId === 13 ? 'King' : ballId;

      // Coordinate mapping to position overlay next to pocket
      const xCenter = this.config.table.xCenter;
      const yCenter = this.config.table.yCenter;
      const width = this.config.table.width;
      const height = this.config.table.height;
      const sideOffset = this.config.pocket.sideOffset;
      const hw = width / 2;
      const hh = height / 2;
      
      const pocketPositions = [
        { x: xCenter - hw, y: yCenter - hh, cls: 'top-left' },      // 0: TL
        { x: xCenter + hw, y: yCenter - hh, cls: 'top-right' },     // 1: TR
        { x: xCenter - hw, y: yCenter + hh, cls: 'bottom-left' },   // 2: BL
        { x: xCenter + hw, y: yCenter + hh, cls: 'bottom-right' },  // 3: BR
        { x: xCenter, y: yCenter - hh - sideOffset, cls: 'top-side' },    // 4: ST
        { x: xCenter, y: yCenter + hh + sideOffset, cls: 'bottom-side' }  // 5: SB
      ];

      const pos = pocketPositions[pocketId] || { x: 512, y: 338, cls: '' };
      const left = (pos.x / 10.24).toFixed(1);
      const top = (pos.y / 5.76).toFixed(1);

      overlay.innerHTML = `
        <div class="suit-mapping-card ${pos.cls}" style="position: absolute; left: ${left}%; top: ${top}%;">
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

      // Per GDD Section 4: duplicate prevention is scoped to the active player's own hand only.
      // A wildcard may NOT replicate a card the player already holds.
      const playerHand = this.hands[player] || [];
      const isOccupied = (r, s) => playerHand.some(c => c.rank === r && c.suit === s);
      const suits = ['S', 'H', 'D', 'C'];
      const allSuitsOccupied = (r) => suits.every(s => isOccupied(r, s));

      // Find first available valid card combination to set as default
      let selectedRank = null;
      let selectedSuit = null;
      let foundDefault = false;
      for (let r = 1; r <= 13; r++) {
        for (const s of suits) {
          if (!isOccupied(r, s)) {
            selectedRank = r;
            selectedSuit = s;
            foundDefault = true;
            break;
          }
        }
        if (foundDefault) break;
      }

      const overlay = document.createElement('div');
      overlay.className = 'wildcard-selector-overlay';

      const rankNames = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
      let ranksHtml = '';
      for (let r = 1; r <= 13; r++) {
        const label = rankNames[r] || r.toString();
        const isDisabled = allSuitsOccupied(r);
        ranksHtml += `<button class="wild-rank-btn" data-rank="${r}" ${isDisabled ? 'disabled' : ''}>${label}</button>`;
      }

      overlay.innerHTML = `
        <div class="wildcard-selector-card">
          <h2 class="suit-mapping-title" style="color: #ffd700; text-shadow: 0 0 15px rgba(255, 215, 0, 0.6); margin-bottom: 5px;">WILDCARD CREATOR</h2>
          <p class="suit-mapping-subtitle" style="margin-bottom: 12px;">${player.toUpperCase()} hit a Wild Pocket!<br>Design your custom wildcard (no duplicates allowed):</p>
          
          <!-- Live Preview Card -->
          <div class="wild-card-preview-container">
            <div id="wild-card-preview" class="wild-card-preview">
              <!-- Rendered dynamically -->
            </div>
          </div>
          
          <!-- Ranks Grid -->
          <div class="wild-ranks-grid">
            ${ranksHtml}
          </div>
          
          <!-- Suits Selector Row -->
          <div class="wild-suits-row">
            <button class="wild-suit-btn spades" data-suit="S">♠</button>
            <button class="wild-suit-btn hearts" data-suit="H">♥</button>
            <button class="wild-suit-btn diamonds" data-suit="D">♦</button>
            <button class="wild-suit-btn clubs" data-suit="C">♣</button>
          </div>
          
          <button id="wild-confirm-btn" style="background: linear-gradient(135deg, #ffd700 0%, #ffb300 100%); color: #0d1527; border: none; border-radius: 8px; padding: 12px 25px; font-size: 14px; font-weight: bold; cursor: pointer; transition: all 0.25s; width: 100%; box-shadow: 0 4px 15px rgba(255, 215, 0, 0.4); letter-spacing: 1px;">
            ADD TO HAND
          </button>
        </div>
      `;
      container.appendChild(overlay);

      // DOM functions for updating selections
      const updateCardPreview = () => {
        const suitSymbols = { S: '♠', H: '♥', D: '♦', C: '♣' };
        const rankSymbols = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
        
        const symbol = suitSymbols[selectedSuit];
        const rankLabel = rankSymbols[selectedRank] || selectedRank.toString();
        const isRed = selectedSuit === 'H' || selectedSuit === 'D';
        
        const previewCard = overlay.querySelector('#wild-card-preview');
        if (previewCard) {
          previewCard.className = `wild-card-preview ${isRed ? 'red-suit' : ''}`;
          previewCard.innerHTML = `
            <div class="preview-top">${rankLabel}</div>
            <div class="preview-center">${symbol}</div>
            <div class="preview-top" style="transform: rotate(180deg); align-self: flex-end;">${rankLabel}</div>
          `;
        }
      };

      const updateSuitButtons = () => {
        const buttons = overlay.querySelectorAll('.wild-suit-btn');
        buttons.forEach(btn => {
          const s = btn.getAttribute('data-suit');
          const occupied = isOccupied(selectedRank, s);
          if (occupied) {
            btn.disabled = true;
            btn.classList.remove('selected');
          } else {
            btn.disabled = false;
            if (s === selectedSuit) {
              btn.classList.add('selected');
            } else {
              btn.classList.remove('selected');
            }
          }
        });
      };

      const selectRank = (r) => {
        selectedRank = r;
        
        // Update rank button active styles
        overlay.querySelectorAll('.wild-rank-btn').forEach(btn => {
          const rVal = parseInt(btn.getAttribute('data-rank'));
          if (rVal === selectedRank) {
            btn.classList.add('selected');
          } else {
            btn.classList.remove('selected');
          }
        });
        
        // If current suit is occupied for the new rank, auto-switch to first available
        if (isOccupied(selectedRank, selectedSuit)) {
          selectedSuit = suits.find(s => !isOccupied(selectedRank, s));
        }
        
        updateSuitButtons();
        updateCardPreview();
      };

      const selectSuit = (s) => {
        if (isOccupied(selectedRank, s)) return;
        selectedSuit = s;
        updateSuitButtons();
        updateCardPreview();
      };

      // Add event listeners to rank buttons
      overlay.querySelectorAll('.wild-rank-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const r = parseInt(btn.getAttribute('data-rank'));
          selectRank(r);
        });
      });
      
      // Add event listeners to suit buttons
      overlay.querySelectorAll('.wild-suit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const s = btn.getAttribute('data-suit');
          selectSuit(s);
        });
      });

      // Initialize defaults
      if (selectedRank !== null && selectedSuit !== null) {
        selectRank(selectedRank);
      }

      const confirmBtn = overlay.querySelector('#wild-confirm-btn');
      confirmBtn.addEventListener('click', () => {
        if (selectedRank === null || selectedSuit === null || isOccupied(selectedRank, selectedSuit)) return;
        
        overlay.style.opacity = '0';
        setTimeout(() => {
          overlay.remove();
          this.controls.enabled = true;
          resolve({ rank: selectedRank, suit: selectedSuit });
        }, 350);
      });
    });
  }


  /**
   * Opens standard 5-card swap HTML modal overlay.
   * Prompts the active player to choose exactly 1 card to discard from their 6 cards.
   * @param {string} player The active player's name
   * @returns {Promise<void>}
   */
  promptCardSwap(player) {
    return new Promise((resolve) => {
      this.controls.enabled = false;
      const container = document.getElementById('game-container') || document.body;

      const hand = this.hands[player];
      if (!hand || hand.length <= 5) {
        this.controls.enabled = true;
        resolve();
        return;
      }

      const overlay = document.createElement('div');
      overlay.className = 'card-swap-overlay';

      const suitSymbols = { S: '♠', H: '♥', D: '♦', C: '♣' };
      const rankSymbols = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };

      let cardsHtml = '';
      hand.forEach((card, idx) => {
        const symbol = suitSymbols[card.suit];
        const rankLabel = rankSymbols[card.rank] || card.rank.toString();
        const isRed = card.suit === 'H' || card.suit === 'D';
        cardsHtml += `
          <div class="swap-card-item ${isRed ? 'red-suit' : ''}" data-index="${idx}">
            <div class="preview-top">${rankLabel}</div>
            <div class="preview-center">${symbol}</div>
            <div class="preview-top" style="transform: rotate(180deg); align-self: flex-end;">${rankLabel}</div>
          </div>
        `;
      });

      overlay.innerHTML = `
        <div class="card-swap-card">
          <h2 class="suit-mapping-title" style="color: #00e5ff; text-shadow: 0 0 15px rgba(0, 229, 255, 0.6); margin-bottom: 5px;">DISCARD CARD</h2>
          <p class="suit-mapping-subtitle" style="margin-bottom: 15px;">${player.toUpperCase()} has 6 cards in hand.<br>Choose exactly 1 card to discard permanently:</p>
          <div class="swap-cards-grid">
            ${cardsHtml}
          </div>
          <button id="swap-confirm-btn" style="background: linear-gradient(135deg, #00e5ff 0%, #00b0ff 100%); color: #0d1527; border: none; border-radius: 8px; padding: 12px 25px; font-size: 14px; font-weight: bold; cursor: pointer; transition: all 0.25s; width: 100%; box-shadow: 0 4px 15px rgba(0, 229, 255, 0.4); letter-spacing: 1px; margin-top: 20px;">
            CONFIRM DISCARD
          </button>
        </div>
      `;
      container.appendChild(overlay);

      // Select first card by default
      let selectedIdx = 0;
      const cardElements = overlay.querySelectorAll('.swap-card-item');
      if (cardElements.length > 0) {
        cardElements[0].classList.add('selected');
      }

      cardElements.forEach(elem => {
        elem.addEventListener('click', () => {
          cardElements.forEach(e => e.classList.remove('selected'));
          elem.classList.add('selected');
          selectedIdx = parseInt(elem.getAttribute('data-index'));
        });
      });

      const confirmBtn = overlay.querySelector('#swap-confirm-btn');
      confirmBtn.addEventListener('click', () => {
        if (selectedIdx < 0 || selectedIdx >= hand.length) return;
        
        // Remove the selected card from hand
        hand.splice(selectedIdx, 1);

        overlay.style.opacity = '0';
        setTimeout(() => {
          overlay.remove();
          this.controls.enabled = true;
          if (this.renderer) {
            this.renderer.updateHUD(this.hands, this.activePlayer, this.consecutiveMisses);
          }
          resolve();
        }, 350);
      });
    });
  }

  /**
   * Creates and appends the persistent ? rules button to the HUD.
   * Safe to call multiple times — skips if already present.
   * @param {HTMLElement} container The game container DOM element
   */
  _injectRulesButton(container) {
    if (document.getElementById('rules-help-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'rules-help-btn';
    btn.className = 'hud-rules-btn';
    btn.title = 'Rules Reference';
    btn.textContent = '?';
    btn.addEventListener('click', () => this.showRulesModal());
    container.appendChild(btn);
  }

  /**
   * Opens the full scrollable rules reference modal.
   * Covers all game rules: table layout, pockets/suits, card scoring,
   * poker hand rankings, stand mechanic, and DQ rules.
   */
  showRulesModal() {
    const container = document.getElementById('game-container') || document.body;
    if (document.querySelector('.rules-modal-overlay')) return; // Already open

    const overlay = document.createElement('div');
    overlay.className = 'rules-modal-overlay';
    overlay.innerHTML = `
      <div class="rules-modal-card">
        <h2 class="rules-modal-title">📖 How to Play</h2>

        <div class="rules-section-header">The Goal</div>
        <div class="rules-row">
          <span class="rules-badge">🏆</span>
          <span class="rules-text">Build the best <strong>5-card poker hand</strong> by pocketing pool balls. Each pocket is linked to a suit (♠ ♥ ♦ ♣). Pocket a ball → earn a card. Best hand at showdown wins.</span>
        </div>

        <div class="rules-section-header">Table & Pockets</div>
        <div class="rules-row">
          <span class="rules-badge">6</span>
          <span class="rules-text">There are <strong>6 pockets</strong> — 4 corners + 2 side pockets. The first 4 balls pocketed into 4 different pockets each claim a <strong>suit</strong> for that pocket.</span>
        </div>
        <div class="rules-row">
          <span class="rules-badge">★</span>
          <span class="rules-text">Once 4 suits are claimed, the remaining 2 pockets become <strong>Wild</strong>. Pocketing into a Wild lets you choose any rank and suit (no duplicates in your own hand).</span>
        </div>

        <div class="rules-section-header">Earning Cards</div>
        <div class="rules-row">
          <span class="rules-badge">✅</span>
          <span class="rules-text"><strong>Valid shot:</strong> Pocket any numbered ball (1–15) into a claimed or Wild pocket → earn one card. Your miss counter resets.</span>
        </div>
        <div class="rules-row">
          <span class="rules-badge">🔁</span>
          <span class="rules-text"><strong>Bonus turn:</strong> Score a valid card and your turn continues — keep shooting until you miss.</span>
        </div>
        <div class="rules-row">
          <span class="rules-badge">⚠️</span>
          <span class="rule