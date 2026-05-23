import Matter from 'matter-js';
import { CONFIG } from './config.js';

/**
 * Handles user mouse/touch input dragging, aiming line calculations,
 * and Matter.js impulse application.
 */
export class AimingControls {
  /**
   * @param {HTMLCanvasElement} canvas The Pixi.js renderer canvas element
   * @param {PhysicsEngine} physics The modular PhysicsEngine instance
   * @param {Object} config The centralized CONFIG object
   * @param {CanvasRenderer|null} renderer Optional renderer reference for Pixi UI elements
   */
  constructor(canvas, physics, config = CONFIG, renderer = null) {
    this.canvas = canvas;
    this.physics = physics;
    this.config = config;
    this.renderer = renderer; // Used to show/hide Pixi-native UI (e.g. BIH confirm button)

    // Interaction states
    this.isAiming = false;             // true while pointer is held for aim-rotation drag
    this.isDraggingSlider = false;     // true while pointer is dragging the power slider
    this._dragStart = null;            // canvas-space anchor for the current aim drag
    this._initialStrokeDir = null;     // strokeDir snapshot captured at drag start
    this._sliderDragStartY = 0;        // Y coordinate where slider drag began
    this._sliderDragStartPower = 0;    // powerRatio at the moment slider drag began
    this.currentMousePos = { x: 512, y: 338 }; // Centered default
    this.powerRatio = 0.0;
    this.strokeDir = { x: 1, y: 0 }; // Default pointing right
    this.activePointerId = undefined; // Track the active pointer for multi-touch safety
    this._hasBallInHand = false;
    this.isPlacingCueBall = false;
    this.isBreakPlacement = false; // When true, restricts BIH to kitchen (left of head string)
    this.cueBallPositionValid = true; // Tracks whether current BIH drop position is overlap-free
    this.justPlacedBall = false; // Safety flag to ignore simulated click events immediately after drop

    // Active status
    this.enabled = true;

    this.initEvents();
  }

  get hasBallInHand() {
    return this._hasBallInHand;
  }

  set hasBallInHand(val) {
    this._hasBallInHand = val;
    if (val) {
      // If the cue ball was parked off-canvas after a scratch (physics parks it at
      // x=-500 so it stays invisible while other balls finish rolling), move it back
      // onto the table now that all balls have stopped and BIH is officially starting.
      const cueBall = this.physics?.cueBall;
      if (cueBall) {
        const t = this.config.table;
        const onTable = cueBall.position.x >= t.xCenter - t.width / 2 &&
                        cueBall.position.x <= t.xCenter + t.width / 2 &&
                        cueBall.position.y >= t.yCenter - t.height / 2 &&
                        cueBall.position.y <= t.yCenter + t.height / 2;
        if (!onTable) {
          // Default starting position: head string centre (or just inside kitchen for break)
          const headStringX = t.xCenter - t.width / 4;
          const startX = this.isBreakPlacement ? headStringX - 30 : headStringX;
          Matter.Body.setPosition(cueBall, { x: startX, y: t.yCenter });
          Matter.Body.setVelocity(cueBall, { x: 0, y: 0 });
          Matter.Body.setAngularVelocity(cueBall, 0);
        }
      }

      this.showBallInHandUI();
      // Disable cue ball physical collisions with other balls during Ball-in-Hand.
      // Category 0x0001 = balls, 0x0002 = cushions/static.
      // By setting mask to 0x0000 we make the cue ball a ghost — no physical contacts.
      if (cueBall) {
        // Save original filter so we can restore it precisely
        this._savedCollisionFilter = { ...cueBall.collisionFilter };
        Matter.Body.set(cueBall, {
          collisionFilter: { category: 0x0001, mask: 0x0000, group: 0 }
        });
      }
    } else {
      this.hideBallInHandUI();
      // Restore full collision participation when Ball-in-Hand ends
      const cueBall = this.physics?.cueBall;
      if (cueBall) {
        Matter.Body.set(cueBall, {
          collisionFilter: this._savedCollisionFilter || { category: 0x0001, mask: 0xFFFFFFFF, group: 0 }
        });
        this._savedCollisionFilter = null;
      }
    }
  }

  showBallInHandUI() {
    this.hideBallInHandUI(); // Safeguard: remove any existing one first

    const btnLabel = this.isBreakPlacement ? 'CONFIRM BREAK POSITION' : 'CONFIRM POSITION';

    // Prefer the Pixi-native button (scales perfectly with canvas)
    if (this.renderer) {
      this.renderer.showBallInHandConfirmButton(btnLabel, () => this.confirmCueBallPlacement());
      return;
    }

    // HTML fallback (used only when no renderer reference is available)
    const container = document.getElementById('game-container') || document.body;
    const ui = document.createElement('div');
    ui.id = 'ball-in-hand-ui';
    ui.className = 'ball-in-hand-hud-overlay';
    ui.innerHTML = `<button id="confirm-placement-btn" class="hud-confirm-btn">${btnLabel}</button>`;
    container.appendChild(ui);
    const confirmBtn = ui.querySelector('#confirm-placement-btn');
    confirmBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.confirmCueBallPlacement();
    });
  }

  hideBallInHandUI() {
    if (this.renderer) {
      this.renderer.hideBallInHandConfirmButton();
    }
    const existing = document.getElementById('ball-in-hand-ui');
    if (existing) existing.remove();
  }

  /**
   * Returns true if (x, y) is a valid cue ball position — i.e. it does not
   * overlap or touch any live target ball. Centres must be > 2*radius apart.
   * @param {number} x Canvas X
   * @param {number} y Canvas Y
   * @returns {boolean}
   */
  isValidCueBallPosition(x, y) {
    const minDist = this.config.ball.radius * 2 + 1; // slight buffer avoids "kissing" edge cases
    const balls = this.physics?.targetBalls || [];
    for (const ball of balls) {
      const dx = x - ball.position.x;
      const dy = y - ball.position.y;
      if (Math.sqrt(dx * dx + dy * dy) < minDist) return false;
    }
    return true;
  }

  /**
   * Moves the cue ball to (clampedX, clampedY) during BIH and
   * updates validity state + button appearance in one place.
   * @param {number} x Raw canvas X
   * @param {number} y Raw canvas Y
   */
  _placeCueBallAt(x, y) {
    const cueBall = this.physics.cueBall;
    const t = this.config.table;
    const r = this.config.ball.radius;
    const headStringX = t.xCenter - t.width / 4;
    const maxX = this.isBreakPlacement ? headStringX : t.xCenter + t.width / 2 - r;
    const clampedX = Math.max(t.xCenter - t.width / 2 + r, Math.min(maxX, x));
    const clampedY = Math.max(t.yCenter - t.height / 2 + r, Math.min(t.yCenter + t.height / 2 - r, y));

    Matter.Body.setPosition(cueBall, { x: clampedX, y: clampedY });
    Matter.Body.setVelocity(cueBall, { x: 0, y: 0 });
    Matter.Body.setAngularVelocity(cueBall, 0);

    const valid = this.isValidCueBallPosition(clampedX, clampedY);
    this.cueBallPositionValid = valid;

    // Update confirm button state (Pixi-native or HTML fallback)
    if (this.renderer) {
      this.renderer.updateBallInHandButton(valid);
    } else {
      const btn = document.getElementById('confirm-placement-btn');
      if (btn) {
        btn.disabled = !valid;
        btn.textContent = valid ? 'CONFIRM POSITION' : '⚠ OVERLAPPING BALL';
        btn.style.background = valid
          ? 'linear-gradient(135deg, #00e5ff 0%, #0077aa 100%)'
          : 'linear-gradient(135deg, #ff5252 0%, #b71c1c 100%)';
        btn.style.cursor = valid ? 'pointer' : 'not-allowed';
      }
    }
  }

  confirmCueBallPlacement() {
    // Block confirmation if position is invalid
    if (!this.cueBallPositionValid) return;

    this.hasBallInHand = false;
    this.isPlacingCueBall = false;
    this.isBreakPlacement = false;
    this.cueBallPositionValid = true;

    // Just placed ball safety flag to prevent immediate aim-locking on pointerup simulated clicks
    this.justPlacedBall = true;
    setTimeout(() => {
      this.justPlacedBall = false;
    }, 250);

    console.log("Cue ball placement confirmed.");
  }

  /**
   * Translates viewport screen coordinates to deterministic game canvas coordinates,
   * accounting for letterboxing (object-fit: contain) on any screen size.
   * @param {number} clientX Viewport X coordinate
   * @param {number} clientY Viewport Y coordinate
   * @returns {Object} { x, y } mapped coordinates
   */
  getCanvasCoordinates(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const dw = rect.width;
    const dh = rect.height;
    const cw = this.config.canvas.width;
    const ch = this.config.canvas.height;

    const canvasRatio = cw / ch;
    const domRatio = dw / dh;

    let offsetX = 0;
    let offsetY = 0;
    let scaledWidth = dw;
    let scaledHeight = dh;

    if (domRatio > canvasRatio) {
      // Horizontal letterboxing (black bars on left/right)
      scaledWidth = dh * canvasRatio;
      offsetX = (dw - scaledWidth) / 2;
    } else if (domRatio < canvasRatio) {
      // Vertical letterboxing (black bars on top/bottom)
      scaledHeight = dw / canvasRatio;
      offsetY = (dh - scaledHeight) / 2;
    }

    const x = ((clientX - rect.left - offsetX) / scaledWidth) * cw;
    const y = ((clientY - rect.top - offsetY) / scaledHeight) * ch;

    return { x, y };
  }

  /**
   * Binds mouse and touch events to the canvas.
   *
   * NEW MECHANIC:
   *   • Drag anywhere (except slider) → rotates aim direction relative to starting angle.
   *     A full table-width of horizontal drag = ±30° rotation.
   *     Releasing the drag LOCKS the aim direction — does NOT fire.
   *   • Power slider (left edge) → drag up/down sets powerRatio.
   *     Releasing the slider FIRES the shot.
   *   • On shot-end, aim auto-snaps to the nearest object ball via aimAtNearestBall().
   */
  initEvents() {
    // ── POINTER DOWN ──────────────────────────────────────────────────────────
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.enabled || !this.physics.cueBall) return;
      if (this.justPlacedBall) return;
      if (this.activePointerId !== undefined) return; // multi-touch safety

      const { x, y } = this.getCanvasCoordinates(e.clientX, e.clientY);
      this.currentMousePos = { x, y };

      // ── Ball-in-Hand placement ──────────────────────────────────────────────
      if (this.hasBallInHand) {
        if (x < this.config.table.xCenter - this.config.table.width / 2) return;
        if (y > 100) {
          this.isPlacingCueBall = true;
          this.activePointerId = e.pointerId;
          this._placeCueBallAt(x, y);
        }
        return;
      }

      const allStopped = this.physics.areAllBallsStopped();
      if (!allStopped) return;
      if (y < 100) return; // ignore HUD strip

      // ── Power slider ────────────────────────────────────────────────────────
      if (this._isInsideSlider(x, y)) {
        this.isDraggingSlider = true;
        this.activePointerId = e.pointerId;
        // Record start state — do NOT jump power to the tap position.
        // The knob follows from its current position as you drag.
        this._sliderDragStartY = y;
        this._sliderDragStartPower = this.powerRatio;
        return;
      }

      // ── Aim rotation drag ───────────────────────────────────────────────────
      this._dragStart = { x, y };
      this._initialStrokeDir = { ...this.strokeDir };
      this.isAiming = true;
      this.activePointerId = e.pointerId;
    });

    // ── POINTER MOVE ──────────────────────────────────────────────────────────
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.enabled || !this.physics.cueBall) return;
      if (this.activePointerId !== undefined && e.pointerId !== this.activePointerId) return;

      const { x, y } = this.getCanvasCoordinates(e.clientX, e.clientY);
      this.currentMousePos = { x, y };

      if (this.hasBallInHand) {
        if (this.isPlacingCueBall) this._placeCueBallAt(x, y);
        return;
      }

      const allStopped = this.physics.areAllBallsStopped();
      if (!allStopped) return;

      if (this.isDraggingSlider) {
        this._updatePowerFromSliderDelta(y);
        return;
      }

      if (!this.isAiming || !this._dragStart || !this._initialStrokeDir) return;

      // Aim rotation: world-space formula that maps drag direction to rotation direction
      // consistently regardless of where the cue ball or aim line is pointing.
      //   • Left→Right drag  (dx > 0, dy ≈ 0): angle < 0 → CCW  ✓
      //   • Right→Left drag  (dx < 0, dy ≈ 0): angle > 0 → CW   ✓
      //   • Bottom→Top drag  (dy < 0, dx ≈ 0): angle < 0 → CCW  ✓  (−dy > 0)
      //   • Top→Bottom drag  (dy > 0, dx ≈ 0): angle > 0 → CW   ✓  (−dy < 0)
      // Sensitivity: a drag equal to the full table width rotates the aim 90°.
      const dx = x - this._dragStart.x;
      const dy = y - this._dragStart.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 2) return; // ignore micro-jitter
      const ix = this._initialStrokeDir.x;
      const iy = this._initialStrokeDir.y;
      const angle = (dx - dy) * (Math.PI / 2) / this.config.table.width;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      this.strokeDir = {
        x: ix * cos - iy * sin,
        y: ix * sin + iy * cos
      };
    });

    // ── POINTER UP ────────────────────────────────────────────────────────────
    window.addEventListener('pointerup', (e) => {
      if (this.activePointerId !== undefined && e.pointerId !== this.activePointerId) return;
      this.activePointerId = undefined;

      if (this.hasBallInHand) {
        if (this.isPlacingCueBall) this.isPlacingCueBall = false;
        return;
      }

      // Aim drag release → lock direction, do NOT fire
      if (this.isAiming) {
        this.isAiming = false;
        this._dragStart = null;
        this._initialStrokeDir = null;
        return;
      }

      // Slider release → fire shot
      if (this.isDraggingSlider) {
        this.isDraggingSlider = false;

        if (!this.enabled || !this.physics.cueBall) {
          this.powerRatio = 0;
          return;
        }

        const allStopped = this.physics.areAllBallsStopped();
        if (!allStopped) {
          this.powerRatio = 0;
          return;
        }

        const currentPower = this.powerRatio;
        this.powerRatio = 0;

        if (currentPower >= this.config.cue.minPower) {
          const maxShotSpeed = this.physics.isBreakShot
            ? this.config.ball.maxSpeed
            : this.config.ball.maxSpeed / 2;
          const minShotSpeed = 0.8;

          const velocityMagnitude = minShotSpeed + currentPower * (maxShotSpeed - minShotSpeed);
          this.physics.applyCueStroke({
            x: this.strokeDir.x * velocityMagnitude,
            y: this.strokeDir.y * velocityMagnitude
          });
          this.physics.isBreakShot = false;
        }
      }
    });
  }

  /**
   * Returns true when (x, y) falls within the power slider hit area (with touch buffer).
   */
  _isInsideSlider(x, y) {
    const s = this.config.slider;
    const buf = s.touchBuffer ?? 20;
    return x >= s.x - buf && x <= s.x + s.width + buf &&
           y >= s.y - buf && y <= s.y + s.height + buf;
  }

  /**
   * Updates powerRatio using a DELTA from the drag-start position.
   * This is "drag-and-drop" behaviour: the knob follows the finger from wherever
   * it currently sits — there is no jump to the tap position.
   *
   * The track height in the renderer is (slider.height - 40), so we use that
   * same value for the mapping so dragging end-to-end gives full 0→1 travel.
   */
  _updatePowerFromSliderDelta(currentY) {
    const s = this.config.slider;
    const trackHeight = s.height - 40; // mirrors renderer: trackY = s.y+20, trackH = s.height-40
    const deltaRatio = (currentY - this._sliderDragStartY) / trackHeight;
    this.powerRatio = Math.max(0, Math.min(1, this._sliderDragStartPower + deltaRatio));
  }

  /**
   * Snaps aim toward the object ball that has the most unobstructed path to a pocket.
   * For each (target ball, pocket) pair the method checks:
   *   1. Is the target→pocket corridor free of other balls?
   *   2. Is the cue→ghost-ball corridor free of other balls?
   * Candidate shots are scored by combined travel distance (shorter = better).
   * Falls back to nearest-ball aim when all paths are fully blocked.
   */
  aimAtBestShot() {
    const cueBall = this.physics?.cueBall;
    if (!cueBall) return;
    const targets = this.physics?.targetBalls || [];
    if (targets.length === 0) return;

    const R = this.config.ball.radius;
    const { xCenter, yCenter, width, height } = this.config.table;
    const { sideOffset } = this.config.pocket;
    const hw = width / 2, hh = height / 2;
    const pocketPositions = [
      { x: xCenter - hw,           y: yCenter - hh           }, // TL
      { x: xCenter + hw,           y: yCenter - hh           }, // TR
      { x: xCenter - hw,           y: yCenter + hh           }, // BL
      { x: xCenter + hw,           y: yCenter + hh           }, // BR
      { x: xCenter,                y: yCenter - hh - sideOffset }, // Side-top
      { x: xCenter,                y: yCenter + hh + sideOffset }, // Side-bottom
    ];

    const cx = cueBall.position.x;
    const cy = cueBall.position.y;

    let bestDir   = null;
    let bestScore = -Infinity;

    for (const target of targets) {
      const tx = target.position.x;
      const ty = target.position.y;

      for (const pocket of pocketPositions) {
        // Direction from target ball toward pocket
        const dpx = pocket.x - tx;
        const dpy = pocket.y - ty;
        const dpDist = Math.sqrt(dpx * dpx + dpy * dpy);
        if (dpDist < 1) continue;
        const dpDirX = dpx / dpDist;
        const dpDirY = dpy / dpDist;

        // Ghost-ball contact point (where cue ball must reach to send target to pocket)
        const ghostX = tx - dpDirX * R * 2;
        const ghostY = ty - dpDirY * R * 2;

        // Direction from cue ball to ghost position
        const cgx = ghostX - cx;
        const cgy = ghostY - cy;
        const cgDist = Math.sqrt(cgx * cgx + cgy * cgy);
        if (cgDist < 1) continue;

        // Verify target→pocket lane is clear (ignore the target ball itself)
        if (!this._isPathClear({ x: tx, y: ty }, pocket,
                                targets.filter(b => b !== target), R)) continue;

        // Verify cue→ghost lane is clear (all target balls are potential obstacles)
        if (!this._isPathClear({ x: cx, y: cy }, { x: ghostX, y: ghostY },
                                targets, R)) continue;

        // Score: prefer short cue-to-ghost distance, slightly prefer short pocket distance
        const score = -(cgDist * 0.60 + dpDist * 0.40);

        if (score > bestScore) {
          bestScore = score;
          bestDir   = { x: cgx / cgDist, y: cgy / cgDist };
        }
      }
    }

    if (bestDir) {
      this.strokeDir = bestDir;
    } else {
      // All shot paths blocked — fall back to nearest ball
      this.aimAtNearestBall();
    }
  }

  /**
   * Checks whether the straight-line segment from `from` to `to` is clear of
   * obstacles.  An obstacle blocks the path if its centre lies within 2×ballRadius
   * of the segment.
   *
   * @param {{x:number,y:number}} from   Start point
   * @param {{x:number,y:number}} to     End point
   * @param {Array<Matter.Body>}  obstacles  Bodies to test against
   * @param {number}              radius     Ball radius
   * @returns {boolean} true = no obstacle in the way
   */
  _isPathClear(from, to, obstacles, radius) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return true;
    const ux = dx / dist;
    const uy = dy / dist;

    for (const obs of obstacles) {
      const ox = obs.position.x - from.x;
      const oy = obs.position.y - from.y;
      const proj = ox * ux + oy * uy;
      if (proj < 0 || proj > dist) continue; // outside the segment
      const perpX = ox - proj * ux;
      const perpY = oy - proj * uy;
      if (Math.sqrt(perpX * perpX + perpY * perpY) < radius * 2) return false;
    }
    return true;
  }

  /**
   * Snaps the aim direction toward the nearest object ball.
   * Used as a fallback by aimAtBestShot() when all pocket paths are blocked.
   */
  aimAtNearestBall() {
    const cueBall = this.physics?.cueBall;
    if (!cueBall) return;
    const targets = this.physics?.targetBalls || [];
    if (targets.length === 0) return;

    let nearestDist = Infinity;
    let nearest = null;
    for (const ball of targets) {
      const dx = ball.position.x - cueBall.position.x;
      const dy = ball.position.y - cueBall.position.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = ball;
      }
    }

    if (nearest) {
      const dx = nearest.position.x - cueBall.position.x;
      const dy = nearest.position.y - cueBall.position.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 0) {
        this.strokeDir = { x: dx / d, y: dy / d };
      }
    }
  }

  /**
   * Computes the aiming raycast and ghost contact ball using pure geometry.
   * @returns {Object|null} Aiming data or null if not currently aiming
   */
  getAimData() {
    if (!this.enabled) return null;
    if (this.hasBallInHand) return null;

    // Show aiming line whenever all balls are stopped
    const allStopped = this.physics.areAllBallsStopped();
    if (!allStopped || !this.physics.cueBall) return null;

    // Suppress aim visual only while dragging slider with near-zero power
    if (this.isDraggingSlider && this.powerRatio < this.config.cue.cancelPower) {
      return null;
    }

    const cueBall = this.physics.cueBall;
    const startX = cueBall.position.x;
    const startY = cueBall.position.y;
    // Add stroke half-width (0.75px = half of 1.5px ball outline) so the ghost ball
    // visually appears to just touch the object ball rather than overlap it.
    const R = this.config.ball.radius + 0.75;

    let hasHit = false;
    let closestTarget = null;
    let ghostCenter = null;
    let minT = Infinity;

    const activeTargets = this.physics.targetBalls;
    const D = this.strokeDir;

    for (const target of activeTargets) {
      const T = target.position;
      
      // Calculate W = S - T (vector from target ball center to cue ball starting position)
      const Wx = startX - T.x;
      const Wy = startY - T.y;
      
      // dotWD is the projection of W onto the stroke direction D
      const dotWD = Wx * D.x + Wy * D.y;
      
      // Since W is (S - T), the vector from S to T is -W.
      // The projection of the vector from S to T onto D is -dotWD.
      // If this is negative, it means the target ball is behind the cue ball.
      if (-dotWD <= 0) continue;

      const WSq = Wx * Wx + Wy * Wy;
      const c = WSq - 4 * R * R;
      const discriminant = 4 * dotWD * dotWD - 4 * c;

      if (discriminant >= 0) {
        const sqrtD = Math.sqrt(discriminant);
        const t1 = (-2 * dotWD - sqrtD) / 2;
        const t2 = (-2 * dotWD + sqrtD) / 2;

        let t = Infinity;
        if (t1 > 0.01 && t2 > 0.01) t = Math.min(t1, t2);
        else if (t1 > 0.01) t = t1;
        else if (t2 > 0.01) t = t2;

        if (t < minT) {
          minT = t;
          closestTarget = target;
        }
      }
    }

    // targetedPocketId: the pocket index the aimed target ball is heading for.
    // Computed here so the renderer can optionally show live pocket validity glow
    // (YELLOW = unclaimed, GREEN = valid card, RED = invalid/duplicate).
    // NOTE: Dynamic pocket glow is intentionally disabled per current design decision
    // (GDD Section 4 UI Guideline: "No dynamic glow or color change during aiming").
    // The value is still returned in aimData for future re-enablement or debugging.
    let targetedPocketId = -1;
    if (closestTarget && minT !== Infinity) {
      hasHit = true;
      ghostCenter = {
        x: startX + D.x * minT,
        y: startY + D.y * minT
      };

      // Project target ball travel vector from ghost ball contact point outward
      const Tx = closestTarget.position.x;
      const Ty = closestTarget.position.y;
      const Gx = ghostCenter.x;
      const Gy = ghostCenter.y;

      // Normal vector from ghost center → target center (direction target ball travels post-collision)
      const Nx = Tx - Gx;
      const Ny = Ty - Gy;
      const dist = Math.sqrt(Nx * Nx + Ny * Ny);
      if (dist > 0.001) {
        const dx = Nx / dist;
        const dy = Ny / dist;

        const pocketRadius = this.config.pocket.radius;
        const { xCenter, yCenter, width, height } = this.config.table;
        const { sideOffset } = this.config.pocket;
        const hw = width / 2;
        const hh = height / 2;
        const pocketPositions = [
          { x: xCenter - hw, y: yCenter - hh }, // 0: TL
          { x: xCenter + hw, y: yCenter - hh }, // 1: TR
          { x: xCenter - hw, y: yCenter + hh }, // 2: BL
          { x: xCenter + hw, y: yCenter + hh }, // 3: BR
          { x: xCenter, y: yCenter - hh - sideOffset }, // 4: ST
          { x: xCenter, y: yCenter + hh + sideOffset }  // 5: SB
        ];

        let minProj = Infinity;
        pocketPositions.forEach((pos, idx) => {
          const Vx = pos.x - Tx;
          const Vy = pos.y - Ty;
          const proj = Vx * dx + Vy * dy;
          if (proj > 0) {
            const distSq = (Vx * Vx + Vy * Vy) - proj * proj;
            if (distSq < pocketRadius * pocketRadius) {
              if (proj < minProj) {
                minProj = proj;
                targetedPocketId = idx;
              }
            }
          }
        });
      }
    }

    return {
      isAiming: this.isAiming,
      startX,
      startY,
      strokeDir: D,
      powerRatio: this.powerRatio,
      hasHit,
      ghostCenter,
      targetCenter: closestTarget ? { x: closestTarget.position.x, y: closestTarget.position.y } : null,
      targetBallId: closestTarget ? closestTarget.plugin.ballId : -1,
      targetedPocketId
    };
  }

}
