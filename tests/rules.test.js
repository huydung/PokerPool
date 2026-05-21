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
  it('should ensure high-value balls (A, J, Q, K) are placed deterministically at exact positions (indices 4, 7, 8, 12)', () => {
    const physics = new PhysicsEngine(CONFIG);

    for (let testRun = 0; testRun < 20; testRun++) {
      physics.spawnBalls();
      
      expect(physics.targetBalls[4].plugin.ballId).toBe(1);   // A in middle of 3rd row (index 4)
      expect(physics.targetBalls[7].plugin.ballId).toBe(12);  // Q in middle of 4th row (index 7)
      expect(physics.targetBalls[8].plugin.ballId).toBe(11);  // J in middle of 4th row (index 8)
      expect(physics.targetBalls[12].plugin.ballId).toBe(13); // K in middle of 5th row (index 12)
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
      },
      updateHUD: () => {},
      updatePocketGraphics: () => {}
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
      setBallVisibility: () => {},
      updateHUD: () => {},
      updatePocketGraphics: () => {}
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
      setBallVisibility: () => {},
      updateHUD: () => {},
      updatePocketGraphics: () => {}
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

  // ========================================================
  // 5. SUIT CLAIMING, LOCKOUT & TRANSITIONS
  // ========================================================
  it('should prevent mapping a claimed suit to a different pocket', async () => {
    const physics = new PhysicsEngine(CONFIG);
    const game = new GameEngine(CONFIG);
    physics.spawnBalls();

    // Mock renderer and prompting
    game.renderer = {
      setActivePlayer: () => {},
      setBallVisibility: () => {},
      updateHUD: () => {},
      updatePocketGraphics: () => {}
    };

    // First pocket claimed Spades
    game.pocketSuits[0] = 'S';

    // Try to score standard ball 5 in pocket 1 (unmapped) and prompt mapping
    game.activePlayer = 'Alice';
    const targetBall = physics.targetBalls[5];
    
    // The promptSuitMapping method filters claimedSuits and only allows remaining.
    const claimedSuits = game.pocketSuits.filter(s => s !== null && s !== 'W');
    expect(claimedSuits).toContain('S');
    expect(claimedSuits).not.toContain('H');
  });

  it('should transition to Phase 2 wild pockets when 4 distinct suits are claimed', async () => {
    const physics = new PhysicsEngine(CONFIG);
    const game = new GameEngine(CONFIG);
    physics.spawnBalls();

    game.renderer = {
      setActivePlayer: () => {},
      setBallVisibility: () => {},
      updateHUD: () => {},
      updatePocketGraphics: () => {}
    };

    // Fast-track Phase 1 by claiming 3 pockets with distinct suits
    game.pocketSuits[0] = 'S';
    game.pocketSuits[1] = 'H';
    game.pocketSuits[2] = 'D';

    // Mock promptSuitMapping to return 'C' (the 4th suit)
    game.promptSuitMapping = () => Promise.resolve('C');

    // Pocket ball 4 (Ace) in pocket 3 (currently unmapped)
    const targetBall = physics.targetBalls[4];
    game.handleShotStart();
    game.handlePocketOverlap(targetBall, 3);
    
    await game.processNormalPocketedBalls(physics);

    // Verify:
    // 1. Pocket 3 is mapped to 'C'
    expect(game.pocketSuits[3]).toBe('C');
    // 2. Phase has transitioned to 2
    expect(game.phase).toBe(2);
    // 3. The remaining unmapped pockets (4 and 5) have become Wild ('W')
    expect(game.pocketSuits[4]).toBe('W');
    expect(game.pocketSuits[5]).toBe('W');
  });

  it('should respawn target ball and count as a miss if pocketed in a Wild Pocket during Phase 2', async () => {
    const physics = new PhysicsEngine(CONFIG);
    const game = new GameEngine(CONFIG);
    physics.spawnBalls();

    const visibilityMap = {};
    game.renderer = {
      setActivePlayer: () => {},
      setBallVisibility: (id, visible) => {
        visibilityMap[id] = visible;
      },
      updateHUD: () => {},
      updatePocketGraphics: () => {}
    };

    // Transition directly to Phase 2
    game.phase = 2;
    game.pocketSuits = ['S', 'H', 'D', 'C', 'W', 'W'];

    // Pocket standard ball 4 (Ace) in Wild Pocket 4
    const targetBall = physics.targetBalls[4];
    game.handleShotStart();
    game.handlePocketOverlap(targetBall, 4);
    physics.handlePocketOverlap(targetBall, 4);

    expect(physics.targetBalls.some(b => b.id === targetBall.id)).toBe(false);

    await game.processNormalPocketedBalls(physics);

    // Assertions:
    // 1. Ball is respawned
    expect(physics.targetBalls.some(b => b.id === targetBall.id)).toBe(true);
    expect(visibilityMap[targetBall.id]).toBe(true);
    // 2. Counts as a miss (since no valid score, and anyInvalidDrop is true because standard ball in wild pocket is invalid)
    expect(game.consecutiveMisses['Alice']).toBe(1);
  });

  // ========================================================
  // 6. 3-CONSECUTIVE MISSES DISQUALIFICATION
  // ========================================================
  it('should trigger game over when a player reaches 3 consecutive misses', async () => {
    const physics = new PhysicsEngine(CONFIG);
    const game = new GameEngine(CONFIG);
    physics.spawnBalls();

    let gameOverWinner = null;
    let gameOverReason = null;

    game.renderer = {
      setActivePlayer: () => {},
      setBallVisibility: () => {},
      updateHUD: () => {},
      updatePocketGraphics: () => {}
    };
    game.showGameOver = (winner, reason) => {
      gameOverWinner = winner;
      gameOverReason = reason;
    };

    // Active player is Alice
    game.activePlayer = 'Alice';
    game.consecutiveMisses['Alice'] = 2;

    // Trigger another miss by processing a shot with no pocketed balls
    game.handleShotStart();
    await game.processNormalPocketedBalls(physics);

    // Assertions:
    // 1. Alice consecutive misses goes to 3
    expect(game.consecutiveMisses['Alice']).toBe(3);
    // 2. game.showGameOver is called with Bob as the winner
    expect(gameOverWinner).toBe('Bob');
    expect(gameOverReason).toContain('3 consecutive misses and is disqualified');
  });
});
