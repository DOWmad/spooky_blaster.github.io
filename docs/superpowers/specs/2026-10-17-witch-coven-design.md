# Witch Coven / Hive Mind Boss — Design

## Goal

Add a fight against several bosses at once for players who reach the second loop. From loop 2
onward, the Coven replaces boss 3 (Reaper / The Eye), the same way the Mirror Witch replaces
boss 2. The campaign stays six levels long, so `CAMPAIGN_LENGTH`, the loop maths and the
leaderboard score cap are unaffected.

## Definition

```js
const COVEN_BOSS = {
  name: 'HIVE MIND', hname: 'WITCH COVEN', sprite: 'boss_witch', hp: 700, coven: true, phases: [
    { hp: 1,   patterns: ['aimed', 'fan', 'hexBolt', 'rain'] },
    { hp: 0.5, patterns: ['cauldronBurst', 'spiral', 'summonBats', 'ring', 'cross'] },
  ],
};
```

Selection: in the `Boss` constructor, when `loop > 0 && (level - 1) % CAMPAIGN_LENGTH === 2`.

Time limit: 70s, matching the mirror boss.

## Phase 1 — three witches, one health bar

- **Positions:** `this.witches = [{ ox: -110 }, { ox: 0 }, { ox: 110 }]`.
  - Each witch bobs out of step with the others around its slot.
  - The whole group uses the normal boss sway.
- **Active witch:** `this.active` (0–2) moves on to another witch after every attack. The active
  witch is outlined and lit; the other two are dimmed. All attacks fire from the active witch.
- **Hit detection:**
  - `hitTest(x, y)` is true inside any witch's circle (r≈22).
  - **`hitScale(x, y)`** replaces `acceptsHit(x)`. It returns:
    - 1 for the active witch
    - 0.25 for the others
    - the mirror boss's existing 0/1 side rule
  - `damageBoss` multiplies damage by `hitScale`. A result of 0 still triggers `blockFlash`.
    Beams and lasers pass their X as they do today.
- **Contact:** touching any witch damages the player.
- **HUD hint:** "SHOOT THE LIT WITCH" / "SHOOT THE LIVE NODE", next to the mirror hint
  (`game.js` ~1476).
- **`hexBolt`:** the active witch fires 3 slow bolts. They steer toward the player for 1.5s,
  then fly straight.

## Merge (at the 50% phase threshold)

- `cancelAttacks()`, clear enemy bullets, `stun = 2`.
- Over 1.5s the witches converge on the centre and a cauldron (classic: core) rises between them.
- Popup "THE COVEN CONVERGES" / "NODES LINKED". The final boss's phase-change hook is extended
  to `def.coven`.
- From this point:
  - Only the cauldron (r≈32, scale 1) passes `hitTest`.
  - The witches orbit it as damaging obstacles and can't be hit.

## Phase 2 attacks

All phase 2 attacks fire from the cauldron.

- **`cauldronBurst`:** lobs 4 slow bubbles; each bursts into a 6-bullet ring after 1s.
- **`summonBats`:** releases 5 `bat` enemies (the type added by the Dracula bat-form work).
  If that work hasn't landed yet, use the existing `minions` pattern instead.
- `spiral`, `ring`, `cross`: existing attacks.

## Death

Normal `bossKilled()`, plus three extra explosions at the witches' positions.

## Files

- `js/entities.js`:
  - `COVEN_BOSS` and its selection
  - witch positions and `active`
  - the `merged` state
  - `hitTest` and `hitScale`
  - the `hexBolt` and `cauldronBurst` attacks
  - drawing for three witches and the cauldron
- `js/game.js`:
  - `damageBoss` uses `hitScale`
  - merge popup
  - HUD hint
- `js/sprites.js`: `boss_witch` / `h_boss_witch` (~40px) and `cauldron` / `h_cauldron`.

## Testing (`tests/game.test.js`)

- Loop-2 level 3 builds `COVEN_BOSS`; loop-1 level 3 is still boss 3.
- `hitScale` returns 1 for the active witch and 0.25 for the others.
- `active` moves on after an attack.
- The boss merges at 50%. After the merge:
  - only the cauldron passes `hitTest`
  - contact with a witch still damages the player
- The mirror boss behaves as before through `hitScale` (lit side 1, dark side 0).

## Out of scope

- Killing witches one at a time, or separate health bars
- Hex circles / damage zones
- Changes to campaign length
