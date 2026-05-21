import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PhysicsEngine } from '../src/physics.js';
import { GameEngine } from '../src/game.js';
import { CONFIG } from '../src/config.js';

// Setup minimal DOM mock for Node environment to prevent ReferenceErrors during Coin Toss overlays
const setupDOMMock = () => {
  const mockElement = {
    appendChild: () => mockElement,
    style: {},
    remove: () => {},
    className: '',
    innerHTML: ''
  };
  global.document = {
    getElementById: () => mockElement,
    createElement: () => mockElement,
    body: mockElement
  };
  global.requestAnimationFrame = (callback) => setTimeout(callback, 0);
};

const cleanupDOMMock = () => {
  delete global.document;
  delete global.requestAnimationFrame;
};

describe('Poker Pool - Game Rules & Turn Orchestration TDD Suite', () => {
  
  beforeEach(() => {
    setupDOMMock();
  });

  afterEach(() => {
    cleanupDOMMock();
  });

  // ========================================================
  // 1. DETERMINISTIC PROTECTED RACK
  // ========================================================
  it('should ensure high-value balls (A, J, Q, K) are placed deterministically at exact positions (indices 3, 7, 4, 8)', () => {
    const physics = new PhysicsEngine(CONFIG);

    for (let testRun = 0; testRun < 20; testRun++) {
      physics.spawnBalls();
      
      expect(physics.targetBalls[3].plugin.ballId).toBe(1);  // A
      expect(physics.targetBalls[4].plugin.ballId).toBe(12); // Q
      expect(physics.targetBalls[7].plugin.ballId).toBe(11); // J
      expect(physics.targetBalls[8].plugin.ballId).toBe(13); // K
    }
  });

  // ========================================================
  // 2. VIRTUAL COIN TOSS
  // ========================================================
  it('should randomly determine starting active player (Alice or Bob) fairly', async () => {
    const mockControls = { enabled: true };
    const mockRenderer = { setActivePlayer: () => {} };
    const game = new GameEngine(CONFIG);

    const winners = { Alice: 0, Bob: 0 };
    
    // Simulate 50 matches to check statistical distribution
    for (let i = 0; i < 50; i++) {
      const gameInstance = new GameEngine(CONFIG);
      const winnerPromise = gameInstance.startMatch(mockControls, mockRenderer);
      
      // Fast-forward timeout sequencing
      await new Promise(r => setTimeout(r, 0));
      
      const winner = gameInstance.activePlayer;
      expect(['Alice', 'Bob']).toContain(winner);
      winners[winner]++;
    }

    // Assert that both Alice and Bob win at least 15% of the time, ensuring a fair random selection
    expect(winners.Alice).toBeGreaterThan(5);
    expect(winners.Bob).toBeGreaterThan(5);
  });

  // ========================================================
  // 3. SAFE-HAVEN BREAK RULE
  // ========================================================
  it('should preserve breaker turn and respawn pocketed balls on a legal break without scoring cards', () => {
    const physics = new PhysicsEngine(CONFIG);
    const game = new GameEngine(CONFIG);
    
    physics.spawnBalls();
    
    // Setup renderer mock to verify visual synching
    const visibilityMap = {};
    game.renderer = {
      setActivePlayer: () => {},
      setBallVisibility: (id, visible) => {
        visibilityMap[id] = visible;
      }
    };

    // Alice breaks
    game.activePlayer = 'Alice';
    game.isBreakShot = true;
    physics.isBreakShot = true;

    // Simulate pocketing target ball 5 during break
    const targetBall = physics.targetBalls[5];
    game.handleShotStart();
    game.handlePocketOverlap(targetBall);
    physics.handlePocketOverlap(targetBall); // This removes it from physics.targetBalls

    // Verify it is physically removed
    expect(physics.targetBalls.some(b => b.id === targetBall.id)).toBe(false);

    // Simulate 4 cushion contacts (a legal break shot)
    physics.cushionContactSet.add(2);
    physics.cushionContactSet.add(3);
    physics.cushionContactSet.add(4);
    physics.cushionContactSet.add(5);

    // Evaluate Shot Outcome
    game.handleShotEnd(physics);

    // Assertions:
    // 1. Ball must be respawned (re-added to targetBalls and physics world)
    expect(physics.targetBalls.some(b => b.id === targetBall.id)).toBe(true);
    expect(visibilityMap[targetBall.id]).toBe(true);

    // 2. Active player must still be Alice (turn preserved)
    expect(game.activePlayer).toBe('Alice');

    // 3. Break phase concludes
    expect(game.isBreakShot).toBe(false);
  });

  // ========================================================
  // 4. ILLEGAL BREAK TURNOVER
  // ========================================================
  it('should transfer turn to opponent and keep cue ball in place on illegal break if no scratch occurs', () => {
    const physics = new PhysicsEngine(CONFIG);
    const game = new GameEngine(CONFIG);
    
    physics.spawnBalls();
    
    // Setup mock renderer
    game.renderer = {
      setActivePlayer: () => {},
      setBallVisibility: () => {}
    };

    // Move cue ball to a non-standard position to verify it stays in place
    physics.cueBall.position.x = 300;
    physics.cueBall.position.y = 300;

    // Alice breaks
    game.activePlayer = 'Alice';
    game.isBreakShot = true;
    physics.isBreakShot = true;

    // Simulate illegal break: 0 cushion contacts and 0 pocketed balls
    physics.cushionContactSet.clear();
    game.handleShotStart();

    // Evaluate Shot Outcome
    game.handleShotEnd(physics);

    // Assertions:
    // 1. Active player must now be Bob (opponent)
    expect(game.activePlayer).toBe('Bob');

    // 2. Breaker Alice gets a miss penalty
    expect(game.consecutiveMisses['Alice']).toBe(1);

    // 3. Cue ball must stay at its rest position (300, 300)
    expect(physics.cueBall.position.x).toBeCloseTo(300, 1);
    expect(physics.cueBall.position.y).toBeCloseTo(300, 1);
  });

  it('should reset cue ball to kitchen if scratch occurs during break', () => {
    const physics = new PhysicsEngine(CONFIG);
    const game = new GameEngine(CONFIG);
    
    physics.spawnBalls();
    
    // Setup mock renderer
    game.renderer = {
      setActivePlayer: () => {},
      setBallVisibility: () => {}
    };

    // Alice breaks
    game.activePlayer = 'Alice';
    game.isBreakShot = true;
    physics.isBreakShot = true;

    // Simulate scratch: pocket overlap on cue ball
    game.handleShotStart();
    game.handlePocketOverlap(physics.cueBall);
    physics.handlePocketOverlap(physics.cueBall);

    // Evaluate Shot Outcome
    game.handleShotEnd(physics);

    // Assertions:
    // 1. Cue ball must be placed behind head string (kitchen)
    const expectedHeadStringX = CONFIG.table.xCenter - CONFIG.table.width / 4;
    expect(physics.cueBall.position.x).toBeCloseTo(expectedHeadStringX, 1);
    expect(physics.cueBall.position.y).toBeCloseTo(CONFIG.table.yCenter, 1);
  });
});
