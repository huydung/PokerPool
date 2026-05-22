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

  it('should map coordinates correctly under letterbox contain conditions', () => {
    const canvas = new MockCanvas();
    const physics = new PhysicsEngine(CONFIG);
    physics.spawnBalls();
    
    // Simulate a DOM canvas width of 2048 and height of 576 (aspect ratio 32:9 - horizontal bars on left and right)
    // The canvas config has cw = 1024, ch = 576 (ratio 16:9 = 1.7778)
    // For DOM canvas: dw = 2048, dh = 576 (ratio = 3.5556 > 1.7778)
    // scaledWidth = dh * 1.7778 = 1024
    // offsetX = (2048 - 1024) / 2 = 512
    canvas.getBoundingClientRect = () => ({
      left: 10,
      top: 20,
      width: 2048,
      height: 576
    });

    const controls = new AimingControls(canvas, physics, CONFIG);

    // If clientX is 512 + 10 (left boundary of active canvas area)
    const result1 = controls.getCanvasCoordinates(522, 20);
    expect(result1.x).toBeCloseTo(0, 5);
    expect(result1.y).toBeCloseTo(0, 5);

    // If clientX is 512 + 1024 + 10 (right boundary of active canvas area)
    const result2 = controls.getCanvasCoordinates(1546, 596);
    expect(result2.x).toBeCloseTo(1024, 5);
    expect(result2.y).toBeCloseTo(576, 5);
  });

  it('should ignore secondary pointerdown events during active slider dragging (multi-touch safety)', () => {
    const canvas = new MockCanvas();
    const physics = new PhysicsEngine(CONFIG);
    physics.spawnBalls();

    const controls = new AimingControls(canvas, physics, CONFIG);
    physics.areAllBallsStopped = () => true;

    // First touch down on slider
    canvas.dispatchEvent('pointerdown', {
      clientX: 30,
      clientY: 200,
      pointerType: 'touch',
      pointerId: 1
    });

    expect(controls.isDraggingSlider).toBe(true);
    expect(controls.activePointerId).toBe(1);

    // Try a second touch down on the table with a different pointer ID
    canvas.dispatchEvent('pointerdown', {
      clientX: 500,
      clientY: 300,
      pointerType: 'touch',
      pointerId: 2
    });

    // Should NOT reset isDraggingSlider and activePointerId should remain 1
    expect(controls.isDraggingSlider).toBe(true);
    expect(controls.activePointerId).toBe(1);
  });

  it('should expand the slider interaction zone when the aim is locked', () => {
    const canvas = new MockCanvas();
    const physics = new PhysicsEngine(CONFIG);
    physics.spawnBalls();

    const controls = new AimingControls(canvas, physics, CONFIG);
    
    // When aim is unlocked (isLocked = false), coordinate x = 120 is OUTSIDE the slider
    expect(controls.isLocked).toBe(false);
    expect(controls.isInsideSlider(120, 200)).toBe(false);

    // Lock the aim
    controls.isLocked = true;

    // When aim is locked (isLocked = true), coordinate x = 120 is INSIDE the expanded slider zone
    expect(controls.isInsideSlider(120, 200)).toBe(true);

    // And verify the vertically unlimited Y-axis extension when locked (e.g. y = 50 is far above y = 138)
    expect(controls.isInsideSlider(120, 50)).toBe(true);
  });

  it('should not reset the aiming lock when clicking in the left gutter (gutter safety guard)', () => {
    const canvas = new MockCanvas();
    const physics = new PhysicsEngine(CONFIG);
    physics.spawnBalls();

    const controls = new AimingControls(canvas, physics, CONFIG);
    physics.areAllBallsStopped = () => true;

    // Set lock
    controls.isLocked = true;

    // Force isInsideSlider to return false to test the safety guard
    controls.isInsideSlider = () => false;

    canvas.dispatchEvent('pointerdown', {
      clientX: 110,
      clientY: 50,
      pointerType: 'mouse'
    });

    // The lock should STILL be true (not toggled to false by Case B)
    expect(controls.isLocked).toBe(true);
  });
});
