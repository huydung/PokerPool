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
    this.cueBall = null;
    this.isBreakShot = true;

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
    
    // Clear any existing ball bodies from the world first
    if (this.cueBall) {
      Matter.Composite.remove(this.world, this.cueBall);
    }
    this.targetBalls.forEach(ball => Matter.Composite.remove(this.world, ball));
    this.targetBalls = [];

    const { xCenter, yCenter, width } = this.config.table;
    const { radius, density, restitution, friction, frictionAir } = this.config.ball;

    const ballOptions = {
      density: density,
      restitution: restitution,
      friction: friction,
      frictionAir: frictionAir,
      label: 'ball'
    };

    // Spawn Cue Ball at the head string center (1/4 table width from left)
    const headStringX = xCenter - width / 4;
    this.cueBall = Matter.Bodies.circle(headStringX, yCenter, radius, {
      ...ballOptions,
      label: 'cue_ball'
    });
    Matter.Composite.add(this.world, this.cueBall);

    // Spawn 15 Target Balls racked in a standard triangle facing left
    // Racking apex starts at the foot spot (1/4 table width from right)
    const footSpotX = xCenter + width / 4;
    const rowOffset = radius * Math.sqrt(3); // Triangle row spacing offset

    let ballIndex = 1;
    // 5 Rows in triangle rack
    for (let row = 0; row < 5; row++) {
      // Calculate X coordinate for this row (increasing as we move right)
      const x = footSpotX + row * rowOffset;
      // Calculate start Y coordinate to center the row vertically
      const startY = yCenter - (row * radius);
      
      for (let col = 0; col <= row; col++) {
        const y = startY + col * (radius * 2);
        
        const targetBall = Matter.Bodies.circle(x, y, radius, {
          ...ballOptions,
          plugin: {
            ballId: ballIndex // Custom numerical identity slot (1-15)
          }
        });
        
        this.targetBalls.push(targetBall);
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

        // Check for Ball overlapping Pockets
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
    
    Matter.Engine.update(this.engine, dt);

    // Limit maximum speed of dynamic bodies to avoid tunneling errors
    const maxSpeed = this.config.ball.maxSpeed;
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
        }
      }
    });
  }

  /**
   * Handles pocket sensory overlaps: resets the cue ball on scratch or removes target balls.
   * @param {Matter.Body} ball The dynamic ball body
   */
  handlePocketOverlap(ball) {
    if (ball.label === 'cue_ball') {
      // Scratch: reset cue ball to head string center
      const headStringX = this.config.table.xCenter - this.config.table.width / 4;
      Matter.Body.setPosition(ball, { x: headStringX, y: this.config.table.yCenter });
      Matter.Body.setVelocity(ball, { x: 0, y: 0 });
      Matter.Body.setAngularVelocity(ball, 0);
    } else {
      // Target ball pocketed: remove from physical world and active array
      Matter.Composite.remove(this.world, ball);
      this.targetBalls = this.targetBalls.filter(b => b.id !== ball.id);
    }
  }

  /**
   * Helper to apply an impulse force vector to the cue ball
   * @param {Matter.Vector} force Force vector
   */
  applyCueStroke(force) {
    if (!this.cueBall) return;
    // Set cue ball speed/angle using active force at the cue ball center
    Matter.Body.applyForce(this.cueBall, this.cueBall.position, force);
  }
}
