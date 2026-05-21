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
