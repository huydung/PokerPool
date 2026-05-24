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

  // Shared pocket-overlap executor — used by normal physics events AND cheat shots.
  // Returns true when the event was accepted (shot in progress), false for phantom events.
  // Phantom events (ball crept in after shot ended) are respawned immediately so the
  // ball stays in play rather than silently disappearing.
  const executePocketOverlap = (ball, pocketId) => {
    const accepted = game.handlePocketOverlap(ball, pocketId);
    if (!accepted && ball.label !== 'cue_ball') {
      // Phantom pocket: ball was still creeping after the shot window closed.
      // Respawn it to the nearest free spot so it stays on the table.
      console.log(`[MAIN] Phantom pocket for ball ${ball.plugin?.ballId} — respawning instead of removing`);
      physics.respawnBall(ball);
      renderer.setBallVisibility(ball.id, true);
      return;
    }
    physics.handlePocketOverlap(ball);
    if (ball.label !== 'cue_ball') {
      renderer.setBallVisibility(ball.id, false);
    }
  };

  // Set up pocket overlap hook to sync physics with visual views and game state rules
  physics.onPocketOverlap = (ball, pocket) => {
    const pocketId = pocket.plugin?.pocketId !== undefined ? pocket.plugin.pocketId : -1;
    executePocketOverlap(ball, pocketId);
  };

  // 3. Create the card-overlay ball visual representations
  renderer.createBallViews(physics.cueBall, physics.targetBalls);

  // 4. Attach interactive mouse/touch cue aiming controls
  // Pass renderer so AimingControls can show Pixi-native UI (BIH confirm button)
  const controls = new AimingControls(renderer.app.canvas, physics, CONFIG, renderer);

  // Wire controls back into physics so physics.update() can check BIH state
  physics.controls = controls;

  // Wire shot-fired callback: handleShotStart clears per-shot registers BEFORE
  // applyCueStroke so no pocket event from the first physics frame is lost.
  controls.onShotFired = () => game.handleShotStart();

  // ── Cheat mode wiring ────────────────────────────────────────────────────
  // Give controls access to pocket bodies for cheat click hit-testing
  controls.physicsPockets = physics.pockets;

  // Cheat ball/pocket click callbacks → game state
  controls.onCheatBallClick   = (ball)     => game.handleCheatBallClick(ball);
  controls.onCheatPocketClick = (pocketId) => game.handleCheatPocketClick(pocketId);

  // Renderer cheat toggle → game + controls
  renderer.onCheatToggle = (enabled) => game.setCheatEnabled(enabled, physics);

  // Renderer Finish Shot button → execute the cheat shot
  renderer.onCheatFinishShot = () => game.executeCheatShot(physics, executePocketOverlap);

  // Right panel clicks are dispatched directly from controls.js via
  // renderer.handleRightPanelClick(x, y) — no extra listener needed here.

  // Start the match by triggering the virtual coin toss
  await game.startMatch(controls, renderer);

  // After coin toss: breaking player places cue ball anywhere in the kitchen
  controls.isBreakPlacement = true;
  controls.hasBallInHand = true;

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

    // Step B2: Keep cheat-mode selection rings in sync with ball positions
    renderer.syncCheatOverlays();

    // Step C: Calculate and render the aiming laser line & ghost ball
    const aimData = controls.getAimData();
    renderer.drawAimLine(aimData);

    // Step D: Render the power indicator slider (driven by slider drag)
    renderer.drawPowerSlider(controls.isDraggingSlider, controls.powerRatio);

    // Step E: Manage shot lifecycle turn-transitions and break evaluations
    const allStopped = physics.areAllBallsStopped();
    if (!isShotActive && !allStopped) {
      // Shot is now in flight — handleShotStart() was already called at fire-time
      // via controls.onShotFired to avoid the timing race where a fast pocket in
      // this first physics frame would be recorded and then immediately erased.
      isShotActive = true;
    } else if (isShotActive && allStopped) {
      isShotActive = false;
      // Auto-aim toward the ball with the clearest path to a pocket after every shot
      controls.aimAtBestShot();
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
