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
    this.cueBallScratchThisShot = false;
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
  handlePocketOverlap(ball) {
    if (ball.label === 'cue_ball') {
      this.cueBallScratchThisShot = true;
    } else {
      const ballId = ball.plugin.ballId;
      if (!this.pocketedBallsThisShot.includes(ballId)) {
        this.pocketedBallsThisShot.push(ballId);
      }
    }
  }

  /**
   * Reset tracking registers when a shot starts rolling
   */
  handleShotStart() {
    this.pocketedBallsThisShot = [];
    this.cueBallScratchThisShot = false;
  }

  /**
   * Evaluates rules, turns, cushion contact validity, and safe-haven break rules.
   * @param {PhysicsEngine} physics The active PhysicsEngine instance
   */
  handleShotEnd(physics) {
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
        
        // Reset cue ball position to head string center behind kitchen bounds
        if (physics.cueBall) {
          const headStringX = this.config.table.xCenter - this.config.table.width / 4;
          Matter.Body.setPosition(physics.cueBall, { x: headStringX, y: this.config.table.yCenter });
          Matter.Body.setVelocity(physics.cueBall, { x: 0, y: 0 });
          Matter.Body.setAngularVelocity(physics.cueBall, 0);
        }

        console.log(`Illegal break or scratch. Turn passes to ${this.activePlayer} with Ball-in-Hand.`);
      }

      // Conclude break shot phase
      this.isBreakShot = false;
      physics.isBreakShot = false;
    } else {
      // 2. Normal Shot Evaluation (Placeholder for Milestone 3 & 4)
      if (this.cueBallScratchThisShot) {
        this.consecutiveMisses[this.activePlayer]++;
        this.activePlayer = opponent;
        console.log(`Scratch! Turn transitions to ${this.activePlayer}`);
      } else if (this.pocketedBallsThisShot.length > 0) {
        // Successful target ball pocketed: maintain turn (placeholder)
        this.consecutiveMisses[this.activePlayer] = 0;
        console.log(`${this.activePlayer} pocketed a ball and continues their turn.`);
      } else {
        // Miss: pass turn
        this.consecutiveMisses[this.activePlayer]++;
        this.activePlayer = opponent;
        console.log(`Miss. Turn transitions to ${this.activePlayer}`);
      }
    }

    // Synchronize renderer turn status
    this.renderer.setActivePlayer(this.activePlayer);
  }
}
