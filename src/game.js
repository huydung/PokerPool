import { CONFIG } from './config.js';
import Matter from 'matter-js';
import { compareHands, evaluatePokerHand } from './poker.js';

/**
 * Returns an inline SVG string for a playing-card suit symbol.
 * All four suits use the exact same bounding box so they always render at
 * identical sizes — no font-metric or emoji-rendering inconsistencies.
 *
 * @param {string} suit  'S' | 'H' | 'D' | 'C'
 * @param {number} size  Width & height in px (default 16)
 * @returns {string} HTML snippet containing an <svg> element
 */
function suitSvg(suit, size = 16) {
  const s = size / 2;
  const cx = s, cy = s;
  const isRed = suit === 'H' || suit === 'D';
  const color = isRed ? '#d32f2f' : '#1a1a1a';

  const f = n => n.toFixed(2); // compact coordinate formatter

  let shapes = '';
  if (suit === 'D') {
    shapes = `<polygon points="${f(cx)},${f(cy-s)} ${f(cx+s*0.72)},${f(cy)} ${f(cx)},${f(cy+s)} ${f(cx-s*0.72)},${f(cy)}" fill="${color}"/>`;

  } else if (suit === 'H') {
    const lr = f(s * 0.55);
    shapes = `
      <circle cx="${f(cx-s*0.30)}" cy="${f(cy-s*0.15)}" r="${lr}" fill="${color}"/>
      <circle cx="${f(cx+s*0.30)}" cy="${f(cy-s*0.15)}" r="${lr}" fill="${color}"/>
      <polygon points="${f(cx-s*0.90)},${f(cy-s*0.10)} ${f(cx+s*0.90)},${f(cy-s*0.10)} ${f(cx)},${f(cy+s)}" fill="${color}"/>`;

  } else if (suit === 'S') {
    const lr = f(s * 0.50);
    shapes = `
      <polygon points="${f(cx)},${f(cy-s)} ${f(cx+s*0.90)},${f(cy+s*0.25)} ${f(cx-s*0.90)},${f(cy+s*0.25)}" fill="${color}"/>
      <circle cx="${f(cx-s*0.35)}" cy="${f(cy+s*0.12)}" r="${lr}" fill="${color}"/>
      <circle cx="${f(cx+s*0.35)}" cy="${f(cy+s*0.12)}" r="${lr}" fill="${color}"/>
      <polygon points="${f(cx-s*0.20)},${f(cy+s*0.35)} ${f(cx+s*0.20)},${f(cy+s*0.35)} ${f(cx+s*0.20)},${f(cy+s*0.75)} ${f(cx-s*0.20)},${f(cy+s*0.75)}" fill="${color}"/>
      <polygon points="${f(cx-s*0.55)},${f(cy+s)} ${f(cx+s*0.55)},${f(cy+s)} ${f(cx+s*0.25)},${f(cy+s*0.72)} ${f(cx-s*0.25)},${f(cy+s*0.72)}" fill="${color}"/>`;

  } else if (suit === 'C') {
    const cr = f(s * 0.44);
    shapes = `
      <circle cx="${f(cx)}"           cy="${f(cy-s*0.30)}" r="${cr}" fill="${color}"/>
      <circle cx="${f(cx-s*0.46)}"    cy="${f(cy+s*0.22)}" r="${cr}" fill="${color}"/>
      <circle cx="${f(cx+s*0.46)}"    cy="${f(cy+s*0.22)}" r="${cr}" fill="${color}"/>
      <polygon points="${f(cx-s*0.20)},${f(cy+s*0.38)} ${f(cx+s*0.20)},${f(cy+s*0.38)} ${f(cx+s*0.20)},${f(cy+s*0.72)} ${f(cx-s*0.20)},${f(cy+s*0.72)}" fill="${color}"/>
      <polygon points="${f(cx-s*0.55)},${f(cy+s)} ${f(cx+s*0.55)},${f(cy+s)} ${f(cx+s*0.25)},${f(cy+s*0.70)} ${f(cx-s*0.25)},${f(cy+s*0.70)}" fill="${color}"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="display:inline-block;vertical-align:middle;flex-shrink:0">${shapes}</svg>`;
}

/**
 * Orchestrates game rules, player active turns, coin toss,
 * and handles the discard-token system and lock-based endgame.
 */
export class GameEngine {
  constructor(config = CONFIG) {
    this.config = config;

    this.player1Name = this.config.rules?.player1Name || 'Player 1';
    this.player2Name = this.config.rules?.player2Name || 'Player 2';

    // Game state
    this.activePlayer = this.player1Name;
    this.isBreakShot = true;
    this.isTossing = false;
    this.gameEnded = false;

    // Discard tokens are REMOVED from game rules — kept as stub for legacy HUD calls only
    this.discardTokens = {
      [this.player1Name]: 0,
      [this.player2Name]: 0
    };

    // Lock state: a player is locked when they have 5 cards AND choose to stop
    // (lock logic kept for backwards compat but tokens no longer gate it)
    this.lockedPlayers = {
      [this.player1Name]: false,
      [this.player2Name]: false
    };
    this.lockedPlayer = null;       // Who triggered the lock countdown
    this.lockCountdown = -1;
    this.lockCountdownActive = false;

    // Tiebreaker tracking
    this.firstToCompleteHand = null;

    // ── Hand completion tracking ───────────────────────────────────────────────
    /** True once a player has FIRST reached 5 cards (so hand-complete dialog fires once) */
    this._handCompleted = {
      [this.player1Name]: false,
      [this.player2Name]: false
    };

    // Card hands
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
    /** True between handleShotStart and handleShotEnd — gates pocket overlap events */
    this._shotInProgress = false;

    // Pocket mapping & phase transition
    this.pocketSuits = new Array(6).fill(null);
    this.phase = 1;

    // ── End-game state ────────────────────────────────────────────────────────
    /** True once both players hold 5-card hands — triggers end-game dialog each turn */
    this._endgameEligible = false;
    /** Name of the player who first requested end game, or null */
    this._endGameFirstRequester = null;
    /** True when the opponent is taking their single final turn after a Request End Game */
    this._opponentFinalTurn = false;

    // ── Shot validity bypass flag (cheat shots skip the validity check) ───────
    this._skipShotValidityCheck = false;

    // ── AI mode ───────────────────────────────────────────────────────────────
    /** Name of the AI-controlled player, or null for PvP. Set externally from main.js. */
    this._aiPlayerName = null;
    /** Hand rank (from evaluatePokerHand) at or above which AI requests end game */
    this._aiEndGameThreshold = 5; // 5 = Straight; AI folds on weaker hands

    // ── Cheat mode ────────────────────────────────────────────────────────────
    this.cheatEnabled = false;
    /** Ordered list of physics bodies selected for cheat pocket simulation */
    this._cheatBallSelections = [];   // Array<Matter.Body>
    /** Ordered list of pocket indices selected for cheat simulation */
    this._cheatPocketSelections = []; // Array<number>
    this._cheatAwaitingFinish = false; // true while Finish Shot button is visible
  }

  get opponent() {
    return this.activePlayer === this.player1Name ? this.player2Name : this.player1Name;
  }

  /**
   * Triggers the coin toss overlay and sets the starting active player.
   *
   * @param {AimingControls} controls
   * @param {CanvasRenderer} renderer
   * @param {string|null}    forcedWinner  When provided, skip the random toss and
   *                                       declare this player the winner (used for
   *                                       AI mode where the human always breaks).
   */
  startMatch(controls, renderer, forcedWinner = null) {
    this.controls = controls;
    this.renderer = renderer;
    this.renderer.gameRef = this;

    return new Promise((resolve) => {
      this.isTossing = true;
      this.controls.enabled = false;

      const winner = forcedWinner ?? (Math.random() < 0.5 ? this.player1Name : this.player2Name);
      this.activePlayer = winner;
      console.log(`[GAME] Coin toss winner: ${winner}${forcedWinner ? ' (forced — AI mode, human breaks)' : ' (random)'}`);

      const container = document.getElementById('game-container') || document.body;

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

      requestAnimationFrame(() => {
        const coinVisual = document.getElementById('coin-visual');
        if (coinVisual) {
          const targetRot = winner === this.player1Name ? 1440 : 1620;
          coinVisual.style.transform = `rotateY(${targetRot}deg)`;
        }
      });

      setTimeout(() => {
        const statusText = document.getElementById('coin-status-text');
        if (statusText) {
          statusText.innerHTML = `Coin landed on <span class="coin-winner-neon">${winner.toUpperCase()}</span>!<br>Place the cue ball in the kitchen to break.`;
        }
      }, 1500);

      setTimeout(() => {
        overlay.style.opacity = '0';
        setTimeout(() => {
          overlay.remove();
          this.isTossing = false;
          this.controls.enabled = true;

          // Wire the right-panel "?" button to the rules modal (Pixi-native button,
          // no HTML injection needed — the panel is drawn in renderer.drawRightPanel)
          if (this.renderer) {
            this.renderer.onRulesRequest = () => this.showRulesModal();
          }

          this.renderer.setActivePlayer(this.activePlayer);

          console.log(`Coin Toss: ${this.activePlayer} breaks.`);
          resolve(winner);
        }, 500);
      }, 3200);
    });
  }

  /**
   * Records a pocket event for the current shot.
   * Returns true if the event was accepted (shot in progress), false if phantom.
   * Phantom events (ball crept in after shot declared over) should be respawned
   * by the caller — this method does NOT touch physics.
   */
  handlePocketOverlap(ball, pocketId = -1) {
    if (ball.label === 'cue_ball') {
      if (!this._shotInProgress) {
        // Cue ball scratch outside of shot window — ignore (BIH already being placed)
        console.log(`[POCKET] Cue ball scratch ignored — no shot in progress (phantom event)`);
        return false;
      }
      this.cueBallScratchThisShot = true;
      console.log(`[POCKET] Cue ball scratched → pocket ${pocketId}`);
      return true;
    } else {
      const ballId = ball.plugin.ballId;
      if (!this._shotInProgress) {
        // Ball crept into pocket after shot was declared over — phantom event
        console.warn(`[POCKET] PHANTOM: Ball ${ballId} entered pocket ${pocketId} outside shot window — caller should respawn`);
        return false; // Signal: caller must respawn
      }
      if (!this.pocketedBallsThisShot.includes(ballId)) {
        this.pocketedBallsThisShot.push(ballId);
        this.pocketedBallsDetails.push({ ballId, ball, pocketId });
        const suitLabel = this.pocketSuits[pocketId] ?? 'unset';
        console.log(`[POCKET] Ball ${ballId} → pocket ${pocketId} (suit=${suitLabel}), shot tally: [${this.pocketedBallsThisShot.join(',')}]`);
      } else {
        console.log(`[POCKET] Ball ${ballId} pocket event de-duped (already recorded this shot)`);
      }
      return true;
    }
  }

  /**
   * Logs both players' hands to the console for easy reference.
   * Called at shot start/end and after any hand change.
   */
  _logHands() {
    const rankLabels = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
    const fmt = c => `${rankLabels[c.rank] || c.rank}${c.suit}`;
    const p1h = this.hands[this.player1Name];
    const p2h = this.hands[this.player2Name];
    const p1eval = p1h.length > 0 ? (evaluatePokerHand(p1h)?.label || '?') : 'empty';
    const p2eval = p2h.length > 0 ? (evaluatePokerHand(p2h)?.label || '?') : 'empty';
    console.log(
      `[HANDS] ${this.player1Name}(${p1h.length}/5): [${p1h.map(fmt).join(' ')}] ${p1eval}` +
      `  |  ${this.player2Name}(${p2h.length}/5): [${p2h.map(fmt).join(' ')}] ${p2eval}`
    );
  }

  handleShotStart() {
    this.pocketedBallsThisShot = [];
    this.pocketedBallsDetails = [];
    this.cueBallScratchThisShot = false;
    this._shotInProgress = true;
    console.log(`[SHOT_START] Registers cleared — ${this.activePlayer}'s shot`);
    this._logHands();
  }

  async handleShotEnd(physics) {
    if (this.gameEnded) return;
    this._shotInProgress = false; // Close the shot window immediately

    // Capture before processing — opponent may take their final turn this shot
    const wasOpponentFinalTurn = this._opponentFinalTurn;
    /** Who's turn it was when the shot was fired (used for turn-start prompt detection) */
    const playerWhoJustShot = this.activePlayer;

    console.log(`[SHOT_END] player=${this.activePlayer} break=${this.isBreakShot} scratch=${this.cueBallScratchThisShot} pocketed=[${this.pocketedBallsThisShot.join(',')}] firstContact=${physics.firstBallContactMade} cushionAfter=${physics.cushionContactAfterBallHit}`);

    const opponent = this.opponent;

    if (this.isBreakShot) {
      await this._handleBreakShot(physics, opponent);
    } else {
      await this.processNormalPocketedBalls(physics);
    }

    if (this.gameEnded) return;

    // Lock countdown: decrement when the non-locked player's turn just ended
    // (activePlayer just became the lockedPlayer means opponent's turn finished)
    if (this.lockCountdownActive && this.lockedPlayer) {
      if (this.activePlayer === this.lockedPlayer) {
        this.lockCountdown--;
        console.log(`Lock countdown: ${this.lockCountdown} turns remaining for opponent.`);
        if (this.lockCountdown <= 0) {
          this.triggerShowdown();
          return;
        }
        // Give turn back to the non-locked player
        const nonLocked = this.lockedPlayer === this.player1Name ? this.player2Name : this.player1Name;
        this.activePlayer = nonLocked;
      }
    }

    if (this.renderer) {
      this.renderer.setActivePlayer(this.activePlayer);
      this.renderer.updateHUD(this.hands, this.activePlayer, this.discardTokens);
    }

    // After each shot, refresh Finish Shot button visibility for cheat mode
    this._updateCheatFinishButton(physics);

    if (this.gameEnded) return;

    // ── Opponent final-turn check ─────────────────────────────────────────────
    // A "final turn" means the opponent keeps shooting as long as they pocket a
    // valid ball each shot (same bonus-shot rule as a normal turn).  Showdown only
    // fires when their turn actually ENDS — i.e. they miss, foul, or scratch.
    //
    // Detection: if the active player is still the same person who fired this shot,
    // _resolveTurn gave them a bonus shot → let them continue.
    // If the active player changed, their turn ended → trigger showdown.
    if (wasOpponentFinalTurn && !this.gameEnded) {
      const finalTurnPlayer = playerWhoJustShot;
      if (this.activePlayer !== finalTurnPlayer) {
        // Turn ended (miss / foul / scratch) → showdown
        console.log(`[ENDGAME] ${finalTurnPlayer}'s final turn ended — triggering showdown`);
        this.triggerShowdown();
        return;
      } else {
        // Scored and kept turn → bonus shot continues within the final turn
        console.log(`[ENDGAME] ${finalTurnPlayer} scored during final turn — bonus shot continues`);
      }
    }

    this._logHands();

    // ── Turn-start endgame prompt ─────────────────────────────────────────────
    // When the ACTIVE PLAYER CHANGED this shot resolution AND the incoming player
    // already has a complete 5-card hand, prompt them before they shoot.
    // This handles the case where Player A completed a hand earlier, chose
    // "Continue Playing", and now control has returned to them from the opponent.
    const activePlayerChanged = (this.activePlayer !== playerWhoJustShot);
    if (activePlayerChanged &&
        (this.hands[this.activePlayer]?.length ?? 0) >= 5 &&
        !this._opponentFinalTurn &&
        !this.gameEnded) {
      console.log(`[TURN_START] ${this.activePlayer} has 5 cards at turn start — showing endgame prompt`);
      const choice = await this._showTurnStartEndgamePrompt(this.activePlayer);
      if (choice === 'end' && !this.gameEnded) {
        const opponent = this.opponent;
        this._endGameFirstRequester = this.activePlayer;
        this._opponentFinalTurn = true;
        this.activePlayer = opponent;
        console.log(`[ENDGAME] ${this._endGameFirstRequester} requests End Game via turn-start prompt → ${opponent} gets final turn`);
        this.showShotToast(
          `⏰ ${this._endGameFirstRequester} requests End Game — ${opponent} gets one final turn!`,
          'score', 4000
        );
        if (this.renderer) {
          this.renderer.setActivePlayer(this.activePlayer);
          this.renderer.updateHUD(this.hands, this.activePlayer, this.discardTokens);
        }
      }
    }
  }

  async _handleBreakShot(physics, opponent) {
    const cushionContacts = physics.cushionContactSet.size;
    const ballsPocketedCount = this.pocketedBallsThisShot.length;
    const isLegalBreak = !this.cueBallScratchThisShot &&
      (cushionContacts >= this.config.rules.minBreakCushionContacts || ballsPocketedCount > 0);

    if (isLegalBreak) {
      if (ballsPocketedCount > 0) {
        this.pocketedBallsThisShot.forEach(ballId => {
          const b = (physics.allTargetBalls || physics.targetBalls).find(b => b.plugin.ballId === ballId);
          if (b) { physics.respawnBall(b); this.renderer?.setBallVisibility(b.id, true); }
        });
        this.showShotToast(`🎱 Break! ${ballsPocketedCount} ball${ballsPocketedCount > 1 ? 's' : ''} respawned (safe haven) — ${this.activePlayer} keeps turn`, 'miss');
      } else {
        this.activePlayer = opponent;
        this.showShotToast(`🎱 Break! No balls pocketed — turn passes to ${this.activePlayer}`, 'miss');
      }
    } else {
      this.pocketedBallsThisShot.forEach(ballId => {
        const b = (physics.allTargetBalls || physics.targetBalls).find(b => b.plugin.ballId === ballId);
        if (b) { physics.respawnBall(b); this.renderer?.setBallVisibility(b.id, true); }
      });
      this.activePlayer = opponent;
      if (this.controls) this.controls.hasBallInHand = true;
      const reason = this.cueBallScratchThisShot ? 'Scratch on break' : 'Illegal break (too few cushion contacts)';
      this.showShotToast(`🚫 ${reason} — Ball-in-Hand for ${this.activePlayer}`, 'scratch');
    }

    this.isBreakShot = false;
    physics.isBreakShot = false;

    if (this.renderer) {
      this.renderer.updateHUD(this.hands, this.activePlayer, this.discardTokens);
      this.renderer.setActivePlayer(this.activePlayer);
    }
  }

  async processNormalPocketedBalls(physics) {
    if (this.gameEnded) return;

    const opponent = this.activePlayer === this.player1Name ? this.player2Name : this.player1Name;

    // ── LOCKED PLAYER INTERFERENCE SHOT ─────────────────────────────────────
    if (this.lockedPlayers[this.activePlayer]) {
      this.pocketedBallsDetails.forEach(({ ballId }) => {
        const ball = (physics.allTargetBalls || physics.targetBalls).find(b => b.plugin.ballId === ballId);
        if (ball) { physics.respawnBall(ball); this.renderer?.setBallVisibility(ball.id, true); }
      });
      this.activePlayer = opponent;
      this.showShotToast(`🔒 ${opponent === this.player1Name ? this.player2Name : this.player1Name} is locked — interference shot`, 'miss');
      if (this.renderer) this.renderer.updateHUD(this.hands, this.activePlayer, this.discardTokens);
      return;
    }

    // ── VALID SHOT CHECK ─────────────────────────────────────────────────────
    // Rule: cue ball MUST contact at least one object ball, AND after that
    // first contact either any ball touches a cushion OR any ball is pocketed.
    // Scratch counts as "ball pocketed" for this rule (handled separately below).
    // Cheat shots bypass this check via _skipShotValidityCheck flag.
    if (!this._skipShotValidityCheck) {
      const anyPocketed = this.pocketedBallsThisShot.length > 0 || this.cueBallScratchThisShot;
      const validShot = physics.firstBallContactMade &&
                        (physics.cushionContactAfterBallHit || anyPocketed);

      if (!validShot) {
        const reason = !physics.firstBallContactMade
          ? 'Cue ball must contact an object ball'
          : 'After contact, a ball must reach a cushion or be pocketed';
        console.log(`[VALID_SHOT] INVALID — ${reason}. firstContact=${physics.firstBallContactMade} cushionAfter=${physics.cushionContactAfterBallHit} anyPocketed=${anyPocketed}`);
        // Respawn any balls that happened to trickle into pockets during the invalid shot
        this.pocketedBallsDetails.forEach(({ ballId }) => {
          const ball = (physics.allTargetBalls || physics.targetBalls).find(b => b.plugin.ballId === ballId);
          if (ball) { physics.respawnBall(ball); this.renderer?.setBallVisibility(ball.id, true); }
        });
        this.activePlayer = opponent;
        if (this.controls) this.controls.hasBallInHand = true;
        this.showShotToast(`🚫 Invalid shot — ${reason}. Ball-in-Hand for ${this.activePlayer}!`, 'scratch', 4000);
        if (this.renderer) this.renderer.updateHUD(this.hands, this.activePlayer, this.discardTokens);
        return;
      }
    }

    // ── SCRATCH ──────────────────────────────────────────────────────────────
    if (this.cueBallScratchThisShot) {
      this.pocketedBallsDetails.forEach(({ ballId }) => {
        const ball = (physics.allTargetBalls || physics.targetBalls).find(b => b.plugin.ballId === ballId);
        if (ball) { physics.respawnBall(ball); this.renderer?.setBallVisibility(ball.id, true); }
      });
      this.activePlayer = opponent;
      if (this.controls) this.controls.hasBallInHand = true;
      if (this.renderer) this.renderer.updateHUD(this.hands, this.activePlayer, this.discardTokens);
      const n = this.pocketedBallsDetails.length;
      this.showShotToast(`🎱 Scratch! Ball-in-Hand for ${this.activePlayer}${n > 0 ? ` — ${n} ball${n > 1 ? 's' : ''} respawned` : ''}`, 'scratch');
      return;
    }

    // ── NORMAL BALL PROCESSING ───────────────────────────────────────────────

    // Capture endgame state BEFORE processing so we can detect if a dialog sets it
    const endGameFlagBefore = this._opponentFinalTurn;

    // Phase 1: For each pocketed ball, prompt for suit mapping / wildcard selection
    // and collect all new cards. No hand dialog yet.
    const { cardsToAdd, ballActions, invalidReasons, anyValid } =
      await this._resolveNewCards(physics);

    // Phase 2: Add cards to hand — auto-silent if staying < 5, dialogs otherwise
    if (cardsToAdd.length > 0) {
      const hand = this.hands[this.activePlayer];
      const projectedSize = hand.length + cardsToAdd.length;
      console.log(`[HAND] ${this.activePlayer} hand=${hand.length} + new=${cardsToAdd.length} → projected=${projectedSize}`);

      if (projectedSize < 5) {
        // ── Auto-add silently — hand still under 5 ────────────────────────────
        hand.push(...cardsToAdd);
        console.log(`[HAND] Auto-added ${cardsToAdd.length} card(s) — hand now ${hand.length}/5`);

      } else if (projectedSize === 5) {
        // ── Exactly 5 — auto-add ──────────────────────────────────────────────
        hand.push(...cardsToAdd);
        console.log(`[HAND] Reached 5 — hand complete`);

      } else {
        // ── Overflow (projected > 5) — free swap dialog ───────────────────────
        console.log(`[HAND] Overflow (projected ${projectedSize}) — showing free swap dialog`);
        await this._showOverflowDiscardDialog(this.activePlayer, cardsToAdd);
        console.log(`[HAND] Overflow resolved — hand now ${hand.length} cards`);
      }

      // Track who first completed a full 5-card hand (tiebreaker)
      if (hand.length === 5 && !this.firstToCompleteHand) {
        this.firstToCompleteHand = this.activePlayer;
      }

      this._logHands();

      // ── Endgame choice at every hand-complete touch point ─────────────────
      // Fires whenever a player's hand settles at 5 after any shot — not just
      // the first time.  First time: full celebration dialog.  Subsequent card
      // swaps: compact side-panel prompt so the player can decide right after
      // seeing the new hand.  Skipped during opponent's designated final turn.
      if (hand.length === 5 && !this.gameEnded && !this._opponentFinalTurn) {
        if (!this._handCompleted[this.activePlayer]) {
          this._handCompleted[this.activePlayer] = true;
          await this._showHandCompleteDialog(this.activePlayer);
        } else {
          // Already had a full hand — card was swapped. Prompt again.
          console.log(`[ENDGAME] ${this.activePlayer} hand at 5 after card swap — compact endgame prompt`);
          const choice = await this._showTurnStartEndgamePrompt(this.activePlayer);
          if (choice === 'end' && !this.gameEnded) {
            this._endGameFirstRequester = this.activePlayer;
            this._opponentFinalTurn = true;
            console.log(`[ENDGAME] ${this.activePlayer} requests End Game post-swap → ${this.opponent} gets final turn`);
          }
        }
      }
    }

    // Phase 3: Apply physics actions (respawn or permanently remove balls)
    console.log(`[ACTIONS] Applying ${ballActions.length} ball action(s): ${ballActions.map(a=>`ball${a.ball?.plugin?.ballId}→${a.action}`).join(', ')}`);
    for (const { ball, action } of ballActions) {
      if (action === 'remove') {
        console.log(`[ACTIONS] Permanently removing ball ${ball?.plugin?.ballId} (id=${ball?.id})`);
        if (this.renderer) this.renderer.setBallVisibility(ball.id, false);
        Matter.Composite.remove(physics.world, ball);
        physics.targetBalls = physics.targetBalls.filter(b => b.id !== ball.id);
        // Also remove from allTargetBalls so future lookups don't resurrect it
        physics.allTargetBalls = physics.allTargetBalls.filter(b => b.id !== ball.id);
      } else {
        console.log(`[ACTIONS] Respawning ball ${ball?.plugin?.ballId} (id=${ball?.id})`);
        physics.respawnBall(ball);
        if (this.renderer) this.renderer.setBallVisibility(ball.id, true);
      }
    }

    if (this.renderer) this.renderer.updatePocketGraphics(this.pocketSuits);

    const scorer = this.activePlayer;
    this._resolveTurn(anyValid, invalidReasons, opponent);

    // ── Endgame turn-force ─────────────────────────────────────────────────
    // _showHandCompleteDialog may have set _opponentFinalTurn = true during Phase 2.
    // _resolveTurn can override the active player (e.g. keeping turn on a score),
    // so we re-force the switch to the opponent here.
    if (!endGameFlagBefore && this._opponentFinalTurn && !this.gameEnded) {
      this.activePlayer = opponent;
      console.log(`[ENDGAME] Forcing turn to ${opponent} for their final shot`);
      this.showShotToast(
        `⏰ ${this._endGameFirstRequester} requests End Game — ${opponent} gets one final turn!`,
        'score', 4000
      );
      if (this.renderer) this.renderer.setActivePlayer(this.activePlayer);
    }

    if (this.renderer) this.renderer.updateHUD(this.hands, this.activePlayer, this.discardTokens);

    if (this.gameEnded) return;

    this._checkAndTriggerLock(scorer);
  }

  /**
   * Phase 1 of multi-ball processing: iterates every pocketed ball, issues suit-mapping
   * prompts (Phase 1) or wildcard-selection prompts as needed, and collects the list of
   * cards that should be offered to the active player.  Ball physics actions (respawn /
   * remove) are collected but NOT yet applied — that happens after the hand dialog.
   *
   * @returns {Promise<{cardsToAdd: Array, ballActions: Array, invalidReasons: Array, anyValid: boolean}>}
   */
  async _resolveNewCards(physics) {
    const opponent = this.activePlayer === this.player1Name ? this.player2Name : this.player1Name;
    const cardsToAdd = [];
    const ballActions = [];
    const invalidReasons = [];
    let anyValid = false;

    console.log(`[RESOLVE] Processing ${this.pocketedBallsDetails.length} pocketed ball(s) for ${this.activePlayer}`);

    for (const detail of this.pocketedBallsDetails) {
      const { ballId, pocketId } = detail;
      const originalBall =
        (physics.allTargetBalls || physics.targetBalls).find(b => b.plugin.ballId === ballId)
        || detail.ball;
      if (!originalBall) {
        console.warn(`[RESOLVE] Ball ${ballId} body not found — skipping (will stay removed!)`);
        continue;
      }

      const isWildcard = ballId > 13; // balls 14–15 are wildcards

      if (!isWildcard) {
        // ── Rank ball (1–13) ────────────────────────────────────────────────
        let suit = this.pocketSuits[pocketId];

        // Hoist hand references early — needed for both exhaustion check and duplicate check.
        const hand = this.hands[this.activePlayer] || [];
        const oppHand = this.hands[opponent] || [];

        // Rank exhaustion: if all 4 suited versions of this rank are already held
        // (across both players combined), the ball can never yield a new card.
        // Remove it permanently rather than cycling it back to the table forever.
        const rankExhausted = ['S', 'H', 'D', 'C'].every(s =>
          hand.some(c => c.rank === ballId && c.suit === s) ||
          oppHand.some(c => c.rank === ballId && c.suit === s)
        );
        const rankAction = rankExhausted ? 'remove' : 'respawn';
        if (rankExhausted) {
          console.log(`[RESOLVE] Ball ${ballId} RANK EXHAUSTED — all 4 suits held. Permanently removing.`);
        }

        if (suit === null) {
          if (this.phase === 1) {
            // ── AUTO-ASSIGN a random suit from the remaining unclaimed suits ──
            // No player prompt needed — random assignment keeps game flow smooth
            // since all suits are equally valuable.
            const claimedSuits = this.pocketSuits.filter(s => s !== null && s !== 'W');
            const allSuits = ['S', 'H', 'D', 'C'];
            const remaining = allSuits.filter(s => !claimedSuits.includes(s));
            const autoSuit = remaining[Math.floor(Math.random() * remaining.length)] || 'S';
            this.pocketSuits[pocketId] = autoSuit;
            suit = autoSuit;

            // Brief notification so players know which suit was assigned
            const suitNames = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
            console.log(`[RESOLVE] Ball ${ballId}: pocket ${pocketId} auto-assigned suit ${autoSuit}`);
            this.showShotToast(`🎲 New pocket → ${suitNames[autoSuit]}!`, 'score', 2000);

            // Auto-promote remaining unmapped pockets to Wild when 4 suits are set
            const mappedCount = this.pocketSuits.filter(s => s !== null && s !== 'W').length;
            if (mappedCount === 4) {
              this.phase = 2;
              this.pocketSuits.forEach((s, idx) => { if (s === null) this.pocketSuits[idx] = 'W'; });
            }
            if (this.renderer) this.renderer.updatePocketGraphics(this.pocketSuits);
          } else {
            // Phase 2 with unmapped pocket — shouldn't normally happen, treat as invalid
            ballActions.push({ ball: originalBall, action: rankAction });
            invalidReasons.push('rank_in_wild');
            continue;
          }
        }

        if (suit === 'W') {
          ballActions.push({ ball: originalBall, action: rankAction });
          invalidReasons.push('rank_in_wild');
          continue;
        }

        // Check for duplicates across both hands
        const alreadyHeld = hand.some(c => c.rank === ballId && c.suit === suit)
                         || oppHand.some(c => c.rank === ballId && c.suit === suit);

        if (!alreadyHeld) {
          cardsToAdd.push({ rank: ballId, suit });
          anyValid = true;
          console.log(`[RESOLVE] Ball ${ballId}: card ${ballId}${suit} → queued for hand, action=${rankAction}`);
        } else {
          invalidReasons.push('duplicate');
          console.log(`[RESOLVE] Ball ${ballId}: ${ballId}${suit} already held (duplicate), action=${rankAction}`);
        }
        ballActions.push({ ball: originalBall, action: rankAction });

      } else {
        // ── Wildcard ball (14–15) ────────────────────────────────────────────
        const suit = this.pocketSuits[pocketId];

        if (suit === 'W') {
          const chosenCard = await this.promptWildcardSelection(this.activePlayer);

          const hand = this.hands[this.activePlayer] || [];
          const oppHand = this.hands[opponent] || [];
          const alreadyHeld = hand.some(c => c.rank === chosenCard.rank && c.suit === chosenCard.suit)
                           || oppHand.some(c => c.rank === chosenCard.rank && c.suit === chosenCard.suit);

          if (!alreadyHeld) {
            cardsToAdd.push(chosenCard);
            anyValid = true;
          } else {
            invalidReasons.push('duplicate');
          }
          // Wildcards are permanently removed from the table
          ballActions.push({ ball: originalBall, action: 'remove' });
        } else {
          ballActions.push({ ball: originalBall, action: 'respawn' });
          invalidReasons.push('wildcard_wrong_pocket');
        }
      }
    }

    return { cardsToAdd, ballActions, invalidReasons, anyValid };
  }

  /**
   * Phase 2 of multi-ball processing: shows ONE unified dialog containing the player's
   * full current hand PLUS all new cards earned this shot.  The player discards as needed
   * to reach ≤ 5 cards, then confirms with Keep.
   *
   * Overflow discards (while total > 5) are FREE.
   * Discards that bring the hand from 5 → 4 cost one token each.
   *
   * @param {string} player  Active player name
   * @param {Array}  newCards  Cards collected this shot (already duplicate-checked)
   * @returns {Promise<{tokensSpent: number}>}
   */
  _showUnifiedHandDialog(player, newCards) {
    return new Promise((resolve) => {
      if (this.controls) this.controls.enabled = false;

      const hand = this.hands[player];
      let availableTokens = this.discardTokens[player] ?? 0;
      let tokensSpent = 0;

      const isP1 = player === this.player1Name;
      const accentColor = isP1 ? '#00e5ff' : '#e040fb';
      const rankLabels = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };

      const container = document.getElementById('game-container') || document.body;
      const overlay = document.createElement('div');
      overlay.className = 'discard-choice-overlay';
      container.appendChild(overlay);

      // Build a working copy of the combined hand (existing + new).
      // Each entry carries a unique `uid` so selection stays stable across re-renders.
      let workingHand = [
        ...hand.map((c, i) => ({ ...c, isNew: false, uid: `old_${i}` })),
        ...newCards.map((c, i) => ({ ...c, isNew: true, uid: `new_${i}` }))
      ];

      let selectedUid = null;

      const renderContent = () => {
        const isOverflow = workingHand.length > 5;
        const canKeep = !isOverflow;
        // Free overflow-discard only when the player pocketed MULTIPLE balls this shot.
        // If they already had ≥5 from a prior turn and pocket just one new ball, they must
        // spend a token to discard — the free pass only covers multi-ball-same-shot overflow.
        const freeDiscard = isOverflow && newCards.length > 1;
        const canDiscard = freeDiscard || availableTokens > 0;

        const cardsHtml = workingHand.map(c => {
          const r = rankLabels[c.rank] || String(c.rank);
          const sIcon = suitSvg(c.suit, 16); // vector SVG — identical size for all suits
          const red = c.suit === 'H' || c.suit === 'D';
          const isSelected = c.uid === selectedUid;
          return `<div class="discard-card-item${c.isNew ? ' new-card' : ''}${red ? ' red-suit' : ''}${isSelected ? ' selected' : ''}" data-uid="${c.uid}">
            <div class="preview-top">${r}</div>
            <div class="preview-center">${sIcon}</div>
            <div class="preview-top" style="transform:rotate(180deg);align-self:flex-end">${r}</div>
            ${c.isNew ? '<div class="new-card-label">NEW</div>' : ''}
          </div>`;
        }).join('');

        const discardLabel = freeDiscard
          ? 'Discard (Free — multi-ball shot)'
          : `Discard (${availableTokens} chance${availableTokens !== 1 ? 's' : ''} left)`;

        overlay.innerHTML = `
          <div class="discard-choice-card" style="border-color:${accentColor}40">
            <div class="discard-choice-header" style="color:${accentColor}">${player.toUpperCase()} — YOUR HAND</div>
            ${isOverflow ? `<div style="color:#ff9800;font-size:11px;text-align:center;margin-bottom:8px;">Hand exceeds 5 — discard until you reach 5 or fewer</div>` : ''}
            <div class="discard-picker-grid" id="hand-grid">${cardsHtml}</div>
            <div class="discard-actions">
              <button class="discard-btn-add" id="dc-keep"${canKeep ? '' : ' disabled'}>Keep</button>
              ${canDiscard ? `<button class="discard-btn-token" id="dc-discard"${selectedUid ? '' : ' disabled'}>${discardLabel}</button>` : ''}
            </div>
          </div>
        `;

        // Card click — select / deselect
        overlay.querySelectorAll('#hand-grid .discard-card-item').forEach(el => {
          el.addEventListener('click', () => {
            const uid = el.getAttribute('data-uid');
            selectedUid = uid === selectedUid ? null : uid; // toggle
            renderContent();
          });
        });

        // Keep — commit working hand to real hand
        const keepBtn = overlay.querySelector('#dc-keep');
        if (keepBtn) {
          keepBtn.addEventListener('click', () => {
            hand.splice(0, hand.length, ...workingHand.map(c => ({ rank: c.rank, suit: c.suit })));
            overlay.style.opacity = '0';
            setTimeout(() => {
              overlay.remove();
              if (this.controls) this.controls.enabled = true;
              resolve({ tokensSpent });
            }, 300);
          });
        }

        // Discard — remove selected card, deduct token unless this is a FREE discard.
        // A discard is free ONLY when: hand still exceeds 5 cards AND multiple balls
        // were pocketed this shot. A single-ball pocket overflow always costs a token.
        const discardBtn = overlay.querySelector('#dc-discard');
        if (discardBtn) {
          discardBtn.addEventListener('click', () => {
            if (!selectedUid) return;
            const beforeSize = workingHand.length;
            workingHand = workingHand.filter(c => c.uid !== selectedUid);
            // Free only when reducing from genuine multi-ball overflow (beforeSize > 5 AND multi-ball shot)
            const isFreeDiscard = beforeSize > 5 && newCards.length > 1;
            if (!isFreeDiscard && availableTokens > 0) {
              availableTokens--;
              tokensSpent++;
              console.log(`[DIALOG] Token spent on discard — ${availableTokens} remaining`);
            } else if (isFreeDiscard) {
              console.log(`[DIALOG] Free discard (multi-ball overflow, beforeSize=${beforeSize})`);
            }
            selectedUid = null;
            renderContent();
          });
        }
      };

      renderContent();
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // NEW CARD-FLOW DIALOGS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Shown when the player's hand overflows past 5 after a shot.
   * All discards are FREE — no token cost. Player discards until hand = 5, then resolves.
   *
   * @param {string} player
   * @param {Array}  newCards  Cards to add (already determined by _resolveNewCards)
   * @returns {Promise<void>}
   */
  _showOverflowDiscardDialog(player, newCards) {
    return new Promise(async (resolve) => {
      // ── AI auto-discard: pick the card whose removal yields the best remaining hand ──
      if (player === this._aiPlayerName) {
        const hand = this.hands[player];
        const combined = [
          ...hand.map((c, i) => ({ ...c, uid: `old_${i}` })),
          ...newCards.map((c, i) => ({ ...c, uid: `new_${i}` }))
        ];
        // Repeatedly discard the weakest card until hand size = 5
        while (combined.length > 5) {
          let bestScore = -1;
          let discardIdx = 0;
          for (let i = 0; i < combined.length; i++) {
            const remaining = combined.filter((_, j) => j !== i).map(c => ({ rank: c.rank, suit: c.suit }));
            const score = remaining.length <= 5 ? (evaluatePokerHand(remaining)?.rank ?? 0) : 0;
            if (score > bestScore) { bestScore = score; discardIdx = i; }
          }
          const discarded = combined.splice(discardIdx, 1)[0];
          console.log(`[AI] Auto-discard: dropped ${discarded.rank}${discarded.suit} — working hand ${combined.length}`);
        }
        hand.splice(0, hand.length, ...combined.map(c => ({ rank: c.rank, suit: c.suit })));
        await new Promise(r => setTimeout(r, 400));
        resolve();
        return;
      }

      if (this.controls) this.controls.enabled = false;

      const hand = this.hands[player];
      const rankLabels = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
      const isP1 = player === this.player1Name;
      const accentColor = isP1 ? '#00e5ff' : '#e040fb';

      // Working set = existing hand + new cards, each tagged with uid
      let workingHand = [
        ...hand.map((c, i) => ({ ...c, isNew: false, uid: `old_${i}` })),
        ...newCards.map((c, i) => ({ ...c, isNew: true, uid: `new_${i}` }))
      ];
      let selectedUid = null;

      const container = document.getElementById('game-container') || document.body;
      const overlay = document.createElement('div');
      overlay.className = 'discard-choice-overlay';
      container.appendChild(overlay);

      const render = () => {
        const excess = workingHand.length - 5;
        const canDiscard = !!selectedUid; // Always free — just need a selection

        const cardsHtml = workingHand.map(c => {
          const r = rankLabels[c.rank] || String(c.rank);
          const sIcon = suitSvg(c.suit, 16);
          const red = c.suit === 'H' || c.suit === 'D';
          const sel = c.uid === selectedUid;
          return `<div class="discard-card-item${c.isNew?' new-card':''}${red?' red-suit':''}${sel?' selected':''}" data-uid="${c.uid}">
            <div class="preview-top">${r}</div>
            <div class="preview-center">${sIcon}</div>
            <div class="preview-top" style="transform:rotate(180deg);align-self:flex-end">${r}</div>
            ${c.isNew?'<div class="new-card-label">NEW</div>':''}
          </div>`;
        }).join('');

        overlay.innerHTML = `
          <div class="discard-choice-card" style="border-color:${accentColor}40">
            <div class="discard-choice-header" style="color:${accentColor}">${player.toUpperCase()} — ADJUST YOUR HAND</div>
            <div style="color:#ff9800;font-size:11px;text-align:center;margin-bottom:8px;">
              Hand exceeds 5 — discard ${excess} card${excess!==1?'s':''} (free)
            </div>
            <div class="discard-picker-grid" id="hand-grid">${cardsHtml}</div>
            <div class="discard-actions">
              <button class="discard-btn-token" id="dc-discard" ${canDiscard?'':'disabled'}>Discard Selected (Free)</button>
            </div>
          </div>`;

        overlay.querySelectorAll('#hand-grid .discard-card-item').forEach(el => {
          el.addEventListener('click', () => {
            const uid = el.getAttribute('data-uid');
            selectedUid = uid === selectedUid ? null : uid;
            render();
          });
        });

        const discardBtn = overlay.querySelector('#dc-discard');
        if (discardBtn) {
          discardBtn.addEventListener('click', () => {
            if (!selectedUid) return;
            workingHand = workingHand.filter(c => c.uid !== selectedUid);
            selectedUid = null;
            console.log(`[OVERFLOW] Free discard — working hand now ${workingHand.length} cards`);

            // Commit to real hand each step so state is always consistent
            hand.splice(0, hand.length, ...workingHand.map(c => ({ rank: c.rank, suit: c.suit })));

            if (workingHand.length <= 5) {
              overlay.style.opacity = '0';
              setTimeout(() => {
                overlay.remove();
                if (this.controls) this.controls.enabled = true;
                resolve();
              }, 200);
            } else {
              render();
            }
          });
        }
      };

      render();
    });
  }

  /**
   * Shown the FIRST TIME a player's hand reaches exactly 5 cards.
   * Displays all 5 cards, the hand ranking, and offers
   * "Request End Game" (trigger endgame) or "Continue Playing".
   *
   * @param {string} player
   * @returns {Promise<void>}
   */
  _showHandCompleteDialog(player) {
    return new Promise(async (resolve) => {
      // ── AI auto-resolve: no dialog shown, AI decides silently ──────────────
      if (player === this._aiPlayerName) {
        const hand = this.hands[player] || [];
        const handResult = hand.length > 0 ? evaluatePokerHand(hand) : null;
        const shouldEnd = (handResult?.rank ?? 0) >= this._aiEndGameThreshold;
        console.log(`[AI] Hand complete dialog auto: ${handResult?.label} rank=${handResult?.rank} → ${shouldEnd ? 'Request End Game' : 'Continue Playing'}`);
        await new Promise(r => setTimeout(r, 700));
        if (shouldEnd && !this.gameEnded) {
          this._endGameFirstRequester = player;
          this._opponentFinalTurn = true;
        }
        resolve();
        return;
      }

      if (this.controls) this.controls.enabled = false;

      const hand = this.hands[player] || [];
      const isP1 = player === this.player1Name;
      const accentColor = isP1 ? '#00e5ff' : '#e040fb';
      const rankLabels = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };

      // Evaluate the hand ranking (supports 1–5 cards)
      const handResult = hand.length > 0 ? evaluatePokerHand(hand) : null;
      const rankingName = handResult?.label || 'Unknown Hand';

      const cardsHtml = hand.map(c => {
        const r = rankLabels[c.rank] || String(c.rank);
        const sIcon = suitSvg(c.suit, 18);
        const red = c.suit === 'H' || c.suit === 'D';
        return `<div class="discard-card-item${red?' red-suit':''}">
          <div class="preview-top">${r}</div>
          <div class="preview-center">${sIcon}</div>
          <div class="preview-top" style="transform:rotate(180deg);align-self:flex-end">${r}</div>
        </div>`;
      }).join('');

      const container = document.getElementById('game-container') || document.body;
      const overlay = document.createElement('div');
      overlay.className = 'discard-choice-overlay';
      container.appendChild(overlay);

      // Is this the opponent's designated final turn (after the other player called End)?
      const isFinalTurn = this._opponentFinalTurn && player === this.activePlayer;
      const opponent = player === this.player1Name ? this.player2Name : this.player1Name;

      const bodyText = isFinalTurn
        ? `⏰ <strong style="color:#ff9800">${this._endGameFirstRequester}</strong> called End Game — this is your final turn.<br>
           Showdown happens after this shot regardless.`
        : `You have a full 5-card hand! <strong style="color:#ff6b6b">Request End Game</strong> — your opponent gets one final turn, then showdown.
           Or <strong style="color:#4fc3f7">Continue Playing</strong> to freely swap cards whenever you pocket a new ball.`;

      // Final-turn: only one button (showdown is inevitable).
      // Normal: two buttons — Request End Game / Continue Playing.
      const actionsHtml = isFinalTurn
        ? `<button class="discard-btn-token" id="hc-end"
             style="background:linear-gradient(135deg,#b71c1c,#7f0000);border-color:#c62828;width:100%">
             ⚔ Go to Showdown
           </button>`
        : `<button class="discard-btn-token" id="hc-end"
             style="background:linear-gradient(135deg,#b71c1c,#7f0000);border-color:#c62828">
             ⚔ Request End Game
           </button>
           <button class="discard-btn-add" id="hc-continue">🎱 Continue Playing</button>`;

      overlay.innerHTML = `
        <div class="discard-choice-card" style="border-color:${accentColor}60;max-width:420px">
          <div class="discard-choice-header" style="color:${accentColor}">${player.toUpperCase()} — HAND COMPLETE!</div>
          <div style="color:#ffd700;font-size:15px;font-weight:700;text-align:center;margin:6px 0 12px;">
            ♠ ${rankingName}
          </div>
          <div class="discard-picker-grid" style="justify-content:center;margin-bottom:14px">${cardsHtml}</div>
          <div style="color:#8ab4d4;font-size:11px;text-align:center;line-height:1.5;margin-bottom:16px;padding:0 8px;">
            ${bodyText}
          </div>
          <div class="discard-actions" style="gap:10px">${actionsHtml}</div>
        </div>`;

      const close = () => {
        overlay.style.opacity = '0';
        setTimeout(() => {
          overlay.remove();
          if (this.controls) this.controls.enabled = true;
          resolve();
        }, 250);
      };

      overlay.querySelector('#hc-end').addEventListener('click', () => {
        console.log(`[ENDGAME] ${player} clicked → ${isFinalTurn ? 'Go to Showdown' : 'Request End Game'}`);
        close();
        if (isFinalTurn) {
          // Opponent also wants to end (or just acknowledging their final turn) → immediate showdown
          this.triggerShowdown();
        } else {
          // First request — give opponent one final turn (turn-force handled after _resolveTurn)
          this._endGameFirstRequester = player;
          this._opponentFinalTurn = true;
          // Toast + active-player update done by the endgame turn-force block after _resolveTurn
        }
      });

      const continueBtn = overlay.querySelector('#hc-continue');
      if (continueBtn) {
        continueBtn.addEventListener('click', () => {
          console.log(`[ENDGAME] ${player} chose → Continue Playing`);
          close();
        });
      }
    });
  }

  /**
   * Shows a compact, non-blocking endgame prompt at the top-centre of the screen
   * when a player with a complete 5-card hand is about to start their turn.
   * The player can Request End Game (opponent gets one final turn) or Continue Shooting.
   *
   * Unlike the full-screen hand-complete dialog, this sits just below the HUD so
   * the player can see the full table while deciding.
   *
   * @param {string} player  Active player who is about to shoot
   * @returns {Promise<'end'|'continue'>}
   */
  _showTurnStartEndgamePrompt(player) {
    return new Promise(async (resolve) => {
      // ── AI auto-resolve ────────────────────────────────────────────────────
      if (player === this._aiPlayerName) {
        const hand = this.hands[player] || [];
        const handResult = hand.length > 0 ? evaluatePokerHand(hand) : null;
        const shouldEnd = (handResult?.rank ?? 0) >= this._aiEndGameThreshold;
        console.log(`[AI] Turn-start prompt auto: ${handResult?.label} → ${shouldEnd ? 'end' : 'continue'}`);
        await new Promise(r => setTimeout(r, 400));
        resolve(shouldEnd ? 'end' : 'continue');
        return;
      }

      if (this.controls) this.controls.enabled = false;

      const hand = this.hands[player] || [];
      const handResult = hand.length > 0 ? evaluatePokerHand(hand) : null;
      const handLabel = handResult?.label || 'Complete Hand';
      const isP1 = player === this.player1Name;
      const accentColor = isP1 ? '#00e5ff' : '#e040fb';

      console.log(`[TURN_START_PROMPT] Showing for ${player} — ${handLabel}`);

      const container = document.getElementById('game-container') || document.body;

      // Remove any stale prompt that wasn't cleaned up
      container.querySelector('.turn-start-endgame-prompt')?.remove();

      const prompt = document.createElement('div');
      prompt.className = 'turn-start-endgame-prompt';

      // ── Position under the player's own hand display ──────────────────────
      // Alice (P1) → left side of canvas.  Bob (P2) → right side (avoid right panel at x≥968).
      // Canvas is 1024×576; table top rail is at y≈130.
      const positionCss = isP1
        ? 'left: 5px; right: auto;'
        : 'right: 62px; left: auto;';

      prompt.style.cssText = `
        position: absolute;
        top: 125px;
        ${positionCss}
        background: rgba(8, 15, 33, 0.96);
        border: 1.5px solid ${accentColor};
        border-radius: 12px;
        padding: 10px 14px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 7px;
        z-index: 600;
        width: 215px;
        box-shadow: 0 0 24px ${accentColor}55, 0 4px 16px rgba(0,0,0,0.7);
        font-family: 'Inter', Arial, sans-serif;
        pointer-events: auto;
      `;

      prompt.innerHTML = `
        <div style="color:${accentColor};font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;">${player}'s Turn</div>
        <div style="color:#ffd700;font-size:13px;font-weight:700;">♠ ${handLabel}</div>
        <div style="color:#7a9ab8;font-size:10px;text-align:center;line-height:1.4;">You have a complete hand. Continue shooting freely, or request showdown?</div>
        <div style="display:flex;gap:8px;width:100%;margin-top:2px;">
          <button id="tsp-end" style="flex:1;background:linear-gradient(135deg,#7f0000,#3d0000);color:#ff8a80;border:1px solid #c62828;border-radius:8px;padding:7px 6px;font-size:10px;font-weight:700;cursor:pointer;letter-spacing:0.5px;font-family:inherit;">⚔ Request End Game</button>
          <button id="tsp-continue" style="flex:1;background:linear-gradient(135deg,#0d4f0d,#052205);color:#a5d6a7;border:1px solid #2e7d32;border-radius:8px;padding:7px 6px;font-size:10px;font-weight:700;cursor:pointer;letter-spacing:0.5px;font-family:inherit;">🎱 Continue Shooting</button>
        </div>
      `;

      container.appendChild(prompt);

      const close = (choice) => {
        prompt.style.opacity = '0';
        prompt.style.transition = 'opacity 0.18s';
        setTimeout(() => {
          prompt.remove();
          if (this.controls) this.controls.enabled = true;
          resolve(choice);
        }, 180);
      };

      prompt.querySelector('#tsp-end').addEventListener('click', () => close('end'));
      prompt.querySelector('#tsp-continue').addEventListener('click', () => close('continue'));
    });
  }

  /**
   * Checks whether lock conditions are met.
   * With tokens removed, lock is no longer auto-triggered by empty tokens.
   * Lock is now only triggered explicitly by the endgame flow (future: Request Showdown).
   * This stub remains so the call site in processNormalPocketedBalls still compiles.
   */
  _checkAndTriggerLock(player) {
    // Lock auto-trigger disabled — endgame is handled by the Request End Game flow.
    // If both players have 5 cards and one requests End Game, showdown triggers normally.
  }

  /**
   * Marks a player as locked and starts the countdown for the opponent.
   */
  triggerLock(player) {
    if (this.gameEnded) return;
    this.lockedPlayers[player] = true;
    this.lockedPlayer = player;

    const opponent = player === this.player1Name ? this.player2Name : this.player1Name;

    // Both locked → immediate showdown
    if (this.lockedPlayers[opponent]) {
      this.triggerShowdown();
      return;
    }

    this.lockCountdown = this.config.rules?.lockCountdownTurns ?? 3;
    this.lockCountdownActive = true;
    this.activePlayer = opponent; // Opponent gets their countdown turns

    this.showShotToast(`🔒 ${player} is locked in! ${opponent} has ${this.lockCountdown} turns.`, 'score', 4000);

    if (this.renderer) {
      this.renderer.updateHUD(this.hands, this.activePlayer, this.discardTokens);
      this.renderer.setActivePlayer(this.activePlayer);
      this._injectAcceptShowdownButton(opponent);
    }

    console.log(`${player} locked. ${opponent} gets ${this.lockCountdown} countdown turns.`);
  }

  /**
   * Injects an "Accept Showdown" button for the non-locked player during countdown.
   */
  _injectAcceptShowdownButton(player) {
    this._removeAcceptShowdownButton();
    const container = document.getElementById('game-container') || document.body;
    const btn = document.createElement('button');
    btn.id = 'accept-showdown-btn';
    btn.className = 'accept-showdown-btn';
    btn.textContent = '⚔ ACCEPT SHOWDOWN';
    btn.addEventListener('click', () => {
      if (this.activePlayer === player && !this.gameEnded) {
        this._removeAcceptShowdownButton();
        this.triggerShowdown();
      }
    });
    container.appendChild(btn);
  }

  _removeAcceptShowdownButton() {
    const btn = document.getElementById('accept-showdown-btn');
    if (btn) btn.remove();
  }

  async _processRankBall({ ballId, pocketId }, originalBall, physics, opponent) {
    const suit = this.pocketSuits[pocketId];

    if (suit === null) {
      if (this.phase === 1) {
        const selectedSuit = await this.promptSuitMapping(this.activePlayer, pocketId, ballId);
        this.pocketSuits[pocketId] = selectedSuit;

        const hand = this.hands[this.activePlayer] || [];
        const oppHand = this.hands[opponent] || [];
        const alreadyHeld = hand.some(c => c.rank === ballId && c.suit === selectedSuit)
                         || oppHand.some(c => c.rank === ballId && c.suit === selectedSuit);

        let scored = false;
        if (!alreadyHeld) {
          scored = await this._processCardAddition(this.activePlayer, { rank: ballId, suit: selectedSuit });
        }

        if (this.renderer) {
          this.renderer.updatePocketGraphics(this.pocketSuits);
          this.renderer.updateHUD(this.hands, this.activePlayer, this.discardTokens);
        }

        const mappedCount = this.pocketSuits.filter(s => s !== null && s !== 'W').length;
        if (mappedCount === 4) {
          this.phase = 2;
          this.pocketSuits.forEach((s, idx) => { if (s === null) this.pocketSuits[idx] = 'W'; });
          if (this.renderer) this.renderer.updatePocketGraphics(this.pocketSuits);
        }

        physics.respawnBall(originalBall);
        if (this.renderer) this.renderer.setBallVisibility(originalBall.id, true);
        // Valid = ball was pocketed into a legitimately claimable pocket; discard choice doesn't affect validity
        return { valid: !alreadyHeld, invalidReason: alreadyHeld ? 'duplicate' : null };
      }

      physics.respawnBall(originalBall);
      if (this.renderer) this.renderer.setBallVisibility(originalBall.id, true);
      return { valid: false, invalidReason: 'rank_in_wild' };

    } else if (suit === 'W') {
      physics.respawnBall(originalBall);
      if (this.renderer) this.renderer.setBallVisibility(originalBall.id, true);
      return { valid: false, invalidReason: 'rank_in_wild' };

    } else {
      const hand = this.hands[this.activePlayer] || [];
      const oppHand = this.hands[opponent] || [];
      const alreadyHeld = hand.some(c => c.rank === ballId && c.suit === suit)
                       || oppHand.some(c => c.rank === ballId && c.suit === suit);

      let scored = false;
      if (!alreadyHeld) {
        scored = await this._processCardAddition(this.activePlayer, { rank: ballId, suit });
        if (this.renderer) this.renderer.updateHUD(this.hands, this.activePlayer, this.discardTokens);
      }

      physics.respawnBall(originalBall);
      if (this.renderer) this.renderer.setBallVisibility(originalBall.id, true);
      return { valid: !alreadyHeld, invalidReason: alreadyHeld ? 'duplicate' : null };
    }
  }

  async _processWildcardBall({ ballId, pocketId }, originalBall, physics, opponent) {
    const suit = this.pocketSuits[pocketId];

    if (suit === 'W') {
      const chosenCard = await this.promptWildcardSelection(this.activePlayer);

      const hand = this.hands[this.activePlayer] || [];
      const oppHand = this.hands[opponent] || [];
      const alreadyHeld = hand.some(c => c.rank === chosenCard.rank && c.suit === chosenCard.suit)
                       || oppHand.some(c => c.rank === chosenCard.rank && c.suit === chosenCard.suit);

      let scored = false;
      if (!alreadyHeld) {
        scored = await this._processCardAddition(this.activePlayer, chosenCard);
        if (this.renderer) this.renderer.updateHUD(this.hands, this.activePlayer, this.discardTokens);
      }

      // Wildcard is permanently removed
      if (this.renderer) this.renderer.setBallVisibility(originalBall.id, false);
      Matter.Composite.remove(physics.world, originalBall);
      physics.targetBalls = physics.targetBalls.filter(b => b.id !== originalBall.id);

      return { valid: !alreadyHeld, invalidReason: alreadyHeld ? 'duplicate' : null };

    } else {
      physics.respawnBall(originalBall);
      if (this.renderer) this.renderer.setBallVisibility(originalBall.id, true);
      return { valid: false, invalidReason: 'wildcard_wrong_pocket' };
    }
  }

  /**
   * Core card-addition gateway. Shows the unified hand dialog where the player
   * sees their full current hand plus the new card and decides to Keep or Discard.
   * Returns true if the new card was added to the player's hand.
   */
  async _processCardAddition(player, newCard) {
    if (this.lockedPlayers[player]) return false;

    const hand = this.hands[player];
    const tokens = this.discardTokens[player] ?? 0;

    const result = await this.promptDiscardChoice(player, newCard);

    if (result.usedToken) {
      this.discardTokens[player] = Math.max(0, tokens - 1);
    }

    if (result.added && hand.length === 5 && !this.firstToCompleteHand) {
      this.firstToCompleteHand = player;
    }

    // Check lock immediately so subsequent balls in this shot respect the new state
    this._checkAndTriggerLock(player);

    return result.added;
  }

  /**
   * Unified hand dialog: shows the player's full current hand plus the new card.
   * Player clicks a card to select it (enables Discard), or presses Keep to accept all.
   * "Keep" is disabled when adding the new card would exceed 5 cards.
   * "Discard" is only shown when tokens > 0 and costs one token when pressed.
   * @returns {Promise<{added: boolean, usedToken: boolean}>}
   */
  promptDiscardChoice(player, newCard) {
    return new Promise((resolve) => {
      if (this.controls) this.controls.enabled = false;

      const hand = this.hands[player];
      const tokens = this.discardTokens[player] ?? 0;
      const isP1 = player === this.player1Name;
      const accentColor = isP1 ? '#00e5ff' : '#e040fb';
      const suitSymbols = { S: '♠', H: '♥', D: '♦', C: '♣' };
      const rankLabels = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };

      const isOverflow = hand.length >= 5;  // total cards would exceed 5
      const canKeep = !isOverflow;
      const showDiscard = tokens > 0 || isOverflow; // overflow discard is always free

      const container = document.getElementById('game-container') || document.body;
      const overlay = document.createElement('div');
      overlay.className = 'discard-choice-overlay';

      const cardHtml = (card, idx, isNew = false) => {
        const r = rankLabels[card.rank] || String(card.rank);
        const s = suitSymbols[card.suit] || card.suit;
        const red = card.suit === 'H' || card.suit === 'D';
        return `<div class="discard-card-item${isNew ? ' new-card' : ''}${red ? ' red-suit' : ''}" data-idx="${idx}">
          <div class="preview-top">${r}</div>
          <div class="preview-center">${s}</div>
          <div class="preview-top" style="transform:rotate(180deg);align-self:flex-end">${r}</div>
          ${isNew ? '<div class="new-card-label">NEW</div>' : ''}
        </div>`;
      };

      const allCards = [...hand, newCard];
      const cardsGrid = allCards.map((c, i) => cardHtml(c, i, i === hand.length)).join('');

      overlay.innerHTML = `
        <div class="discard-choice-card" style="border-color:${accentColor}40">
          <div class="discard-choice-header" style="color:${accentColor}">${player.toUpperCase()} — YOUR HAND</div>
          <div class="discard-picker-grid" id="hand-grid">${cardsGrid}</div>
          <div class="discard-actions">
            <button class="discard-btn-add" id="dc-keep"${canKeep ? '' : ' disabled'}>Keep</button>
            ${showDiscard ? `<button class="discard-btn-token" id="dc-discard" disabled>${isOverflow ? 'Discard (Free)' : `Discard (${tokens} chance${tokens !== 1 ? 's' : ''} left)`}</button>` : ''}
          </div>
        </div>
      `;
      container.appendChild(overlay);

      let selectedIdx = -1;

      const doResolve = (added, usedToken) => {
        overlay.style.opacity = '0';
        setTimeout(() => {
          overlay.remove();
          if (this.controls) this.controls.enabled = true;
          resolve({ added, usedToken });
        }, 300);
      };

      // Card selection — enables Discard button
      overlay.querySelectorAll('#hand-grid .discard-card-item').forEach(el => {
        el.addEventListener('click', () => {
          overlay.querySelectorAll('#hand-grid .discard-card-item').forEach(e => e.classList.remove('selected'));
          el.classList.add('selected');
          selectedIdx = parseInt(el.getAttribute('data-idx'));
          const discardBtn = overlay.querySelector('#dc-discard');
          if (discardBtn) discardBtn.disabled = false;
        });
      });

      // Keep — add new card as-is
      overlay.querySelector('#dc-keep').addEventListener('click', () => {
        hand.push(newCard);
        doResolve(true, false);
      });

      // Discard — remove selected card (new or existing)
      // Token cost applies only when hand.length < 5 (overflow discards are free)
      const discardBtn = overlay.querySelector('#dc-discard');
      if (discardBtn) {
        discardBtn.addEventListener('click', () => {
          if (selectedIdx < 0) return;
          const usedToken = !isOverflow; // free when total was > 5
          if (selectedIdx === hand.length) {
            // Selected card is the new one — just skip it
            doResolve(false, usedToken);
          } else {
            // Selected card is an existing one — swap it out, keep new card
            hand.splice(selectedIdx, 1);
            hand.push(newCard);
            doResolve(true, usedToken);
          }
        });
      }
    });
  }

  _resolveTurn(anyValidScore, invalidReasons, opponent) {
    const anyInvalidDrop = invalidReasons.length > 0;
    const primaryReason = invalidReasons[0] || null;

    console.log(`[TURN] anyValid=${anyValidScore} invalidReasons=[${invalidReasons.join(',')}] activePlayer=${this.activePlayer}`);

    if (anyValidScore && !anyInvalidDrop) {
      const handSize = (this.hands[this.activePlayer] || []).length;
      const tok = this.discardTokens[this.activePlayer] ?? 0;
      console.log(`[TURN] Clean score → ${this.activePlayer} keeps turn. hand=${handSize}/5 tokens=${tok}`);
      this.showShotToast(`✅ Scored! ${this.activePlayer}: ${handSize}/5 cards, ${tok} token${tok !== 1 ? 's' : ''} left — bonus turn`, 'score');

    } else if (anyValidScore && anyInvalidDrop) {
      console.log(`[TURN] Mixed → turn passes to ${opponent}`);
      this.activePlayer = opponent;
      this.showShotToast(`⚠️ Mixed shot — card scored but also: ${this._invalidReasonText(primaryReason)}`, 'mixed');

    } else if (anyInvalidDrop) {
      console.log(`[TURN] Invalid (${primaryReason}) → turn passes to ${opponent}`);
      this.activePlayer = opponent;
      this.showShotToast(`🚫 ${this._invalidReasonText(primaryReason)}`, 'invalid');

    } else {
      console.log(`[TURN] Miss → turn passes to ${opponent}`);
      this.activePlayer = opponent;
      this.showShotToast(`💨 Miss — Turn → ${opponent}`, 'miss');
    }
  }

  _invalidReasonText(reason) {
    switch (reason) {
      case 'duplicate':             return 'Card already held in players\' hands';
      case 'wildcard_wrong_pocket': return '★ Wildcard must be played into a Wild ★ Pocket';
      case 'rank_in_wild':          return 'Numbered ball cannot score in a Wild ★ Pocket';
      default:                      return 'Invalid drop';
    }
  }

  /* DISABLED — suit mapping is now fully automatic (random assignment).
     Keeping this method commented out for reference / future re-enablement.

  promptSuitMapping(player, pocketId, ballId) { ... } */

  promptWildcardSelection(player) {
    return new Promise((resolve) => {
      this.controls.enabled = false;
      const container = document.getElementById('game-container') || document.body;

      const playerHand = this.hands[player] || [];
      const opponentName = player === this.player1Name ? this.player2Name : this.player1Name;
      const opponentHand = this.hands[opponentName] || [];
      const isOccupied = (r, s) =>
        playerHand.some(c => c.rank === r && c.suit === s) ||
        opponentHand.some(c => c.rank === r && c.suit === s);
      const suits = ['S', 'H', 'D', 'C'];
      const allSuitsOccupied = r => suits.every(s => isOccupied(r, s));

      let selectedRank = null, selectedSuit = null;
      for (let r = 1; r <= 13; r++) {
        for (const s of suits) {
          if (!isOccupied(r, s)) { selectedRank = r; selectedSuit = s; break; }
        }
        if (selectedRank) break;
      }

      const overlay = document.createElement('div');
      overlay.className = 'wildcard-selector-overlay';

      const rankNames = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
      let ranksHtml = '';
      for (let r = 1; r <= 13; r++) {
        const label = rankNames[r] || r.toString();
        ranksHtml += `<button class="wild-rank-btn" data-rank="${r}" ${allSuitsOccupied(r) ? 'disabled' : ''}>${label}</button>`;
      }

      overlay.innerHTML = `
        <div class="wildcard-selector-card">
          <h2 class="suit-mapping-title" style="color:#ffd700;text-shadow:0 0 15px rgba(255,215,0,0.6);margin-bottom:5px;">WILDCARD CREATOR</h2>
          <p class="suit-mapping-subtitle" style="margin-bottom:12px;">${player.toUpperCase()} hit a Wild Pocket!<br>Design your custom wildcard (no duplicates allowed):</p>
          <div class="wild-card-preview-container"><div id="wild-card-preview" class="wild-card-preview"></div></div>
          <div class="wild-ranks-grid">${ranksHtml}</div>
          <div class="wild-suits-row">
            <button class="wild-suit-btn spades"   data-suit="S">${suitSvg('S', 22)}</button>
            <button class="wild-suit-btn hearts"   data-suit="H">${suitSvg('H', 22)}</button>
            <button class="wild-suit-btn diamonds" data-suit="D">${suitSvg('D', 22)}</button>
            <button class="wild-suit-btn clubs"    data-suit="C">${suitSvg('C', 22)}</button>
          </div>
          <button id="wild-confirm-btn" style="background:linear-gradient(135deg,#ffd700 0%,#ffb300 100%);color:#0d1527;border:none;border-radius:8px;padding:12px 25px;font-size:14px;font-weight:bold;cursor:pointer;width:100%;box-shadow:0 4px 15px rgba(255,215,0,0.4);letter-spacing:1px;">ADD TO HAND</button>
        </div>
      `;
      container.appendChild(overlay);

      const updateCardPreview = () => {
        const rl = rankNames[selectedRank] || String(selectedRank);
        const isRed = selectedSuit === 'H' || selectedSuit === 'D';
        const p = overlay.querySelector('#wild-card-preview');
        if (p) {
          p.className = `wild-card-preview${isRed ? ' red-suit' : ''}`;
          p.innerHTML = `<div class="preview-top">${rl}</div><div class="preview-center">${suitSvg(selectedSuit, 20)}</div><div class="preview-top" style="transform:rotate(180deg);align-self:flex-end">${rl}</div>`;
        }
      };

      const updateSuitButtons = () => {
        overlay.querySelectorAll('.wild-suit-btn').forEach(btn => {
          const s = btn.getAttribute('data-suit');
          const occ = isOccupied(selectedRank, s);
          btn.disabled = occ;
          btn.classList.toggle('selected', !occ && s === selectedSuit);
        });
      };

      const selectRank = r => {
        selectedRank = r;
        overlay.querySelectorAll('.wild-rank-btn').forEach(b => b.classList.toggle('selected', parseInt(b.getAttribute('data-rank')) === r));
        if (isOccupied(selectedRank, selectedSuit)) selectedSuit = suits.find(s => !isOccupied(selectedRank, s));
        updateSuitButtons(); updateCardPreview();
      };

      const selectSuit = s => {
        if (isOccupied(selectedRank, s)) return;
        selectedSuit = s; updateSuitButtons(); updateCardPreview();
      };

      overlay.querySelectorAll('.wild-rank-btn').forEach(b => b.addEventListener('click', () => selectRank(parseInt(b.getAttribute('data-rank')))));
      overlay.querySelectorAll('.wild-suit-btn').forEach(b => b.addEventListener('click', () => selectSuit(b.getAttribute('data-suit'))));
      if (selectedRank !== null && selectedSuit !== null) selectRank(selectedRank);

      overlay.querySelector('#wild-confirm-btn').addEventListener('click', () => {
        if (!selectedRank || !selectedSuit || isOccupied(selectedRank, selectedSuit)) return;
        overlay.style.opacity = '0';
        setTimeout(() => { overlay.remove(); this.controls.enabled = true; resolve({ rank: selectedRank, suit: selectedSuit }); }, 350);
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CHEAT SYSTEM
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Enables or disables cheat mode. Updates controls flag and shows/hides
   * the Finish Shot button based on current game state.
   * @param {boolean} enabled
   * @param {object}  physics  PhysicsEngine reference (used to check break state)
   */
  setCheatEnabled(enabled, physics) {
    this.cheatEnabled = enabled;
    if (this.controls) {
      this.controls.cheatEnabled = enabled;
    } else {
      console.warn('[CHEAT] setCheatEnabled: controls not wired to game — cheatEnabled not propagated to controls');
    }

    // Clear any pending selections when toggling
    this._resetCheatSelections();

    if (!enabled) {
      if (this.renderer) this.renderer.setCheatFinishButton(false);
      this._cheatAwaitingFinish = false;
      console.log('[CHEAT] Disabled — selections cleared, finish button hidden');
    } else {
      console.log(`[CHEAT] Enabled — checking if Finish Shot should show: isBreakShot=${this.isBreakShot} gameEnded=${this.gameEnded} shotInProgress=${this._shotInProgress}`);
      // Show Finish Shot button only when appropriate (normal shot, balls stopped)
      this._updateCheatFinishButton(physics);
    }
  }

  /**
   * Shows or hides the Finish Shot button based on current game state.
   * Called after every shot end and on cheat toggle.
   * @param {object} physics
   */
  _updateCheatFinishButton(physics) {
    if (!this.cheatEnabled || !this.renderer) {
      console.log(`[CHEAT] updateFinishBtn skipped: enabled=${this.cheatEnabled} renderer=${!!this.renderer}`);
      return;
    }
    const allStopped = physics?.areAllBallsStopped() ?? false;
    const show = !this.isBreakShot && !this.gameEnded && allStopped;
    console.log(`[CHEAT] updateFinishBtn: show=${show} isBreakShot=${this.isBreakShot} gameEnded=${this.gameEnded} allStopped=${allStopped}`);
    this.renderer.setCheatFinishButton(show);
    this._cheatAwaitingFinish = show;
  }

  /**
   * Called by controls when a ball is clicked in cheat mode.
   * Toggles the ball in the selection list and updates visual highlight.
   * @param {Matter.Body} ball
   */
  handleCheatBallClick(ball) {
    if (!this.cheatEnabled) {
      console.log(`[CHEAT] Ball click ignored: cheat not enabled`);
      return;
    }
    if (!this._cheatAwaitingFinish) {
      console.warn(`[CHEAT] Ball click ignored: _cheatAwaitingFinish=false (Finish Shot button not active). isBreakShot=${this.isBreakShot} gameEnded=${this.gameEnded}`);
      return;
    }

    const idx = this._cheatBallSelections.findIndex(b => b.id === ball.id);
    if (idx >= 0) {
      // Deselect
      this._cheatBallSelections.splice(idx, 1);
      if (this.renderer) this.renderer.setCheatBallSelected(ball.id, false);
      console.log(`[CHEAT] Deselected ball ${ball.plugin?.ballId ?? 'cue'} — selections: [${this._cheatBallSelections.map(b=>b.plugin?.ballId??'cue').join(',')}]`);
    } else {
      // Select
      this._cheatBallSelections.push(ball);
      if (this.renderer) this.renderer.setCheatBallSelected(ball.id, true);
      console.log(`[CHEAT] Selected ball ${ball.plugin?.ballId ?? 'cue'} — selections: [${this._cheatBallSelections.map(b=>b.plugin?.ballId??'cue').join(',')}]`);
    }
  }

  /**
   * Called by controls when a pocket is clicked in cheat mode.
   * Toggles the pocket in the selection list and updates visual highlight.
   * @param {number} pocketId
   */
  handleCheatPocketClick(pocketId) {
    if (!this.cheatEnabled) {
      console.log(`[CHEAT] Pocket click ignored: cheat not enabled`);
      return;
    }
    if (!this._cheatAwaitingFinish) {
      console.warn(`[CHEAT] Pocket click ignored: _cheatAwaitingFinish=false. isBreakShot=${this.isBreakShot} gameEnded=${this.gameEnded}`);
      return;
    }

    const idx = this._cheatPocketSelections.indexOf(pocketId);
    if (idx >= 0) {
      // Deselect
      this._cheatPocketSelections.splice(idx, 1);
      if (this.renderer) this.renderer.setCheatPocketSelected(pocketId, false);
      console.log(`[CHEAT] Deselected pocket ${pocketId} — selections: [${this._cheatPocketSelections.join(',')}]`);
    } else {
      // Select
      this._cheatPocketSelections.push(pocketId);
      if (this.renderer) this.renderer.setCheatPocketSelected(pocketId, true);
      console.log(`[CHEAT] Selected pocket ${pocketId} — selections: [${this._cheatPocketSelections.join(',')}]`);
    }
  }

  /**
   * Clears all cheat selections and visual highlights.
   */
  _resetCheatSelections() {
    this._cheatBallSelections = [];
    this._cheatPocketSelections = [];
    if (this.renderer) this.renderer.clearCheatSelections();
  }

  /**
   * Executes the cheat shot: simulates the selected balls being pocketed
   * in the selected pockets, then runs the full normal shot-end processing.
   *
   * Pairing rule: ball[i] → pocket[i % pockets.length].
   * If no pockets selected but balls are, the first unassigned pocket is used.
   * @param {object} physics  PhysicsEngine reference
   * @param {function} onPocketFn  The shared pocket-overlap handler from main.js
   */
  async executeCheatShot(physics, onPocketFn) {
    if (!this._cheatAwaitingFinish) return;
    if (this._cheatBallSelections.length === 0 && !this.cueBallScratchThisShot) {
      // Nothing selected → treat as a miss (no balls pocketed)
      console.log('[CHEAT] Finish Shot with no balls selected → treating as miss');
    }

    console.log(`[CHEAT] Executing shot: balls=[${this._cheatBallSelections.map(b=>b.plugin?.ballId??'cue').join(',')}] pockets=[${this._cheatPocketSelections.join(',')}]`);

    // Hide Finish Shot button immediately
    this._cheatAwaitingFinish = false;
    if (this.renderer) this.renderer.setCheatFinishButton(false);

    // Clear registers before simulating pocket events
    this.handleShotStart();
    // Cheat shots bypass the valid-shot rule (no real cue stroke happens)
    this._skipShotValidityCheck = true;

    // Simulate each ball being pocketed
    const pocketCount = this._cheatPocketSelections.length;
    this._cheatBallSelections.forEach((ball, i) => {
      const pocketId = pocketCount > 0
        ? this._cheatPocketSelections[i % pocketCount]
        : 0; // fallback: first pocket if none explicitly chosen
      onPocketFn(ball, pocketId);
    });

    // Clear visual selections before processing (avoid stale rings during dialogs)
    this._resetCheatSelections();

    // Run the full normal shot-end processing
    await this.handleShotEnd(physics);

    // Restore validity check after cheat shot processing completes
    this._skipShotValidityCheck = false;

    // After processing, show Finish Shot button again for next shot
    this._updateCheatFinishButton(physics);
  }

  // _showEndGameDialog removed — end-game choice is now inside _showHandCompleteDialog
  // which is triggered whenever a player's hand reaches exactly 5 cards.

  /** @deprecated HTML button — now replaced by Pixi right panel */
  _injectRulesButton(container) {
    // No-op: button is now part of the Pixi canvas via renderer.drawRightPanel()
  }

  showRulesModal() {
    const container = document.getElementById('game-container') || document.body;
    if (document.querySelector('.rules-modal-overlay')) return;

    const overlay = document.createElement('div');
    overlay.className = 'rules-modal-overlay';
    overlay.innerHTML = `
      <div class="rules-modal-card">
        <h2 class="rules-modal-title">📖 How to Play</h2>

        <div class="rules-section-header">The Goal</div>
        <div class="rules-row"><span class="rules-badge">🏆</span><span class="rules-text">Build the best <strong>5-card poker hand</strong> by pocketing pool balls. Each pocket is linked to a suit (♠ ♥ ♦ ♣). Pocket a ball → earn a card. Best hand at showdown wins.</span></div>

        <div class="rules-section-header">Break Shot</div>
        <div class="rules-row"><span class="rules-badge">🎱</span><span class="rules-text">The coin-toss winner places the cue ball <strong>anywhere in the kitchen</strong> (left of the head string) and breaks. Any balls pocketed on the break respawn — no cards or suits are claimed. ${this.config.rules.minBreakCushionContacts ?? 4} cushion contacts required if no ball drops, or it's a foul.</span></div>

        <div class="rules-section-header">Pocket Suits</div>
        <div class="rules-row"><span class="rules-badge">6</span><span class="rules-text">6 pockets — 4 corners + 2 sides. The first ball pocketed into an unclaimed pocket <strong>auto-assigns a random suit</strong> to that pocket. Once 4 suits are mapped, the remaining 2 become <strong>Wild ★ Pockets</strong>.</span></div>

        <div class="rules-section-header">Earning Cards</div>
        <div class="rules-row"><span class="rules-badge">✅</span><span class="rules-text"><strong>Pocket a ball into a valid suit pocket</strong> → earn that card. You may keep shooting until you miss (bonus turn).</span></div>
        <div class="rules-row"><span class="rules-badge">🎫</span><span class="rules-text"><strong>Discard Tokens (${this.config.rules.discardTokens ?? 3} each):</strong> Every time you pocket a ball, you can spend a token to discard any card (the new one OR any existing card in your hand). Use them wisely — they let you shape your hand throughout the game.</span></div>
        <div class="rules-row"><span class="rules-badge">5</span><span class="rules-text"><strong>Hand limit is 5 cards.</strong> With tokens remaining, use one to swap when you pocket a ball. Without tokens at 5 cards, you are <strong>Locked</strong>.</span></div>

        <div class="rules-section-header">Locked State & Endgame</div>
        <div class="rules-row"><span class="rules-badge">🔒</span><span class="rules-text"><strong>Locked</strong> = 5 cards + 0 tokens. You still shoot every turn but all pocketed balls immediately respawn — use it to disrupt the table for your opponent.</span></div>
        <div class="rules-row"><span class="rules-badge">⏳</span><span class="rules-text">When a player locks, the opponent gets <strong>${this.config.rules.lockCountdownTurns ?? 3} more turns</strong> to optimize their hand. The opponent can also click <strong>Accept Showdown</strong> to end early.</span></div>
        <div class="rules-row"><span class="rules-badge">⚔</span><span class="rules-text">When both players are locked, or the countdown hits 0, it's <strong>Showdown</strong> — best poker hand wins!</span></div>

        <div class="rules-section-header">Scratch / Ball-in-Hand</div>
        <div class="rules-row"><span class="rules-badge">👋</span><span class="rules-text">Cue ball pocketed → scratch. All co-pocketed balls respawn, no cards awarded. Opponent gets <strong>Ball-in-Hand</strong> anywhere on the table.</span></div>

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
        <div class="rules-row" style="margin-top:8px;"><span class="rules-badge">A</span><span class="rules-text">Ace plays <strong>high or low</strong>.</span></div>
        <div class="rules-row"><span class="rules-badge">≡</span><span class="rules-text">Ties broken by kickers, then by who completed their hand first.</span></div>

        <button class="rules-close-btn" id="rules-close-btn">GOT IT — CLOSE</button>
      </div>
    `;
    container.appendChild(overlay);
    document.getElementById('rules-close-btn').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  triggerShowdown() {
    if (this.gameEnded) return;
    this.gameEnded = true;

    this._removeAcceptShowdownButton();
    if (this.controls) this.controls.enabled = false;

    const handA = this.hands[this.player1Name] || [];
    const handB = this.hands[this.player2Name] || [];

    const result = compareHands(handA, handB, null, null, this.firstToCompleteHand, this.player1Name, this.player2Name);

    const rankSymbols = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
    const getHandStr = hand => hand.length === 0 ? 'Empty Hand' :
      hand.map(c => `<span style="white-space:nowrap">${rankSymbols[c.rank] || c.rank}${suitSvg(c.suit, 13)}</span>`).join(' ');

    const details = `
      <div style="margin-top:15px;border-top:1px solid rgba(255,255,255,0.15);padding-top:15px;text-align:left;font-family:monospace;font-size:12px;color:#a0aab8;">
        <div style="margin-bottom:8px;"><strong style="color:#00e5ff;">${this.player1Name}'s Hand:</strong> ${getHandStr(handA)}<br><span style="color:#64b5f6;">(${result.labelA})</span></div>
        <div style="margin-bottom:8px;"><strong style="color:#e040fb;">${this.player2Name}'s Hand:</strong> ${getHandStr(handB)}<br><span style="color:#ba68c8;">(${result.labelB})</span></div>
        <div style="margin-top:10px;border-top:1px dashed rgba(255,255,255,0.1);padding-top:8px;color:#ffd700;font-weight:bold;text-align:center;">${result.reason}</div>
      </div>
    `;

    const winnerName = result.winner === 'A' ? this.player1Name : this.player2Name;
    this.showGameOver(winnerName, details);
  }

  showGameOver(winner, reason) {
    this.gameEnded = true;
    if (this.controls) this.controls.enabled = false;
    this._removeAcceptShowdownButton();
    const container = document.getElementById('game-container') || document.body;
    if (container.querySelector('.game-over-overlay')) return;

    const overlay = document.createElement('div');
    overlay.className = 'game-over-overlay';
    overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(4,6,12,0.95);backdrop-filter:blur(12px);display:flex;justify-content:center;align-items:center;z-index:3000;';
    overlay.innerHTML = `
      <div style="background:linear-gradient(135deg,#1f112e 0%,#0d0614 100%);border:3px solid #b388ff;border-radius:24px;padding:40px;text-align:center;box-shadow:0 25px 50px rgba(0,0,0,0.9),0 0 50px rgba(179,136,255,0.4);max-width:440px;width:85%;">
        <h1 style="color:#b388ff;font-size:32px;font-weight:900;margin:0 0 15px 0;letter-spacing:5px;text-shadow:0 0 15px rgba(179,136,255,0.6);">MATCH OVER</h1>
        <p style="color:#e040fb;font-size:18px;font-weight:bold;margin:0 0 10px 0;text-transform:uppercase;text-shadow:0 0 8px rgba(224,64,251,0.5);">${winner.toUpperCase()} WINS!</p>
        <p style="color:#90caf9;font-size:13px;line-height:1.6;margin:0 0 30px 0;">${reason}</p>
        <button onclick="window.location.reload()" style="background:linear-gradient(135deg,#b388ff 0%,#7c4dff 100%);color:white;border:none;border-radius:12px;padding:14px 30px;font-size:14px;font-weight:800;cursor:pointer;box-shadow:0 4px 15px rgba(124,77,255,0.4);letter-spacing:1px;width:100%;">PLAY AGAIN</button>
      </div>
    `;
    container.appendChild(overlay);
  }

  showShotToast(message, type = 'miss', duration = 3000) {
    const container = document.getElementById('game-container') || document.body;
    const existing = container.querySelector('.shot-toast');
    if (existing) { clearTimeout(existing._exitTimer); existing.remove(); }

    const toast = document.createElement('div');
    toast.className = `shot-toast type-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    const exitTimer = setTimeout(() => {
      toast.classList.add('toast-exit');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }, duration);
    toast._exitTimer = exitTimer;
  }
}
