# Five Arcade Additions Implementation Plan

> **For agentic workers:** This plan was executed inline in the current checkout; each completed checkbox describes a verified implementation step.

**Goal:** Add the five approved mechanics to the current six-level game with no new controls.

**Architecture:** Extend the current entity definitions for the wave, bolt, enemy, and boss; route damage and timing through the existing game loop; add pixel art and level events. Keep global and local leaderboard protocols untouched.

**Tech Stack:** Browser JavaScript, Canvas 2D, Node's built-in test runner, Python Playwright for local browser inspection.

---

### Task 1: Define behavior with headless tests

**Files:** `tests/game.test.js`

- [x] Test that a level-four Siren emits a wall with a safe gap and the gap avoids the player's current column.
- [x] Test that the Chain secondary fires and jumps only to nearby enemies.
- [x] Test that Chrono slows bullets while enemies keep normal speed.
- [x] Test that the later-loop Mirror boss blocks central shots, accepts exposed-side shots, and switches sides after attacking.
- [x] Test that the capacitor awards each graze once and does not reward invulnerable play.
- [x] Run `node --test --test-name-pattern='siren appears|chain lightning fires|chrono pickup|mirror boss replaces|graze capacitor' tests/game.test.js` and confirm the new cases fail before implementation.

### Task 2: Build the new combat objects

**Files:** `js/entities.js`, `js/game.js`, `js/levels.js`, `js/sprites.js`

- [x] Add `SonicWave` and Siren state changes, collision, themed art, and events in levels 4–6.
- [x] Add `ChainBolt`, weighted pickup, nearby-target chaining, and short arc effects.
- [x] Add the Chrono pickup, timer, and projectile-only time scaling.
- [x] Add the Mirror boss variant, alternating exposed side, damage gate, and visual marker.
- [x] Add the capacitor pickup, one-graze-per-bullet score, ultimate charge, and HUD chip.

### Task 3: Verify gameplay and presentation

**Files:** `tests/game.test.js`, `js/game.js`

- [x] Run `node --test tests/*.test.js` and `node --check js/*.js`.
- [x] Run `git diff --check`.
- [x] Inspect the Halloween title and both Mirror boss themes in a local headless browser; correct pickup-list overlap.
- [x] Re-run full verification after the final balance and visual changes (84 tests pass; JavaScript syntax and diff checks pass).
