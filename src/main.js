import './style.css';
import { PhysicsEngine } from './physics.js';
import { CanvasRenderer } from './renderer.js';
import { AimingControls } from './controls.js';
import { CONFIG } from './config.js';
import { GameEngine } from './game.js';

/**
 * Orchestrates and coordinates the Poker Pool physics sandbox
 */
async function initSandbox() {
  const container = document.getElementById('game-container');
  if (!container) {
    console.error('Error: #game-container element not found');
    return;
  }

  // 1. Create the physics simulator
  const physics = new PhysicsEngine(CONFIG);
  physics.spawnBalls();

  // 1b. Create the central game rules orchestrator
  const game = new GameEngine(CONFIG);

  // 2. Initialize the Pixi.js Canvas Renderer
  const renderer = new CanvasRenderer(container, CONFIG);
  await renderer.init();

  // Set up pocket overlap hook to sync physics with visual views and game state rules
  physics.onPocketOverlap = (ball, pocket) => {
    const pocketId = pocket.plugin?.pocketId !== undefined ? pocket.plugin.pocketId : -1;
    game.handlePocketOverlap(ball, pocketId);
    physics.handlePocketOverlap(ball);
    if (ball.label !== 'cue_ball') {
      renderer.setBallVisibility(ball.id, false);
    }
  };

  // 3. Create the card-overlay ball visual representations
  renderer.createBallViews(physics.cueBall, physics.targetBalls);

  // 4. Attach interactive mouse/touch cue aiming controls
  const controls = new AimingControls(renderer.app.canvas, physics, CONFIG);

  // Start the match by triggering the virtual coin toss
  await game.startMatch(controls, renderer);

  let isShotActive = false;

  // 5. Core Game Loop running inside Pixi ticker (synced to display refresh rate)
  renderer.app.ticker.add((ticker) => {
    // Pixi ticker.deltaTime is a scale factor based on target 60FPS.
    // Convert it to elapsed milliseconds for the Matter.js update steps.
    const dt = ticker.deltaTime * (1000 / 60);

    // Step A: Update rigid-body simulation coordinates
    physics.update(dt);

    // Step B: Synchronize Pixi graphics to Matter.js coordinates
    renderer.syncPositions(physics.cueBall, physics.targetBalls);

    // Step C: Calculate and render the aiming laser line & ghost ball
    const aimData = controls.getAimData();
    renderer.drawAimLine(aimData);

    // Step D: Render the beautiful glassmorphic power slider on the left edge
    renderer.drawPowerSlider(controls.isDraggingSlider, controls.powerRatio);

    // Step E: Manage shot lifecycle turn-transitions and break evaluations
    const allStopped = physics.areAllBallsStopped();
    if (!isShotActive && !allStopped) {
      isShotActive = true;
      game.handleShotStart();
    } else if (isShotActive && allStopped) {
      isShotActive = false;
      game.handleShotEnd(physics);
    }
  });

  console.log('Poker Pool Sandbox Initialized successfully');
}

// Start the sandbox when the DOM is fully loaded
window.addEventListener('DOMContentLoaded', () => {
  initSandbox().catch(err => {
    console.error('Failed to initialize Poker Pool Sandbox:', err);
  });
});
