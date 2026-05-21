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
    this.startDragPos = { x: 0, y: 0 };
    this.currentMousePos = { x: 0, y: 0 };
    this.dragDist = 0;
    this.strokeDir = { x: 0, y: 0 };

    // Active status
    this.enabled = true;

    this.initEvents();
  }

  /**
   * Binds mouse and touch events to the canvas.
   */
  initEvents() {
    // Pointer down (start drag)
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.enabled || !this.physics.cueBall) return;

      // Get mouse coordinate relative to canvas bounds
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = ((e.clientX - rect.left) / rect.width) * this.config.canvas.width;
      const mouseY = ((e.clientY - rect.top) / rect.height) * this.config.canvas.height;

      // Check if cue ball is stationary before allowing a shot
      const cueSpeed = Matter.Body.getSpeed(this.physics.cueBall);
      if (cueSpeed > 0.05) return;

      this.isAiming = true;
      this.startDragPos = { x: mouseX, y: mouseY };
      this.currentMousePos = { x: mouseX, y: mouseY };
      this.dragDist = 0;
      this.strokeDir = { x: 1, y: 0 }; // Default pointing right
    });

    // Pointer move (drag in progress)
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.isAiming || !this.physics.cueBall) return;

      const rect = this.canvas.getBoundingClientRect();
      const mouseX = ((e.clientX - rect.left) / rect.width) * this.config.canvas.width;
      const mouseY = ((e.clientY - rect.top) / rect.height) * this.config.canvas.height;

      this.currentMousePos = { x: mouseX, y: mouseY };

      // Calculate dragging vector (pulling back from starting drag click coordinate)
      const dx = mouseX - this.startDragPos.x;
      const dy = mouseY - this.startDragPos.y;
      
      this.dragDist = Math.sqrt(dx * dx + dy * dy);

      if (this.dragDist > 0.1) {
        // Stroke direction is opposite of pulling vector (drag-back mechanics)
        this.strokeDir = {
          x: -dx / this.dragDist,
          y: -dy / this.dragDist
        };
      }
    });

    // Pointer up (release to fire shot)
    window.addEventListener('pointerup', () => {
      if (!this.isAiming || !this.physics.cueBall) return;

      this.isAiming = false;

      // Calculate applied force based on pull back distance
      const cappedDrag = Math.min(this.dragDist, this.config.cue.maxDrag);
      
      // Only trigger shot if pull back distance is sufficient and NOT canceled (greater than cancelDistance)
      if (cappedDrag >= this.config.cue.minDrag && this.dragDist >= this.config.cue.cancelDistance) {
        const forceMagnitude = cappedDrag * this.config.cue.dragScale;
        let forceLimit = this.config.cue.maxForce;
        if (this.physics.isBreakShot) {
          forceLimit *= this.config.cue.breakForceMultiplier || 2.0;
        }
        const appliedForce = Math.min(forceMagnitude, forceLimit);

        // Apply dynamic linear impulse to cue ball center
        const forceVector = {
          x: this.strokeDir.x * appliedForce,
          y: this.strokeDir.y * appliedForce
        };

        this.physics.applyCueStroke(forceVector);
        
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
    if (!this.isAiming || !this.physics.cueBall || this.dragDist < this.config.cue.cancelDistance) return null;

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
