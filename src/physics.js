import Matter from 'matter-js';
import { CONFIG } from './config.js';

/**
 * Modular Physics Engine simulator using Matter.js
 * Strictly handles rigid-body physics, table coordinates, and collisions.
 * NO knowledge of scoring arrays, matches, or evaluations.
 */
export class PhysicsEngine {
  /**
   * @param {Object} config The centralized CONFIG object
   */
  constructor(config = CONFIG) {
    this.config = config;

    // Create Matter.js Engine
    this.engine = Matter.Engine.create({
      gravity: { x: 0, y: 0 } // No global gravity for pool/billiards top-down table
    });
    this.world = this.engine.world;

    // References to bodies
    this.cushions = [];
    this.pockets = [];
    this.targetBalls = [];
    this.allTargetBalls = [];
    this.cueBall = null;
    this.isBreakShot = true;
    this.cushionContactSet = new Set(); // Track which target balls contact cushions during a shot
    /** True once the cue ball has contacted any object ball this shot */
    this.firstBallContactMade = false;
    /** True once any ball (cue or object) contacts a cushion AFTER first ball-ball contact */
    this.cushionContactAfterBallHit = false;
    /** @type {AimingControls|null} Reference to the controls instance for BIH state checks */
    this.controls = null;

    // Callbacks for hooks
    /** @type {function(Matter.Body, Matter.Body): void} Callback when a ball enters a pocket */
    this.onPocketOverlap = null;
    /** @type {function(Matter.Body, Matter.Body): void} Callback when two balls collide */
    this.onBallCollision = null;

    // ── Spin / English system ─────────────────────────────────────────────────
    /** Contact-point offset (-1..1 in each axis) set by controls before each shot */
    this.cueBallSpin = { x: 0, y: 0 };
    /** Direction of the current stroke — set in applyCueStroke for spin calculations */
    this._strokeDir = { x: 1, y: 0 };
    /** Speed of the stroke at fire time — used as reference magnitude for spin impulse */
    this._strokeSpeed = 0;
    /** True when draw/follow effect should be applied on the next update tick */
    this._spinEffectQueued = false;
    /** True when cushion-English rotation should be applied on the next update tick */
    this._cushionEnglishQueued = false;
    /** True when throw (spin transfer to object ball) should be applied next tick */
    this._throwQueued = false;
    /** The object ball body that should receive the throw impulse */
    this._throwTarget = null;

    this.initTable();
    this.initPockets();
    this.initCollisionListeners();
  }

  /**
   * Constructs the outer solid cushions/rails representing the 2:1 table play area.
   */
  initTable() {
    const { xCenter, yCenter, width, height, railWidth, railRestitution } = this.config.table;

    // Half widths/heights for bounds calculations
    const hw = width / 2;
    const hh = height / 2;
    const rw = railWidth;

    // Cushion options: solid, high density, and custom bounciness
    const cushionOptions = {
      isStatic: true,
      restitution: railRestitution,
      friction: this.config.ball.friction,
      label: 'cushion'
    };

    // Construct the 4 boundary cushions around the felt play area
    const topCushion = Matter.Bodies.rectangle(xCenter, yCenter - hh - rw/2, width + rw * 2, rw, cushionOptions);
    const bottomCushion = Matter.Bodies.rectangle(xCenter, yCenter + hh + rw/2, width + rw * 2, rw, cushionOptions);
    const leftCushion = Matter.Bodies.rectangle(xCenter - hw - rw/2, yCenter, rw, height, cushionOptions);
    const rightCushion = Matter.Bodies.rectangle(xCenter + hw + rw/2, yCenter, rw, height, cushionOptions);

    this.cushions = [topCushion, bottomCushion, leftCushion, rightCushion];

    // Explicitly apply restitution post-construction to bypass Matter.js's static body zeroing override
    this.cushions.forEach(cushion => {
      Matter.Body.set(cushion, { restitution: railRestitution });
    });

    Matter.Composite.add(this.world, this.cushions);
  }

  /**
   * Places 6 sensory pockets (4 corners, 2 side rails) that do not block movement.
   */
  initPockets() {
    const { xCenter, yCenter, width, height } = this.config.table;
    const { radius, sideOffset } = this.config.pocket;

    const hw = width / 2;
    const hh = height / 2;

    // Pocket locations centered on outer border edges to catch overlapping balls
    const pocketPositions = [
      { x: xCenter - hw, y: yCenter - hh, label: 'Corner_TopLeft' },     // Top Left
      { x: xCenter + hw, y: yCenter - hh, label: 'Corner_TopRight' },    // Top Right
      { x: xCenter - hw, y: yCenter + hh, label: 'Corner_BottomLeft' },  // Bottom Left
      { x: xCenter + hw, y: yCenter + hh, label: 'Corner_BottomRight' }, // Bottom Right
      { x: xCenter, y: yCenter - hh - sideOffset, label: 'Side_Top' },   // Side Top (slightly offset up)
      { x: xCenter, y: yCenter + hh + sideOffset, label: 'Side_Bottom' } // Side Bottom (slightly offset down)
    ];

    pocketPositions.forEach((pos, idx) => {
      const pocket = Matter.Bodies.circle(pos.x, pos.y, radius, {
        isStatic: true,
        isSensor: true, // Crucial: registers collisions but does NOT rebound the balls physically
        label: 'pocket',
        plugin: {
          pocketId: idx,
          pocketName: pos.label
        }
      });
      this.pockets.push(pocket);
    });

    Matter.Composite.add(this.world, this.pockets);
  }

  /**
   * Sets up programmatic racking for 15 target balls and 1 cue ball.
   */
  spawnBalls() {
    this.isBreakShot = true;
    this.cushionContactSet.clear();
    
    // Clear any existing ball bodies from the world first
    if (this.cueBall) {
      Matter.Composite.remove(this.world, this.cueBall);
    }
    this.targetBalls.forEach(ball => Matter.Composite.remove(this.world, ball));
    this.targetBalls = [];
    this.allTargetBalls = [];

    const { xCenter, yCenter, width } = this.config.table;
    const { radius, density, restitution, friction, frictionAir } = this.config.ball;

    const ballOptions = {
      density: density,
      restitution: restitution,
      friction: friction,
      frictionStatic: 0.0, // Prevent tangential friction-induced spin/deflection during contacts
      frictionAir: frictionAir,
      label: 'ball'
    };

    // Spawn Cue Ball at the head string center (1/4 table width from left)
    const headStringX = xCenter - width / 4;
    // 25-sided polygon approximation reduces contact normal deviation from 9° (10-sided) to 3.6°,
    // and brings the contact distance within 0.08px of the true 2R (vs 0.98px for 10-sided).
    this.cueBall = Matter.Bodies.polygon(headStringX, yCenter, 26, radius, {
      ...ballOptions,
      label: 'cue_ball'
    });
    Matter.Composite.add(this.world, this.cueBall);

    // Racking apex starts at the foot spot (1/4 table width from right)
    const footSpotX = xCenter + width / 4;
    const rowOffset = radius * Math.sqrt(3); // Triangle row spacing offset

    // Deterministic Protected Rack setup:
    // A (1) in middle of 3rd row -> index 4
    // J (11) and Q (12) in middle positions of 4th row -> indices 7 and 8
    // K (13) in middle of 5th/last row -> index 12
    const ballIds = new Array(15);
    ballIds[4] = 1;   // A
    ballIds[7] = 12;  // Q
    ballIds[8] = 11;  // J
    ballIds[12] = 13; // K

    // Other balls (2-10, 14, 15)
    const otherValues = [2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 15];
    // Shuffle the other values
    for (let i = otherValues.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [otherValues[i], otherValues[j]] = [otherValues[j], otherValues[i]];
    }

    let otherIdx = 0;
    for (let i = 0; i < 15; i++) {
      if (i === 4 || i === 7 || i === 8 || i === 12) continue;
      ballIds[i] = otherValues[otherIdx++];
    }

    let ballIndex = 0;
    // 5 Rows in triangle rack
    for (let row = 0; row < 5; row++) {
      // Calculate X coordinate for this row (increasing as we move right)
      const x = footSpotX + row * rowOffset;
      // Calculate start Y coordinate to center the row vertically
      const startY = yCenter - (row * radius);
      
      for (let col = 0; col <= row; col++) {
        const y = startY + col * (radius * 2);
        
        const targetBall = Matter.Bodies.polygon(x, y, 25, radius, {
          ...ballOptions,
          plugin: {
            ballId: ballIds[ballIndex]
          }
        });
        
        this.targetBalls.push(targetBall);
        this.allTargetBalls.push(targetBall);
        ballIndex++;
      }
    }

    Matter.Composite.add(this.world, this.targetBalls);
  }

  /**
   * Sets up collision event listeners in Matter.js to bridge hooks.
   */
  initCollisionListeners() {
    Matter.Events.on(this.engine, 'collisionStart', (event) => {
      event.pairs.forEach((collisionPair) => {
        const { bodyA, bodyB } = collisionPair;

        // ── Cue ball → object ball first contact ─────────────────────────────
        const isCueA = bodyA.label === 'cue_ball';
        const isCueB = bodyB.label === 'cue_ball';
        const isBallA = bodyA.label === 'ball';
        const isBallB = bodyB.label === 'ball';
        if ((isCueA && isBallB) || (isCueB && isBallA)) {
          if (!this.firstBallContactMade) {
            this.firstBallContactMade = true;
            console.log('[PHYSICS] First cue-to-ball contact registered');
            const spin = this.cueBallSpin;
            // Queue draw/follow effect (modifies cue ball path after contact)
            if (Math.abs(spin.x) > 0.05 || Math.abs(spin.y) > 0.05) {
              this._spinEffectQueued = true;
              console.log(`[SPIN] Draw/follow effect queued: spin=(${spin.x.toFixed(2)},${spin.y.toFixed(2)})`);
            }
            // Queue throw (side-spin transfers to object ball, deflects it off expected line)
            if (Math.abs(spin.x) > 0.05) {
              this._throwQueued = true;
              this._throwTarget = isCueA ? bodyB : bodyA;
              console.log(`[SPIN] Throw queued: spinX=${spin.x.toFixed(2)}`);
            }
          }
        }

        // ── Cushion contacts ──────────────────────────────────────────────────
        const isCushionA = bodyA.label === 'cushion';
        const isCushionB = bodyB.label === 'cushion';
        if (isCushionA && isBallB) {
          this.cushionContactSet.add(bodyB.plugin.ballId);
          if (this.firstBallContactMade) this.cushionContactAfterBallHit = true;
        } else if (isCushionB && isBallA) {
          this.cushionContactSet.add(bodyA.plugin.ballId);
          if (this.firstBallContactMade) this.cushionContactAfterBallHit = true;
        } else if ((isCushionA && isCueB) || (isCushionB && isCueA)) {
          // Cue ball hitting cushion: queue English angle deflection if side spin is active.
          // This fires for ALL cushion contacts — including pure bank shots with no object ball.
          if (this.firstBallContactMade) this.cushionContactAfterBallHit = true;
          if (Math.abs(this.cueBallSpin.x) > 0.05) {
            this._cushionEnglishQueued = true;
            console.log(`[SPIN] Cushion English queued: spinX=${this.cueBallSpin.x.toFixed(2)}`);
          }
        }

        // ── Pocket overlaps ───────────────────────────────────────────────────
        if (bodyA.label === 'pocket' && (bodyB.label === 'ball' || bodyB.label === 'cue_ball')) {
          if (this.onPocketOverlap) this.onPocketOverlap(bodyB, bodyA);
        } else if (bodyB.label === 'pocket' && (bodyA.label === 'ball' || bodyA.label === 'cue_ball')) {
          if (this.onPocketOverlap) this.onPocketOverlap(bodyA, bodyB);
        }

        // Check for Ball-to-Ball Collisions
        const isBodyABall = (bodyA.label === 'ball' || bodyA.label === 'cue_ball');
        const isBodyBBall = (bodyB.label === 'ball' || bodyB.label === 'cue_ball');
        
        if (isBodyABall && isBodyBBall) {
          if (this.onBallCollision) this.onBallCollision(bodyA, bodyB);
        }
      });
    });
  }

  /**
   * Advance the physics simulation engine one tick.
   * Also clamps max velocity to avoid tunneling through cushions.
   * @param {number} dt Time step in milliseconds
   */
  update(dt = 1000 / 60) {
    // Sync timeScale directly from configuration parameter
    this.engine.timing.timeScale = this.config.ball.timeScale || 1.0;
    
    // High-Precision Physics Sub-stepping:
    // Dividing the single frame time step into 10 sub-steps limits per-step displacement,
    // reducing body penetration to a fraction of a pixel and ensuring extremely accurate collision normals.
    const subSteps = 10;
    const subDt = dt / subSteps;
    for (let i = 0; i < subSteps; i++) {
      Matter.Engine.update(this.engine, subDt);
    }

    // Apply queued spin effects one full update cycle after collision detection.
    // The one-tick delay lets Matter.js resolve collision response first so our
    // velocity override is not clobbered by the engine's own impulse calculations.
    if (this._spinEffectQueued) {
      this._spinEffectQueued = false;
      this._applySpinEffect(); // draw / follow on cue ball
    }
    if (this._throwQueued) {
      this._throwQueued = false;
      this._applyThrow(); // side-spin transfer to object ball
    }
    if (this._cushionEnglishQueued) {
      this._cushionEnglishQueued = false;
      this._applyCushionEnglish(); // English angle change off rails
    }

    // During Ball-in-Hand: hard-clamp cue ball velocity to zero every tick so it stays
    // exactly where the player positioned it, preventing physics-induced drift.
    if (this.controls?.hasBallInHand && this.cueBall) {
      Matter.Body.setVelocity(this.cueBall, { x: 0, y: 0 });
      Matter.Body.setAngularVelocity(this.cueBall, 0);
    }

    // Limit maximum speed and snap near-zero velocities to exactly zero.
    // The snap prevents balls from creeping slowly into pockets after the game
    // has declared them "stopped" — a common source of phantom pocket events.
    const maxSpeed = this.config.ball.maxSpeed;
    const snapThreshold = 0.1; // px/frame below which we hard-zero velocity
    const allBodies = Matter.Composite.allBodies(this.world);

    allBodies.forEach(body => {
      if (!body.isStatic) {
        const speed = Matter.Body.getSpeed(body);
        if (speed > maxSpeed) {
          const ratio = maxSpeed / speed;
          Matter.Body.setVelocity(body, {
            x: body.velocity.x * ratio,
            y: body.velocity.y * ratio
          });
        } else if (speed > 0 && speed < snapThreshold) {
          // Snap micro-velocity to zero so balls cannot creep into pockets
          // after the turn has been declared over.
          Matter.Body.setVelocity(body, { x: 0, y: 0 });
          Matter.Body.setAngularVelocity(body, 0);
        }
      }
    });
  }

  /**
   * Checks if all dynamic balls (cue ball and active target balls) on the table have stopped.
   * @returns {boolean} True if all balls have speeds < 0.05
   */
  areAllBallsStopped() {
    if (!this.cueBall) return false;
    // Use 0.1 threshold (matches the snap-to-zero in update) so balls that
    // have not yet been snapped are not considered "stopped" — preventing the
    // game loop from declaring a shot over while a ball is still creeping.
    const cueSpeed = Matter.Body.getSpeed(this.cueBall);
    if (cueSpeed > 0.1) return false;

    for (let i = 0; i < this.targetBalls.length; i++) {
      const ballSpeed = Matter.Body.getSpeed(this.targetBalls[i]);
      if (ballSpeed > 0.1) return false;
    }
    return true;
  }

  /**
   * Handles pocket sensory overlaps: parks the cue ball off-canvas on scratch
   * (so it stays invisible while other balls finish moving), or removes target balls.
   *
   * For scratch: the ball is NOT teleported to the head string immediately because
   * other balls may still be in motion.  The game engine calls hasBallInHand = true
   * inside handleShotEnd (which fires only after areAllBallsStopped()), and the
   * controls setter then repositions the cue ball to a sensible BIH starting point.
   *
   * @param {Matter.Body} ball The dynamic ball body
   */
  handlePocketOverlap(ball) {
    if (ball.label === 'cue_ball') {
      // Park the cue ball well off-canvas so it stays invisible while target balls
      // continue rolling.  areAllBallsStopped() still works correctly because the
      // body still exists in the world with velocity = 0.
      console.log(`[PHYSICS] Cue ball scratched — parked off-canvas at (-500,-500)`);
      Matter.Body.setPosition(ball, { x: -500, y: -500 });
      Matter.Body.setVelocity(ball, { x: 0, y: 0 });
      Matter.Body.setAngularVelocity(ball, 0);
    } else {
      // Target ball pocketed: remove from physical world and active array
      const ballId = ball.plugin?.ballId ?? '?';
      console.log(`[PHYSICS] Ball ${ballId} (id=${ball.id}) pocketed — removed from world. Active balls remaining: ${this.targetBalls.length - 1}`);
      Matter.Composite.remove(this.world, ball);
      this.targetBalls = this.targetBalls.filter(b => b.id !== ball.id);
    }
  }

  /**
   * Helper to set direct velocity on the cue ball, overriding residual vectors
   * @param {Matter.Vector} velocity Starting velocity vector
   */
  applyCueStroke(velocity) {
    if (!this.cueBall) return;
    // Reset all per-shot tracking when a new shot fires
    this.cushionContactSet.clear();
    this.firstBallContactMade = false;
    this.cushionContactAfterBallHit = false;
    this._spinEffectQueued = false;
    this._cushionEnglishQueued = false;
    this._throwQueued = false;
    this._throwTarget = null;
    const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2);
    // Store normalised stroke direction AND initial speed for spin effect calculations.
    // We use _strokeSpeed (not post-collision speed) so draw/follow work correctly
    // even on head-on shots where the cue ball transfers all velocity to the object ball.
    this._strokeDir = speed > 0
      ? { x: velocity.x / speed, y: velocity.y / speed }
      : { x: 1, y: 0 };
    this._strokeSpeed = speed;
    console.log(`[PHYSICS] Cue stroke applied: vx=${velocity.x.toFixed(2)} vy=${velocity.y.toFixed(2)} speed=${speed.toFixed(2)} spin=(${this.cueBallSpin.x.toFixed(2)},${this.cueBallSpin.y.toFixed(2)})`);
    // Overrides any residual velocities and guarantees 100% directional accuracy
    Matter.Body.setVelocity(this.cueBall, velocity);
  }

  /**
   * Applies the queued spin/English effect to the cue ball.
   * Called once per physics update cycle after first ball-ball contact.
   * spin.x  : side/English  (−1=left, +1=right)
   * spin.y  : draw / follow (−1=follow/topspin, +1=draw/backspin)
   */
  /**
   * Applies draw / follow impulse to the cue ball after it contacts an object ball.
   * Uses the original stroke speed so the effect is meaningful even on head-on shots
   * where the cue ball transfers all momentum and stops dead (post-collision speed ≈ 0).
   *
   * Strength is intentionally modest (0.16 × refSpeed) — the previous value of 0.55 was
   * too aggressive. Side-spin (spin.x) is NOT consumed here; it persists so that
   * _applyCushionEnglish() can use it if the cue ball subsequently hits a rail.
   */
  _applySpinEffect() {
    if (!this.cueBall || !this.cueBallSpin) return;
    const spin = this.cueBallSpin;
    if (Math.abs(spin.y) < 0.05) return; // Only draw/follow here; English is handled separately

    const vel = this.cueBall.velocity;
    const dir = this._strokeDir;
    const refSpeed = this._strokeSpeed; // Original shot speed — not post-collision speed
    if (refSpeed < 0.5) return;

    let newVx = vel.x;
    let newVy = vel.y;

    // Draw / Follow — impulse along the original stroke direction.
    //   spin.y > 0 → dot below centre (draw/backspin): subtract forward → ball reverses/stops
    //   spin.y < 0 → dot above centre (follow/topspin): add forward → ball continues
    const drawStrength = 0.16; // ~0.3× the previous 0.55 — feels natural, not overpowered
    newVx -= dir.x * spin.y * refSpeed * drawStrength;
    newVy -= dir.y * spin.y * refSpeed * drawStrength;

    console.log(`[SPIN] Draw/follow applied: spinY=${spin.y.toFixed(2)} refSpeed=${refSpeed.toFixed(2)} vel=(${vel.x.toFixed(2)},${vel.y.toFixed(2)}) → (${newVx.toFixed(2)},${newVy.toFixed(2)})`);
    Matter.Body.setVelocity(this.cueBall, { x: newVx, y: newVy });

    // Consume draw/follow spin. Side-spin (x) intentionally kept alive for cushion English.
    this.cueBallSpin = { x: spin.x, y: 0 };
  }

  /**
   * Applies side-spin "throw" to the object ball at the moment of first cue-to-ball contact.
   *
   * Real physics: the spinning cue ball's surface drags against the object ball at the contact
   * point (like gears). This deflects the OB slightly off its expected line — called "throw".
   * Effect is small (~0.10 × strokeSpeed) but produces visibly different object ball paths.
   *
   * Direction: perpendicular to the stroke direction (tangent at contact).
   *   spin.x > 0 (right English) → OB deflects in +perpendicular direction
   *   spin.x < 0 (left English)  → OB deflects in -perpendicular direction
   */
  _applyThrow() {
    if (!this._throwTarget) return;
    const spinX = this.cueBallSpin.x;
    if (Math.abs(spinX) < 0.05) return;

    const objVel = this._throwTarget.velocity;
    const objSpeed = Math.sqrt(objVel.x ** 2 + objVel.y ** 2);
    if (objSpeed < 0.1) return; // OB not moving — no throw

    // Perpendicular to stroke direction (tangent at ball-to-ball contact)
    const perpX = -this._strokeDir.y;
    const perpY =  this._strokeDir.x;
    const throwStrength = 0.10;

    const newVx = objVel.x + perpX * spinX * this._strokeSpeed * throwStrength;
    const newVy = objVel.y + perpY * spinX * this._strokeSpeed * throwStrength;

    console.log(`[SPIN] Throw applied to OB: spinX=${spinX.toFixed(2)} → OB vel (${objVel.x.toFixed(2)},${objVel.y.toFixed(2)}) → (${newVx.toFixed(2)},${newVy.toFixed(2)})`);
    Matter.Body.setVelocity(this._throwTarget, { x: newVx, y: newVy });
    this._throwTarget = null;
  }

  /**
   * Rotates the cue ball's post-cushion velocity by an angle proportional to side spin.
   *
   * Real physics: the spinning ball's rubber surface drags against the rail, changing the
   * exit angle. Running English (spin matching natural roll off the rail) widens the angle;
   * reverse English narrows it. We model this as a CCW velocity rotation for positive spin.x.
   *
   * Max deflection ≈ 15° at full English (±1.0). Spin decays 30% per rail contact,
   * simulating the energy lost to the cushion's rubber absorption.
   */
  _applyCushionEnglish() {
    if (!this.cueBall) return;
    const spinX = this.cueBallSpin.x;
    if (Math.abs(spinX) < 0.05) return;

    const vel = this.cueBall.velocity;
    const speed = Math.sqrt(vel.x ** 2 + vel.y ** 2);
    if (speed < 0.5) return;

    // Rotate the reflected velocity vector by angle proportional to side spin.
    // Negative sign: positive spinX (right English) → CW rotation (correct physical direction).
    const maxAngle = 0.78; // radians ≈ 45° at full English (scales linearly with spin amount)
    const angle = -spinX * maxAngle;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const newVx = vel.x * cos - vel.y * sin;
    const newVy = vel.x * sin + vel.y * cos;

    // Decay spin ~30% per cushion contact (rubber absorbs rotational energy)
    const decayedX = spinX * 0.70;
    this.cueBallSpin = { x: decayedX, y: this.cueBallSpin.y };

    console.log(`[SPIN] Cushion English applied: spinX=${spinX.toFixed(2)} angle=${(angle * 180 / Math.PI).toFixed(1)}° vel=(${vel.x.toFixed(2)},${vel.y.toFixed(2)}) → (${newVx.toFixed(2)},${newVy.toFixed(2)}) spinX decayed→${decayedX.toFixed(2)}`);
    Matter.Body.setVelocity(this.cueBall, { x: newVx, y: newVy });
  }

  /**
   * Safe-Haven Break / Invalid Pocket Respawn:
   * Teleports a pocketed target ball to the first unoccupied coordinate in the 9-point respawn matrix.
   * @param {Matter.Body} ball The pocketed ball body
   */
  respawnBall(ball) {
    // If the ball was removed from the world composite on pocket overlap, restore it
    if (!this.targetBalls.some(b => b.id === ball.id)) {
      this.targetBalls.push(ball);
      Matter.Composite.add(this.world, ball);
    }

    const matrix = this.config.rules.respawnMatrix;
    const radius = this.config.ball.radius;
    let freeSpot = null;

    for (const spot of matrix) {
      let isBlocked = false;
      
      // Check cue ball
      if (this.cueBall) {
        const dx = this.cueBall.position.x - spot.x;
        const dy = this.cueBall.position.y - spot.y;
        if (Math.sqrt(dx * dx + dy * dy) < radius * 3) {
          isBlocked = true;
        }
      }
      
      // Check all active target balls (except itself)
      for (const target of this.targetBalls) {
        if (target.id === ball.id) continue;
        const dx = target.position.x - spot.x;
        const dy = target.position.y - spot.y;
        if (Math.sqrt(dx * dx + dy * dy) < radius * 3) {
          isBlocked = true;
          break;
        }
      }
      
      if (!isBlocked) {
        freeSpot = spot;
        break;
      }
    }

    // Fallback to first spot if all spots are blocked
    if (!freeSpot) {
      freeSpot = matrix[0];
    }

    // Teleport the ball to the spot, set velocity to zero
    const ballId = ball.plugin?.ballId ?? '?';
    console.log(`[PHYSICS] Ball ${ballId} respawned at (${freeSpot.x}, ${freeSpot.y})${freeSpot === matrix[0] && !matrix.find(s => s !== freeSpot) ? ' [FALLBACK - all spots blocked]' : ''}`);
    Matter.Body.setPosition(ball, { x: freeSpot.x, y: freeSpot.y });
    Matter.Body.setVelocity(ball, { x: 0, y: 0 });
    Matter.Body.setAngularVelocity(ball, 0);
  }
}
