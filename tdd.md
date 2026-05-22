# Technical Requirements & AI Workflow Guidelines: Poker Pool Prototype

This document establishes the structural standards, architectural guidelines, and automation rules for the **Poker Pool** prototype. It serves as a strict manual for any AI agent or developer writing and editing code, ensuring the system remains clean, easy to configure for non-coders, and safe to modify during high-velocity development cycles.

## 1\. Core Architecture Guidelines

### 1.1 Centralized Configuration Mandate

To allow team members who do not read code to easily tweak and playtest the game, **all mechanical, physical, and rules-based constants must reside in a single, dedicated configuration file** (e.g., `src/config.js` or `src/config.json`).

-   **Zero Magic Numbers:** No pixel dimensions, speed limits, friction coefficients, colors, or turn limits are allowed to be hardcoded in the game loop, physics engine, or rendering files.
-   **Self-Documenting Comments:** Every key in the configuration file must be accompanied by a natural-language comment explaining exactly what gameplay parameter it alters and its recommended scale.

### 1.2 Configuration Categories

The configuration file must explicitly isolate the following adjustment domains:

-   **Physics Engine:** Frictional damping, rail/cushion bounce coefficient (restitution), ball density, maximum cue stroke force, and velocity speed clamps.
-   **Rules & Pacing:** Maximum consecutive turn misses permitted before DQ, turn countdowns after a player stands, maximum card hand capacity, and minimum cushion contact counts for a legal break.
-   **AI Simulation Strategy:** Shot precision multipliers, risk-appetite weightings (e.g., chasing straights/flushes vs. safe pairs), and defensive shot priorities.
-   **Game Juice & HUD Visuals:** Screenshake force multipliers on collisions, ball respawn animation timings, aiming-assist laser length, and diagnostic state glow-colors (valid, invalid, wild, and unclaimed pockets).

### 1.3 Strategic Modularity

To prevent the application from breaking when components are regenerated or refactored, the codebase must enforce three distinct logic tiers:

-   **Physics Simulator (Matter.js):** Handles strict rigid-body coordinates, collision events, and physical momentum. It must have zero knowledge of card hands, player turns, or score conditions.
-   **Render Layer (Pixi.js/Canvas):** Translates the coordinate data from the physics simulator into visible entities. It handles animations, HUD elements, and particle effects.
-   **Rules & State Engine:** Evaluates active hands (using a poker evaluation library), tracks current turn state, manages consecutive miss tallies, and handles pocket assignment state machines. It is driven by collision events emitted by the physics layer but remains physically disconnected from it.

## 2\. AI Execution & Environment Control

When an AI developer or agent is acting upon the workspace, it is required to execute the following version-control and workspace management commands automatically.

### 2.1 Git Operations & Version Tracking

-   **Incremental Feature Snapshots:** The AI must not make massive, sweeping edits across the entire codebase. Edits must be made incrementally.
-   **Atomic Micro-Commits:** Upon successfully completing a single feature item (e.g., adding the pocket suit-selection modal), the AI must automatically execute a localized compiler check and perform a Git commit before starting the next task.
-   **Standardized Commits:** All automatic commits must follow standard conventions (e.g., `feat:`, `fix:`, `chore:`, `test:`) describing the change precisely in a natural-language title.

### 2.2 Localhost Orchestration & Validation

-   **Automated Workspace Diagnostics:** Prior to signaling completion of a task, the AI must automatically verify that the local development server (e.g., Vite, Webpack) is running. If offline, it must trigger the start command.
-   **Health and Compilation Checks:** The AI must run a background check to confirm the build compiles cleanly without errors before reporting success.
-   **Build Tool Sandbox Limitation:** Vite 8 + rolldown uses native Node bindings (`@rolldown/binding-linux-x64-gnu`) that fail in sandboxed CI/AI Linux environments with EPERM errors. In those environments, the dev server (`vite`) and test runner (`vitest`) cannot be executed. The user must run these locally on their own machine (Windows). The AI should not patch Vite internals to work around this — it breaks the user's local server.

### 2.3 Post-Prompt Communication Template

At the conclusion of **every single prompt response**, the AI must print a prominent status block to the terminal/chat so non-coding team members know exactly where to test:

```
======================================================================