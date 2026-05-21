# Developer Log: Poker Pool Prototype

This log tracks all architectural decisions, design choices, physical coordinates, and debug resolutions throughout the development of the Poker Pool prototype.

---

## Initial Setup & Alignment (2026-05-21)

### Key Decisions
1. **Vite Framework**: Initialized Vite + Vanilla JS to provide a high-velocity development loop.
2. **Fixed Dimension & Aspect-Ratio Scaling**:
   - **Resolution**: Selected a fixed canvas dimension of `1024 x 576` (16:9 ratio).
   - **Scaling**: Standard CSS-based containment layout (`aspect-ratio: 16/9; max-width: 100%; max-height: 100%`) with black margins (letterboxing) ensures that coordinates remain fully deterministic in the physics calculations regardless of user viewport dimensions.
3. **Table & HUD Space Layout**:
   - **HUD Height**: Allocated `136px` at the top of the canvas for the score, hands, and profile visual panels, matching the general spacing in `gameref.png`.
   - **Table Center**: Centered the `800 x 400` table play area vertically in the remaining space: X centered at `512`, Y centered at `336` (bounds: Y from `136` to `536`, X from `112` to `912`).
4. **Interactive Deflection Laser**:
   - Built a high-fidelity aiming guide where the player drags behind the cue ball to charge shots.
   - Using Matter.js raycasting, the trajectory hits target balls, draws a **ghost cue ball** at the contact point, and calculates the resulting **deflection vectors** (target ball moves along the center-to-center normal vector, and the cue ball deflects perpendicular to it).

### Physics Calibration
- Ball radius: `15` px.
- Pocket radius: `25` px.
- Rails/Cushions: `30` px wide static rect bodies.
- Ball density: `0.0016` (simulates heavy billiard balls).
- Ball restitution: `0.95` (insures highly elastic ball-to-ball collisions).
- Cushion restitution: `0.80` (absorbs slightly more momentum, realistic bounce).

---

## Milestone 1 Core Physics & Aiming Sandbox Complete (2026-05-21)

### Key Decisions
1. **Dynamic Parameter Alignment**: Expanded `src/config.js` to expose exact names and aliases (`cushionRestitution`, `ballRestitution`, `ballDensity`, `maxBallSpeed`, `tableFriction`, `timeScale`) with full JSDoc comments to accommodate TDD validation and user-driven balance adjustments.
2. **Strict Architecture Verification**: Ensured complete isolation of the physics module (`src/physics.js`) from rule-centric terms. The decoupled check ensures no scoring, game, card, or turn-based domain vocabulary is present.

### Major Bugs & Lessons Learned

#### 1. Matter.js Static Body Restitution Override
- **Symptom**: Cushions built with `{ isStatic: true, restitution: 0.8 }` inside `Bodies.rectangle` options reported a bounciness (`restitution`) of `0` in physics tests.
- **Cause**: Matter.js automatically overrides or zeroes out restitution internally when a body is constructed with `isStatic: true` in the initial options.
- **Resolution**: Implemented post-construction property application. By calling `Matter.Body.set(cushion, { restitution: railRestitution })` after body initialization, we bypass the creation-time zeroing and preserve the high-fidelity elastic properties.

#### 2. Decohesion / Modular Decoupling Keyword Collisions
- **Symptom**: The isolation unit test checking for decoupled game rules failed by reporting a banned keyword match for `pair` in `src/physics.js`.
- **Cause**: The physics code used standard Matter.js loop syntax: `event.pairs.forEach((pair) => { ... })`. The variable name `pair` conflicted with the card-pair domain concept banned from the engine.
- **Resolution**: Renamed the local variables to `collisionPair` to avoid regex boundary collisions, satisfying both the strict decoupler and internal clarity.

#### 3. Asynchronous Unit Test Promise Leaking
- **Symptom**: The ball-to-ball rebound collision test ran synchronously but threw an "Unhandled Rejection" error in Vitest.
- **Cause**: The test used `.then()` to handle the dynamic import of `matter-js`, executing assertions asynchronously after Vitest had already marked the test as successful.
- **Resolution**: Converted the test block to `async/await`, resolving and awaiting the import synchronously inside the test runner and adjusting speed comparison precision to account for Matter.js tick intervals.

---

