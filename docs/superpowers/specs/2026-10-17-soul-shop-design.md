# Soul Shop — Design

## Goal

Give each run a build. After every level the player picks 1 of 3 run-scoped upgrades.
Souls, earned through skilful play, buy a reroll or a second pick. Everything resets on
game over, so every run starts equal and the global leaderboard stays fair.

## Decisions

- Format: pick-1-of-3 after each level; souls fund rerolls and extra picks.
- Scope: run only. No persistence, no `localStorage`.
- Soul sources: combo milestones, no-damage clears, fast boss kills. No soul pickups.
- No raw damage upgrades (boss HP is tuned around power levels; loops would trivialise).
- Leaderboard unchanged: souls and upgrades never award score directly.

## Flow

New state `shop`:

- `levelclear` → `shop` → next level
- `victory` → `shop` → next loop

The shop has its own `updateShop()` / `drawShop()` in the state switch (`game.js` ~1248).
There is no timer.

If every upgrade is maxed, skip the shop and award 5000 points instead.

## Screen

- Three cards side by side. Each shows its label, its name for the current theme, a one-line
  effect, and the stack count for stackable upgrades (`2/3`).
- Below the cards: `REROLL (1◆)`, `SECOND PICK (3◆)`, and the current soul total. A button is
  dimmed when the player can't afford it.
- Keyboard: ←/→ highlight a card; Enter/Space take it; `R` rerolls; `2` buys a second pick.
- Touch: tap a card to take it; tap a button to use it (existing `tapOn`, `game.js:845`).
- A second pick re-rolls the offer, excluding the upgrade just taken.
- If fewer than 3 upgrades are still available, show fewer cards.

During play, show a `◆n` chip in the status chips (`game.js` ~1375) and a `+1◆` popup when
souls are earned.

## Upgrades

Defined in `UPGRADES` in `js/entities.js`, beside `POWERUPS`:
`{ label, name, hname, desc, max, color }`.

| key | name / hname | effect | max |
|---|---|---|---|
| magnet | MAGNET / CANDY BAG | Power-ups drift toward the ship | 1 |
| fuse | LONG FUSE / SLOW CANDLE | Combo window +0.75s per stack (base 1.5s) | 2 |
| overcharge | OVERCHARGE / FULL MOON | Ultimate charge gain +25% per stack | 3 |
| plating | SECOND SKIN / THICK HIDE | +1 shield at level start per stack (capped at `maxShields`) | 2 |
| keen | KEEN POWER / IRON WILL | Death does not lower `power` or `spread` | 1 |
| wingman | WINGMAN / FAMILIAR | Start each level with at least N drones (capped at `MAX_DRONES`) | 2 |
| charm | LINGERING CHARM / OLD CHARM | Timed pickups last +50% per stack | 2 |
| lucky | LUCKY / RABBIT'S FOOT | Enemy drop chance ×1.3 per stack | 2 |
| spare | SPARE HULL / NINE LIVES | +1 life immediately | 2 |
| decoy | DECOY / SCARECROW | One decoy charge per level (see below) | 1 |

`hname` values are placeholders and can be tuned during implementation.

### Decoy

- Activation: key `Q`, plus a touch button next to the ultimate button.
- One charge per level. It spawns a stationary dummy at the ship's position, lasting 5s.
- While the dummy is active, enemy and boss aimed shots target it instead of the player.
  So does the black cat's pathing.
- The dummy cannot be destroyed; it simply expires.

## State and effects

- Add `G.souls = 0` and `G.upgrades = {}` (key → stacks). Reset both in `newGame()`.
- Read each effect with `G.upgrades.key || 0` where it applies:
  - `fuse`: where `comboTimer` is set (`game.js` ~425)
  - `overcharge`: in the ultimate charge gain (`game.js` ~437)
  - `charm`: where timed pickups set their durations (rapid, garlic, holy, silver, chrono,
    and any other timed pickup present at implementation time)
  - `lucky`: in `maybeDrop`
  - `keen`: in `Player.downgrade()`, which gets a flag argument
  - `plating`, `wingman`, `decoy`: granted in `startLevel()`
  - `magnet`: in the `PowerUp` update, which pulls toward the player when the upgrade is owned
  - `spare`: applied on purchase

## Soul payouts

| Event | Souls |
|---|---|
| Combo reaches x3, x4, x5 (each once per level) | +1 each |
| Level cleared with `tookDamage === false` | +2 |
| Boss killed with `timeLeft / timeLimit ≥ 0.5` | +2 |
| Boss killed with `timeLeft / timeLimit ≥ 0.25` | +1 |

The two boss rows don't stack: take the higher one.

Unspent souls carry over to the next level.

## Shop logic

A pure function `rollOffers(owned, n = 3, exclude = [])` returns up to `n` distinct
upgrade keys. It never returns a maxed upgrade or an excluded one. It is exported for tests.

## Testing (`tests/game.test.js`)

- `rollOffers`:
  - never offers a maxed upgrade
  - never repeats an upgrade
  - respects `exclude`
  - returns fewer than `n` when the pool is short
- Payout rules:
  - combo milestones pay once per level
  - no-damage bonus
  - boss time tiers
- `newGame()` resets `souls` and `upgrades`.
- Applying one upgrade per effect changes the targeted value (spot checks for `fuse`,
  `keen` and `lucky`).

## Out of scope

- Persistent unlocks or meta-progression
- Soul pickups
- Damage upgrades
