import { CONFIG } from './config.js';
import Matter from 'matter-js';
import { compareHands, evaluatePokerHand } from './poker.js';

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
    } else {
      const ballId = ball.plugin.ballId;
      if (!this.pocketedBallsThisShot.includes(ballId)) {
        this.pocketedBallsThisShot.push(ballId);
        this.pocketedBallsDetails.push({ ballId, ball, pocketId });
      }
    }
  }

  handleShotStart() {
    this.pocketedBallsThisShot = [];
    this.pocketedBallsDetails = [];
    this.cueBallScratchThisShot = false;
  }

  async handleShotEnd(physics) {
    if (this.gameEnded) return;

    console.log(`Shot end. Break:${this.isBreakShot}, Pocketed:[${this.pocketedBallsThisShot.join(',')}], Scratch:${this.cueBallScratchThisShot}`);

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

    const scorer = this.activePlayer;
    this._resolveTurn(anyValidScore, invalidReasons, opponent);

    if (this.renderer) this.renderer.updateHUD(this.hands, this.activePlayer, this.discardTokens);

    if (this.gameEnded) return;

    // Check if the scoring player just became locked
    this._checkAndTriggerLock(scorer);
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
   * Core card-addition gateway.
   * Shows the discard-token prompt. Player can:
   *   • Add card for free (hand < 5)
   *   • Spend a token to discard any card (new or existing)
   * When the hand reaches 5, shows a ONE-TIME "last chance" prompt:
   *   • Use a token to remove one card (hand drops to 4, play continues)
   *   • Decline → player is immediately locked
   * Returns true if the card was ultimately added to the player's hand.
   */
  async _processCardAddition(player, newCard) {
    const hand = this.hands[player];

    // Hard guard: locked players should never reach here (intercepted by interference path)
    if (hand.length >= 5) return false;

    const result = await this.promptDiscardChoice(player, newCard);

    if (result.usedToken) {
      this.discardTokens[player] = Math.max(0, (this.discardTokens[player] ?? 0) - 1);
    }

    // Track who first built a complete 5-card hand
    if (result.added && hand.length === 5 && !this.firstToCompleteHand) {
      this.firstToCompleteHand = player;
    }

    // Hand just hit 5 → one last chance to discard before locking
    if (result.added && hand.length === 5) {
      const tokensNow = this.discardTokens[player] ?? 0;
      if (tokensNow > 0) {
        const usedLastChance = await this._promptLastChanceDiscard(player);
        if (usedLastChance) {
          // They discarded one card, hand is back at 4 — no lock
          if (this.renderer) this.renderer.updateHUD(this.hands, this.activePlayer, this.discardTokens);
          return result.added;
        }
      }
      // No tokens OR declined → lock now
      this.triggerLock(player);
    }

    return result.added;
  }

  /**
   * One-time "hand complete" prompt when player's hand just reached 5.
   * Player can spend ONE token to remove any card (hand drops to 4), or lock in.
   * Handles its own token decrement.
   * @returns {Promise<boolean>} true if they used the token and discarded, false if locked
   */
  _promptLastChanceDiscard(player) {
    return new Promise((resolve) => {
      if (this.controls) this.controls.enabled = false;

      const hand = this.hands[player];
      const tokens = this.discardTokens[player] ?? 0;
      const isP1 = player === this.player1Name;
      const accentColor = isP1 ? '#00e5ff' : '#e040fb';
      const suitSymbols = { S: '♠', H: '♥', D: '♦', C: '♣' };
      const rankLabels = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };

      const container = document.getElementById('game-container') || document.body;
      const overlay = document.createElement('div');
      overlay.className = 'discard-choice-overlay';

      const tokenDots = Array.from({ length: 3 }, (_, i) =>
        `<span class="token-dot${i < tokens ? ' active' : ''}"></span>`
      ).join('');

      const cardHtml = (card, idx) => {
        const r = rankLabels[card.rank] || String(card.rank);
        const s = suitSymbols[card.suit] || card.suit;
        const red = card.suit === 'H' || card.suit === 'D';
        return `<div class="discard-card-item${red ? ' red-suit' : ''}" data-idx="${idx}">
          <div class="preview-top">${r}</div>
          <div class="preview-center">${s}</div>
          <div class="preview-top" style="transform:rotate(180deg);align-self:flex-end">${r}</div>
        </div>`;
      };

      overlay.innerHTML = `
        <div class="discard-choice-card" style="border-color:${accentColor}60">
          <div class="discard-choice-header" style="color:${accentColor}">🏆 ${player.toUpperCase()} — HAND COMPLETE</div>
          <div style="color:#b0bec5;font-size:11px;text-align:center;line-height:1.5;">Your hand is full! Last chance to swap a card using one discard token.<br>If you decline, your hand locks in immediately.</div>
          <div class="discard-actions" id="lc-actions">
            <button class="discard-btn-token" id="lc-discard">✂ USE TOKEN — REMOVE A CARD</button>
            <button class="discard-btn-skip" id="lc-lock">🔒 LOCK MY HAND</button>
          </div>
          <div id="lc-picker" style="display:none;width:100%">
            <div class="discard-picker-label">Pick a card to remove from your hand:</div>
            <div class="discard-picker-grid" id="lc-grid">${hand.map((c, i) => cardHtml(c, i)).join('')}</div>
            <button class="discard-btn-confirm" id="lc-confirm" disabled>CONFIRM REMOVE</button>
          </div>
        </div>
      `;
      container.appendChild(overlay);

      let selectedIdx = -1;

      const doResolve = (used) => {
        overlay.style.opacity = '0';
        setTimeout(() => {
          overlay.remove();
          if (this.controls) this.controls.enabled = true;
          resolve(used);
        }, 300);
      };

      overlay.querySelector('#lc-lock').addEventListener('click', () => doResolve(false));

      overlay.querySelector('#lc-discard').addEventListener('click', () => {
        overlay.querySelector('#lc-actions').style.display = 'none';
        overlay.querySelector('#lc-picker').style.display = 'block';

        overlay.querySelectorAll('#lc-grid .discard-card-item').forEach(el => {
          el.addEventListener('click', () => {
            overlay.querySelectorAll('#lc-grid .discard-card-item').forEach(e => e.classList.remove('selected'));
            el.classList.add('selected');
            selectedIdx = parseInt(el.getAttribute('data-idx'));
            overlay.querySelector('#lc-confirm').disabled = false;
          });
        });
      });

      overlay.querySelector('#lc-confirm').addEventListener('click', () => {
        if (selectedIdx < 0) return;
        hand.splice(selectedIdx, 1); // hand goes from 5 → 4
        this.discardTokens[player] = Math.max(0, (this.discardTokens[player] ?? 0) - 1);
        doResolve(true);
      });
    });
  }

  /**
   * Shows the discard-choice modal and returns the player's decision.
   * @returns {Promise<{added: boolean, usedToken: boolean, swappedOut: boolean}>}
   */
  promptDiscardChoice(player, newCard) {
    return new Promise((resolve) => {
      if (this.controls) this.controls.enabled = false;

      const hand = this.hands[player]; // always < 5 when called
      const tokens = this.discardTokens[player] ?? 0;
      const isP1 = player === this.player1Name;
      const accentColor = isP1 ? '#00e5ff' : '#e040fb';
      const suitSymbols = { S: '♠', H: '♥', D: '♦', C: '♣' };
      const rankLabels = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };

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

      const newR = rankLabels[newCard.rank] || String(newCard.rank);
      const newS = suitSymbols[newCard.suit] || newCard.suit;
      const newRed = newCard.suit === 'H' || newCard.suit === 'D';

      const tokenDots = Array.from({ length: 3 }, (_, i) =>
        `<span class="token-dot${i < tokens ? ' active' : ''}"></span>`
      ).join('');

      overlay.innerHTML = `
        <div class="discard-choice-card" style="border-color:${accentColor}40">
          <div class="discard-choice-header" style="color:${accentColor}">${player.toUpperCase()} — BALL POCKETED</div>
          <div class="discard-new-card-row">
            <div class="discard-new-label">New card earned:</div>
            <div class="discard-card-item new-card${newRed ? ' red-suit' : ''}" style="border-color:${accentColor}">
              <div class="preview-top">${newR}</div>
              <div class="preview-center">${newS}</div>
              <div class="preview-top" style="transform:rotate(180deg);align-self:flex-end">${newR}</div>
            </div>
          </div>
          <div class="discard-actions" id="discard-actions">
            <button class="discard-btn-add" id="dc-add">ADD TO HAND</button>
            ${tokens > 0 ? `<button class="discard-btn-token" id="dc-token">Discard (${tokens} chance${tokens !== 1 ? 's' : ''} left)</button>` : ''}
          </div>
          <div class="discard-picker" id="discard-picker" style="display:none">
            <div class="discard-picker-label">Pick a card to discard (including the new one):</div>
            <div class="discard-picker-grid" id="discard-picker-grid"></div>
            <button class="discard-btn-confirm" id="dc-confirm" disabled>CONFIRM DISCARD</button>
          </div>
        </div>
      `;
      container.appendChild(overlay);

      let selectedDiscardIdx = -1;

      const doResolve = (added, usedToken, swappedOut = false) => {
        overlay.style.opacity = '0';
        setTimeout(() => {
          overlay.remove();
          if (this.controls) this.controls.enabled = true;
          resolve({ added, usedToken, swappedOut });
        }, 300);
      };

      // "Add to hand" free path
      overlay.querySelector('#dc-add').addEventListener('click', () => {
        hand.push(newCard);
        doResolve(true, false);
      });

      // "Use token" path — reveal picker
      const tokenBtn = overlay.querySelector('#dc-token');
      if (tokenBtn) {
        tokenBtn.addEventListener('click', () => {
          overlay.querySelector('#discard-actions').style.display = 'none';
          const picker = overlay.querySelector('#discard-picker');
          const grid = overlay.querySelector('#discard-picker-grid');
          picker.style.display = 'block';

          const allCards = [...hand, newCard];
          grid.innerHTML = allCards.map((c, i) => cardHtml(c, i, i === hand.length)).join('');

          grid.querySelectorAll('.discard-card-item').forEach(el => {
            el.addEventListener('click', () => {
              grid.querySelectorAll('.discard-card-item').forEach(e => e.classList.remove('selected'));
              el.classList.add('selected');
              selectedDiscardIdx = parseInt(el.getAttribute('data-idx'));
              overlay.querySelector('#dc-confirm').disabled = false;
            });
          });
        });
      }

      // Confirm discard
      overlay.querySelector('#dc-confirm').addEventListener('click', () => {
        if (selectedDiscardIdx < 0) return;
        const allCards = [...hand, newCard];
        const discardedNew = selectedDiscardIdx === hand.length;

        if (discardedNew) {
          doResolve(false, true, false);
        } else {
          hand.splice(selectedDiscardIdx, 1);
          hand.push(newCard);
          doResolve(true, true, true);
        }
      });
    });
  }

  _resolveTurn(anyValidScore, invalidReasons, opponent) {
    const anyInvalidDrop = invalidReasons.length > 0;
    const primaryReason = invalidReasons[0] || null;

    if (anyValidScore && !anyInvalidDrop) {
      const handSize = (this.hands[this.activePlayer] || []).length;
      const tok = this.discardTokens[this.activePlayer] ?? 0;
      this.showShotToast(`✅ Scored! ${this.activePlayer}: ${handSize}/5 cards, ${tok} token${tok !== 1 ? 's' : ''} left — bonus turn`, 'score');

    } else if (anyValidScore && anyInvalidDrop) {
      this.activePlayer = opponent;
      this.showShotToast(`⚠️ Mixed shot — card scored but also: ${this._invalidReasonText(primaryReason)}`, 'mixed');

    } else if (anyInvalidDrop) {
      this.activePlayer = opponent;
      this.showShotToast(`🚫 ${this._invalidReasonText(primaryReason)}`, 'invalid');

    } else {
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

  promptSuitMapping(player, pocketId, ballId) {
    return new Promise((resolve) => {
      const claimedSuits = this.pocketSuits.filter(s => s !== null && s !== 'W');
      const allSuits = ['S', 'H', 'D', 'C'];
      const remainingSuits = allSuits.filter(s => !claimedSuits.includes(s));

      if (remainingSuits.length === 1) { resolve(remainingSuits[0]); return; }

      this.controls.enabled = false;
      const container = document.getElementById('game-container') || document.body;
      const overlay = document.createElement('div');
      overlay.className = 'suit-mapping-overlay';

      const pocketNames = ['Top Left Corner', 'Top Right Corner', 'Bottom Left Corner', 'Bottom Right Corner', 'Top Side', 'Bottom Side'];
      const pocketName = pocketNames[pocketId] || `Pocket ${pocketId}`;
      const ballName = ballId === 1 ? 'Ace' : ballId === 11 ? 'Jack' : ballId === 12 ? 'Queen' : ballId === 13 ? 'King' : ballId;

      const { xCenter, yCenter, width, height, } = this.config.table;
      const { sideOffset } = this.config.pocket;
      const hw = width / 2, hh = height / 2;
      const pocketPositions = [
        { x: xCenter - hw, y: yCenter - hh, cls: 'top-left' },
        { x: xCenter + hw, y: yCenter - hh, cls: 'top-right' },
        { x: xCenter - hw, y: yCenter + hh, cls: 'bottom-left' },
        { x: xCenter + hw, y: yCenter + hh, cls: 'bottom-right' },
        { x: xCenter, y: yCenter - hh - sideOffset, cls: 'top-side' },
        { x: xCenter, y: yCenter + hh + sideOffset, cls: 'bottom-side' }
      ];
      const pos = pocketPositions[pocketId] || { x: 512, y: 338, cls: '' };
      const left = (pos.x / 10.24).toFixed(1);
      const top = (pos.y / 5.76).toFixed(1);

      overlay.innerHTML = `
        <div class="suit-mapping-card ${pos.cls}" style="position:absolute;left:${left}%;top:${top}%;">
          <h2 class="suit-mapping-title">CLAIM SUIT</h2>
          <p class="suit-mapping-subtitle">${player.toUpperCase()} pocketed [${ballName}] in the ${pocketName}!<br>Map a suit to this pocket:</p>
          <div class="suit-buttons-grid">
            <button class="suit-btn spades" data-suit="S" ${!remainingSuits.includes('S') ? 'disabled' : ''}><span class="suit-symbol">♠</span><span class="suit-label">SPADES</span></button>
            <button class="suit-btn hearts" data-suit="H" ${!remainingSuits.includes('H') ? 'disabled' : ''}><span class="suit-symbol">♥</span><span class="suit-label">HEARTS</span></button>
            <button class="suit-btn diamonds" data-suit="D" ${!remainingSuits.includes('D') ? 'disabled' : ''}><span class="suit-symbol">♦</span><span class="suit-label">DIAMONDS</span></button>
            <button class="suit-btn clubs" data-suit="C" ${!remainingSuits.includes('C') ? 'disabled' : ''}><span class="suit-symbol">♣</span><span class="suit-label">CLUBS</span></button>
          </div>
        </div>
      `;
      container.appendChild(overlay);

      overlay.querySelectorAll('.suit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const selectedSuit = btn.getAttribute('data-suit');
          overlay.style.opacity = '0';
          setTimeout(() => { overlay.remove(); this.controls.enabled = true; resolve(selectedSuit); }, 350);
        });
      });
    });
  }

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
            <button class="wild-suit-btn spades" data-suit="S">♠</button>
            <button class="wild-suit-btn hearts" data-suit="H">♥</button>
            <button class="wild-suit-btn diamonds" data-suit="D">♦</button>
            <button class="wild-suit-btn clubs" data-suit="C">♣</button>
          </div>
          <button id="wild-confirm-btn" style="background:linear-gradient(135deg,#ffd700 0%,#ffb300 100%);color:#0d1527;border:none;border-radius:8px;padding:12px 25px;font-size:14px;font-weight:bold;cursor:pointer;width:100%;box-shadow:0 4px 15px rgba(255,215,0,0.4);letter-spacing:1px;">ADD TO HAND</button>
        </div>
      `;
      container.appendChild(overlay);

      const updateCardPreview = () => {
        const syms = { S: '♠', H: '♥', D: '♦', C: '♣' };
        const rl = rankNames[selectedRank] || String(selectedRank);
        const isRed = selectedSuit === 'H' || selectedSuit === 'D';
        const p = overlay.querySelector('#wild-card-preview');
        if (p) {
          p.className = `wild-card-preview${isRed ? ' red-suit' : ''}`;
          p.innerHTML = `<div class="preview-top">${rl}</div><div class="preview-center">${syms[selectedSuit]}</div><div class="preview-top" style="transform:rotate(180deg);align-self:flex-end">${rl}</div>`;
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
        <div class="rules-row"><span class="rules-badge">6</span><span class="rules-text">6 pockets — 4 corners + 2 sides. First 4 balls pocketed into 4 different pockets each claim a <strong>suit</strong>. Once 4 suits are mapped, the remaining 2 become <strong>Wild ★ Pockets</strong>.</span></div>

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

    const suitSymbols = { S: '♠', H: '♥', D: '♦', C: '♣' };
    const rankSymbols = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
    const getHandStr = hand => hand.length === 0 ? 'Empty Hand' :
      hand.map(c => `${rankSymbols[c.rank] || c.rank}${suitSymbols[c.suit] || c.suit}`).join(', ');

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
