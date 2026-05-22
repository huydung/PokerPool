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
🚀 PROTOTYPE RUNTIME STATUS
======================================================================
* CURRENT BRANCH     : [Active Git Branch Name]
* LAST EDITS MADE    : [Summary of behavioral changes made in this turn]
* LOCAL TESTING URL  : http://localhost:5173  (Or active dev port)
* CONFIG FILE TO EDIT: /src/config.js  (Modify this to tweak values)
======================================================================
```

---

## 3. Implemented Rules & Architectural Decisions (Living Record)

This section records concrete rules decisions and implementation choices that must be preserved across all future refactors.

### 3.1 Duplicate Card Prevention — Cross-Hand Scope
The `hasCard` check that gates card registration **must** check both players' hands, not just the active player's. This applies identically in three code paths inside `GameEngine.processNormalPocketedBalls()`:
1. Standard ball → unmapped pocket (Phase 1 suit assignment)
2. Standard ball → mapped suit pocket (Phase 2)
3. Wildcard ball → wild pocket (after `promptWildcardSelection`)

The `promptWildcardSelection` method's `isOccupied(rank, suit)` lambda must also include the opponent's hand so the UI disables rank+suit combos already held globally.

**Rationale:** Two players holding the same card is logically impossible in a real card game and would break poker hand evaluation integrity.

### 3.2 Scratch — Full Shot Void
A cue ball scratch voids the entire shot's pocketing events. The scratch detection early-return in `processNormalPocketedBalls` runs **before** any card-awarding, suit-mapping, or wildcard-consuming logic. All balls pocketed co-incidentally on a scratch shot respawn with no state changes.

### 3.3 Aiming Assist — Final Rendering Spec
The following elements are **intentionally omitted** from the aiming system (removed during design review):
- Target ball deflection vector line
- Cue ball deflection vector line  
- Dynamic pocket glow rings (green/yellow/red)

Keeping: ghost cue ball at contact point, dashed laser origin line, glowing ring around cue ball when aim is locked.

### 3.4 Browser-Based Poker Test Suite (`test.html`)
Due to the Vite/vitest sandbox limitation (Section 2.2), a self-contained `test.html` has been built as the primary validation tool for game logic. It imports `src/poker.js` directly as an ES module with no build step. It must be kept in sync with any changes to the poker evaluator. The 48 tests cover: hand type identification, kicker comparison, wheel (A-2-3-4-5) straights, Royal Flush detection, and the full tiebreaker chain in `compareHands`.

### 3.5 Ball-in-Hand Placement Validation
During BIH mode, `AimingControls.isValidCueBallPosition(x, y)` checks the proposed position against all target balls using a minimum clearance of `2 × ballRadius + 1px`. The confirm button (`confirmCueBallPlacement`) has a hard guard that returns early if `cueBallPositionValid === false`, preventing any workaround via keyboard or programmatic calls.

### 3.6 Git Commit Strategy in Sandbox Environments
The AI sandbox cannot delete `.git/index.lock` or `.git/HEAD.lock` (EPERM). Workaround procedure:
1. Truncate lock files to 0 bytes via Python `open(f, 'w').close()`
2. Rebuild a clean index at a temp path: `GIT_INDEX_FILE=/tmp/idx git read-tree HEAD`
3. Stage new blobs: `git hash-object -w <file>` then `GIT_INDEX_FILE=/tmp/idx git update-index --add --cacheinfo ...`
4. Write tree: `GIT_INDEX_FILE=/tmp/idx git write-tree`
5. Create commit: `git commit-tree <tree> -p <parent> -m "..."`
6. Advance ref: `echo <hash> > .git/refs/heads/master`

Never attempt `git add` or `git commit` directly in the sandbox — they will fail on the lock file.

### 3.7 Shot Feedback System
Every shot resolution must emit a toast notification (see `GameEngine.showShotToast`) with one of five typed variants. The toast must fire **after** `this.activePlayer` has already been updated to the new active player, so the message correctly names who takes next turn. Toast duration is 3000 ms with CSS-driven entrance/exit animations; any new toast immediately replaces a still-visible previous one.
