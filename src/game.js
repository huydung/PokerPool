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

  /** Convenience getter — the name of the player who is NOT currently active. */
  get opponent() {
    return this.activePlayer === this.player1Name ? this.player2Name : this.player1Name;
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
    // Decouple Stand button: renderer fires this callback instead of reaching into gameRef directly
    this.renderer.onStandRequested = (player) => this.triggerStand(player);

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

    const opponent = this.opponent;

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
          this.showShotToast(`🎱 Break! ${ballsPocketedCount} ball${ballsPocketedCount > 1 ? 's' : ''} respawned (safe haven) — ${this.activePlayer} keeps turn`, 'miss');
          console.log(`Legal break with pocketed balls. Respawns completed. ${this.activePlayer} keeps turn.`);
        } else {
          // Legal break but no pocketed balls: pass turn cleanly to opponent
          this.activePlayer = opponent;
          this.showShotToast(`🎱 Break! No balls pocketed — turn passes to ${this.activePlayer}`, 'miss');
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
        if (this.controls) this.controls.hasBallInHand = true;

        const breakFaultReason = this.cueBallScratchThisShot ? 'Scratch on break' : 'Illegal break (too few cushion contacts)';
        this.showShotToast(`🚫 ${breakFaultReason} — Ball-in-Hand for ${this.activePlayer}`, 'scratch');
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
   * Scratch rule: if the cue ball was pocketed on this shot the entire shot is voided —
   * all co-pocketed target balls respawn with no cards awarded, no suit mappings made.
   * @param {PhysicsEngine} physics The active PhysicsEngine instance
   */
  async processNormalPocketedBalls(physics) {
    if (this.gameEnded) return;

    const opponent = this.activePlayer === this.player1Name ? this.player2Name : this.player1Name;

    // ── SCRATCH FIRST-CHECK ──────────────────────────────────────────────────
    // A scratch (cue ball pocketed) voids the entire shot regardless of what
    // else was pocketed. Respawn every co-pocketed ball, award nothing, end turn.
    if (this.cueBallScratchThisShot) {
      this.pocketedBallsDetails.forEach(({ ballId }) => {
        const ball = (physics.allTargetBalls || physics.targetBalls).find(b => b.plugin.ballId === ballId);
        if (ball) {
          physics.respawnBall(ball);
          if (this.renderer) this.renderer.setBallVisibility(ball.id, true);
        }
      });

      this.consecutiveMisses[this.activePlayer]++;
      const isOpponentStanding = this.handsStood[opponent];
      if (!isOpponentStanding) this.activePlayer = opponent;
      if (this.controls) this.controls.hasBallInHand = true;

      if (this.renderer) this.renderer.updateHUD(this.hands, this.activePlayer, this.consecutiveMisses);

      const scratchCount = this.pocketedBallsDetails.length;
      const respawnNote = scratchCount > 0 ? ` — ${scratchCount} ball${scratchCount > 1 ? 's' : ''} respawned` : '';
      this.showShotToast(`🎱 Scratch! Ball-in-Hand for opponent${respawnNote}`, 'scratch');
      console.log(`Scratch! All co-pocketed balls respawned. Turn → ${this.activePlayer} with Ball-in-Hand.`);

      const p1Misses = this.consecutiveMisses[this.player1Name] || 0;
      const p2Misses = this.consecutiveMisses[this.player2Name] || 0;
      if (p1Misses >= this.config.rules.maxConsecutiveMisses) {
        this.showGameOver(this.player2Name, `${this.player1Name} hit ${this.config.rules.maxConsecutiveMisses} consecutive misses (including scratch) and is disqualified!`);
      } else if (p2Misses >= this.config.rules.maxConsecutiveMisses) {
        this.showGameOver(this.player1Name, `${this.player2Name} hit ${this.config.rules.maxConsecutiveMisses} consecutive misses (including scratch) and is disqualified!`);
      }
      return;
    }
    // ────────────────────────────────────────────────────────────────────────

    let anyValidScore = false;
    const invalidReasons = [];

    for (const detail of this.pocketedBallsDetails) {
      const { ballId } = detail;
      const originalBall = (physics.allTargetBalls || physics.targetBalls).find(b => b.plugin.ballId === ballId);
      if (!originalBall) continue;

      const result = (ballId >= 1 && ballId <= 13)
        ? await this._processRankBall(detail, originalBall, physics, opponent)
        : await this._processWildcardBall(detail, originalBall, physics, opponent);

      if (result.valid) anyValidScore = true;
      if (result.invalidReason) invalidReasons.push(result.invalidReason);
    }

    // ── Turn resolution ───────────────────────────────────────────────
    const scorer = this.activePlayer; // capture before _resolveTurn may switch it
    this._resolveTurn(anyValidScore, invalidReasons, opponent);

    if (this.renderer) this.renderer.updateHUD(this.hands, this.activePlayer, this.consecutiveMisses);

    // Forced Showdown: both players have exactly 5 cards
    const p1Hand = this.hands[this.player1Name] || [];
    const p2Hand = this.hands[this.player2Name] || [];
    if (p1Hand.length === 5 && p2Hand.length === 5) { this.triggerShowdown(); return; }

    // 3-Miss Elimination (scratch path handled above)
    const maxMisses = this.config.rules.maxConsecutiveMisses;
    const p1Misses = this.consecutiveMisses[this.player1Name] || 0;
    const p2Misses = this.consecutiveMisses[this.player2Name] || 0;
    if (p1Misses >= maxMisses) {
      this.showGameOver(this.player2Name, `${this.player1Name} hit ${maxMisses} consecutive misses and is disqualified!`);
      return;
    } else if (p2Misses >= maxMisses) {
      this.showGameOver(this.player1Name, `${this.player2Name} hit ${maxMisses} consecutive misses and is disqualified!`);
      return;
    }

    // Stand Decision Modal: show whenever the scoring player just has exactly 5 cards
    const scorerHand = this.hands[scorer] || [];
    if (anyValidScore && scorerHand.length === 5 && !this.handsStood[scorer] && !this.gameEnded) {
      await this.showStandDecisionModal(scorer);
      // After the modal, re-sync HUD (triggerStand may have changed activePlayer)
      if (this.renderer) this.renderer.updateHUD(this.hands, this.activePlayer, this.consecutiveMisses);
    }
  }

  /**
   * Handles scoring logic for a standard rank ball (1–13) pocketing event.
   * @returns {{ valid: boolean, invalidReason: string|null }}
   */
  async _processRankBall({ ballId, pocketId }, originalBall, physics, opponent) {
    const suit = this.pocketSuits[pocketId];

    if (suit === null) {
      // ── Unmapped pocket ───────────────────────────────────────────
      if (this.phase === 1) {
        const selectedSuit = await this.promptSuitMapping(this.activePlayer, pocketId, ballId);
        this.pocketSuits[pocketId] = selectedSuit;

        const hand = this.hands[this.activePlayer] || [];
        const oppHand = this.hands[opponent] || [];
        const alreadyHeld = hand.some(c => c.rank === ballId && c.suit === selectedSuit)
                         || oppHand.some(c => c.rank === ballId && c.suit === selectedSuit);

        let scored = false;
        if (!alreadyHeld) scored = await this._addCardToHand(this.activePlayer, { rank: ballId, suit: selectedSuit });

        if (this.renderer) {
          this.renderer.updatePocketGraphics(this.pocketSuits);
          this.renderer.updateHUD(this.hands, this.activePlayer, this.consecutiveMisses);
        }

        // Phase transition: 4 suits mapped → remaining unmapped become Wild
        const mappedCount = this.pocketSuits.filter(s => s !== null && s !== 'W').length;
        if (mappedCount === 4) {
          this.phase = 2;
          this.pocketSuits.forEach((s, idx) => { if (s === null) this.pocketSuits[idx] = 'W'; });
          if (this.renderer) this.renderer.updatePocketGraphics(this.pocketSuits);
        }

        physics.respawnBall(originalBall);
        if (this.renderer) this.renderer.setBallVisibility(originalBall.id, true);
        return { valid: scored, invalidReason: (!scored && alreadyHeld) ? 'duplicate' : null };
      }

      // Phase 2 — unmapped pocket (shouldn't exist but guard anyway)
      physics.respawnBall(originalBall);
      if (this.renderer) this.renderer.setBallVisibility(originalBall.id, true);
      return { valid: false, invalidReason: 'rank_in_wild' };

    } else if (suit === 'W') {
      // ── Wild pocket — rank balls forbidden ────────────────────────
      physics.respawnBall(originalBall);
      if (this.renderer) this.renderer.setBallVisibility(originalBall.id, true);
      return { valid: false, invalidReason: 'rank_in_wild' };

    } else {
      // ── Mapped suit pocket ────────────────────────────────────────
      const hand = this.hands[this.activePlayer] || [];
      const oppHand = this.hands[opponent] || [];
      const alreadyHeld = hand.some(c => c.rank === ballId && c.suit === suit)
                       || oppHand.some(c => c.rank === ballId && c.suit === suit);

      let scored = false;
      if (!alreadyHeld) {
        scored = await this._addCardToHand(this.activePlayer, { rank: ballId, suit });
        if (this.renderer) this.renderer.updateHUD(this.hands, this.activePlayer, this.consecutiveMisses);
      }

      physics.respawnBall(originalBall);
      if (this.renderer) this.renderer.setBallVisibility(originalBall.id, true);
      return { valid: scored, invalidReason: alreadyHeld ? 'duplicate' : null };
    }
  }

  /**
   * Handles scoring logic for a wildcard ball (14–15) pocketing event.
   * @returns {{ valid: boolean, invalidReason: string|null }}
   */
  async _processWildcardBall({ ballId, pocketId }, originalBall, physics, opponent) {
    const suit = this.pocketSuits[pocketId];

    if (suit === 'W') {
      // ── Wild pocket — wildcard is valid ──────────────────────────
      const chosenCard = await this.promptWildcardSelection(this.activePlayer);

      const hand = this.hands[this.activePlayer] || [];
      const oppHand = this.hands[opponent] || [];
      const alreadyHeld = hand.some(c => c.rank === chosenCard.rank && c.suit === chosenCard.suit)
                       || oppHand.some(c => c.rank === chosenCard.rank && c.suit === chosenCard.suit);

      let scored = false;
      if (!alreadyHeld) {
        scored = await this._addCardToHand(this.activePlayer, chosenCard);
        if (this.renderer) this.renderer.updateHUD(this.hands, this.activePlayer, this.consecutiveMisses);
      }

      // Wildcard is permanently removed — never respawns
      if (this.renderer) this.renderer.setBallVisibility(originalBall.id, false);
      Matter.Composite.remove(physics.world, originalBall);
      physics.targetBalls = physics.targetBalls.filter(b => b.id !== originalBall.id);

      return { valid: scored, invalidReason: alreadyHeld ? 'duplicate' : null };

    } else {
      // ── Suit or unmapped pocket — wildcard forbidden ──────────────
      physics.respawnBall(originalBall);
      if (this.renderer) this.renderer.setBallVisibility(originalBall.id, true);
      return { valid: false, invalidReason: 'wildcard_wrong_pocket' };
    }
  }

  /**
   * Adds a card to a player's hand, triggering a card-swap prompt if the hand exceeds 5.
   * Tracks the first player to complete their hand.
   * @returns {boolean} true — card was added (caller should treat this as a valid score)
   */
  async _addCardToHand(player, card) {
    const hand = this.hands[player] || [];
    hand.push(card);
    if (!this.firstToCompleteHand && hand.length === 5) this.firstToCompleteHand = player;
    if (hand.length > 5) await this.promptCardSwap(player);
    return true;
  }

  /**
   * Resolves the turn outcome: updates active player, miss counter, and fires the shot toast.
   * Turn shift rules (GDD Section 4):
   *  • Valid score only  → keep turn, reset miss counter.
   *  • Valid + invalid   → reset miss counter, end turn (invalid drop ends it).
   *  • Invalid only      → increment miss counter, end turn.
   *  • Complete miss     → increment miss counter, end turn.
   * @param {boolean}  anyValidScore
   * @param {string[]} invalidReasons  Array of reason codes from this shot's invalid events
   * @param {string}   opponent        The non-active player's name (captured before any switch)
   */
  _resolveTurn(anyValidScore, invalidReasons, opponent) {
    const anyInvalidDrop = invalidReasons.length > 0;
    const isOpponentStanding = this.handsStood[opponent];
    const primaryReason = invalidReasons[0] || null;

    if (anyValidScore && !anyInvalidDrop) {
      this.consecutiveMisses[this.activePlayer] = 0;
      const handSize = (this.hands[this.activePlayer] || []).length;
      this.showShotToast(`✅ Scored! ${this.activePlayer} earns a card (${handSize}/5) — bonus turn`, 'score');
      console.log(`${this.activePlayer} scored and keeps their turn.`);

    } else if (anyValidScore && anyInvalidDrop) {
      this.consecutiveMisses[this.activePlayer] = 0;
      if (!isOpponentStanding) this.activePlayer = opponent;
      this.showShotToast(`⚠️ Mixed shot — card scored, but: ${this._invalidReasonText(primaryReason)}`, 'mixed');
      console.log(`Mixed shot (valid + invalid). Miss counter reset, turn ends.`);

    } else if (anyInvalidDrop) {
      const prevPlayer = this.activePlayer;
      this.consecutiveMisses[this.activePlayer]++;
      const missCount = this.consecutiveMisses[prevPlayer];
      if (!isOpponentStanding) this.activePlayer = opponent;
      this.showShotToast(`🚫 ${this._invalidReasonText(primaryReason)} (miss #${missCount})`, 'invalid');
      console.log(`Invalid drop — turn transitions to ${this.activePlayer}`);

    } else {
      this.consecutiveMisses[this.activePlayer]++;
      if (!isOpponentStanding) this.activePlayer = opponent;
      this.showShotToast(`💨 Miss — no balls pocketed. Turn → ${this.activePlayer}`, 'miss');
      console.log(`Miss. Turn transitions to ${this.activePlayer}`);
    }
  }

  /**
   * Returns a human-readable explanation for a given invalid-drop reason code.
   * @param {string|null} reason
   * @returns {string}
   */
  _invalidReasonText(reason) {
    switch (reason) {
      case 'duplicate':            return 'Card already held by either player';
      case 'wildcard_wrong_pocket': return '★ Wildcard must be played into a Wild ★ Pocket';
      case 'rank_in_wild':         return 'Numbered ball cannot score in a Wild ★ Pocket';
      default:                     return 'Invalid drop';
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

      // No card may be duplicated across either player's hand.
      // A wildcard choice is blocked if that exact rank+suit is already held by anyone.
      const playerHand = this.hands[player] || [];
      const opponentName = player === this.player1Name ? this.player2Name : this.player1Name;
      const opponentHandWild = this.hands[opponentName] || [];
      const isOccupied = (r, s) =>
        playerHand.some(c => c.rank === r && c.suit === s) ||
        opponentHandWild.some(c => c.rank === r && c.suit === s);
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
          <span class="rules-text">Once 4 suits are claimed, the remaining 2 pockets become <strong>Wild</strong>. Pocketing into a Wild lets you choose any rank and suit — but not a card already held by either player.</span>
        </div>

        <div class="rules-section-header">Earning Cards</div>
        <div class="rules-row">
          <span class="rules-badge">✅</span>
          <span class="rules-text"><strong>Valid shot:</strong> Pocket any numbered ball (1–15) into a claimed or Wild pocket → earn one card. Your miss counter resets.</span>
        </div>
        <div class="rules-row">
          <span class="rules-badge">🔁</span>
          <span class="rules-text"><strong>Keeping turn:</strong> Score a valid card and your turn continues — keep shooting until you miss.</span>
        </div>
        <div class="rules-row">
          <span class="rules-badge">⚠️</span>
          <span class="rules-text"><strong>Invalid drop:</strong> No card may exist in both players' hands simultaneously. If the ball you pocket would create a duplicate (same rank+suit already held by either player), it respawns, your turn ends, and it counts as a miss.</span>
        </div>
        <div class="rules-row">
          <span class="rules-badge">5</span>
          <span class="rules-text"><strong>Hand limit:</strong> Maximum 5 cards. On earning a 6th you must discard one — choose wisely.</span>
        </div>

        <div class="rules-section-header">Break Shot</div>
        <div class="rules-row">
          <span class="rules-badge">🎱</span>
          <span class="rules-text">The opening break is <strong>safe haven</strong> — any balls pocketed on the break respawn. No cards are awarded and no suits are claimed. You need ${this.config.rules.minBreakCushionContacts ?? 4} cushion contacts minimum if no ball is pocketed, or the break is a foul.</span>
        </div>

        <div class="rules-section-header">Ball-in-Hand</div>
        <div class="rules-row">
          <span class="rules-badge">👋</span>
          <span class="rules-text">After a scratch (cue ball pocketed), your opponent gets <strong>Ball-in-Hand</strong> — they can place the cue ball anywhere on the table (not overlapping another ball). Hit <em>Confirm Position</em> to lock it in.</span>
        </div>

        <div class="rules-section-header">Standing</div>
        <div class="rules-row">
          <span class="rules-badge">🛑</span>
          <span class="rules-text">When you have a <strong>full 5-card hand</strong> you may <em>Stand</em>. Your opponent then gets <strong>${this.config.rules.standCountdownTurns ?? 3} more turns</strong> to finish their hand. Showdown happens at turn 0 or when both players have stood.</span>
        </div>

        <div class="rules-section-header">Disqualification</div>
        <div class="rules-row">
          <span class="rules-badge">❌</span>
          <span class="rules-text"><strong>${this.config.rules.maxConsecutiveMisses ?? 3} consecutive misses</strong> = DQ. Your opponent wins automatically. Scoring a valid card resets your miss counter.</span>
        </div>

        <div class="rules-section-header">Poker Hand Rankings</div>
        <div class="rules-hand-grid">
          <div class="rules-hand-item"><span class="rules-hand-rank">10</span><span class="rules-hand-label">Royal Flush</span></div>
          <div class="rules-hand-item"><span class="rules-hand-rank">9</span><span class="rules-hand-label">Straight Flush</span></div>
          <div class="rules-hand-item"><span class="rules-hand-rank">8</span><span class="rules-hand-label">Four of a Kind</span></div>
          <div class="rules-hand-item"><span class="rules-hand-rank">7</span><span class="rules-hand-label">Full House</span></div>
          <div class="rules-hand-item"><span class="rules-hand-rank">6</span><span class="rules-hand-label">Flush</span></div>
          <div class="rules-hand-item"><span class="rules-hand-rank">5</span><span class="rules-hand-label">Straight</span></div>
          <div class="rules-hand-item"><span class="rules-hand-rank">4</span><span class="rules-hand-label">Three of a Kind</span></div>
          <div class="rules-hand-item"><span class="rules-hand-rank">3</span><span class="rules-hand-label">Two Pair</span></div>
          <div class="rules-hand-item"><span class="rules-hand-rank">2</span><span class="rules-hand-label">One Pair</span></div>
          <div class="rules-hand-item"><span class="rules-hand-rank">1</span><span class="rules-hand-label">High Card</span></div>
        </div>
        <div class="rules-row" style="margin-top:8px;">
          <span class="rules-badge">A</span>
          <span class="rules-text">Ace plays <strong>high or low</strong>. A-2-3-4-5 (the "wheel") is the lowest straight.</span>
        </div>
        <div class="rules-row">
          <span class="rules-badge">≡</span>
          <span class="rules-text">Tied hands are broken by <strong>kickers</strong>, then by who stood first, then by who completed their hand first.</span>
        </div>

        <button class="rules-close-btn" id="rules-close-btn">GOT IT — CLOSE</button>
      </div>
    `;

    container.appendChild(overlay);

    // Close on button click or backdrop click
    document.getElementById('rules-close-btn').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }

  /**
   * Shows the Stand Decision Modal when a player has collected their 5th card.
   * The modal offers two choices:
   *   • "Keep my hand (STAND)" — calls triggerStand; opponent gets standCountdownTurns shots.
   *   • "Continue shooting"    — dismisses; player keeps their turn and may improve the hand.
   *
   * The modal re-appears after every subsequent valid score + swap while the player holds 5 cards.
   * @param {string} player The player who just reached or maintained 5 cards
   * @returns {Promise<void>} Resolves when the player clicks either button
   */
  showStandDecisionModal(player) {
    return new Promise((resolve) => {
      if (this.gameEnded || this.handsStood[player]) { resolve(); return; }
      if (this.controls) this.controls.enabled = false;

      const suitSymbols = { S: '♠', H: '♥', D: '♦', C: '♣' };
      const rankLabels  = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
      const hand = this.hands[player] || [];
      const handStr = hand.map(c => {
        const r = rankLabels[c.rank] || String(c.rank);
        const s = suitSymbols[c.suit] || c.suit;
        return `${r}${s}`;
      }).join('  ');

      const countdownTurns = this.config.rules.standCountdownTurns;
      const isP1 = player === this.player1Name;
      const accentColor = isP1 ? '#00e5ff' : '#e040fb';
      const container = document.getElementById('game-container') || document.body;

      const overlay = document.createElement('div');
      overlay.className = 'stand-decision-overlay';
      overlay.innerHTML = `
        <div class="stand-decision-card">
          <div class="stand-decision-badge" style="color:${accentColor};">★ DECISION TIME ★</div>
          <div class="stand-decision-player" style="color:${accentColor};">${player}</div>
          <div class="stand-decision-hand-title">Your current hand:</div>
          <div class="stand-decision-hand-str">${handStr}</div>
          <div class="stand-decision-divider"></div>
          <div class="stand-decision-options">
            <div class="stand-decision-option keep-option">
              <div class="stand-option-icon">🛑</div>
              <div class="stand-option-title">KEEP my hand</div>
              <div class="stand-option-desc">Lock in your 5 cards now.<br>Your opponent gets <strong>${countdownTurns} more turns</strong> to improve their hand, then it's Showdown.</div>
              <button class="stand-btn-keep" id="stand-modal-keep">Keep &amp; Stand</button>
            </div>
            <div class="stand-decision-sep">or</div>
            <div class="stand-decision-option continue-option">
              <div class="stand-option-icon">🎱</div>
              <div class="stand-option-title">CONTINUE shooting</div>
              <div class="stand-option-desc">Keep playing. You can swap out a card for a better one — but so can your opponent.</div>
              <button class="stand-btn-continue" id="stand-modal-continue">Continue shooting</button>
            </div>
          </div>
        </div>
      `;

      container.appendChild(overlay);

      const doKeep = () => {
        overlay.remove();
        if (this.controls) this.controls.enabled = true;
        this.triggerStand(player);
        resolve();
      };

      const doContinue = () => {
        overlay.remove();
        if (this.controls) this.controls.enabled = true;
        resolve();
      };

      overlay.querySelector('#stand-modal-keep').addEventListener('click', (e) => { e.stopPropagation(); doKeep(); });
      overlay.querySelector('#stand-modal-continue').addEventListener('click', (e) => { e.stopPropagation(); doContinue(); });
    });
  }

  /**
   * Puts player into voluntary stand state.
   * Locks player controls, resets lasers, and starts a countdown for opponent.
   * @param {string} player The standing player's name
   */
  triggerStand(player) {
    if (this.gameEnded) return;
    const hand = this.hands[player];
    if (!hand || hand.length !== 5) {
      console.warn(`Cannot stand. ${player} does not have exactly 5 cards.`);
      return;
    }

    console.log(`${player} decided to voluntary stand!`);
    this.handsStood[player] = true;
    this.standingPlayer = player;
    
    if (!this.firstToStand) {
      this.firstToStand = player;
    }

    const opponent = player === this.player1Name ? this.player2Name : this.player1Name;

    // Double stand check: if opponent has already stood or stands now, trigger showdown immediately!
    if (this.handsStood[opponent]) {
      this.triggerShowdown();
      return;
    }

    // Set countdown to 3 shots for opponent
    this.standCountdown = this.config.rules.standCountdownTurns;

    // Set turn to opponent immediately
    this.activePlayer = opponent;

    // Lock aiming lasers or disable controls for standing player (they don't shoot anymore)
    if (this.renderer) {
      this.renderer.updateHUD(this.hands, this.activePlayer, this.consecutiveMisses);
      this.renderer.setActivePlayer(this.activePlayer);
    }

    console.log(`Stand countdown started. ${opponent} has ${this.config.rules.standCountdownTurns} shots to optimize their hand.`);
  }

  /**
   * Collects both card hands, runs the standard 5-card poker evaluator,
   * compares hands with kicker tiebreaker, and displays the game over screen.
   */
  triggerShowdown() {
    if (this.gameEnded) return;
    this.gameEnded = true;

    if (this.controls) {
      this.controls.enabled = false;
    }

    const handA = this.hands[this.player1Name] || [];
    const handB = this.hands[this.player2Name] || [];

    const result = compareHands(handA, handB, this.standingPlayer, this.firstToStand, this.firstToCompleteHand, this.player1Name, this.player2Name);
    
    const suitSymbols = { S: '♠', H: '♥', D: '♦', C: '♣' };
    const rankSymbols = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };

    const getHandStr = (hand) => {
      if (hand.length === 0) return "Empty Hand";
      return hand.map(c => {
        const symbol = suitSymbols[c.suit] || c.suit;
        const rankLabel = rankSymbols[c.rank] || c.rank.toString();
        return `${rankLabel}${symbol}`;
      }).join(', ');
    };

    const details = `
      <div style="margin-top: 15px; border-top: 1px solid rgba(255,255,255,0.15); padding-top: 15px; text-align: left; font-family: monospace; font-size: 12px; color: #a0aab8;">
        <div style="margin-bottom: 8px;"><strong style="color: #00e5ff;">Alice's Hand:</strong> ${getHandStr(handA)}<br><span style="color: #64b5f6;">(${result.labelA})</span></div>
        <div style="margin-bottom: 8px;"><strong style="color: #e040fb;">Bob's Hand:</strong> ${getHandStr(handB)}<br><span style="color: #ba68c8;">(${result.labelB})</span></div>
        <div style="margin-top: 10px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 8px; color: #ffd700; font-weight: bold; text-align: center;">${result.reason}</div>
      </div>
    `;

    const winnerName = result.winner === 'A' ? this.player1Name : this.player2Name;
    
    this.showGameOver(winnerName, details);
  }

  /**
   * Opens static HTML overlay for final Match Over.
   * Always sets gameEnded = true first to prevent any subsequent shot evaluations
   * from re-triggering overlays (e.g. 3-miss DQ path bypasses triggerShowdown).
   */
  showGameOver(winner, reason) {
    this.gameEnded = true;
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

  /**
   * Displays a brief toast notification just below the HUD describing what
   * happened on the previous shot. Replaces any already-visible toast.
   * Automatically dismisses after `duration` ms.
   *
   * @param {string} message   Human-readable shot summary
   * @param {'score'|'scratch'|'miss'|'invalid'|'mixed'} type  Visual variant
   * @param {number} [duration=3000]  Auto-dismiss delay in milliseconds
   */
  showShotToast(message, type = 'miss', duration = 3000) {
    const container = document.getElementById('game-container') || document.body;

    // Remove any previous toast immediately, clearing its pending exit timer first
    const existing = container.querySelector('.shot-toast');
    if (existing) {
      clearTimeout(existing._exitTimer);
      existing.remove();
    }

    const toast = document.createElement('div');
    toast.className = `shot-toast type-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    // Schedule exit animation then removal
    const exitTimer = setTimeout(() => {
      toast.classList.add('toast-exit');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }, duration);

    // Clean up timer if toast is removed early (e.g. next toast replaces it)
    toast._exitTimer = exitTimer;
  }
}
