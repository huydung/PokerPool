import { describe, it, expect } from 'vitest';
import { PhysicsEngine } from '../src/physics.js';
import { CONFIG } from '../src/config.js';
import fs from 'fs';
import path from 'path';

describe('Poker Pool - Physics Sandbox TDD Suite', () => {

  // ========================================================
  // 1. CONFIGURATION & ZERO MAGIC NUMBERS TEST
  // ========================================================
  it('should read all physical parameters from CONFIG module with no magic hardcodes', () => {
    const engine = new PhysicsEngine(CONFIG);
    
    // Assert table layout dimensions are exactly as configured
    expect(engine.config.table.width).toBe(CONFIG.table.width);
    expect(engine.config.table.height).toBe(CONFIG.table.height);

    // Verify cushions are modeled with the configured cushion/rail bounciness
    engine.cushions.forEach(cushion => {
      expect(cushion.restitution).toBe(CONFIG.table.cushionRestitution);
    });

    // Spawn balls and verify their physical rigid-body parameters match config properties
    engine.spawnBalls();
    
    expect(engine.cueBall.circleRadius).toBe(CONFIG.ball.radius);
    expect(engine.cueBall.density).toBeCloseTo(CONFIG.ball.density, 6);
    expect(engine.cueBall.restitution).toBe(CONFIG.ball.restitution);
    expect(engine.cueBall.friction).toBe(CONFIG.ball.friction);

    engine.targetBalls.forEach(ball => {
      expect(ball.circleRadius).toBe(CONFIG.ball.radius);
      expect(ball.density).toBeCloseTo(CONFIG.ball.density, 6);
      expect(ball.restitution).toBe(CONFIG.ball.restitution);
      expect(ball.friction).toBe(CONFIG.ball.friction);
    });
  });

  // ========================================================
  // 2. ELASTIC REBOUNDS & MOMENTUM CONSERVATION
  // ========================================================
  it('should compute highly elastic ball-to-ball rebounds using configured density/restitution', async () => {
    // Setup a physical engine with a highly elastic configuration
    const customConfig = {
      ...CONFIG,
      ball: {
        ...CONFIG.ball,
        density: 0.001,
        restitution: 1.0, // perfectly elastic for easy calculation
        friction: 0.0,
        frictionAir: 0.0,
        maxSpeed: 100
      }
    };

    const engine = new PhysicsEngine(customConfig);
    
    // Dynamically import matter-js asynchronously and await it
    const { Body } = await import('matter-js');

    // Spawn two balls: Cue ball and one target ball directly in line along X-axis
    engine.spawnBalls();

    const cueBall = engine.cueBall;
    const targetBall = engine.targetBalls[0]; // Apex target ball

    // Reposition balls for a direct head-on collision along horizontal line
    Body.setPosition(cueBall, { x: 200, y: 300 });
    Body.setPosition(targetBall, { x: 250, y: 300 });

    // Zero-out all velocities
    Body.setVelocity(cueBall, { x: 0, y: 0 });
    Body.setVelocity(targetBall, { x: 0, y: 0 });

    // Apply initial horizontal velocity to cue ball moving right towards target
    Body.setVelocity(cueBall, { x: 5, y: 0 });

    // Run multiple ticks to simulate collision
    for (let i = 0; i < 30; i++) {
      engine.update(16.67); // 60fps tick step
    }

    const cueSpeed = Body.getSpeed(cueBall);
    const targetSpeed = Body.getSpeed(targetBall);

    // In a perfectly elastic head-on collision of equal mass (density/radius):
    // Cue ball should stop (velocity transfers entirely) and Target ball should shoot off.
    expect(cueSpeed).toBeLessThan(0.5); // Cue ball stops or comes close to rest
    expect(targetSpeed).toBeCloseTo(5.0, 0); // Target ball moves off at roughly original speed (precision 0 is within 0.5)
  });

  // ========================================================
  // 3. ARCHITECTURAL MODULARITY & ISOLATION CHECK
  // ========================================================
  it('should be completely decoupled from card rankings or hand scores', () => {
    // Read the physics.js source code as text and search for prohibited card/game-rules keywords
    const physicsPath = path.resolve(__dirname, '../src/physics.js');
    const sourceCode = fs.readFileSync(physicsPath, 'utf-8');

    // List of banned domain concepts that must never leak into rigid-body physics calculations
    const bannedKeywords = [
      'hand', 'poker', 'card', 'suit', 'royal', 'flush', 'straight', 
      'pair', 'kicker', 'player', 'miss', 'disqualify', 'winner'
    ];

    bannedKeywords.forEach(keyword => {
      // Use case-insensitive search
      const regex = new RegExp(`\\b${keyword}\\b`, 'i');
      const containsKeyword = regex.test(sourceCode);
      
      expect(containsKeyword).toBe(false);
    });
  });
});
