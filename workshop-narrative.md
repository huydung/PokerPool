# From Idea to Playable Game in 4 Days — Without Writing a Line of Code

## An AI Game Prototyping Case Study: *Poker Pool*

---

> **Note on sources:** This narrative is built from the full repository history (54 commits), the Game Design Document (`gdd.md`), Technical Design Document (`tdd.md`), milestone plan (`plan.md`), and developer log (`devlog.md`). The Claude Chat conversation ("Game Prototype with AI") was not directly accessible to the author of this document — if you have a transcript of that session, the ideation section below can be deepened with the actual back-and-forth that produced the GDD.

---

## Part 1 — The Premise

What if you had an idea for a game but couldn't code? What if the usual answer — "find a developer" or "learn Unity over the next six months" — was no longer the only option?

That's the question this case study answers.

In four days, starting from a single creative concept, a fully playable physics-based card game was built using two AI tools — **a conversational AI** (Claude in the "Game Prototype with AI" project) for design, and **Claude Code** for implementation. The result: a working game called **Poker Pool**, built on a professional JavaScript stack, with 6,450 lines of code across 8 source files, a physics engine, a poker hand evaluator, an AI opponent, animated HUD transitions, toast notifications, and 54 git commits — none of them typed by hand in a code editor.

The creator's job was not to be a programmer. It was to be a **game director**.

---

## Part 2 — The Idea: Poker Pool

The concept is elegantly simple: what if billiards and poker had a baby?

Players compete on a standard 2:1 pool table. But instead of pocketing balls by number, every ball represents a playing card — Ace through King, plus two wild-card balls. Pockets are mapped to suits. Pocketing a ball earns you that card. The first player to assemble the strongest 5-card poker hand wins.

It sounds obvious in retrospect. That's usually the sign of a good idea.

The concept solves a real design problem: **pool is a skill game, poker is a strategy game, and combining them creates genuine tension**. You might be a better pool player but make worse poker decisions. You might be a poker shark who can't make a cut shot. The game punishes both types of one-dimensional play.

But an idea isn't a game. A game needs rules, edge cases, balance decisions, and a technical foundation. This is where AI entered the picture.

---

## Part 3 — Phase 1: Designing the Game with AI (The Claude Chat Phase)

Before a single line of code was written, the design was hashed out in conversation with a Claude chat project called **"Game Prototype with AI."**

This is the phase where Antigravity thinking applies: **removing the constraint of "can this be built?"** from the design conversation entirely. When you're talking to an AI about your game idea, you're not limited by what you personally know how to code. You can say "what if pocketing the same ball twice were illegal?" and get an immediate answer about what rule system would support that, what edge cases it creates, and whether it makes the game better or worse.

Based on the evidence in the repository, that conversation produced:

**The core loop decisions:**
- Two phases: a chaotic opening (Phase 1, "Suit War") where pockets don't have suits yet, and a focused closing sprint (Phase 2, "Hand Race") once all four suits are mapped
- The Protected Rack — forcing Aces, Jacks, Queens, and Kings into the hidden center slots of the break formation so they can't be scooped on a lucky scatter shot
- The Safe-Haven Break rule — any balls pocketed on the break respawn immediately with no cards awarded, neutralizing the randomness of the opening shot
- The 3-Miss Elimination rule — punishing intentional defensive stalling
- The Stand mechanic and its tiebreaker: the player who commits first (stands) wins on a tie, rewarding decisive strategy over passive accumulation

**The design document that emerged: `gdd.md`**

The GDD is 8 sections of precise, unambiguous game specification. It reads like a document a real game studio would produce. Section 4 alone contains a full card registration matrix — a table defining every combination of ball type × pocket type and what the rule outcome should be. That kind of systematic thinking, doing it rapidly and iterating it in conversation with an AI, is the first transformative moment in this workflow.

The GDD became the single source of truth that everything else flowed from.

---

## Part 4 — Phase 2: Translating Design into Engineering Instructions

With the GDD complete, the next job was to make it executable. This produced two more documents:

### The TDD (`tdd.md`): Rules for the AI Developer

The Technical Design Document isn't really technical in the sense of algorithms or data structures. It's a **set of instructions for how an AI agent must behave** when implementing the GDD.

It mandates:
- **Centralized configuration** — all game constants go in `src/config.js`, zero hardcoded magic numbers, every parameter JSDoc-commented in plain English so non-coders can tune the game
- **Strict architectural layers** — physics has no knowledge of cards, rendering has no knowledge of rules, game logic has no knowledge of pixel coordinates
- **Atomic commits** — every single feature gets its own commit before moving to the next
- **Test coverage** — unit tests enforce the architectural boundaries
- **A status block** printed at the end of every response so non-coding team members know where to test

This document shows a sophisticated insight: **the AI is not just a coder, it's a system that needs constraints and contracts to produce maintainable output.** The TDD is those constraints.

The TDD even includes a git workaround for sandbox EPERM errors (Section 3.6) — evidence of real problem-solving happening in a feedback loop between the human director and the AI agent.

### The Plan (`plan.md`): Five Milestone Prompts

The plan breaks the game into five milestones, each with a specific "AI Developer Prompt" written in a structured format:

```
Role: [specific engineering role]
Context: Read and follow [specific GDD sections] and [specific TDD sections].
Your objective is to implement [feature].

1. [Requirement 1]
2. [Requirement 2]
...
TDD REQUIREMENTS & TEST CHECKLIST: [specific assertions to verify]
```

This is the key technique. Instead of writing code, the designer wrote **prompt specifications** — precise, testable, role-assigned instructions that an AI agent could execute as an engineering brief. Each milestone had its own scope, its own test checklist, and its own definition of done.

The five milestones:
1. Core physics and aiming sandbox
2. Game initialization, protected racking, safe-haven break
3. Phase 1 suit mapping and state transitions
4. Turn loops, hand swapping, wildcard registration
5. Endgame — Stand, countdown, poker showdown

---

## Part 5 — Phase 3: Execution with Claude Code

Claude Code is an AI coding agent that lives in your terminal. It can read files, write code, run tests, make git commits, and iterate on failures — all from natural language instructions.

The workflow for each milestone was:

1. Hand Claude Code the GDD, TDD, plan.md, and the milestone prompt
2. Watch it generate the code, run tests, fix failures, and commit
3. Observe the result running in the browser
4. Report what didn't feel right — in plain English, as a player, not a programmer
5. Feed that feedback back in

### What This Actually Looked Like

The commit log tells the story with precision. Here is the real timeline:

**Day 1 — May 21 (Milestone 1):** Physics sandbox built. Matter.js rigid-body table, pocket collision sensors, cue ball aiming with ghost ball and deflection lines. Then immediately, six sub-milestones of refinement: physics calibration, slider UI, aim lock-in, multi-touch safety, gutter guards, and finally 10× physics sub-stepping to eliminate the collision deviation problem where shots didn't match the aiming guides.

The devlog entry for that last fix is revealing:

> *"Standard 60Hz physics engines permit high-speed rigid bodies to overlap significantly before registering collisions. In oblique collisions, this penetration drastically shifts the center-to-center normal vector... Implementing sub-stepping completely eliminated tunneling and coordinate drift."*

This was not guesswork. The AI diagnosed the root cause (discrete time-step collision deviation) and applied the textbook solution (sub-stepping). The designer's job was to describe the symptom: **"the shot doesn't go where the guide line shows."**

**Day 2 — May 21–22 (Milestones 2–3):** Protected racking, coin toss animation, safe-haven break logic, respawn matrix, the Phase 1 suit-mapping state machine, the HUD overlay.

**Day 3 — May 22–23 (Milestone 4):** The full turn loop, hand-swapping UI modal, wildcard creator UI, cross-player duplicate card prevention, 3-miss elimination.

**Day 4 — May 24 (Milestone 5 + Bonus AI Player):** Stand mechanic, 3-turn countdown, poker showdown with kicker tiebreakers — and then a complete AI opponent using ghost-ball geometry, shot scoring, aim error randomization, and endgame decision logic.

The day ended with adding a start screen offering a choice between 2-player local and vs-AI modes.

**Total: 54 commits. 6,450 lines of code. One playable game.**

---

## Part 6 — The Design Iteration Loop

Here is where the real value shows. The GDD has a section labeled **"Post-GDD v1.1 Addenda"** — eight decisions added *during* active development. This is the design feedback loop in action:

**8.1 Scratch Rule:** When the cue ball is pocketed, should other balls pocketed on the same shot count? The answer settled on: no. A scratch voids the entire shot. The GDD was updated mid-development.

**8.3 Aiming Assist finalization:** The original GDD called for deflection projection lines and pocket glow indicators (green/yellow/red) showing whether a shot was valid before you took it. During playtesting, these were removed. Why? They "cluttered the visual space and guided players too prescriptively." The game became more interesting without them.

This is a design decision you can only reach by *playing the game*. Previously, without AI tools, you would have needed a developer to build the feature, then remove it after two weeks of work. Here, the feature was built, tested, and removed as a conscious design decision — all within the same development sprint.

**8.5 Shot Toast Notifications:** Five feedback types (Score, Scratch, Miss, Invalid Drop, Mixed) emerged from playtesting edge cases — not from the original design spec. The GDD grew to include them because the game needed them.

**8.6 HUD Sweep Animation:** The directional sweep encoding player identity into animation direction — that's a polish detail that emerged from actually playing the game and noticing the HUD felt static during turn changes.

None of these required writing code. They required noticing something while playing, describing it in English, and handing it back.

---

## Part 7 — What the AI Solved That Would Have Been Hard Otherwise

### The Physics Precision Problem

Pool requires that aiming guides match actual ball physics. At standard 60Hz simulation, they don't — high-speed oblique shots deviate 10–30 degrees from the projected line. The solution (10× sub-stepping) was identified, implemented, and verified in the same session. Without AI, this would have required deep Matter.js knowledge and likely days of debugging.

### The Poker Hand Evaluator

A correct poker evaluator handles pairs, trips, straights (including ace-low wheels), flushes, full houses, four of a kind, straight flushes, and royal flushes — with full kicker comparison for tiebreaking, for 1–5 card hands (since you're building the hand progressively). The 211-line `poker.js` plus 48 automated browser tests covering every edge case was produced as a deliverable, not a weekend project.

### The AI Opponent

A pool AI opponent needs ghost-ball geometry (where does the cue ball need to be to pocket ball X into pocket Y?), obstruction detection (is anything blocking that shot?), a scoring function (which shot is most valuable given the current game state?), and aim error simulation (so it doesn't play perfectly). All of this — 439 lines in `ai.js` — emerged from one AI implementation plan document and one Claude Code execution session.

### The Cross-Player Duplicate Card Rule

This is a subtle correctness bug that a solo developer might ship with: when a wildcard is registered, the system needs to check *both* players' hands, not just the active player's. The TDD mandated this rule explicitly (Section 3.1), and the implementation enforces it in three separate code paths. The AI didn't invent this rule — the designer did. But having it written in a TDD meant it couldn't be forgotten.

---

## Part 8 — Instructions: How to Do This Yourself

Here is the reproducible workflow, distilled:

### Step 1: Ideation Session (30–60 minutes)
Open a Claude chat (or equivalent). Describe your game concept. Ask it to:
- Identify the core gameplay loop
- List the main mechanical decisions that need to be made
- Find the edge cases and conflicts in your rules
- Suggest what you might be missing

The output of this session is a rough GDD draft.

### Step 2: Write the GDD (1–3 hours)
Polish the draft into a proper Game Design Document. It should specify:
- Win condition
- Turn structure
- All legal and illegal states
- Every UI element and what it does
- Every edge case explicitly resolved (don't leave anything "to be decided later")

The GDD is the contract. If it's ambiguous, the implementation will be wrong.

### Step 3: Write the TDD (1–2 hours)
This is your instructions to the AI agent. It should specify:
- **Architecture rules** (what can each module know about?)
- **Configuration mandate** (where do constants live?)
- **Test requirements** (what must be verified automatically?)
- **Commit discipline** (how big is one commit?)
- Any known environment constraints (build tool limitations, sandbox restrictions, etc.)

### Step 4: Write Milestone Prompts (1–2 hours)
Break the game into 3–5 milestones. For each one, write a prompt with:
- A specific role for the AI (`Role: Senior Game Physics Engineer`)
- Explicit GDD/TDD section references (`Read Sections 1, 3, and 6 of gdd.md`)
- Numbered requirements
- A test checklist

### Step 5: Execute with Claude Code, Milestone by Milestone
Feed each milestone prompt to Claude Code. Before starting the next milestone:
1. Run the game in a browser
2. Play it for 10 minutes
3. List what doesn't feel right — in plain English, as a player
4. Feed corrections back as a follow-up prompt

### Step 6: Update the GDD as You Discover New Decisions
When playtesting reveals a rule ambiguity or a design improvement, write it into the GDD first, then ask Claude Code to implement it. The GDD stays the source of truth.

---

## Part 9 — Lessons Learned

### 1. The GDD is load-bearing
Every problem in the implementation traced back to an ambiguity in the GDD. When the scratch rule wasn't fully specified, it took two passes to get right. When the duplicate card rule was explicitly written in the TDD, it was implemented correctly the first time. **Vagueness in design becomes bugs in code.**

### 2. TDD is not just about tests
In this workflow, the TDD is primarily an architectural contract that tells the AI what the code is *not* allowed to know. The decoupling rules (physics must have zero knowledge of cards) prevented an entire class of spaghetti code bugs. The decoupler test that rejected `pair` as a variable name in `physics.js` seems pedantic — until you realize it caught a real vocabulary collision that would have failed a test.

### 3. Incremental milestones are essential
Trying to build everything at once produces systems that are hard to debug. The milestone structure meant that by the time Milestone 4 was built on top of Milestone 3, the physics were already verified to be correct. Problems were isolated to the new layer.

### 4. Play your game as soon as possible
The aiming assist change (removing deflection lines after playtesting) is the most important design decision in the whole project — and it's one the GDD got wrong initially. You cannot know which features make the game worse until you play it. The AI can build features; only a human can decide if they make the game fun.

### 5. The config file is a superpower for non-coders
`src/config.js` — 221 lines, every parameter JSDoc-commented in plain English — means that anyone on the team can change the physics, rebalance the rules, or adjust the AI difficulty without opening any other file. The TDD mandate for this wasn't optional; it's what makes the prototype genuinely collaborative.

### 6. The AI is a consultant, not a decision-maker
Every design decision in this game was made by the human. The AI's role was to execute those decisions faithfully, catch logical inconsistencies, and surface technical constraints. The Stand mechanic, the Protected Rack, the Safe-Haven Break — these are human design insights, not AI suggestions. The AI made them real.

### 7. Describe symptoms as a player, not as a programmer
"The shot doesn't go where the aiming guide shows" is a better bug report than "the deflection vector calculation is wrong." The first is true experience; the second is a guess about cause. The AI diagnosed the cause (discrete time-step collision deviation) better than a non-expert would have anyway.

---

## Part 10 — Tips

**Start with the win condition.** If you can't state it in one sentence, your GDD will be unresolvable in five pages.

**Resolve edge cases on paper first.** Every time you write "TBD" in a GDD, you're deferring a decision to a moment when you're in the middle of an implementation session. That decision will be rushed and often wrong.

**Give the AI a role, not just a task.** "Role: Senior Game Physics Engineer" produces better output than "please implement the physics." The role sets the frame of expertise the AI brings to ambiguous decisions.

**Use the devlog as a living document.** Every time the AI hits a bug that required a non-obvious fix, that fix should go into the devlog. It becomes a knowledge base for future sessions and protects you from re-discovering the same bug.

**Test in a real browser after every milestone.** Not just unit tests — actually play the game. Unit tests verify correctness; play sessions verify fun.

**Keep the config file human-readable.** If your non-coder collaborator (or future you) can't tune `railRestitution: 0.8` (lower = softer bounce) without reading the source, the config is failing its job.

**Commit often.** 54 commits in 4 days means every feature is recoverable. If a new milestone breaks something from a previous one, you can pinpoint exactly which commit introduced it.

---

## Part 11 — What to Do Better Next Time

### 1. Write the visual reference into the GDD earlier
The project referenced `gameref.png` throughout — a screenshot showing the desired visual style — but it was used informally. A formal "Visual Spec" section in the GDD with annotated screenshots would save multiple rendering correction cycles.

### 2. Prototype mechanics on paper before the AI session
The Phase 1 → Phase 2 transition (suit mapping → hand race) is the game's most original mechanic. It would have benefited from a physical card-and-paper test of the rule before implementation. Paper prototyping is still faster than AI implementation and reveals rule conflicts without any technical debt.

### 3. Define the AI opponent requirements earlier
The AI player was added as a "bonus" on Day 4, documented in `POKERPOOL_AI_PLAN.md` as a late addition. Including the AI opponent in the original milestone plan would have ensured the game's architecture was built with AI hooks from the start, rather than retro-fitting them.

### 4. Add sound earlier
The GDD specified Howler.js audio from the beginning (Section 6), but sound was never implemented. Audio feedback — collision sounds, card registration chimes, endgame fanfare — is not a polish detail, it's fundamental to game feel. It should be Milestone 3, not a post-ship task.

### 5. Record the Claude Chat design session
The ideation conversation that produced the GDD is not in the repository. That conversation — the back-and-forth that refined the core loop, resolved the edge cases, and produced the rule decisions — is the most valuable artifact in the whole project for teaching purposes, and it wasn't preserved. Future projects should export and archive the design chat.

### 6. Keep the GDD versioned with the commits
`gdd.md` is updated with addenda (Section 8) but without version markers tied to specific commits. When the GDD says "deflection lines were removed after playtesting," there's no git log entry explaining why. Future GDDs should have dated decision log entries ("2026-05-23: Removed pocket glow per playtesting — too prescriptive").

### 7. Build the test.html browser suite from Day 1
The standalone `test.html` suite (48 poker evaluator tests, no build step) was created as a workaround for CI sandbox limitations. It turned out to be the most reliable testing tool in the project. It should be the primary test suite from the start, not a workaround.

---

## Closing: What Actually Changed

The standard story about game development is: ideas are cheap, execution is expensive. You need engineers, you need time, you need money. Most game ideas never get tested because the cost of testing them is prohibitively high.

This project inverts that story.

The expensive part — 6,450 lines of physics simulation, rendering pipeline, game logic, poker evaluation, and AI behavior — was produced by an AI agent executing well-specified design documents. The valuable part — the game concept, the design decisions, the balancing choices, the playtesting feedback — was contributed by a person who didn't write a single line of JavaScript.

The workshop lesson is not "AI writes code for you." It's more precise than that:

> **If you can describe your game clearly enough for another person to build it, you can describe it clearly enough for an AI to build it. The discipline of clear description is the skill. Everything else is execution.**

The GDD, TDD, and milestone prompts in this repository are not byproducts of the project. They *are* the project. The code is what happened when those documents met Claude Code.

---

*Repository: PokerPool-Gemini · 54 commits · 4 days · May 21–24, 2026*  
*Stack: Vite · Matter.js · Pixi.js · Vitest · Vanilla JavaScript*  
*Author: contact.huydung@gmail.com*

---

> **For workshop participants:** The full repository, including all design documents, milestone prompts, and the devlog with every bug resolved, is available as a reference. Clone it, read the GDD before reading any code, and notice how every implementation decision traces back to a design document decision.
