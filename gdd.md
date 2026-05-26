# Poker Pool — Prototype Game Design Document (v1.3)

This document distills the core mechanics of **Poker Pool** into an actionable, lightweight specification for the playable 1v1 local prototype. Visual polish, network code, and secondary features are omitted to focus purely on physics tuning, interaction loops, and gameplay strategy.

> **v1.3 Change Summary (vs v1.2):** Removed unimplemented "3-Miss Elimination" rule. Corrected endgame flow: "Stand" button → "Request End Game" dialog; "3-turn countdown" → opponent gets one final turn. Corrected hand card dialog: appears on every card addition, not only overflow. Clarified invalid-pocket turn-end language (no miss counter). Fixed Cheat Mode player scope. Added missing Shot Validity Rule. Expanded break legality conditions.

---

## 1. Executive Setup & Table Topography

The prototype is a 1v1 local **pass-and-play** game played on a standard 2:1 billiards table model with 6 pockets (4 corners, 2 center side pockets).

### Player Names
Both player names are entered on the start screen before the game begins. Placeholder defaults are "Player 1" and "Player 2". Names propagate consistently throughout the HUD, match-over dialog, and all toast messages.

### The Rack & Asset Allocation

- **Cue Ball:** Solid white sphere. Controlled by user inputs. No numeric value, never registers as a card.
- **Rank Balls (1–13):** Programmatically generated circles (using a standard color palette) overlaid with text identifiers (Ace, 2–10, Jack, Queen, King).
- **Wildcard Balls (14–15):** Distinct metallic gold spheres stamped with a "★" symbol.
- **The Protected Rack:** Balls are packed into a tight 15-ball triangle at the foot spot. To prevent high-value cards from scattering instantly into pockets on a lucky opening shot, the **highest-tier ranks (Ace, Jack, Queen, King)** are programmatically forced into the 4 hidden center slots of the triangle (rack indices 5, 6, 7, and 8). The remaining balls (2–10, 14, 15) are shuffled randomly around them.

### Respawn Matrix

When a ball enters an invalid pocket, scratches, or drops during the break, it immediately teleports to one of 9 pre-set coordinates on the table surface (three rows across head, center, and foot zones). If a targeted spawn spot is blocked by an active ball, the engine cycles to the next index.

---

## 2. The Opening: Coin Toss & The Break

### The Coin Toss

At match start, an animated coin toss overlay runs a 50/50 virtual flip that determines who breaks. The winner is displayed before play begins.

### Break-Shot Legality

The break shot has its own legality rules separate from normal shot validity:

1. The breaking player places the cue ball **anywhere in the kitchen** (the area to the left of the head string) and strikes.
2. A legal break requires **either**: at least one ball pocketed, **or** at least **4 cushion contacts** during the shot. If neither condition is met, it is an **illegal break**.
3. **Scatter Safety:** Any balls pocketed on the break (legal or not) **immediately respawn** to matrix spots. No cards are added to hands and no pocket suits are claimed.
4. **After a legal break with pocketed balls:** The breaking player keeps their turn and takes the first true strategic shot.
5. **After a legal break with no balls pocketed:** Turn passes cleanly to the opponent.
6. **Illegal break (too few cushions, no balls pocketed):** Ball-in-Hand is awarded to the opponent (anywhere on the table). The breaking player's turn ends.
7. **Cue ball scratch on the break:** All co-pocketed balls respawn, Ball-in-Hand is awarded to the opponent anywhere on the table.

---

## 3. Phase 1: Suit War (Pocket Mapping)

At the start of the match, all six pockets are entirely generic (gray rim rendering). The core early game revolves around map territory acquisition.

- The first four *distinct* pockets to successfully receive a rank ball become **Suit Pockets**.
- The scoring player is instantly prompted with a UI overlay to map one of the four classic playing card suits (**♠, ♥, ♦, ♣**) to that pocket.
- Once chosen, that suit is locked to that pocket for the duration of the match. A suit cannot be duplicated.
- **Phase Transition:** As soon as all four suits are mapped to four different pockets, the remaining two unmapped pockets instantly transform into **Wild Pockets** (rendered with a gold border and a "★" icon).

---

## 4. Phase 2: The Card Hand Race & Wildcards

### Turn Mechanics & Chaining

- **The Bonus Loop:** Pocketing a ball in a valid pocket allows the player to keep shooting on the same turn. The turn only shifts to the opponent when a shot fails to score, a ball drops into an invalid pocket, or a scratch/foul occurs.

### Shot Validity Rule

Every shot (outside of the break) must satisfy both conditions to be valid:

1. **First contact:** The cue ball must strike at least one object ball.
2. **After contact:** At least one ball must either reach a cushion **or** be pocketed.

If a shot fails either condition, it is an **invalid shot**: the turn ends and Ball-in-Hand is awarded to the opponent.

### Card Registration Matrix

When a ball drops into an active pocket, its programmatic identity is instantly evaluated:

| Ball State | Pocket Target | Action |
|---|---|---|
| **Rank Ball (1–13)** | Unmapped Pocket (Phase 1) | Prompt player to map suit → Register card in hand → Ball respawns to matrix. |
| **Rank Ball (1–13)** | Mapped Suit Pocket | If *neither* player already holds this exact Rank + Suit combo → Register card → Ball respawns. |
| **Rank Ball (1–13)** | Active Wild Pocket | **Invalid drop.** Ball respawns immediately. Turn ends. |
| **Wildcard Ball (14–15)** | Active Suit Pocket | **Invalid drop.** Ball respawns immediately. Turn ends. |
| **Wildcard Ball (14–15)** | Active Wild Pocket | Open rank selector UI (A–K) and suit selector → Add custom card to hand → Ball is **permanently removed** from play (no respawn). |

> **Note:** "Turn ends" for invalid drops means the active player's turn passes to the opponent. There is no cumulative miss penalty counter.

### The Card Hand Dialog

Every time a player earns a valid card, a **hand dialog** pauses play and shows the player their current hand plus the new card. The player must take an action before shooting resumes:

- **Keep** (available when hand has fewer than 5 cards): Adds the new card to the hand. No cost.
- **Discard (Free)** (available only when the new card would make 6 cards — overflow): The player must select one of the 6 cards to permanently discard, bringing the hand back to 5.

> There is no discard-token mechanic in the current prototype — discarding is only available for free during overflow situations.

### Duplicate Card Prevention

No card (rank + suit combination) may exist in both players' hands simultaneously. The duplicate check is enforced globally across **both** hands for all card-earning paths (suit mapping, mapped pocket, wildcard selection).

---

## 5. Live Aiming Assist & Screen Layout

- **Canvas Scale & Aspect Ratio**: Fixed **1024 × 576** canvas (16:9) with responsive CSS letterboxing. Physics coordinates are fully deterministic across all displays.
- **Table Aesthetics**: Sleek dark-blue felt table with wooden rail borders.
- **Raycast Aiming**: Real-time ray-cast projects a path from the cue ball, placing a **ghost cue ball outline** at the exact predicted contact point with the target ball. No deflection lines, pocket glow indicators, or target-ball deflection vectors are rendered.
- **Aim Lock-In**: Left-clicking anywhere on the table locks the aiming angle. The power slider expands its hit zone when aim is locked to prevent accidental angle changes. Left-clicking again unlocks. On touch devices, releasing the pointer auto-locks.
- **Visual Locked-In Cues**: Locked aim → thick neon-cyan laser line and ghost ball outline; glowing ring around the cue ball. Unlocked → standard thin white dashed guides.
- **Pocket Rendering**: Pockets show their suit symbol and suit-color rim once claimed. No glow changes during aiming.
- **Spin / English Selector**: A circular UI in the lower-left lets players set side spin (left/right English) and topspin/backspin on the cue ball before each shot.
- **Power Slider**: Vertical slider on the left edge of the canvas. Drag down to increase shot power. Released automatically fires the shot.

---

## 6. The Endgame: Request End Game & Showdown

### Reaching a Complete Hand

The first time a player's hand reaches exactly 5 cards, a **Hand Complete dialog** appears showing:
- Their full 5-card hand and its evaluated poker rank (e.g. "Pair", "Flush")
- Two buttons: **⚔ Request End Game** or **🎱 Continue Playing**

On any subsequent turn where they still hold 5 cards, a compact **prompt** appears at the top of the screen before they shoot, offering the same choice.

**If the player chooses "Continue Playing":** They keep shooting freely. They can still replace cards via the hand dialog whenever they pocket new balls (by discarding during overflow).

### Requesting End Game

When a player clicks **"Request End Game":**

1. Their opponent is immediately granted **one final turn**.
2. During that final turn, the opponent can keep shooting as long as they pocket valid balls (bonus shots apply normally). Their turn ends the moment they miss, scratch, or commit a foul.
3. The instant their final turn ends → **Showdown**.

If the opponent also holds 5 cards and the Hand Complete dialog is showing when End Game is requested, they see an **"⚔ Go to Showdown"** button to acknowledge and immediately trigger Showdown.

### Forced Showdown

If both players hold exactly 5 cards simultaneously (both locked), the engine triggers an **immediate Showdown** without either player needing to request it.

### Showdown Resolution

Hands are evaluated using standard 5-card poker rankings (High Card up to Royal Flush).

- If both players hold identical hand rankings (e.g., both have a Pair), kicker cards are compared.
- If kickers are entirely identical, **the player who first reached 5 cards is awarded the win** as a reward for strategic pacing.

---

## 7. Cheat Mode

A developer/testing utility accessible during active gameplay via the right side panel.

- **Activation:** Click the **CHEAT** toggle pill in the right panel. Click again to turn it off.
- **What it enables:** While cheat mode is ON, the active player (either player) can manually simulate any ball being pocketed into any pocket without physically shooting. Click a ball to select it (a ring appears), then click a pocket. A **"FINISH ⚡"** button appears to execute the simulated pocket event.
- **Rules still apply:** Cheat shots go through the same game state machine — card registration, suit assignment, turn logic, duplicate prevention, etc. all run normally.
- **Purpose:** Rapid playtesting of edge cases — hand dialogs, wildcard selectors, overflow discards, the endgame Request End Game flow — without playing through a full match.

---

## 8. Prototype Tech Stack (Actual Implementation)

| Layer | Technology | Notes |
|---|---|---|
| Physics | Matter.js | Rigid-body 2D, elastic ball collisions, cushion restitution patched post-construction |
| Rendering | Pixi.js v8 (WebGL) | Programmatic ball drawing, suit SVG icons, PixiJS Text for HUD |
| Game Logic | Vanilla JS (`game.js`) | State machine: turns, card hands, scoring, endgame |
| Poker Evaluator | Vanilla JS (`poker.js`) | 5-card hand ranking + tiebreaker chain |
| Build Tool | Vite 8 | ES modules, fast HMR dev server, `npm run build` → `dist/` |
| Test Suite | `test.html` | Browser-native, zero build step, 48 assertions across 6 suites |

> **AI opponent code** (`src/ai.js`) exists in the codebase but is **not exposed** in the current build. The start screen always starts a 2-player local pass-and-play session.

---

## 9. Physical Engine Implementation Notes

### Screen & Table Coordinate System
- **Viewport**: Fixed `1024 × 576` px (16:9) with CSS letterboxing.
- **Table center**: X = `512`, Y = `330`. Table felt area: `800 × 400` px.
- **Felt bounds**: X: `112` to `912`, Y: `130` to `530`.
- **Static Cushion Rails**: Four static rectangular Matter.js bodies (`30px` wide) surrounding the play area. Restitution set to `0.80` post-construction (Matter.js resets restitution on static bodies during creation).
- **Sensory Pockets**: Six sensor circles of radius `26px` at corners and side-center positions. `isSensor: true` — trigger collision callbacks without physical obstruction.

### Matter.js Static Body Restitution
Specifying `restitution` during static body creation is silently reset to `0` by Matter.js internally. The engine patches each rail with `Matter.Body.set(body, { restitution })` after creation to maintain elastic cushion response.

### Physics-Safe Variable Naming
Loop iterators over Matter.js collision arrays (`event.pairs`) are named `collisionPair` (not `pair`) to avoid keyword clashes with card-game terminology in any future decoupler test regexes.

---

## 10. Implemented Design Decisions (Living Record)

### 10.1 Scratch Rule
A cue ball scratch voids the **entire shot**: all co-pocketed target balls respawn, no cards are awarded, no suit mappings are made, no wildcards are consumed. The opponent receives Ball-in-Hand. This early-exit is enforced at the top of `processNormalPocketedBalls` before any card logic runs.

### 10.2 Duplicate Card Rule
No card (rank + suit) may exist in both hands simultaneously. Enforced globally across both hands for all three card-earning paths. The wildcard selector UI disables rank+suit combinations already held by either player.

### 10.3 Aiming Assist — Final Rendering Spec
Intentionally omitted: target ball deflection vector, cue ball deflection vector, dynamic pocket glow rings. Kept: ghost cue ball at contact point, dashed laser origin line, glowing ring around cue ball when aim is locked.

### 10.4 Ball-in-Hand Placement Validation
During BIH mode, the cue ball cannot be placed overlapping any other ball. The Confirm button shows "⚠ OVERLAPPING BALL" and is disabled until a legal position is chosen.

### 10.5 Shot Toast Notifications
After every shot resolution, a 3-second toast appears below the HUD. Five typed variants:
- **Score** (green): Valid card earned, bonus turn granted
- **Scratch** (red): Cue ball pocketed, balls respawned, BIH awarded
- **Miss** (grey): No valid scoring, turn passes
- **Invalid drop** (amber): Duplicate or wrong-pocket attempt, ball respawned, turn ends
- **Mixed** (purple): Valid card scored but also an invalid drop — turn ends despite scoring

### 10.6 HUD Active-Player Sweep Animation
When the active player changes, a full-width gradient bar sweeps across the HUD top area. Sweep direction encodes the player: left-to-right = P2 becoming active (purple); right-to-left = P1 (cyan). Fires only on genuine player switches, not on the initial coin-toss assignment.

### 10.7 Rules Reference Modal
A persistent `?` button in the HUD opens a full scrollable rules overlay at any time. Covers: table layout, pocket mapping, card earning, break rules, Ball-in-Hand, End Game flow, and the full poker hand ranking ladder.

### 10.8 Browser-Based Test Suite
`test.html` provides 48 automated tests across 6 suites for the poker evaluator: hand type detection, kicker comparison, Ace-low wheel detection, cross-rank disambiguation, wildcard-style combinations, and the full tiebreaker chain in `compareHands`. Open directly in any browser — no build step required.
