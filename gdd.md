# Poker Pool — Prototype Game Design Document (v1.1)

This document distills the core mechanics of **Poker Pool** into an actionable, lightweight specification for a playable 1v1 local prototype. Visual polish, network code, and secondary features are omitted to focus purely on physics tuning, interaction loops, and gameplay strategy.

## 1\. Executive Setup & Table Topography

The prototype is a 1v1 local pass-and-play game played on a standard 2:1 billiards table model with 6 pockets (4 corners, 2 center side pockets).

### The Rack & Asset Allocation

-   **Cue Ball:** Solid white sphere. Controlled by user inputs. No numeric value, never registers as a card.
-   **Rank Balls (1–13):** Programmatically generated circles (using a standard color palette) overlaid with text identifiers (Ace, 2–10, Jack, Queen, King).
-   **Wildcard Balls (14–15):** Distinct metallic gold spheres stamped with a "★" symbol.
-   **The Protected Rack:** Balls are packed into a tight 15-ball triangle at the foot spot. To prevent high-value cards from scattering instantly into pockets on a lucky opening shot, the **highest-tier ranks (Ace, Jack, Queen, King)** are programmatically forced into the 4 hidden center slots of the triangle (rack indices 5, 6, 7, and 8). The remaining balls (2–10, 14, 15) are shuffled randomly around them.

### Respawn Matrix

When a ball enters an invalid pocket, scratches, or drops during the break, it immediately teleports to one of 9 pre-set coordinates on the table surface (Zebra patterns across head, center, and foot zones). If a targeted spawn spot is blocked by an active ball, the engine cycles to the next index.

## 2\. The Opening: Lag Shot & The Break

### The Simplified Lag

For the prototype, replace the physical rail-bouncing lag with a quick, automated 50/50 virtual coin toss that explicitly dictates who shoots first.

### The Break-Shot Safety Rule

The break shot allows players to scatter the pack dynamically without gaining an unfair random advantage before the strategy phase begins:

1.  The breaking player strikes the cue ball from behind the head string.
2.  **The Scatter Safety:** If any balls (1–15) are pocketed on the break shot, **they immediately respawn to random matrix spots. No cards are added to hands, and no pocket suits are claimed.**
3.  If at least one ball was pocketed on the break, the breaking player maintains their turn and takes the first true strategic shot. If no balls dropped, the turn passes cleanly to the opponent.
4.  A cue ball scratch on the break resets all pocketed balls to respawn spots, increments the breaker's miss counter, and awards the opponent **Ball in Hand** anywhere on the surface.

## 3\. Phase 1: Suit War (Pocket Mapping)

At the start of the match, all six pockets are entirely generic (gray rim rendering). The core early game revolves around map territory acquisition.

-   The first four _distinct_ pockets to successfully receive a rank ball become **Suit Pockets**.
-   The scoring player is instantly prompted with a UI overlay to map one of the four classic playing card suits (**♠, ♥, ♦, ♣**) to that pocket.
-   Once chosen, that suit is locked to that pocket for the duration of the match. A suit cannot be duplicated.
-   **Phase Transition:** As soon as all four suits are mapped to four different pockets, the remaining two unmapped pockets instantly transform into **Wild Pockets** (rendered with a gold border and a "★" icon).

## 4\. Phase 2: The Card Hand Race & Wildcards

### Turn Mechanics & Chaining

-   **The Bonus Loop:** Pocketing a ball in a valid pocket allows the player to keep shooting on the same turn. The turn only shifts to the opponent when a shot fails to score, a ball drops into an invalid pocket, or a scratch occurs.
-   **3-Miss Elimination:** To prevent intentional defensive stalling, a per-player hidden counter tracks consecutive failed turns (misses, invalid drops, or scratches). If a player hits **3 consecutive misses**, they are instantly disqualified, and the opponent wins. Any valid pocket score resets this counter to 0.

### Card Registration Matrix

When a ball drops into an active pocket, its programmatic identity is instantly evaluated:

| Ball State | Pocket Target | Action / Card Registration |
| --- | --- | --- |
| **Rank Ball (1-13)** | Unmapped Pocket (Phase 1) | Prompt player to map suit → Register Card → Respawn original ball rank. |
| **Rank Ball (1-13)** | Mapped Suit Pocket | If _neither_ player already holds this exact Rank + Suit combo → Register Card → Respawn ball rank. |
| **Rank Ball (1-13)** | Active Wild Pocket | **Invalid.** Ball immediately teleports to a respawn spot. Turn ends (counts as a miss). |
| **Wildcard Ball (14-15)** | Active Suit Pocket | **Invalid.** Ball immediately teleports to a respawn spot. Turn ends (counts as a miss). |
| **Wildcard Ball (14-15)** | Active Wild Pocket | Open rank selector UI (A–K) and suit selector → Add custom card → **Permanently remove ball from play (no respawn).** |

### Live Aiming Assist & Screen Layout (UI Guideline)

- **Canvas Scale & Aspect Ratio**: The application is built on a fixed **1024 x 576** canvas size (16:9 aspect ratio) with responsive letterboxing (black bars surrounding the canvas on non-16:9 screens) to ensure physics coordinates remain fully deterministic across all displays.
- **Table Aesthetics**: Styled as a sleek blue felt table with elegant wooden rail borders, matching `gameref.png`.
- **Advanced Raycast Aiming**: When aiming the cue stick at a target ball, the engine runs a real-time ray-cast. It projects a path from the cue ball, placing a **ghost cue ball** at the exact predicted point of contact with the target ball. No deflection lines, target deflection vectors, or pocket glow indicators are rendered — only the ghost ball and the laser origin line.
- **Precision Aim Lock-In**: Enables players to lock the aiming angle (left-click anywhere on the table for PC/Mouse, or automatically on releasing the finger/pointerup for Mobile/Touch). While locked, moving the cursor to the left power slider does not disrupt the aimed angle. Left-clicking on the table again on PC unlocks the angle. To prevent accidental unlocks, the slider's detection box is dynamically expanded horizontally (up to x = 140) and vertically (covering the entire canvas height) when aim is locked, and a left gutter safety guard ignores any off-target clicks in the left gutter (x < 112) without resetting the lock. For multi-touch safety, secondary pointer inputs are ignored while dragging.
- **Visual Locked-In Cues**: When the aim is locked, the laser guide line and ghost cue ball outline glow with a high-opacity, thick neon-cyan (`0x00e5ff`) paint, and a glowing ring is rendered around the cue ball (`radius + 4`). When unlocked, standard thin white dashed guides are drawn.
- **Pocket Rendering**: Pockets display their suit symbol and suit-color rim once claimed. No dynamic glow or color change during aiming.

### Hand Swapping (The 5-Card Cap)

A player's hand maxes out at 5 cards. If a player scores a valid 6th card, a UI overlay freezes play, displaying all 6 options. The player must choose one card to permanently discard to return their active hand to exactly 5 cards.

## 5\. The Endgame: Stand & Showdown

The match rushes to a conclusion via two distinct architectural pathways:

### Option A: The Voluntary Stand

1.  At the start of their turn (before taking a shot), a player holding 5 completed cards can click a **"Stand"** button.
2.  The standing player's turn completely freezes; they take no more actions.
3.  The opponent is immediately granted a tight **3-turn countdown window** to optimize or fill their own hand.
4.  Once the countdown hits 0, both hands are fed into the poker evaluator for the final Showdown.

### Option B: Forced Showdown

If both players happen to fill their active hands to exactly 5 cards simultaneously during normal back-and-forth play, the engine skips the Stand mechanic entirely and forces an **immediate Showdown**.

### Showdown Resolution (The tiebreaker)

Hands are evaluated using standard 5-card poker rankings (High Card up to Royal Flush) via an internal script.

-   If both players hold identical hand rankings (e.g., both have a Pair of Kings), the engine evaluates their individual kicker cards.
-   If the kickers are entirely identical, **the player who triggered the Stand mechanic (completed their hand architecture first) is awarded the win** as a reward for strategic pacing.

## 6\. Prototype Asset & Tech Mapping (Kenney Framework)

To rapidly build this prototype without creating custom art assets, the code maps directly to free, lightweight engine modules and **Kenney's All-in-1 Asset Bundle**:

-   **Engine & Physics Layer:** Matter.js for high-fidelity 2D rigid-body elastic ball-to-ball and rail collisions. Friction and angular velocity are tuned to simulate heavy pool balls.
-   **Rendering Layer:** Pixi.js for fast WebGL rendering. Balls are drawn as programmatic circles using hues from Kenney's _Board Game Pack_, with text strings rendered directly on top.
-   **Card UI Overlays:** Kenney's _Playing Cards Pack_ sprites are mapped to HTML/CSS DOM elements floating directly over the canvas web page for high-readability hand views.
-   **Icons & Markers:** Suit icons (♠♥♦♣) and selection indicators map directly to assets in Kenney's _Board Game Icons_ pack.
-   **Audio Engine:** Howler.js managing spatial sound triggers. Hard/soft collisions pull from Kenney's _Impact Sounds_, while menu, suit selection, and victory jingles pull directly from Kenney's _UI Audio_ and _Music Jingles_ sets.

---

## 7. Milestone 1 Physical Engine Implementations & Discoveries

During the initial deployment of the physics engine and aiming controls, several concrete layout configurations and technical workarounds were established:

### Screen & Table Coordinate System
- **Viewport Layout**: Fixed at exactly `1024 x 576` pixels (16:9 aspect ratio) with CSS letterboxing.
- **Top HUD Area**: The top `136px` of the canvas is reserved for game scoring and hands, meaning the table is centered vertically in the remaining space: X centered at `512` and Y centered at `336`.
- **Felt Bounds**: The `800 x 400` felt play area lies between X: `112` to `912` and Y: `136` to `536`.
- **Static Cushion Rails**: Four static rectangular Matter.js bodies of `30px` width surround the play area, explicitly set with `0.80` bounciness post-construction.
- **Sensory Pockets**: Six circles of radius `25px` placed at the exact pocketing junctions: Top Left `(112, 136)`, Top Right `(912, 136)`, Bottom Left `(112, 536)`, Bottom Right `(912, 536)`, Side Top `(512, 131)`, and Side Bottom `(512, 541)`. Set as `isSensor: true` so they trigger collision callbacks without physical obstruction.

### Matter.js Static Body Restitution Resolution
In Matter.js, specifying bounciness (`restitution`) in options during static body creation (`isStatic: true`) resets it to `0` internally. To override this, the engine must set the restitution value post-construction via `Matter.Body.set(body, { restitution })` for each rail cushion. This maintains an elastic physical response.

### Physics-Safe Variable Naming
To respect architectural boundaries where physics must remain ignorant of card hands, scoring rules, or players, loop iterators handling Matter.js collision arrays (`event.pairs`) are named `collisionPair` instead of the card termin