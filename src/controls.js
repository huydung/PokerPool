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
   */
  constructor(canvas, physics, config = CONFIG) {
    this.canvas = canvas;
    this.physics = physics;
    this.config = config;

    // Interaction states
    this.isAiming = false;
    this.isLocked = false; // Aiming angle lock-in state
    this.isDraggingSlider = false;
    this.startDragPos = { x: 0, y: 0 };
    this.currentMousePos = { x: 512, y: 338 }; // Centered default
    this.powerRatio = 0.0;
    this.strokeDir = { x: 1, y: 0 }; // Default pointing right
    this.activePointerId = undefined; // Track the active pointer for multi-touch safety
    this._hasBallInHand = false;
    this.isPlacingCueBall = false;
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
      this.showBallInHandUI();
      // Disable cue ball physical collisions with other balls during Ball-in-Hand.
      // Category 0x0001 = balls, 0x0002 = cushions/static.
      // By setting mask to 0x0000 we make the cue ball a ghost — no physical contacts.
      const cueBall = this.physics?.cueBall;
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
    
    const container = document.getElementById('game-container') || document.body;
    
    const ui = document.createElement('div');
    ui.id = 'ball-in-hand-ui';
    ui.className = 'ball-in-hand-hud-overlay';
    ui.innerHTML = `
      <button id="confirm-placement-btn" class="hud-confirm-btn">CONFIRM POSITION</button>
    `;
    container.appendChild(ui);
    
    const confirmBtn = ui.querySelector('#confirm-placement-btn');
    confirmBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // Stop event bubbling to canvas
      this.confirmCueBallPlacement();
    });
  }

  hideBallInHandUI() {
    const existing = document.getElementById('ball-in-hand-ui');
    if (existing) {
      existing.remove();
    }
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
    const clampedX = Math.max(124, Math.min(900, x));
    const clampedY = Math.max(150, Math.min(526, y));

    Matter.Body.setPosition(cueBall, { x: clampedX, y: clampedY });
    Matter.Body.setVelocity(cueBall, { x: 0, y: 0 });
    Matter.Body.setAngularVelocity(cueBall, 0);

    const valid = this.isValidCueBallPosition(clampedX, clampedY);
    this.cueBallPositionValid = valid;

    // Update confirm button state
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

  confirmCueBallPlacement() {
    // Block confirmation if position is invalid
    if (!this.cueBallPositionValid) return;

    this.hasBallInHand = false;
    this.isPlacingCueBall = false;
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
   * Helper to check if coordinates are within the vertical slider interaction area.
   * Uses a highly generous bounding box on the left margin (especially when locked)
   * to eliminate accidental aiming resets due to quick clicks or fat-fingered touches.
   * @param {number} x Canvas X coordinate
   * @param {number} y Canvas Y coordinate
   * @returns {boolean} True if coordinates are inside the slider bounds
   */
  isInsideSlider(x, y) {
    const s = this.config.slider;
    if (!s) return false;
    
    // Left rail starts at x = 112. Anything x < 112 is in the gutter area.
    // When aim is locked, we make the slider box extremely wide (up to x = 140)
    // so players can easily drag the power slider without missing.
    const isLocked = this.isLocked;
    const horizontalBuffer = isLocked ? 80 : 30;
    // When locked, extend vertical buffer to cover the entire canvas height to avoid accidental Y-axis misses.
    const verticalBuffer = isLocked ? 200 : 20;

    return (
      x >= 0 &&
      x <= s.x + s.width + horizontalBuffer &&
      y >= s.y - verticalBuffer &&
      y <= s.y + s.height + verticalBuffer
    );
  }

  /**
   * Binds mouse and touch events to the canvas.
   */
  initEvents() {
    // Canvas pointerdown (either clicks on the slider or aims on the table)
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.enabled || !this.physics.cueBall) return;

      // Safety check to ignore simulated clicks/taps immediately after placing the ball
      if (this.justPlacedBall) return;

      // Multi-touch safety: If we are already active with a pointer, ignore any new pointerdowns!
      if (this.activePointerId !== undefined) return;

      const coords = this.getCanvasCoordinates(e.clientX, e.clientY);
      const mouseX = coords.x;
      const mouseY = coords.y;

      this.currentMousePos = { x: mouseX, y: mouseY };

      // Ball-in-Hand drag-to-place handler
      if (this.hasBallInHand) {
        // Gutter/slider safety: ignore if touching near the slider (mouseX < 112)
        if (mouseX < 112) {
          return;
        }

        // Ensure they touched inside the table felt area (below HUD)
        if (mouseY > 100) {
          this.isPlacingCueBall = true;
          this.activePointerId = e.pointerId;
          this._placeCueBallAt(mouseX, mouseY);
        }
        return; // Complete lockout: don't allow falling through to aiming / slider while hasBallInHand is active
      }

      // Check if all balls are stopped before allowing aim adjustments or shots
      const allStopped = this.physics.areAllBallsStopped();
      if (!allStopped) return;

      // Case A: Interaction inside the vertical power slider zone
      if (this.isInsideSlider(mouseX, mouseY)) {
        this.isDraggingSlider = true;
        this.activePointerId = e.pointerId; // Capture this pointer
        this.powerRatio = Math.max(0, Math.min(1, (mouseY - this.config.slider.y) / this.config.slider.height));
      } else {
        // Gutter Safety Guard: If click/touch is in the left rail/gutter area (mouseX < 112),
        // but somehow missed the slider (e.g. out of vertical bounds), do NOT treat it as a table interaction.
        // This completely prevents accidental aiming resets/toggles when clicking in the left gutter.
        if (mouseX < 112) {
          return;
        }

        // Case B: Table tap/drag interaction
        this.isDraggingSlider = false;
        
        if (e.pointerType === 'touch') {
          // Mobile/Touch device: start table aiming, unlock angle for current gesture
          this.isAiming = true;
          this.isLocked = false; 
          this.activePointerId = e.pointerId; // Capture this pointer
          const cueBall = this.physics.cueBall;
          const dx = mouseX - cueBall.position.x;
          const dy = mouseY - cueBall.position.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 0.1) {
            this.strokeDir = {
              x: dx / dist,
              y: dy / dist
            };
          }
        } else {
          // PC/Mouse device: Click on table toggles lock state
          this.isLocked = !this.isLocked;
          
          // If newly unlocked, snap aiming direction instantly to mouse click coordinate
          if (!this.isLocked) {
            const cueBall = this.physics.cueBall;
            const dx = mouseX - cueBall.position.x;
            const dy = mouseY - cueBall.position.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 0.1) {
              this.strokeDir = {
                x: dx / dist,
                y: dy / dist
              };
            }
          }
        }
      }
    });

    // Canvas pointermove (aim or slide power)
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.enabled || !this.physics.cueBall) return;

      // Multi-touch safety: if we are tracking a specific pointer, ignore others
      if (this.activePointerId !== undefined && e.pointerId !== this.activePointerId) return;

      const coords = this.getCanvasCoordinates(e.clientX, e.clientY);
      const mouseX = coords.x;
      const mouseY = coords.y;

      this.currentMousePos = { x: mouseX, y: mouseY };

      if (this.hasBallInHand) {
        if (this.isPlacingCueBall) {
          this._placeCueBallAt(mouseX, mouseY);
        }
        return; // Lock out aiming pointer movements during Ball-In-Hand
      }

      const allStopped = this.physics.areAllBallsStopped();
      if (!allStopped) return;

      if (this.isDraggingSlider) {
        // Sliding: update power based on vertical Y displacement
        this.powerRatio = Math.max(0, Math.min(1, (mouseY - this.config.slider.y) / this.config.slider.height));
      } else {
        // Rotating: update vector direction only if pointer is outside the slider zones
        if (!this.isInsideSlider(mouseX, mouseY)) {
          const cueBall = this.physics.cueBall;
          const dx = mouseX - cueBall.position.x;
          const dy = mouseY - cueBall.position.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          
          if (e.pointerType === 'touch') {
            // Touch device: only rotate while actively aiming (finger dragged on table)
            if (this.isAiming && dist > 0.1) {
              this.strokeDir = {
                x: dx / dist,
                y: dy / dist
              };
            }
          } else {
            // Mouse device: only rotate if angle is UNLOCKED
            if (!this.isLocked && dist > 0.1) {
              this.strokeDir = {
                x: dx / dist,
                y: dy / dist
              };
            }
          }
        }
      }
    });

    // Window level pointerup (release to fire shot or cancel)
    window.addEventListener('pointerup', (e) => {
      // Multi-touch safety: only handle pointerup for our active pointer if tracked
      if (this.activePointerId !== undefined && e.pointerId !== this.activePointerId) return;

      // Reset pointer tracking
      this.activePointerId = undefined;

      if (this.hasBallInHand) {
        if (this.isPlacingCueBall) {
          this.isPlacingCueBall = false;
        }
        return; // Maintain Ball-In-Hand state until explicitly confirmed via UI button click
      }

      // For mobile touch, releasing finger off table auto-locks aiming angle
      if (e.pointerType === 'touch' && this.isAiming) {
        this.isAiming = false;
        this.isLocked = true;
      }

      if (!this.enabled || !this.physics.cueBall || !this.isDraggingSlider) {
        this.isDraggingSlider = false;
        this.powerRatio = 0.0;
        return;
      }

      this.isDraggingSlider = false;

      // Only trigger shot if all balls are stopped
      const allStopped = this.physics.areAllBallsStopped();
      if (!allStopped) {
        this.powerRatio = 0.0;
        return;
      }

      const currentPower = this.powerRatio;

      // Release triggers shot if power ratio is greater than minPower
      if (currentPower >= this.config.cue.minPower) {
        // Calibrate max speed: normal shot max is 10.0, break shot max is 20.0 (exactly 2x normal max)
        const maxNormalSpeed = this.config.ball.maxSpeed / 2;
        const maxShotSpeed = this.physics.isBreakShot ? this.config.ball.maxSpeed : maxNormalSpeed;
        const minShotSpeed = 0.8; // Calibrated very gentle soft shot speed threshold
        
        // Linearly interpolate cue ball velocity magnitude
        const velocityMagnitude = minShotSpeed + currentPower * (maxShotSpeed - minShotSpeed);

        const velocityVector = {
          x: this.strokeDir.x * velocityMagnitude,
          y: this.strokeDir.y * velocityMagnitude
        };

        this.physics.applyCueStroke(velocityVector);
        
        // Break shot has been completed
        this.physics.isBreakShot = false;

        // Fired shot successfully: reset lock status for next round
        this.isLocked = false;
      }

      this.powerRatio = 0.0;
    });
  }

  /**
   * Computes the aiming raycast and ghost contact ball using pure geometry.
   * @returns {Object|null} Aiming data or null if not currently aiming
   */
  getAimData() {
    if (!this.enabled) return null;
    if (this.hasBallInHand) return null;

    // Show aiming line automatically if all balls are stopped (pre-shot continuous hover-aiming)
    const allStopped = this.physics.areAllBallsStopped();
    if (!allStopped || !this.physics.cueBall) return null;

    // If dragging slider, hide visual guides if power is below cancelPower threshold (pulling back to cancel)
    if (this.isDraggingSlider && this.powerRatio < this.config.cue.cancelPower) {
      return null;
    }

    const cueBall = this.physics.cueBall;
    const startX = cueBall.position.x;
    const startY = cueBall.position.y;
    const R = this.config.ball.radius;

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
      isLocked: this.isLocked,
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
