# Poker Pool — AI Player Implementation Plan

## Overview

A medium-difficulty AI player that gives a human a genuine challenge without being unbeatable.
The AI must be **fully decoupled** from game logic — it sits as a separate module that reads
game/physics state and calls the same public APIs a human player would.

---

## Architecture

```
src/
  ai.js          ← AIPlayer class (pure logic, no DOM, no Pixi)
  main.js        ← Wires AI into game loop (when activePlayer === AI_NAME)
  game.js        ← No AI-specific code; AI calls the same handleShotFired, etc.
```

**Key constraint**: The AI plays via the same `physics.applyCueStroke(vel)` the human uses.
It must also respect BIH placement, valid-shot rules, and the endgame dialog flow
(by reading `game.hands[AI_NAME]` and calling `game._endGameFirstRequester` API).

---

## Start Screen (PvP / PvAI)

Rendered entirely on the Pixi canvas (no HTML outside canvas).
Shown before `initSandbox()` runs.

### Flow

1. Title screen appears: two large buttons drawn in Pixi
   - **PLAYER VS PLAYER** → asks for 2 names
   - **PLAYER VS AI** → asks for 1 name (human); AI is always "♟ AI"
2. Name entry: rendered as a Pixi overlay that captures keyboard input via a hidden HTML `<input>` (positioned off-screen at `x: -9999`) so we don't add visible HTML
3. On confirm → `CONFIG.rules.player1Name` / `player2Name` are set, `CONFIG.rules.isAI = true/false`
4. Transition: fade-out overlay, `initSandbox()` proceeds

---

## AIPlayer Class (`src/ai.js`)

```js
export class AIPlayer {
  constructor(aiName, config, physics, game, controls) { ... }

  /** Called by main.js when it's the AI's turn and all balls are stopped */
  async takeTurn() { ... }
}
```

### `takeTurn()` Steps

1. **Check BIH** — if `controls.hasBallInHand`, place cue ball at best position first
2. **Evaluate all legal shots** — iterate every target ball + every pocket
3. **Score each candidate shot** — pick the best
4. **Apply aim error** — perturb direction by ±error angle
5. **Fire the shot** — set `controls.strokeDir`, call `controls.onShotFired()`, `physics.applyCueStroke(vel)`

---

## Shot Geometry

### Ghost Ball Method

For ball `T` at position `T.pos` and pocket `P` at `P.pos`:

```
direction = normalize(P.pos - T.pos)
ghost     = T.pos - direction × (2 × ballRadius)   // where cue ball center must be
```

The cue ball must travel from its current position to `ghost`.
Stroke direction: `normalize(ghost - cueBall.pos)`.

### Obstruction Check (Ray-Circle)

For each candidate shot, check if any other ball `O` blocks the path from cue ball to ghost:

```
// Ray from cueBall.pos toward ghost:
t = dot(O.pos - cueBall.pos, dir)     // closest point parameter
if t < 0 or t > dist(cueBall, ghost): skip
closest = cueBall.pos + dir × t
blocked = dist(closest, O.pos) < 2 × ballRadius
```

If blocked → shot is not usable (try next pocket or ball).

Also check if the ghost position itself is occupied by another ball.

---

## Shot Scoring (Card-Value Heuristic)

Each legal shot yields a card `{rank, suit}` based on the pocket's suit mapping.
Score the shot based on how much that card improves the AI's hand:

| Scenario | Score |
|----------|-------|
| Completes 5-card hand | 1000 |
| Improves to Four of a Kind | 900 |
| Improves to Full House | 800 |
| Improves to Flush/Straight | 700 |
| Improves to Three of a Kind | 500 |
| Improves to Two Pair | 400 |
| Adds Pair | 300 |
| Adds card, improves kicker | 100 |
| Duplicate / rank exhausted | -∞ (skip) |

Secondary score: geometric difficulty (shorter distance = easier):
```
geoScore = 1 / (dist(cueBall, ghost) + dist(ghost, pocket))
```

Final: `totalScore = cardScore + geoScore × 0.1`

---

## Difficulty Tuning (Medium)

```js
const MEDIUM = {
  aimErrorDegrees: 3.5,      // Random ±3.5° added to every shot
  safetyPlayChance: 0.10,    // 10% chance to play safe instead of best shot
  powerVariance: 0.08,       // ±8% power variation
  maxThinkTimeMs: 800,       // Artificial delay before shot fires
};
```

**Error injection**:
```js
const error = (Math.random() * 2 - 1) * MEDIUM.aimErrorDegrees * Math.PI / 180;
const dir = rotate(idealDir, error);
```

**Safety play**: Choose lowest-risk shot (puts a ball near a cushion, doesn't give opponent easy pocket).

---

## Endgame Handling for AI

When `game.hands[AI_NAME].length === 5` at turn start:
- AI evaluates hand strength vs. opponent's current hand (using `evaluatePokerHand`)
- If AI hand wins by rank ≥ 2 or is a lock: immediately calls Request End Game
- Otherwise: Continue Playing (try to improve via wildcard or pocket adjustment)

---

## BIH Placement

When `controls.hasBallInHand`:
1. Generate candidate positions (grid inside valid zone — kitchen for break, full table otherwise)
2. For each candidate, find the best shot from there
3. Pick candidate that maximizes shot quality
4. Call `Matter.Body.setPosition(physics.cueBall, bestPos)` + `controls.hasBallInHand = false`

---

## Main.js Wiring

```js
// After game loop declares shot over:
if (game.activePlayer === AI_NAME && !isShotActive && allStopped && !game.gameEnded) {
  setTimeout(() => ai.takeTurn(), MEDIUM.maxThinkTimeMs); // artificial think delay
}
```

The `isShotActive` flag prevents re-entry while the AI's shot is still rolling.

---

## Files to Create/Modify

| File | Change |
|------|--------|
| `src/ai.js` | **Create** — AIPlayer class |
| `src/main.js` | Wire AI turn trigger; add start-screen mode selection |
| `src/game.js` | `startMatch()` accepts `{ mode, names }` parameter |
| `src/renderer.js` | Add `drawStartScreen()` method; title + mode selection in Pixi |
| `src/config.js` | Add `rules.isAI`, `rules.aiName` |

---

## Estimated Complexity

| Component | Complexity | Notes |
|-----------|-----------|-------|
| Shot geometry (ghost ball + obstruction) | Medium | Pure math, well-defined |
| Card-value scoring | Low | Calls existing `evaluatePokerHand` |
| Start screen Pixi UI | Medium | No HTML; keyboard capture trick |
| BIH placement | Medium | Grid search |
| Endgame AI logic | Low | Simple hand comparison |
| Main.js wiring | Low | Few lines |

Total estimate: **1–2 sessions** of implementation work.
