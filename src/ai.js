import Matter from 'matter-js';
import { CONFIG } from './config.js';

/**
 * Medium-difficulty AI player for Poker Pool.
 *
 * Algorithm:
 *  1. Wait for its turn (triggered from main.js after handleShotEnd resolves).
 *  2. If ball-in-hand, place cue ball at the best available kitchen position.
 *  3. Enumerate every (object-ball, pocket) combo, run ghost-ball geometry and
 *     obstruction checks, score by how much the card improves the AI's hand.
 *  4. Fire the best-scoring shot with small Gaussian aiming error and power
 *     variance so it isn't perfectly robotic.
 *  5. If no clear shot exists, fire a safety shot toward the densest cluster.
 *
 * Difficulty params (medium):
 *   aimErrorDegrees : 3.5   — std-dev of Gaussian aiming noise
 *   powerVariance   : 0.10  — ±10% random power variation
 *   thinkTimeMs     : 600   — fake "thinking" delay before each shot (ms)
 */
export class AIPlayer {
  /**
   * @param {Object}  config      Centralized CONFIG object
   * @param {string}  playerName  Must match game.player2Name (default 'Bob')
   */
  constructor(config = CONFIG, playerName = null) {
    this.config     = config;
    this.playerName = playerName ?? config.rules?.player2Name ?? 'Bob';

    // ── Difficulty tuning ────────────────────────────────────────────────────
    this.aimErrorDegrees = 3.5;   // Gaussian σ for aiming error in degrees
    this.powerVariance   = 0.10;  // ±fraction random power multiplier
    this.thinkTimeMs     = 600;   // base think delay (randomised ±200ms)
    this.safetyPlayChance = 0.05; // 5% chance to intentionally play safe
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Entry point called by main.js when it's the AI's turn.
   * Handles ball-in-hand placement, shot selection, and firing.
   *
   * @param {PhysicsEngine}  physics
   * @param {GameEngine}     game
   * @param {AimingControls} controls
   */
  async takeTurn(physics, game, controls) {
    console.log(`[AI] === Turn start — ${this.playerName}'s turn ===`);

    await this._think();

    const cueBall = physics.cueBall;
    if (!cueBall) {
      console.warn('[AI] No cue ball found — skipping turn');
      return;
    }

    // ── Ball-in-hand: place cue ball first ───────────────────────────────
    if (controls.hasBallInHand || controls.isBreakPlacement) {
      this._placeCueBall(physics, game, controls);
      await this._think(450);
    }

    // ── Rare safety play ────────────────────────────────────────────────
    if (Math.random() < this.safetyPlayChance) {
      console.log('[AI] Intentional safety play');
      this._fireSafetyShot(physics, game, controls);
      return;
    }

    // ── Find and fire best shot ─────────────────────────────────────────
    const shot = this._findBestShot(physics, game);
    if (shot) {
      this._fireShot(physics, game, controls, shot);
    } else {
      console.log('[AI] No pottable shot found — safety shot');
      this._fireSafetyShot(physics, game, controls);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SHOT SELECTION
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Evaluates all (ball, pocket) combinations and returns the best one,
   * or null if none is clear.
   */
  _findBestShot(physics, game) {
    const cueBall  = physics.cueBall;
    const balls    = physics.targetBalls;
    const pockets  = physics.pockets;
    const radius   = this.config.ball.radius;

    let best = null;
    let bestScore = -Infinity;

    for (const ball of balls) {
      for (const pocket of pockets) {
        // Ghost ball: where cue ball must be to sink OB into this pocket
        const ghost = this._ghostBallPos(ball.position, pocket.position, radius);

        // Ghost must be inside the table
        if (!this._isInsideTable(ghost)) continue;

        // Cue ball → ghost: must be unobstructed (excluding the target OB)
        if (!this._lineIsClear(cueBall.position, ghost, ball, balls, radius)) continue;

        // OB → pocket: must also be roughly clear
        if (!this._lineIsClear(ball.position, pocket.position, ball, balls, radius)) continue;

        const score = this._scoreShot(ball, pocket, ghost, cueBall.position, game);
        if (score > bestScore) {
          bestScore = score;
          best = { ball, pocket, ghost, score };
        }
      }
    }

    if (best) {
      console.log(`[AI] Best shot: ball=${best.ball.plugin?.ballId} pocket=${best.pocket.plugin?.pocketId} score=${best.score.toFixed(1)}`);
    }
    return best;
  }

  /**
   * Scores a potential shot.  Higher = better.
   * Factors in card value, hand improvement, shot difficulty.
   */
  _scoreShot(ball, pocket, ghost, cueBallPos, game) {
    const ballId   = ball.plugin?.ballId;
    const pocketId = pocket.plugin?.pocketId ?? -1;
    const suit     = game.pocketSuits[pocketId];
    const hand     = game.hands[this.playerName] || [];
    const oppHand  = game.hands[game.player1Name === this.playerName ? game.player2Name : game.player1Name] || [];

    let score = 0;

    // ── Card value ─────────────────────────────────────────────────────────
    if (suit === null) {
      score += 30; // Unmapped pocket — bonus for expanding the board
    } else if (suit === 'W') {
      score -= 20; // Wild pocket for a rank ball is low priority
    } else if (ballId <= 13) {
      const alreadyHeld =
        hand.some(c => c.rank === ballId && c.suit === suit) ||
        oppHand.some(c => c.rank === ballId && c.suit === suit);
      if (alreadyHeld) {
        score -= 200; // Avoid wasted shots on duplicates
      } else if (hand.length < 5) {
        // Estimate improvement: just completing the hand is worth a lot
        score += hand.length === 4 ? 800 : 100 + ballId * 5;
      } else {
        // Already have 5 — score by how much swapping improves the hand
        score += 60; // Some value for being able to swap
      }
    } else {
      // Wildcard ball (14–15) in wild pocket
      score += suit === 'W' ? 150 : -50;
    }

    // ── Shot difficulty ────────────────────────────────────────────────────
    // Penalise distance: farther cue-ball travel = less precise
    const dx = ghost.x - cueBallPos.x;
    const dy = ghost.y - cueBallPos.y;
    score -= Math.sqrt(dx * dx + dy * dy) * 0.08;

    // Penalise OB-to-pocket distance
    const ox = pocket.position.x - ball.position.x;
    const oy = pocket.position.y - ball.position.y;
    score -= Math.sqrt(ox * ox + oy * oy) * 0.04;

    return score;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SHOT EXECUTION
  // ─────────────────────────────────────────────────────────────────────────

  _fireShot(physics, game, controls, shot) {
    const cueBall = physics.cueBall;

    // Direction from cue ball to ghost ball
    const dx = shot.ghost.x - cueBall.position.x;
    const dy = shot.ghost.y - cueBall.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;

    // Apply Gaussian aiming error
    const sigma = this.aimErrorDegrees * (Math.PI / 180);
    // Box-Muller for Gaussian sample
    const u1 = Math.random() || 1e-10;
    const u2 = Math.random();
    const errorRad = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * sigma;

    const cos = Math.cos(errorRad);
    const sin = Math.sin(errorRad);
    const ux  = dx / dist;
    const uy  = dy / dist;
    const dirX = ux * cos - uy * sin;
    const dirY = ux * sin + uy * cos;

    // Power: scale with shot distance, add variance
    const maxSpeed  = this.config.ball.maxSpeed;
    const basePower = Math.min(0.75, 0.30 + dist / 500);
    const variance  = (Math.random() - 0.5) * 2 * this.powerVariance;
    const power     = Math.max(0.15, Math.min(1.0, basePower * (1 + variance)));
    const speed     = power * maxSpeed;

    console.log(`[AI] Firing: ball=${shot.ball.plugin?.ballId} pocket=${shot.pocket.plugin?.pocketId} dist=${dist.toFixed(0)} power=${power.toFixed(2)} error=${(errorRad * 180 / Math.PI).toFixed(1)}°`);

    if (controls.onShotFired) controls.onShotFired();
    physics.cueBallSpin = { x: 0, y: 0 };
    physics.applyCueStroke({ x: dirX * speed, y: dirY * speed });
  }

  /**
   * Safety shot: drive the cue ball into the thickest cluster without
   * worrying about pocketing, to scatter balls and deny easy shots.
   */
  _fireSafetyShot(physics, game, controls) {
    const cueBall = physics.cueBall;
    const balls   = physics.targetBalls;
    const { xCenter, yCenter } = this.config.table;

    // Find cluster centroid
    let tx = xCenter, ty = yCenter;
    if (balls.length > 0) {
      tx = balls.reduce((s, b) => s + b.position.x, 0) / balls.length;
      ty = balls.reduce((s, b) => s + b.position.y, 0) / balls.length;
    }

    const dx = tx - cueBall.position.x;
    const dy = ty - cueBall.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const speed = this.config.ball.maxSpeed * 0.45;

    console.log(`[AI] Safety shot toward cluster (${tx.toFixed(0)},${ty.toFixed(0)})`);
    if (controls.onShotFired) controls.onShotFired();
    physics.cueBallSpin = { x: 0, y: 0 };
    physics.applyCueStroke({ x: (dx / dist) * speed, y: (dy / dist) * speed });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BALL-IN-HAND PLACEMENT
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Places the cue ball at the best available position in the kitchen
   * (or anywhere on the table if it's a normal ball-in-hand, not a break).
   */
  _placeCueBall(physics, game, controls) {
    const { xCenter, yCenter, width } = this.config.table;
    const radius = this.config.ball.radius;

    const isBreak = controls.isBreakPlacement || game.isBreakShot;

    // For break: place at head string centre, offset slightly for variation
    // For normal BIH: pick the position with the clearest shot at a high-value ball
    let bestPos;
    if (isBreak) {
      const headX = xCenter - width / 4;
      // Try a few Y positions to avoid other balls
      const yOptions = [yCenter, yCenter - 30, yCenter + 30, yCenter - 70, yCenter + 70];
      bestPos = this._findClearPosition(physics, yOptions.map(y => ({ x: headX, y })), radius) || { x: headX, y: yCenter };
    } else {
      // Generate a grid of candidate positions across the table
      const candidates = [];
      for (let xi = -3; xi <= 3; xi++) {
        for (let yi = -2; yi <= 2; yi++) {
          candidates.push({
            x: xCenter + xi * 80,
            y: yCenter + yi * 60
          });
        }
      }
      // Filter inside table and pick the one with the best shot angle
      bestPos = this._findBestBIHPosition(physics, game, candidates, radius) ||
                { x: xCenter - width / 4, y: yCenter };
    }

    console.log(`[AI] Placing cue ball at (${bestPos.x.toFixed(0)}, ${bestPos.y.toFixed(0)}) isBreak=${isBreak}`);
    Matter.Body.setPosition(physics.cueBall, bestPos);
    Matter.Body.setVelocity(physics.cueBall, { x: 0, y: 0 });
    Matter.Body.setAngularVelocity(physics.cueBall, 0);

    controls.hasBallInHand      = false;
    controls.isBreakPlacement   = false;
  }

  /**
   * From a list of candidate positions, returns the first that has no ball
   * within 3 radii, or null if all are blocked.
   */
  _findClearPosition(physics, candidates, radius) {
    for (const pos of candidates) {
      if (!this._isInsideTable(pos)) continue;
      const clear = physics.targetBalls.every(b => {
        const dx = b.position.x - pos.x;
        const dy = b.position.y - pos.y;
        return Math.sqrt(dx * dx + dy * dy) >= radius * 3;
      });
      if (clear) return pos;
    }
    return null;
  }

  /**
   * From candidate positions, returns the one that gives the highest shot score.
   * Falls back to `_findClearPosition` if no shot is found.
   */
  _findBestBIHPosition(physics, game, candidates, radius) {
    let best = null;
    let bestScore = -Infinity;

    for (const pos of candidates) {
      if (!this._isInsideTable(pos)) continue;

      // Must be clear of all balls
      const occupied = physics.targetBalls.some(b => {
        const dx = b.position.x - pos.x;
        const dy = b.position.y - pos.y;
        return Math.sqrt(dx * dx + dy * dy) < radius * 3;
      });
      if (occupied) continue;

      // Temporarily evaluate shot score from this cue ball position
      const fakeCueBall = { position: pos };
      let maxScore = -Infinity;
      for (const ball of physics.targetBalls) {
        for (const pocket of physics.pockets) {
          const ghost = this._ghostBallPos(ball.position, pocket.position, radius);
          if (!this._isInsideTable(ghost)) continue;
          if (!this._lineIsClear(pos, ghost, ball, physics.targetBalls, radius)) continue;
          const s = this._scoreShot(ball, pocket, ghost, pos, game);
          if (s > maxScore) maxScore = s;
        }
      }

      if (maxScore > bestScore) {
        bestScore = maxScore;
        best = pos;
      }
    }

    return best || this._findClearPosition(physics, candidates, radius);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GEOMETRY HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Ghost ball position: the exact cue-ball centre needed to pocket
   * the object ball into the given pocket.
   *
   *   ghost = OB_pos + normalize(OB_pos − pocket_pos) × 2R
   */
  _ghostBallPos(obPos, pocketPos, radius) {
    const dx = obPos.x - pocketPos.x;
    const dy = obPos.y - pocketPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    return {
      x: obPos.x + (dx / dist) * 2 * radius,
      y: obPos.y + (dy / dist) * 2 * radius
    };
  }

  /**
   * Returns true if a position is inside the play-area bounds (accounting for ball radius).
   */
  _isInsideTable(pos) {
    const { xCenter, yCenter, width, height } = this.config.table;
    const r = this.config.ball.radius;
    return (
      pos.x >= xCenter - width  / 2 + r &&
      pos.x <= xCenter + width  / 2 - r &&
      pos.y >= yCenter - height / 2 + r &&
      pos.y <= yCenter + height / 2 - r
    );
  }

  /**
   * Ray–circle obstruction test.
   * Returns false if any ball (except `excludeBall`) blocks the line from→to.
   *
   * @param {Object}        from         Start point {x,y}
   * @param {Object}        to           End point {x,y}
   * @param {Matter.Body|null} excludeBall  Ball to skip (the target OB)
   * @param {Matter.Body[]} allBalls     All target balls
   * @param {number}        radius       Ball radius
   */
  _lineIsClear(from, to, excludeBall, allBalls, radius) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return true;

    const ux = dx / len;
    const uy = dy / len;

    for (const ball of allBalls) {
      if (excludeBall && ball.id === excludeBall.id) continue;

      // Vector from 'from' to ball centre
      const fx = ball.position.x - from.x;
      const fy = ball.position.y - from.y;

      // Scalar projection onto the ray
      const t = fx * ux + fy * uy;
      if (t < 0 || t > len) continue; // Ball behind start or past end

      // Perpendicular distance from ball centre to ray
      const px = fx - t * ux;
      const py = fy - t * uy;
      const perpDistSq = px * px + py * py;

      // Two-ball diameter clearance needed (with 1px tolerance)
      if (perpDistSq < (radius * 2 - 1) ** 2) return false;
    }
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // UTILITY
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Returns a promise that resolves after a realistic "thinking" delay.
   * @param {number|null} ms  Fixed delay in ms; null = random thinkTimeMs±200
   */
  _think(ms = null) {
    const delay = ms !== null
      ? ms
      : this.thinkTimeMs + (Math.random() - 0.5) * 400;
    return new Promise(r => setTimeout(r, Math.max(100, delay)));
  }
}
