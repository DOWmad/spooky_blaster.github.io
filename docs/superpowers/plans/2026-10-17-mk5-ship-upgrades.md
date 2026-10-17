# MK5 Ship Upgrades Implementation Plan

> **For agentic workers:** Execute this focused plan inline; no subagent is needed for the three-file change.

**Goal:** Extend the ship upgrade path to MK5 with two new themed hulls.

**Architecture:** Keep `SHIP_SPEED` as the class cap, `Player.maxShields` as class plus one, and the existing ship pickup and death rules. Add only MK4 and MK5 sprite definitions and their Halloween variants.

**Tech Stack:** Browser JavaScript, Canvas 2D, Node test runner, local headless browser.

---

### Task 1: Prove the current cap and missing sprites

**Files:** `tests/game.test.js`

- [x] Add a test that collects ship pickups through MK5, checks speed and full shield capacity at each step, checks the 5,000-point max reward, and checks death downgrade.
- [x] Add a test that renders MK4 and MK5 in both themes without missing sprites.
- [x] Run the focused tests and confirm they fail because the current ship cap is MK3.

### Task 2: Extend the class ladder and art

**Files:** `js/entities.js`, `js/sprites.js`

- [x] Add speeds 340 and 360 to `SHIP_SPEED`; retain `MAX_MK = SHIP_SPEED.length - 1`.
- [x] Add distinct classic `player_mk4` and `player_mk5` pixel-art rows.
- [x] Include MK4 and MK5 in the existing Halloween ship recolor generation.
- [x] Run the focused tests until they pass.

### Task 3: Verify the game

**Files:** `js/entities.js`, `js/sprites.js`, `tests/game.test.js`

- [x] Run `node --test tests/*.test.js` (86 pass) and syntax-check all `js/*.js`.
- [x] Inspect the new hulls in a local browser (both themes, no page errors) and run `git diff --check`.
