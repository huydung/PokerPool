import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AimingControls } from '../src/controls.js';
import { PhysicsEngine } from '../src/physics.js';
import { CONFIG } from '../src/config.js';

class MockCanvas {
  constructor() {
    this.listeners = {};
  }
  addEventListener(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }
  dispatchEvent(event, data) {
    const list = this.listeners[event];
    if (list) {
      list.forEach(cb => cb(data));
    }
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 1024, height: 576 };
  }
}

describe('Poker Pool - Precision Aim Lock-In TDD Suite', () => {
  let originalWindow;
  let windowListeners;

  beforeEach(() => {
    originalWindow = global.window;
    windowListeners = {};
    global.window = {
      addEventListener: (event, callback) => {
        if (!windowListeners[event]) {
          windowListeners[event] = [];
        }
        windowListeners[event].push(callback);
      },
      dispatchEvent: (event, data) => {
        const list = windowListeners[event];
        if (list) {
          list.forEach(cb => cb(data));
        }
      }
    };
  });

  afterEach(() => {
    global.window = originalWindow;
  });

  it('should initialize with unlocked state (isLocked = false)', () => {
    const canvas = new MockCanvas();
    const physics = new PhysicsEngine(CONFIG);
    physics.spawnBalls();
    
    const controls = new AimingControls(canvas, physics, CONFIG);
    expect(controls.isLocked).toBe(false);
  });

  it('should toggle isLocked state on desktop mouse clicks', () => {
    const canvas = new MockCanvas();
    const physics = new PhysicsEngine(CONFIG);
    physics.spawnBalls();
    
    // Position cue ball near center for testing
    const cueBall = physics.cueBall;
    cueBall.position.x = 512;
    cueBall.position.y = 338;

    const controls = new AimingControls(canvas, physics, CONFIG);
    
    // Ensure all balls stopped
    physics.areAllBallsStopped = () => true;

    // Trigger pointerdown outside slider to toggle lock
    canvas.dispatchEvent('pointerdown', {
      clientX: 600,
      clientY: 400,
      pointerType: 'mouse'
    });

    expect(controls.isLocked).toBe(true);

    // Click again to unlock
    canvas.dispatchEvent('pointerdown', {
      clientX: 700,
      clientY: 300,
      pointerType: 'mouse'
    });

    expect(controls.isLocked).toBe(false);
  });

  it('should not alter strokeDir on pointermove when isLocked is true', () => {
    const canvas = new MockCanvas();
    const physics = new PhysicsEngine(CONFIG);
    physics.spawnBalls();

    const cueBall = physics.cueBall;
    cueBall.position.x = 512;
    cueBall.position.y = 338;

    const controls = new AimingControls(canvas, physics, CONFIG);
    physics.areAllBallsStopped = () => true;

    // First click locks the aim direction
    canvas.dispatchEvent('pointerdown', {
      clientX: 600,
      clientY: 400,
      pointerType: 'mouse'
    });
    
    expect(controls.isLocked).toBe(true);
    const initialStrokeDir = { ...controls.strokeDir };

    // Move mouse - direction should not change since aim is locked
    canvas.dispatchEvent('pointermove', {
      clientX: 800,
      clientY: 200,
      pointerType: 'mouse'
    });

    expect(controls.strokeDir.x).toBe(initialStrokeDir.x);
    expect(controls.strokeDir.y).toBe(initialStrokeDir.y);
  });

  it('should update strokeDir on pointermove when isLocked is false', () => {
    const canvas = new MockCanvas();
    const physics = new PhysicsEngine(CONFIG);
    physics.spawnBalls();

    const cueBall = physics.cueBall;
    cueBall.position.x = 512;
    cueBall.position.y = 338;

    const controls = new AimingControls(canvas, physics, CONFIG);
    physics.areAllBallsStopped = () => true;

    expect(controls.isLocked).toBe(false);

    // Move mouse - direction should update
    canvas.dispatchEvent('pointermove', {
      clientX: 700,
      clientY: 500,
      pointerType: 'mouse'
    });

    const updatedX = 700 - 512;
    const updatedY = 500 - 338;
    const dist = Math.sqrt(updatedX * updatedX + updatedY * updatedY);

    expect(controls.strokeDir.x).toBeCloseTo(updatedX / dist, 5);
    expect(controls.strokeDir.y).toBeCloseTo(updatedY / dist, 5);
  });

  it('should auto-lock on pointerup (touch release) for mobile devices', () => {
    const canvas = new MockCanvas();
    const physics = new PhysicsEngine(CONFIG);
    physics.spawnBalls();

    const cueBall = physics.cueBall;
    cueBall.position.x = 512;
    cueBall.position.y = 338;

    const controls = new AimingControls(canvas, physics, CONFIG);
    physics.areAllBallsStopped = () => true;

    // Touch down triggers aiming but isLocked remains false
    canvas.dispatchEvent('pointerdown', {
      clientX: 600,
      clientY: 400,
      pointerType: 'touch'
    });

    expect(controls.isAiming).toBe(true);
    expect(controls.isLocked).toBe(false);

    // Touch release on window triggers auto-lock
    global.window.dispatchEvent('pointerup', {
      pointerType: 'touch'
    });

    expect(controls.isAiming).toBe(false);
    expect(controls.isLocked).toBe(true);
  });
});
