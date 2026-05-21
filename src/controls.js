import { CONFIG } from './config.js';
import Matter from 'matter-js';

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

    // Active status
    this.enabled = true;

    this.initEvents();
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

      // Check if all balls are stopped before allowing aim adjustments or shots
      const allStopped = this.physics.areAllBallsStopped();
      if (!allStopped) return;

      // Multi-touch safety: If we are already active with a pointer, ignore any new pointerdowns!
      if (this.activePointerId !== undefined) return;

      const coords = this.getCanvasCoordinates(e.clientX, e.clientY);
      const mouseX = coords.x;
      const mouseY = coords.y;

      this.currentMousePos = { x: mouseX, y: mouseY };

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
   * Computes the aiming raycast, ghost contact ball, and deflection paths.
   * @returns {Object|null} Aiming data or null if not currently aiming
   */
  getAimData() {
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
    let targetDeflect = null;
    let cueDeflect = null;

    // 1. Create a lightweight temporary Matter.js engine and world
    const tempEngine = Matter.Engine.create({ gravity: { x: 0, y: 0 } });
    const tempWorld = tempEngine.world;

    // 2. Clone cue ball at its current coordinates
    const tempCueBall = Matter.Bodies.circle(startX, startY, R, {
      density: cueBall.density,
      restitution: cueBall.restitution,
      friction: cueBall.friction,
      frictionStatic: cueBall.frictionStatic,
      frictionAir: cueBall.frictionAir
    });
    Matter.Composite.add(tempWorld, tempCueBall);

    // 3. Clone all active target balls at their current coordinates
    const activeTargets = this.physics.targetBalls;
    const tempTargetBalls = activeTargets.map(target => {
      const tempTarget = Matter.Bodies.circle(target.position.x, target.position.y, R, {
        density: target.density,
        restitution: target.restitution,
        friction: target.friction,
        frictionStatic: target.frictionStatic,
        frictionAir: target.frictionAir
      });
      tempTarget.plugin = { ballId: target.plugin.ballId };
      Matter.Composite.add(tempWorld, tempTarget);
      return tempTarget;
    });

    // 4. Calculate shot velocity at exactly 70% force (powerRatio = 0.7)
    const simulatePowerRatio = 0.7;
    const maxNormalSpeed = this.config.ball.maxSpeed / 2;
    const maxShotSpeed = this.physics.isBreakShot ? this.config.ball.maxSpeed : maxNormalSpeed;
    const minShotSpeed = 0.8;
    const velocityMagnitude = minShotSpeed + simulatePowerRatio * (maxShotSpeed - minShotSpeed);
    const velocityVector = {
      x: this.strokeDir.x * velocityMagnitude,
      y: this.strokeDir.y * velocityMagnitude
    };

    Matter.Body.setVelocity(tempCueBall, velocityVector);

    // 5. Run simulation loop to detect the first collision
    let collisionOccurred = false;
    let hitTempTarget = null;
    const maxSteps = 300; // safety ceiling
    const dt = 16.666;
    const subSteps = 10;
    const subDt = dt / subSteps;

    for (let step = 0; step < maxSteps; step++) {
      // Step the virtual physics engine frame (using identical high-precision 10 sub-stepping parameters)
      for (let s = 0; s < subSteps; s++) {
        Matter.Engine.update(tempEngine, subDt);
      }

      // Check for collisions between cue ball and target balls
      const collisions = Matter.Query.collides(tempCueBall, tempTargetBalls);
      if (collisions.length > 0) {
        collisionOccurred = true;
        const col = collisions[0];
        hitTempTarget = col.bodyA === tempCueBall ? col.bodyB : col.bodyA;
        break;
      }
    }

    // 6. If collision occurred, resolve exact deflection vectors
    if (collisionOccurred && hitTempTarget) {
      hasHit = true;
      
      // Find the corresponding target ball in the active list
      closestTarget = activeTargets.find(t => t.plugin.ballId === hitTempTarget.plugin.ballId);

      // Run 2 more frames (20 sub-steps) to let the post-collision velocities resolve and stabilize
      for (let f = 0; f < 2; f++) {
        for (let s = 0; s < subSteps; s++) {
          Matter.Engine.update(tempEngine, subDt);
        }
      }

      const cueVelocityAfter = tempCueBall.velocity;
      const targetVelocityAfter = hitTempTarget.velocity;

      const cueSpeed = Math.sqrt(cueVelocityAfter.x * cueVelocityAfter.x + cueVelocityAfter.y * cueVelocityAfter.y);
      const targetSpeed = Math.sqrt(targetVelocityAfter.x * targetVelocityAfter.x + targetVelocityAfter.y * targetVelocityAfter.y);

      if (cueSpeed > 0.01) {
        cueDeflect = { x: cueVelocityAfter.x / cueSpeed, y: cueVelocityAfter.y / cueSpeed };
      }
      if (targetSpeed > 0.01) {
        targetDeflect = { x: targetVelocityAfter.x / targetSpeed, y: targetVelocityAfter.y / targetSpeed };
      }

      // Calculate analytical contact point (ghost center) using closestTarget's initial position
      if (closestTarget) {
        const T = closestTarget.position;
        const Vx = startX - T.x;
        const Vy = startY - T.y;
        const dotVD = Vx * this.strokeDir.x + Vy * this.strokeDir.y;
        const VSq = Vx * Vx + Vy * Vy;
        const c = VSq - 4 * R * R;
        const d = 4 * (dotVD * dotVD) - 4 * c;

        if (d >= 0) {
          const t1 = (-2 * dotVD - Math.sqrt(d)) / 2;
          const t2 = (-2 * dotVD + Math.sqrt(d)) / 2;
          let closestT = Infinity;
          if (t1 > 0.01 && t2 > 0.01) closestT = Math.min(t1, t2);
          else if (t1 > 0.01) closestT = t1;
          else if (t2 > 0.01) closestT = t2;

          if (closestT !== Infinity) {
            ghostCenter = {
              x: startX + this.strokeDir.x * closestT,
              y: startY + this.strokeDir.y * closestT
            };
          }
        }
      }

      // Fallback ghost center if analytical fails
      if (!ghostCenter) {
        ghostCenter = { x: hitTempTarget.position.x, y: hitTempTarget.position.y };
      }
    }

    return {
      isAiming: this.isAiming,
      isLocked: this.isLocked,
      startX,
      startY,
      strokeDir: this.strokeDir,
      powerRatio: this.powerRatio,
      hasHit,
      ghostCenter,
      targetCenter: closestTarget ? { x: closestTarget.position.x, y: closestTarget.position.y } : null,
      targetDeflect,
      cueDeflect
    };
  }
}
