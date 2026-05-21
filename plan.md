## 3\. Progressive Prototype Milestones & TDD Prompt Library

The development of the prototype is divided into five incremental milestones. Each milestone must be validated programmatically against the corresponding TDD requirements before moving forward.

### 3.1 Milestone 1: Core Physics & Interactive Aiming (Base Table Setup)

**Purpose:** Set up the rigid 2-D physics sandbox environment and responsive cue stick control loop. This establishes the physical touch and momentum scale of the game, completely isolating physics calculations from game-rules logic.

#### AI Developer Prompt

```
Role: Principal Game Systems & Physics Engineer
Context: Read and follow 'gdd.md' (Sections 1, 4, and 6) and 'tdd.md' (Sections 1.1 and 1.3).

Your objective is to implement the Core Physics & Interactive Aiming Sandbox using Matter.js and Pixi.js/HTML5 Canvas.

1. CONFIGURATION:
   - Create a centralized config file (e.g., 'src/config.js') as defined in Section 1.1 of 'tdd.md'.
   - Include customizable values for timeScale, tableFriction, railRestitution, ballRestitution, ballDensity, maxBallSpeed, and visual configurations. Add detailed JSDoc comments to every parameter.

2. PHYSICAL LAYOUT:
   - Construct a standard 2:1 billiards table layout bounded by solid Matter.js static bodies representing the cushions/rails.
   - Place 6 open sensory pockets (4 corners, 2 center side-rails). Pockets should register overlapping collision events without exerting physical rebound forces on the balls.

3. BALL ENTITIES:
   - Programmatically spawn 15 target balls and 1 white cue ball as physical Matter.js circles.
   - For rendering, programmatically overlay text characters (A, 2-10, J, Q, K, and '★' stars on balls 14-15) directly onto the circular textures so they read as cards. Keep them on separate visual Pixi.js containers.

4. CUE CONTROLS & AIM LINE:
   - Build an interactive aiming line (laser assist) originating from the cue ball, projecting outward in the opposite direction of dragging.
   - The aim line must ray-cast to show the collision point on the first targeted ball.
   - Allow setting shot power based on mouse/touch drag distance, up to the maximum shot force configured in 'src/config.js'.
   - On release, apply an impulse force to the cue ball using Matter.js.

5. TDD REQUIREMENTS & TEST CHECKLIST:
   - Write unit tests asserting that:
     * No 'magic numbers' are read outside of the configuration module.
     * Ball-to-ball collisions compute elastic rebounds using configuration density/restitution parameters.
     * Matter.js is completely modular and has zero references to player hands or card rankings.
```

### 3.2 Milestone 2: Game Initialization & Safe-Haven Break

**Purpose:** Build the deterministic protected racking formation, the automated virtual coin-toss lag system, and the break-shot logic featuring the safety respawn rule. This guarantees a balanced match start where a powerful initial scatter cannot reward lucky random drops.

#### AI Developer Prompt

```
Role: Senior Game Rules & State Machine Engineer
Context: Read and follow 'gdd.md' (Sections 1, 2, and 4) and 'tdd.md' (Section 3.1).

Your objective is to implement the Game Setup, Automated Lag, and Safe-Haven Break Mechanics.

1. AUTOMATED LAG TOSS:
   - On match initialization, bypass the physical lag with an automated, animated virtual coin toss that randomly determines who shoots first (Alice or Bob).
   - Display a highly visible visual banner indicating who won the coin toss and has the break choice.

2. THE PROTECTED RACK:
   - Implement the racking system on the foot spot.
   - Programmatically force high-value target balls (Ace, Jack, Queen, King - balls 1, 11, 12, and 13) into the center slots of the 15-ball triangle (rack indices 5, 6, 7, and 8).
   - Distribute all other balls (2-10, 14, 15) randomly in the remaining positions.

3. THE BREAK SHOT MECHANIC:
   - The breaking player must take their shot from behind the head string (the head kitchen).
   - Validate if the break is legal: at least 4 balls must contact cushions OR a ball must be pocketed.
   - SAFE-HAVEN BREAK RULE: If any ball is pocketed during this initial break shot, prevent any suit-mapping or card hand additions. Programmatically capture the pocketed balls, route them immediately to any of the 9 pre-defined respawn matrix coordinates from Section 1 of 'gdd.md' (choosing randomly from free spots), and maintain the breaking player's turn.

4. TDD REQUIREMENTS & TEST CHECKLIST:
   - Write automated unit tests verifying:
     * Racks generated always have A, J, Q, K locked in positions 5, 6, 7, 8.
     * Any ball pocketed during a break shot is immediately routed to a respawn spot, no suits are mapped, and no cards are added to hands.
     * An illegal break properly transitions turn control to the opponent with Ball-In-Hand options.
```

### 3.3 Milestone 3: Phase 1 (Suit Mapping, State Transitions & Aiming Glow)

**Purpose:** Implement pocket state mappings and interactive HUD cues. Pockets dynamically change color to guide shots based on what the player is targeting and the contents of their hand, transitioning the game state from the open suit-claiming phase into the endgame hand race.

#### AI Developer Prompt

```
Role: Senior UI/UX & Game State Engineer
Context: Read and follow 'gdd.md' (Sections 3 and 4) and 'tdd.md' (Section 3.2).

Your objective is to develop the Phase 1 Suit Mapping system, dynamic aiming assist glow indicators, and the transition to Phase 2.

1. POCKET MAPPING STATE MACHINE:
   - All pockets start unmapped (rendered with a generic gray border).
   - Implement the collision hook: when ball (1-13) falls into an unmapped pocket, pause physics and render a clean HTML overlay prompting the player to choose and map one of the remaining four suits (♠, ♥, ♦, ♣).
   - Once a suit is chosen, lock that suit permanently to that pocket. Change its rendering to include the corresponding color (red/black) and suit symbol.
   - When all four suits are claimed across four different pockets, immediately trigger the Phase 2 transition: turn the remaining two unmapped pockets into "Wild Pockets" (rendered with a gold rim and a '★' star).

2. PHASE 2 RESTRICTIONS:
   - In Phase 2, standard balls (1-13) entering a Wild Pocket must not register. They must instantly teleport to one of the 9 free respawn coordinates on the table.
   - Only Wildcard balls (14 & 15) are permitted to score inside the Wild Pockets.

3. LIVE AIMING ASSIST:
   - Create a dynamic aiming evaluation function: as the player points the cue stick at a targeted ball, calculate which pocket it is projected to enter.
   - Render a glowing ring around the target pocket in real time:
     * YELLOW: If the pocket is unclaimed (Phase 1).
     * GREEN: If pocketing the ball registers a valid new card in the active player's hand.
     * RED: If pocketing the ball is invalid (e.g. the player already holds that card rank/suit, or is shooting a standard ball into a Wild Pocket).

4. TDD REQUIREMENTS & TEST CHECKLIST:
   - Write unit tests verifying:
     * Once a suit is claimed, it cannot be mapped to any other pocket.
     * The remaining two pockets become Wild Pockets immediately upon the fourth suit mapping.
     * Standard balls (1-13) entering a Wild Pocket automatically trigger a respawn and do not register cards.
```

### 3.4 Milestone 4: Turn Loops, Card Swapping & Miss Elimination

**Purpose:** Build the core gameplay turn-cycle, including bonus shot chains, hand capacity management (swapping a 6th card), wildcard mapping, and the 3-miss automatic disqualification rule to keep the match moving forward.

#### AI Developer Prompt

```
Role: Core Systems Engineer
Context: Read and follow 'gdd.md' (Section 4) and 'tdd.md' (Sections 3.3 and 3.4).

Your objective is to build the Core Turn Cycle, Hand Swapping mechanics, Wildcard customization, and 3-Miss Elimination logic.

1. TURN CYCLE & BONUS SHOTS:
   - Implement the turn loop: pocketing any valid ball grants a bonus shot, continuing the active player's turn.
   - Turn ends and passes to the opponent if the shot misses, drops a ball into an invalid pocket (triggering a respawn), or scratches the cue ball.

2. HAND SWAPPING & WILDCARDS:
   - Create active hand arrays for each player, capped at 5 cards. Display the hands visually on screen using card sprites (e.g., Kenney Playing Cards).
   - 5-CARD SWAP DECISION: If a player with a full 5-card hand pockets another valid card, pause the turn and show a swap modal. The player must choose one of the 6 cards (their active 5 + the new card) to permanently discard before they can take a bonus shot.
   - WILDCARD REGISTRATION: When ball 14 or 15 enters a Wild Pocket, open a custom select menu enabling the player to pick any Rank (A-K) and any claimed Suit, provided the combination does not create a duplicate of an existing card in their hand. Once used, permanently delete that wildcard ball from play.

3. 3-MISS ELIMINATION:
   - Maintain a per-player consecutive miss counter. Increment by 1 on any failed shot, invalid pocket drop, or cue ball scratch.
   - Reset the counter to 0 immediately on a successful pocket that registers a card.
   - If a player's counter reaches 3, immediately terminate the match and award victory to the opponent. Render a clean, stylized game-over screen.

4. TDD REQUIREMENTS & TEST CHECKLIST:
   - Write automated unit tests verifying:
     * Pocketing a ball in an invalid pocket increments the miss counter and triggers a respawn.
     * Pockets that would result in a duplicate card are marked invalid and trigger a respawn.
     * The swap modal correctly blocks further shots and handles card discard and hand size constraints.
     * Reaching 3 consecutive misses immediately triggers an opponent win.
```

### 3.5 Milestone 5: The Endgame (Stand, Countdown & Showdown)

**Purpose:** Connect the final pieces of the prototype: implementing the voluntary "Stand" button, counting down final turns for the opponent, and executing the card hand showdown comparison with tiebreaker logic.

#### AI Developer Prompt

```
Role: Senior Gameplay Architect & Evaluator
Context: Read and follow 'gdd.md' (Section 5) and 'tdd.md' (Sections 3.5 and 3.6).

Your objective is to complete the game loop by implementing the Stand mechanics, the 3-turn countdown, and the final Showdown hand evaluations.

1. STAND MECHANIC:
   - Add a highly visible "Stand" button. It must be clickable only at the start of a turn by a player holding exactly 5 cards.
   - Upon clicking "Stand", lock and freeze that player's shooting controls.
   - Start a 3-turn countdown for the opponent. If the opponent fails to complete their hand or improve it within those 3 turns, proceed immediately to Showdown.
   - If both players happen to reach 5 cards during normal back-and-forth play without a Stand, trigger an immediate Showdown.

2. POKER EVALUATOR & SHOWDOWN:
   - Integrate a standard 5-card poker hand evaluation script (e.g., 'pokersolver' library) to calculate and display each player's active hand rank (e.g., "Pair of Kings", "Flush") under their hand in real time.
   - At Showdown, compare the two hands:
     * Standard hands are ranked from High Card up to Royal Flush.
     * Incomplete hands are evaluated as-is (e.g., a Pair beats a High Card).
     * If hand ranks match, compare individual kickers to find the winner.
     * SHOWDOWN TIEBREAKER: If the hands and kickers are completely identical, award the victory to the player who declared the "Stand" action (rewarding them for pacing and completing first).

3. TDD REQUIREMENTS & TEST CHECKLIST:
   - Write automated unit tests verifying:
     * Declaring Stand locks the shooter's cue control and starts a strict 3-turn countdown for the opponent.
     * The hand evaluator accurately identifies Straights (including Ace-low wheels), Flushes, and Full Houses.
     * Absolute ties are successfully broken in favor of the player who stood first.
```