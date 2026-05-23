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

    this.player1Name = this.config.rules?.player1Name || 'Alice';
    this.player2Name = this.config.rules?.player2Name || 'Bob';

    // Game state
    this.activePlayer = this.player1Name;
    this.isBreakShot = true;
    this.isTossing = false;
    this.gameEnded = false;

    // Discard token system
    const startTokens = this.config.rules?.discardTokens ?? 3;
    this.discardTokens = {
      [this.player1Name]: startTokens,
      [this.player2Name]: startTokens
    };

    // Lock state: a player is locked when they have 5 cards AND 0 tokens
    this.lockedPlayers = {
      [this.player1Name]: false,
      [this.player2Name]: false
    };
    this.lockedPlayer = null;       // Who triggered the lock countdown
    this.lockCountdown = -1;
    this.lockCountdownActive = false;

    // Tiebreaker tracking
    this.firstToCompleteHand = null;

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

    // Pocket mapping & phase transition
    this.pocketSuits = new Array(6).fill(null);
    this.phase = 1;
  }

  get opponent() {
    return this.activePlayer === this.player1Name ? this.player2Name : this.player1Name;
  }

  /**
   * Triggers the coin toss overlay and sets the starting active player.
   */
  startMatch(controls, renderer) {
    this.controls = controls;
    this.renderer = renderer;
    this.renderer.gameRef = this;

    return new Promise((resolve) => {
      this.isTossing = true;
      this.controls.enabled = false;

      const winner = Math.random() < 0.5 ? this.player1Name : this.player2Name;
      this.activePlayer = winner;

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

          this._injectRulesButton(container);
          this.renderer.setActivePlayer(this.activePlayer);

          console.log(`Coin Toss: ${this.activePlayer} breaks.`);
          resolve(winner);
        }, 500);
      }, 3200);
    });
  }

  handlePocketOverlap(ball, pocketId = -1) {
    if (ball.label === 'cue_ball') {
      this.cueBallScratchThisShot = true;
      console.log(`[POCKET] Cue ball scratched → pocket ${pocketId}`);
    } else {
      const ballId = ball.plugin.ballId;
      if (!this.pocketedBallsThisShot.includes(ballId)) {
        this.pocketedBallsThisShot.push(ballId);
        this.pocketedBallsDetails.push({ ballId, ball, pocketId });
        const suitLabel = this.pocketSuits[pocketId] ?? 'unset';
        console.log(`[POCKET] Ball ${ballId} → pocket ${pocketId} (suit=${suitLabel}), shot tally: [${this.pocketedBallsThisShot.join(',')}]`);
      } else {
        console.log(`[POCKET] Ball ${ballId} pocket event de-duped (already recorded this shot)`);
      }
    }
  }

  handleShotStart() {
    this.pocketedBallsThisShot = [];
    this.pocketedBallsDetails = [];
    this.cueBallScratchThisShot = false;
    console.log(`[SHOT_START] Registers cleared — ${this.activePlayer}'s shot`);
  }

  async handleShotEnd(physics) {
    if (this.gameEnded) return;

    console.log(`[SHOT_END] player=${this.activePlayer} break=${this.isBreakShot} scratch=${this.cueBallScratchThisShot} pocketed=[${this.pocketedBallsThisShot.join(',')}]`);

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

    // Phase 1: For each pocketed ball, prompt for suit mapping / wildcard selection
    // and collect all new cards. No hand dialog yet.
    const { cardsToAdd, ballActions, invalidReasons, anyValid } =
      await this._resolveNewCards(physics);

    // Phase 2: Show ONE unified hand dialog for all new cards at once
    if (cardsToAdd.length > 0) {
      console.log(`[DIALOG] Showing hand dialog for ${this.activePlayer}: newCards=[${cardsToAdd.map(c=>`${c.rank}${c.suit}`).join(',')}]`);
      const { tokensSpent } = await this._showUnifiedHandDialog(this.activePlayer, cardsToAdd);
      this.discardTokens[this.activePlayer] = Math.max(
        0,
        (this.discardTokens[this.activePlayer] ?? 0) - tokensSpent
      );
      console.log(`[DIALOG] Done — tokensSpent=${tokensSpent}, tokens remaining=${this.discardTokens[this.activePlayer]}, hand=[${(this.hands[this.activePlayer]||[]).map(c=>`${c.rank}${c.suit}`).join(',')}]`);

      // Track who first completed a full 5-card hand
      if (this.hands[this.activePlayer].length === 5 && !this.firstToCompleteHand) {
        this.firstToCompleteHand = this.activePlayer;
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

        // Discard — remove selected card, deduct token if not a free overflow discard
        const discardBtn = overlay.querySelector('#dc-discard');
        if (discardBtn) {
          discardBtn.addEventListener('click', () => {
            if (!selectedUid) return;
            const beforeSize = workingHand.length;
            workingHand = workingHand.filter(c => c.uid !== selectedUid);
            // Token cost only when the discard does NOT reduce an overflow (i.e. beforeSize ≤ 5)
            const wasOverflow = beforeSize > 5;
            if (!wasOverflow && availableTokens > 0) {
              availableTokens--;
              tokensSpent++;
            }
            selectedUid = null;
            renderContent();
          });
        }
      };

      renderContent();
    });
  }

  /**
   * Checks whether the given player is now locked (5 cards, 0 tokens) and triggers if so.
   */
  _checkAndTriggerLock(player) {
    if (this.gameEnded) return;
    const hand = this.hands[player] || [];
    const tokens = this.discardTokens[player] ?? 0;
    if (hand.length === 5 && tokens === 0 && !this.lockedPlayers[player]) {
      this.triggerLock(player);
    }
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
      case 'duplicate':             return 'Card already held by either player';
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
        <div style="margin-bottom:8px;"><strong style="color:#00e5ff;">Alice's Hand:</strong> ${getHandStr(handA)}<br><span style="color:#64b5f6;">(${result.labelA})</span></div>
        <div style="margin-bottom:8px;"><strong style="color:#e040fb;">Bob's Hand:</strong> ${getHandStr(handB)}<br><span style="color:#ba68c8;">(${result.labelB})</span></div>
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
