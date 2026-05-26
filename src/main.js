import './style.css';
import { PhysicsEngine } from './physics.js';
import { CanvasRenderer } from './renderer.js';
import { AimingControls } from './controls.js';
import { CONFIG } from './config.js';
import { GameEngine } from './game.js';
import { AIPlayer } from './ai.js';

// ── Pool-themed AI name pool ──────────────────────────────────────────────────
const AI_NAMES = [
  'The Shark', 'Lucky Louie', 'Slick Rick', 'Diamond Dan',
  'Eight-Ball Edna', "Rack 'em Rosa", 'Hustler Hank', 'Pocket Pete',
  'The Surgeon', 'Cue-Ball Carl', 'Bandit Billy', 'Silky Sam',
  'Ace McCoy', 'The Viper', 'Steady Eddie', 'Checkered Charlie',
];

/**
 * Shows the start screen inside #game-container and returns a promise that
 * resolves with { mode, p1Name, p2Name } (always 2-player mode).
 *
 * @param {HTMLElement} container
 * @returns {Promise<{mode: '2p', p1Name: string, p2Name: string}>}
 */
function showStartScreen(container) {
  return new Promise((resolve) => {
    console.log('[MAIN] Showing start screen');

    const inputStyle = `
      width: 100%; padding: 10px 12px; border-radius: 8px;
      border: 1px solid #3a5a3a; background: #0e1e0e;
      color: #9fff9f; font-size: 15px; outline: none;
      box-sizing: border-box;
    `;
    const labelStyle = `
      display: block; text-align: left; margin-bottom: 5px;
      color: #5a9a5a; font-size: 12px; letter-spacing: 1px; text-transform: uppercase;
    `;

    // ── Build overlay ────────────────────────────────────────────────────────
    const overlay = document.createElement('div');
    overlay.id = 'start-screen-overlay';
    overlay.style.cssText = `
      position: absolute; inset: 0; z-index: 9000;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      background: radial-gradient(ellipse at center, #1a3a1a 0%, #0a1a0a 70%, #050d05 100%);
      font-family: 'Segoe UI', sans-serif;
    `;

    overlay.innerHTML = `
      <div id="ss-panel" style="
        background: linear-gradient(160deg, #1e2e1e 0%, #141e14 100%);
        border: 2px solid #3a5a3a;
        border-radius: 16px;
        box-shadow: 0 0 40px rgba(0,255,80,0.15), inset 0 1px 0 rgba(255,255,255,0.05);
        padding: 36px 40px 32px;
        min-width: 340px;
        max-width: 420px;
        text-align: center;
      ">
        <div style="font-size: 48px; margin-bottom: 8px;">🎱</div>
        <h1 style="
          color: #7fff7f; font-size: 26px; margin: 0 0 4px;
          text-shadow: 0 0 12px rgba(127,255,127,0.6);
          letter-spacing: 2px; text-transform: uppercase;
        ">Poker Pool</h1>
        <p style="color: #5a8a5a; font-size: 13px; margin: 0 0 28px; letter-spacing: 1px;">
          Best poker hand wins the rack
        </p>

        <!-- Player name fields -->
        <div style="margin-bottom: 14px; text-align: left;">
          <label style="${labelStyle}">Player 1 Name</label>
          <input id="ss-p1" type="text" placeholder="Player 1" maxlength="20" style="${inputStyle}"/>
        </div>
        <div style="text-align: left;">
          <label style="${labelStyle}">Player 2 Name</label>
          <input id="ss-p2" type="text" placeholder="Player 2" maxlength="20" style="${inputStyle}"/>
        </div>

        <button id="ss-start-btn" style="
          margin-top: 20px; width: 100%; padding: 13px;
          border-radius: 10px; border: 2px solid #5aaa5a;
          background: linear-gradient(180deg, #2a5a2a 0%, #1a3a1a 100%);
          color: #9fff9f; font-size: 16px; font-weight: 700;
          cursor: pointer; letter-spacing: 1px; text-transform: uppercase;
          box-shadow: 0 0 16px rgba(90,200,90,0.25);
          transition: all 0.2s;
        ">🎱 Start Game</button>
      </div>
    `;

    container.appendChild(overlay);

    // Focus P1 input on open
    setTimeout(() => document.getElementById('ss-p1')?.focus(), 50);

    // Hover effect on start button
    const startBtn = document.getElementById('ss-start-btn');
    startBtn.addEventListener('mouseenter', () => {
      startBtn.style.background = 'linear-gradient(180deg, #3a7a3a 0%, #2a5a2a 100%)';
      startBtn.style.boxShadow = '0 0 22px rgba(90,200,90,0.45)';
    });
    startBtn.addEventListener('mouseleave', () => {
      startBtn.style.background = 'linear-gradient(180deg, #2a5a2a 0%, #1a3a1a 100%)';
      startBtn.style.boxShadow = '0 0 16px rgba(90,200,90,0.25)';
    });

    // ── Start game ───────────────────────────────────────────────────────────
    const doStart = () => {
      const p1Name = (document.getElementById('ss-p1')?.value.trim()) || 'Player 1';
      const p2Name = (document.getElementById('ss-p2')?.value.trim()) || 'Player 2';

      console.log(`[MAIN] Starting game — 2P | P1: "${p1Name}" | P2: "${p2Name}"`);

      overlay.style.transition = 'opacity 0.4s ease';
      overlay.style.opacity = '0';
      setTimeout(() => {
        overlay.remove();
        resolve({ mode: '2p', p1Name, p2Name });
      }, 420);
    };

    startBtn.addEventListener('click', doStart);

    // Enter key starts the game
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doStart();
    });
  });
}

/**
 * Orchestrates and coordinates the Poker Pool physics sandbox.
 */
async function initSandbox() {
  const container = document.getElementById('game-container');
  if (!container) {
    console.error('Error: #game-container element not found');
    return;
  }

  // ── 0. Show mode/name selection start screen ──────────────────────────────
  const { mode, p1Name, p2Name } = await showStartScreen(container);

  const isAIMode = mode === 'ai';
  console.log(`[MAIN] Mode: ${isAIMode ? 'Player vs AI' : 'Player vs Player'} | P1: "${p1Name}" | P2: "${p2Name}"`);

  // Patch config with chosen names before any game objects read it
  CONFIG.rules.player1Name = p1Name;
  CONFIG.rules.player2Name = p2Name;

  // 1. Create the physics simulator
  const physics = new PhysicsEngine(CONFIG);
  physics.spawnBalls();

  // 1b. Create the central game rules orchestrator
  const game = new GameEngine(CONFIG);

  // 1c. Create AI player if in AI mode
  let aiPlayer = null;
  if (isAIMode) {
    // AI is always player 2 so the human gets the break
    aiPlayer = new AIPlayer(CONFIG, p2Name);
    game._aiPlayerName = aiPlayer.playerName;
    console.log(`[MAIN] AI player created: ${aiPlayer.playerName}`);
  }

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

  // ── Start the match ───────────────────────────────────────────────────────
  // In AI mode the human player (P1) always gets the break shot —
  // pass their name as forcedWinner to skip the random coin toss.
  const forcedWinner = isAIMode ? p1Name : null;
  await game.startMatch(controls, renderer, forcedWinner);

  // After coin toss: breaking player places cue ball anywhere in the kitchen
  controls.isBreakPlacement = true;
  controls.hasBallInHand = true;

  // ── AI turn trigger ───────────────────────────────────────────────────────
  // Called after handleShotEnd resolves (all dialogs dismissed, active player updated).
  // Checks if it's the AI's turn and fires a shot after a short visual pause.
  let aiTurnPending = false;

  const maybeStartAITurn = () => {
    if (!aiPlayer || game.gameEnded) return;
    if (game.activePlayer !== aiPlayer.playerName) return;
    if (aiTurnPending) return;

    aiTurnPending = true;
    console.log(`[MAIN] AI turn scheduled`);

    // Brief delay so the player can see the table state before AI shoots
    setTimeout(() => {
      aiTurnPending = false;
      if (game.activePlayer !== aiPlayer.playerName || game.gameEnded || isShotActive) return;
      aiPlayer.takeTurn(physics, game, controls).catch(e => {
        console.error('[MAIN] AI takeTurn error:', e);
      });
    }, 900);
  };

  // Note: In AI mode the human always breaks, so no need to check if AI won toss.
  // The AI's first turn will be triggered naturally after the human's break ends.

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
    // Skip aim-line rendering when it's the AI's turn (no human aiming)
    const isAITurn = aiPlayer && game.activePlayer === aiPlayer.playerName;
    const aimData = isAITurn ? null : controls.getAimData();
    renderer.drawAimLine(aimData);

    // Step D: Render the power indicator slider (driven by slider drag)
    renderer.drawPowerSlider(controls.isDraggingSlider, controls.powerRatio);

    // Step D2: Update spin/English indicator dot position
    renderer.updateSpinUI(controls.spinOffset);

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
      // handleShotEnd is async — chain the AI trigger onto its completion
      game.handleShotEnd(physics).then(() => {
        maybeStartAITurn();
      });
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
