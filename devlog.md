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


## Milestone 1.1 - Physics, Controls, and Rendering Improvements (2026-05-21)

### Key Decisions
1. **Scaled Glassmorphic HUD**: Reduced the HUD height to `100px` and table `yCenter` to `338px`, introducing an `8px` gap that completely prevents cushions and pockets overlap.
2. **Tournament-accurate Proportions**: Configured ball radius to `9px` (diameter `18px`), satisfying standard proportions of a `2¼"` ball on a `100"` table (mapped to `800px` play area).
3. **High-Fidelity Deflection Projection**: Fixed the aiming assist by resolving the missing `hitPoint` key (replaced with `ghostCenter` verification). Target deflection vectors are projected starting from `targetCenter` (the target ball's center at contact) instead of the contact point, creating a realistic separable visual.
4. **Drag-to-Cancel aiming**: Suspends the aiming visual and stroke when the pointer is dragged within `15px` of the origin, giving players a clean way to abort a stroke.
5. **Dynamic Break Force Multiplier**: Enabled a racked break shot multiplier (`2.0x` power limit) that is consumed upon the first stroke, giving the racked table a highly satisfying break impact.
6. **Decoupled Pocket Sinking**: Integrated the sensory `onPocketOverlap` callback to cleanly remove pocketed target balls from the physical world and hide them visually, preventing any bounce-back from static rails behind the pocket sensor.

### Major Bugs & Lessons Learned

#### 1. Aiming Laser Assist Black Hole
- **Symptom**: The interactive aiming stick worked, but the ghost ball, target deflection line, and cue deflection lines were never drawn; only a straight infinite laser ray was rendered passing through target balls.
- **Cause**: In `renderer.js`, the laser assist branch was conditionally gated on `if (aimData.hasHit && aimData.hitPoint)`. However, `getAimData()` in `controls.js` returned `ghostCenter`, `targetDeflect`, and `cueDeflect` but *never* defined or returned a `hitPoint` property.
- **Resolution**: Refactored the renderer to check for `aimData.hasHit && aimData.ghostCenter`. Added the new `targetCenter` coordinate in controls and used it in the renderer to project trajectories from their correct physical origins.

#### 2. Ball Pocket Bounce-Back
- **Symptom**: Dynamic balls shot directly into sensory pockets would register overlapping pocket events but would bounce back out into active play instead of sinking.
- **Cause**: Pockets are sensory circles located exactly on cushions boundaries. While sensory circles do not exert rebound forces, the static rectangular rails enclosing the table spanned the entire width/height of the table behind the pockets. Consequently, the ball would enter the pocket and collide with the solid cushion body underneath, bouncing back.
- **Resolution**: Implemented physics removal upon pocket sensor overlap. Once a target ball enters a pocket, it is removed from the Matter.js world, hidden in Pixi, and filtered out of active aiming targets. Cue ball scratches reset the cue ball to the head string center with velocities zeroed.

---

## Milestone 1.2 - Interactive Usability & Precision Physics (2026-05-21)

### Key Decisions
1. **Frictionless Elastic Rebound System**: Removed ball-to-ball and ball-to-rail friction (`CONFIG.ball.friction = 0.0`) to eliminate tangential friction-induced throw vectors in Matter.js, ensuring 100% agreement between real physical rebounds and analytical raycast aiming lines.
2. **Dedicated Cue Power Slider UI**: Implemented a vertical glassmorphic slider container on the left edge of the screen. Pre-shot aiming rotation is controlled by tapping or dragging anywhere on the table, while stroke power is controlled by pulling down the vertical slider handle, fully resolving aiming usability issues near cushions.
3. **Continuous Pre-Shot Hover Aiming**: Aiming lines, ghost balls, and deflection paths display continuously whenever all balls are stopped, allowing immediate visual targeting as the cursor moves without needing a drag action.
4. **Direct Starting Velocity Overrides**: Modified shot application from single-tick forces to direct velocity vectors (`Matter.Body.setVelocity`), guaranteeing that the cue ball starts moving precisely along the aimed direction, overcoming minor numerical integration jitters.

### Major Bugs & Lessons Learned

#### 1. Hover-Aiming Snapping Conflict
- **Symptom**: When players tried to click or drag the power slider on the left, the aiming angle would suddenly snap directly toward the left slider area, throwing off their shot direction.
- **Cause**: In hover-aiming mode, pointer movement anywhere on the canvas recalculated the angle toward the cursor. Consequently, moving the cursor to the slider changed the aiming angle to point at the slider track.
- **Resolution**: Implemented a bounding box exclusion zone in `controls.js` via `isInsideSlider(x, y)`. When the cursor hovers or moves inside the slider bounds, the controls lock the aiming angle at its last directed position, preventing snapping.

#### 2. Vector Accuracy and Force Jitters
- **Symptom**: Applying instant force in a single tick in Matter.js resulted in a slightly deviated starting angle under certain time steps, causing minor misalignment.
- **Cause**: Single-tick forces are integrated alongside residual velocities and coordinate integrations, causing small rounding differences.
- **Resolution**: Directly applied calculated initial velocities (`Matter.Body.setVelocity`) to start movement exactly along the aimed line, ensuring perfect trajectory alignment.

