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
          // Cue ball hitting cushion also counts after first ball contact
          if (this.firstBallContactMade) this.cushionContactAfterBallHit = true;
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
    const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2);
    console.log(`[PHYSICS] Cue stroke applied: vx=${velocity.x.toFixed(2)} vy=${velocity.y.toFixed(2)} speed=${speed.toFixed(2)}`);
    // Overrides any residual velocities and guarantees 100% directional accuracy
    Matter.Body.setVelocity(this.cueBall, velocity);
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
