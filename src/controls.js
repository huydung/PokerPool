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
    this.isDraggingSlider = false;
    this.startDragPos = { x: 0, y: 0 };
    this.currentMousePos = { x: 512, y: 338 }; // Centered default
    this.dragDist = 0;
    this.strokeDir = { x: 1, y: 0 }; // Default pointing right

    // Active status
    this.enabled = true;

    this.initEvents();
  }

  /**
   * Helper to check if coordinates are within the vertical slider interaction area (plus buffer padding)
   * @param {number} x Canvas X coordinate
   * @param {number} y Canvas Y coordinate
   * @returns {boolean} True if coordinates are inside the slider bounds
   */
  isInsideSlider(x, y) {
    const s = this.config.slider;
    if (!s) return false;
    return (
      x >= s.x - s.touchBuffer &&
      x <= s.x + s.width + s.touchBuffer &&
      y >= s.y - s.touchBuffer &&
      y <= s.y + s.height + s.touchBuffer
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

      const rect = this.canvas.getBoundingClientRect();
      const mouseX = ((e.clientX - rect.left) / rect.width) * this.config.canvas.width;
      const mouseY = ((e.clientY - rect.top) / rect.height) * this.config.canvas.height;

      this.currentMousePos = { x: mouseX, y: mouseY };

      // Case A: Interaction inside the vertical power slider zone
      if (this.isInsideSlider(mouseX, mouseY)) {
        this.isDraggingSlider = true;
        const dragRatio = Math.max(0, Math.min(1, (mouseY - this.config.slider.y) / this.config.slider.height));
        this.dragDist = dragRatio * this.config.cue.maxDrag;
      } else {
        // Case B: Table tap/drag interaction: adjust aiming rotation immediately
        this.isDraggingSlider = false;
        this.isAiming = true; // Flag active pointerdown aiming on table
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
    });

    // Canvas pointermove (aim or slide power)
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.enabled || !this.physics.cueBall) return;

      const rect = this.canvas.getBoundingClientRect();
      const mouseX = ((e.clientX - rect.left) / rect.width) * this.config.canvas.width;
      const mouseY = ((e.clientY - rect.top) / rect.height) * this.config.canvas.height;

      this.currentMousePos = { x: mouseX, y: mouseY };

      const allStopped = this.physics.areAllBallsStopped();
      if (!allStopped) return;

      if (this.isDraggingSlider) {
        // Sliding: update power based on vertical Y displacement
        const dragRatio = Math.max(0, Math.min(1, (mouseY - this.config.slider.y) / this.config.slider.height));
        this.dragDist = dragRatio * this.config.cue.maxDrag;
      } else {
        // Rotating: update vector direction only if pointer is outside the slider zones (avoids sudden angles when aiming/clicking slider)
        if (!this.isInsideSlider(mouseX, mouseY)) {
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
    });

    // Window level pointerup (release to fire shot or cancel)
    window.addEventListener('pointerup', () => {
      this.isAiming = false; // Release table drag flag

      if (!this.enabled || !this.physics.cueBall || !this.isDraggingSlider) {
        this.isDraggingSlider = false;
        this.dragDist = 0;
        return;
      }

      this.isDraggingSlider = false;

      // Only trigger shot if all balls are stopped
      const allStopped = this.physics.areAllBallsStopped();
      if (!allStopped) {
        this.dragDist = 0;
        return;
      }

      // Calculate applied force based on vertical slider pullback
      const cappedDrag = Math.min(this.dragDist, this.config.cue.maxDrag);
      
      // Release triggers shot if pullback is greater than cancellation threshold
      if (cappedDrag >= this.config.cue.minDrag && this.dragDist >= this.config.cue.cancelDistance) {
        const forceMagnitude = cappedDrag * this.config.cue.dragScale;
        let forceLimit = this.config.cue.maxForce;
        if (this.physics.isBreakShot) {
          forceLimit *= this.config.cue.breakForceMultiplier || 2.0;
        }
        const appliedForce = Math.min(forceMagnitude, forceLimit);

        // Convert the force magnitude to direct velocity vector
        const cueBall = this.physics.cueBall;
        const velocityMagnitude = (appliedForce / cueBall.mass) * (1000 / 60);

        const velocityVector = {
          x: this.strokeDir.x * velocityMagnitude,
          y: this.strokeDir.y * velocityMagnitude
        };

        this.physics.applyCueStroke(velocityVector);
        
        // Break shot has been completed
        this.physics.isBreakShot = false;
      }

      this.dragDist = 0;
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

    // If dragging slider, hide visual guides if drag distance is below cancel threshold (pulling back to cancel)
    if (this.isDraggingSlider && this.dragDist < this.config.cue.cancelDistance) {
      return null;
    }

    const cueBall = this.physics.cueBall;
    const startX = cueBall.position.x;
    const startY = cueBall.position.y;
    const R = this.config.ball.radius;

    let hasHit = false;
    let closestTarget = null;
    let closestT = Infinity; // Distance to intersection point
    let ghostCenter = null;
    let targetDeflect = null;
    let cueDeflect = null;

    // Filter target balls that are active
    const activeTargets = this.physics.targetBalls;

    // Loop through all active target balls to check analytical quadratic overlap
    activeTargets.forEach((target) => {
      const T = target.position;
      
      // Vector V = CueBallPos - TargetBallPos
      const Vx = startX - T.x;
      const Vy = startY - T.y;

      // Dot product V . D (strokeDir)
      const dotVD = Vx * this.strokeDir.x + Vy * this.strokeDir.y;

      // Quadratic coefficient c = V^2 - (2R)^2
      const VSq = Vx * Vx + Vy * Vy;
      const c = VSq - 4 * R * R;

      // Discriminant d = b^2 - 4ac (where a = 1, since strokeDir is normalized)
      // Since b = 2 * (V . D), b^2 - 4c = 4*(V.D)^2 - 4*(V^2 - 4R^2)
      const d = 4 * (dotVD * dotVD) - 4 * c;

      if (d >= 0) {
        // Compute the two roots
        const t1 = (-2 * dotVD - Math.sqrt(d)) / 2;
        const t2 = (-2 * dotVD + Math.sqrt(d)) / 2;

        // We want the smallest positive root (meaning the ball is ahead of the cue ball path)
        let t = -1;
        if (t1 > 0.01 && t2 > 0.01) {
          t = Math.min(t1, t2);
        } else if (t1 > 0.01) {
          t = t1;
        } else if (t2 > 0.01) {
          t = t2;
        }

        // Keep track of the closest intersected target ball
        if (t > 0.01 && t < closestT) {
          closestT = t;
          closestTarget = target;
          hasHit = true;
        }
      }
    });

    if (hasHit && closestTarget) {
      // 1. Position of the cue ball center at the moment of contact
      ghostCenter = {
        x: startX + this.strokeDir.x * closestT,
        y: startY + this.strokeDir.y * closestT
      };

      // 2. Projected target ball deflection direction (along the normal of centers)
      const Tx = closestTarget.position.x;
      const Ty = closestTarget.position.y;
      
      const normX = Tx - ghostCenter.x;
      const normY = Ty - ghostCenter.y;
      const normDist = Math.sqrt(normX * normX + normY * normY);

      if (normDist > 0.1) {
        targetDeflect = {
          x: normX / normDist,
          y: normY / normDist
        };

        // 3. Projected cue ball deflection direction (perpendicular to normal)
        // cueDeflect = incomingDir - dot(incomingDir, normal) * normal
        const dotDNorm = this.strokeDir.x * targetDeflect.x + this.strokeDir.y * targetDeflect.y;
        
        const cueDeflectX = this.strokeDir.x - dotDNorm * targetDeflect.x;
        const cueDeflectY = this.strokeDir.y - dotDNorm * targetDeflect.y;
        const cueDeflectDist = Math.sqrt(cueDeflectX * cueDeflectX + cueDeflectY * cueDeflectY);

        if (cueDeflectDist > 0.01) {
          cueDeflect = {
            x: cueDeflectX / cueDeflectDist,
            y: cueDeflectY / cueDeflectDist
          };
        } else {
          // Absolute direct head-on collision: cue ball deflects perpendicular to incoming vector
          cueDeflect = {
            x: -targetDeflect.y,
            y: targetDeflect.x
          };
        }
      }
    }

    return {
      isAiming: this.isAiming,
      startX,
      startY,
      strokeDir: this.strokeDir,
      dragDist: this.dragDist,
      hasHit,
      ghostCenter,
      targetCenter: closestTarget ? { x: closestTarget.position.x, y: closestTarget.position.y } : null,
      targetDeflect,
      cueDeflect
    };
  }
}
