# Using AI to Design & Prototype a Game
### Case Study: *Poker Pool* — built from scratch in one AI conversation

---

## Overview

This is a real end-to-end account of how a fully playable game was designed, specified, and built using AI tools — from zero idea to running prototype — without writing a single line of code by hand.

The result: **Poker Pool**, a physics-based card game that fuses billiards and poker. In four days, using Claude for design and Claude Code for implementation, the project produced 6,450 lines of code across 8 source files, a Matter.js physics engine, a Pixi.js renderer, a poker hand evaluator, an AI opponent, and 54 git commits.

The creator's job throughout was not programmer. It was **game director**.

---

## Phase 1 — Brainstorm Wide First, Narrow Later

The session started with no fixed idea. Instead of arriving with a spec, the first move was to dump raw material into the AI: a list of personal hobbies and constraints.

**The input:**
- Hobbies: poker, pool/billiards, piano, origami, leadership
- Constraints: must run on PC and mobile, fun with touch controls, interesting enough to demo live at a workshop

**What was asked for:** not a list of ideas, but a **comparison table** — 12+ concepts rated across innovativeness, mobile UX, AI demo value, fun factor, and development complexity.

Forcing a comparison table rather than a list makes useful tradeoffs visible immediately. Two ideas emerged as clearly worth pursuing:

- **Felt & Fate** (later renamed Poker Pool): pool table + poker hand building on the same surface
- **Bankroll Dojo**: coach a poker player's career as a management simulation

The most interesting candidates were unexpected combinations — *FoldBluff* (origami folding as poker hand management) appeared in the table and no one would have thought of it without the AI's cross-domain pattern matching. That's not a trick you can replicate by thinking alone.

**Lesson:** AI brainstorming works best when you give it enough diversity to surprise you, then let your own pattern-matching pick what resonates. Don't arrive with a half-formed idea and ask the AI to finish it. Arrive with raw material and let the AI generate surface area.

---

## Phase 2 — Expand Selectively into Structure

Both shortlisted ideas got **medium-depth GDDs** produced side by side in a single session. A GDD in this context is not a description — it covers:

- Core mechanic and vision
- Turn structure and game loop
- Controls specification
- Art direction
- Asset map against a specific asset bundle (Kenney's All-in-1)
- Tech stack
- Build time estimate with AI assistance

The AI produced both documents in a single tabbed file, styled to personal brand colors — demonstrating that AI handles presentation layer alongside content. This matters for workshops: the deliverable is immediately shareable.

**Key point:** The first document is a starting point, not a final answer. Its value is in giving you something concrete to react to. You cannot design well in the abstract.

---

## Phase 3 — Do the Real Design Work by Disagreeing

The best design decisions came from pushback, not acceptance. Here are three that shaped the final game:

### 3.1 Hidden information killed strategic depth

The original concept had unknown card values on the balls — players wouldn't know what rank they were shooting for until the ball was pocketed.

**Pushback:** "Both poker and pool are information games. Pool players can see exactly which ball is which. Poker players can see their own hand. Why hide the card values?"

**Result:** Full-information gameplay. Both players' hands are always visible. The game became more strategic, not less — players can see what their opponent is building and play defensively.

### 3.2 The break shot was too powerful

An early lucky break could pocket two or three high-value balls and hand one player a massive structural advantage before the strategy phase had even started.

**Pushback:** "The break is exciting because of the scatter, not because of the pockets. The randomness shouldn't carry strategic consequence."

**Result:** The **Safe-Haven Break Rule** — any balls pocketed on the break immediately respawn to pre-set matrix coordinates. No cards are registered, no suits are mapped. The breaker keeps the turn and takes the first true strategic shot. The break is still a spectacle; it's just not a lottery.

### 3.3 The 3-miss rule beats complex safety systems

The AI proposed a "safety token" system — players could spend tokens to play defensive shots without penalty — to prevent intentional stalling.

**Counter-proposal:** Three consecutive missed turns and you're eliminated. No tokens, no complexity.

**Why it's better:** Simpler to explain, simpler to implement, and it creates real tension. Players can't just stall forever hoping their opponent makes a mistake. Every miss is tracked.

### Other design decisions locked in this phase:

- **Protected Rack:** Ace, Jack, Queen, King are programmatically forced into the 4 hidden center slots of the 15-ball triangle. They can't scatter into pockets on a lucky opening shot.
- **Suit Assignment:** The first player to pocket a ball into any unclaimed pocket *names* that pocket's suit. Territory acquisition becomes a first-phase metagame.
- **9 respawn coordinates:** Pre-set positions across head, center, and foot zones. Balls that enter invalid pockets teleport there instantly — no chaos, no physics accidents.
- **The Stand mechanic:** A player holding 5 cards can voluntarily "Stand" before their turn, locking their hand and giving the opponent a 3-turn countdown to respond. Ties go to whoever stood first — rewarding decisive play.

**Lesson:** The design conversation is most valuable when you treat AI suggestions as proposals to interrogate, not answers to accept. Every "yes, but..." or "what if instead..." move in the conversation produced a better design decision than the first draft.

---

## Phase 4 — Design for Non-Technical Users from Day One

One of the most consequential decisions made during the design conversation — and it took about five minutes — was a **three-file config architecture**:

```
config/gameplay.ts   — all game rules and physics constants
config/ui.ts         — all visual values (colors, sizes, animation durations)
config/assets.ts     — every asset file path
```

Every variable is tagged either `@live` (safe to adjust without reloading) or `@fileonly` (structural, requires restart). Live variables auto-generate a real-time dev panel in the right third of the screen during prototyping — sliders, color pickers, toggles — no coding required.

Each config file opens with a plain-English header:

> *"You do NOT need to know how to code to change these values."*

The guardrail was baked into every subsequent AI prompt: **no raw numbers or hex color strings anywhere in source code outside config files** — enforced as a lint warning, not just a suggestion.

In the actual implementation (`src/config.js`, 221 lines), every parameter is JSDoc-commented explaining what it does and what scale it operates on. Changing `railRestitution: 0.8` to `0.9` makes the table bouncier. Anyone can do that.

**Lesson:** Adding this system costs five minutes of thinking during the design phase. It saves hours when collaborators need to tweak the game, and it's the difference between a prototype only you can adjust and one a whole team can iterate on.

---

## Phase 5 — End with Executable Instructions, Not Just a Document

The design conversation ended with a **5-milestone roadmap**, each milestone accompanied by a ready-to-paste Claude Code prompt. Each prompt specified exact file names, variable names, library integrations, and the config guardrail check.

**Milestone 1 — The Felt:**
Physics table, all three config files, live dev panel, visible cue stick. No game logic — pure physics playground. Paste this prompt into Claude Code and it builds a working table with documented config.

**Milestone 2 — The Rules Engine:**
Suit assignment state machine, card registration matrix, respawn system, turn alternation.

**Milestone 3 — The Player UI:**
Card hand display, aiming assist, break rules, 3-miss counter, Swap Decision modal.

**Milestone 4 — The Match:**
Stand rule, Showdown, elimination, all win/loss states.

**Milestone 5 — The Polish:**
Audio mapped to game events, full mobile touch, build, deploy.

The prompt structure used throughout:

```
Role: [specific engineering role]
Context: Read and follow [GDD sections] and [TDD sections].
Your objective is to implement [feature].

1. [Requirement]
2. [Requirement]
...
TDD Requirements & Test Checklist: [specific assertions to verify]
```

Giving the AI a **role** ("Role: Senior Game Physics Engineer") rather than just a task produces better output. The role sets the frame of expertise the AI brings to ambiguous decisions.

---

## Phase 6 — Execution with Claude Code

Claude Code is an AI coding agent that operates in your terminal. It reads files, writes code, runs tests, makes git commits, and iterates on failures — from natural language instructions.

The workflow for each milestone:

1. Hand Claude Code the GDD, TDD, plan, and the milestone prompt
2. Watch it generate code, run tests, fix failures, commit
3. Open the browser and play the game
4. Describe what doesn't feel right — in plain English, as a player
5. Feed corrections back in

### What this looked like in practice

**Day 1 — May 21:** Physics sandbox built. Then six sub-milestones of refinement as problems surfaced during play. The most technically significant: shots weren't matching the aiming guides on oblique cuts. Symptom described to Claude Code as a player — "the ball doesn't go where the line shows." Diagnosis: discrete time-step collision deviation (high-speed balls overlapping before collision is detected, shifting the rebound angle by 10–30 degrees). Solution: 10× physics sub-stepping. One session, fixed.

**Day 2 — May 21–22:** Protected racking, coin toss animation, safe-haven break, respawn matrix, suit-mapping state machine, HUD overlays.

**Day 3 — May 22–23:** Full turn loop, hand-swapping modal, wildcard creator, cross-player duplicate card prevention, 3-miss elimination.

**Day 4 — May 24:** Stand mechanic, 3-turn countdown, poker showdown with kicker tiebreakers — and a complete AI opponent using ghost-ball geometry, shot scoring, and aim error simulation. Day ended with a mode selection start screen.

**Total: 54 commits. 6,450 lines of code. Four days.**

### The design iteration loop

The GDD has a section labeled "Post-GDD v1.1 Addenda" — eight decisions added *during* active development. This is normal and expected. Some examples:

- **Aiming deflection lines removed.** The original spec included projection lines showing where the target ball would go. During playtesting: they "guided players too prescriptively" and made the game less interesting. Built, tested, removed. The whole cycle happened within one sprint.

- **Shot toast notifications added.** Five feedback types (Score, Scratch, Miss, Invalid Drop, Mixed) emerged from playing edge cases — not from the original spec. The game needed them; they were added.

- **HUD sweep animation added.** Noticing the HUD felt static during turn changes led to a directional gradient sweep — left-to-right signals Player 2's turn, right-to-left signals Player 1's. A polish detail that emerged from play.

None of these required writing code. They required noticing something while playing and describing it in English.

---

## What the AI Solved That Would Have Been Hard Otherwise

**The physics precision problem.** Pool requires aiming guides that match real ball physics. The 10× sub-stepping solution was identified, implemented, and verified in the same session. Without AI, this requires deep Matter.js knowledge and likely days of debugging.

**The poker hand evaluator.** A correct evaluator for 1–5 card hands (progressive hand building) with full kicker comparison, ace-low wheel detection, and tiebreaking chain: 211 lines of code, 48 automated browser tests. A deliverable, not a weekend project.

**The AI opponent.** Ghost-ball geometry, obstruction detection, shot scoring by hand value, aim error simulation: 439 lines. From one design document and one execution session.

**The cross-player duplicate card rule.** A subtle correctness bug that would be easy to ship: when any card is registered, the system must check *both* players' hands, not just the active player's. The TDD mandated this explicitly; the implementation enforces it in three separate code paths.

---

## Three Takeaways for Workshop Participants

**1. Start messy.**
Don't wait for a perfect idea. Dump your constraints and context — personal interests, platform targets, demo requirements — and let the AI generate enough surface area that something clicks. Arrive with raw material, not a half-formed spec.

**2. Disagree out loud.**
The best design decisions came from friction: "that mechanic limits strategic depth," "the break is too powerful," "assets need their own config file." Every pushback in the design conversation produced a better game than the first draft. Treat AI suggestions as proposals to interrogate.

**3. Think about non-coders from the start.**
The config architecture, live dev panel, and plain-English documentation were not afterthoughts — they were designed in during the initial conversation. Designing for handoff from the beginning is a product mindset, not a dev mindset. It takes five minutes of thinking upfront and saves hours later.

---

## The Documents Are the Product

The GDD, TDD, and milestone prompts in this repository are not byproducts of the project. They *are* the project. The 6,450 lines of code are what happened when those documents met Claude Code.

> **If you can describe your game clearly enough for another person to build it, you can describe it clearly enough for an AI to build it. The discipline of clear description is the skill. Everything else is execution.**

---

## What to Do Better Next Time

**Record the design conversation.**
The Claude Chat session that produced the GDD is not in the repository. That conversation — the back-and-forth that produced the two-phase structure, the Protected Rack, the Safe-Haven Break — is the most valuable artifact in the whole project for teaching, and it wasn't preserved. Export and archive the design chat.

**Paper prototype before the AI session.**
The Phase 1 → Phase 2 transition (suit mapping → hand race) is the game's most original mechanic. It would have benefited from a physical card-and-paper test first. Paper prototyping reveals rule conflicts without any technical debt.

**Define the AI opponent in the original milestone plan.**
The AI player was added as a bonus on Day 4. Including it in the original plan would have ensured the architecture was built with AI hooks from the start, not retro-fitted.

**Add sound in Milestone 3, not as a post-ship task.**
Audio was specified in the GDD (Howler.js, Kenney audio bundle) but never implemented. Sound is not polish — it's fundamental to game feel.

**Version GDD decisions with dates and commit references.**
`gdd.md` is updated with addenda but without version markers tied to specific commits. When the GDD says "deflection lines removed after playtesting," there is no corresponding git log entry explaining why. Future GDDs should have dated decision log entries that can be traced to commits.

**Build the browser test suite from Day 1.**
The standalone `test.html` suite (48 tests, no build step) was created as a workaround for CI sandbox limitations and turned out to be the most reliable testing tool in the project. Make it the primary test suite from the start.

---

## Reference

| Artifact | What it is |
|----------|-----------|
| `gdd.md` | Complete game ruleset, mechanics, edge cases, UI spec |
| `tdd.md` | Architecture rules, config mandate, AI workflow guidelines |
| `plan.md` | 5-milestone roadmap with ready-to-paste Claude Code prompts |
| `devlog.md` | Every bug encountered, diagnosed, and resolved — with the fix |
| `src/config.js` | 221-line config file, every parameter in plain English |
| `test.html` | 48 browser-based poker evaluator tests, no build step |

---

*Repository: PokerPool-Gemini · 54 commits · 4 days · May 21–24, 2026*
*Stack: Vite · Matter.js · Pixi.js · Vitest · Vanilla JavaScript*
