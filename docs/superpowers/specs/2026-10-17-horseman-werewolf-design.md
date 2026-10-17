# Headless Horseman Boss and Werewolf Mid-Boss — Design

## Goal

The level-4 werewolf boss is weak. Its pounce is a slow move to the player's old position,
landing does nothing, and most of its attacks are shared with other bosses.

This design does two things:

- Replaces the level-4 boss with the **Headless Horseman** (classic: **Dark Rider**). The fight
  is built around a sideways charge, which no current boss has.
- Demotes the **werewolf** (classic: **Alpha Prowler**) to an elite wave enemy, in the style of
  the necromancer, that pounces and howls.

## Part 1 — Horseman boss (replaces `BOSS_DEFS[3]`)

```js
{ name: 'DARK RIDER', hname: 'HEADLESS HORSEMAN', sprite: 'boss4', hp: 560, fears: 'holy', phases: [
  { hp: 1,   patterns: ['charge', 'fan', 'aimed', 'rain'] },
  { hp: 0.5, patterns: ['charge', 'headThrow', 'fan', 'aimed', 'rain'] },
] }
```

Art: new `h_boss4` / `boss4` sprites (a rider on horseback; classic is a cyber-knight on a
hover-bike), about the same size as the current werewolf sprite. The current werewolf art
moves to the new enemy sprite.

Unchanged from the other bosses: the 55s time limit and berserk, HP scaling, the 50% phase
threshold, and the entry and death flow.

### `charge`

1. **Warn (0.8s):** a pulsing horizontal band at the player's current Y; the rider lines up
   at a screen edge. Drawn like the laser warning, turned sideways.
2. **Gallop (0.7s):** sweeps across the full width along that band. Touching it hurts, through
   the existing body-contact check (`game.js` ~1049). It drops a trail of slowly falling ember
   bullets.
3. **Return (0.6s):** moves back home.
4. **Raging:** charges twice; the second charge comes from the opposite side.

**Holy water (Halloween):** while `player.holy > 0`, the band's Y is clamped to `≤ H / 2`, and
the popup "THE BRIDGE HOLDS" appears once per charge. Holy water's drop weight is raised
during level 4.

### `headThrow` (phase 2 only)

- Throws a head entity (r≈12, 3 HP) that bounces off the screen edges for 4s, then homes back
  to the rider.
- **While the head is out, damage to the boss is ×2.**
- **Shooting the head down:**
  - it bursts into an 8-bullet ring
  - the rider is stunned for 1s
  - the rider regrows its head (no ×2 window any more)
- The head stays out for at most one throw at a time.
- Classic mode: a "drone head" — same mechanics, different palette.

## Part 2 — Werewolf elite enemy

`ENEMY_TYPES.werewolf = { sprite: 'werewolf', hp: 45, score: 1200, speed: 80, r: 18, drop: 0.6 }`
It gets the usual `hpBonus` scaling. The sprite is the old boss art, scaled to about half size.

### Behaviour (`mode`)

1. `enter`: drops to a perch at y≈110.
2. `howl` (1s, stationary, howl sound):
   - every living, non-raised enemy gets ×1.3 speed and ×1.3 fire rate for 4s
   - buffed enemies get a faint red outline
   - no bullets are fired
3. `crouch` (0.6s, flashing) → `pounce` (0.45s) → `land`:
   - the pounce target is the player's position plus 0.3s of the player's velocity, clamped to
     the screen
   - landing fires an 8-bullet ring and shakes the screen
4. `return` (0.6s) to the perch.
5. After 3 howl→pounce cycles: `leave`, running off-screen. No score if it escapes.

Contact damage uses the existing enemy collision.

**Silver (Halloween):** it regenerates 2 HP/s unless silver hit it within the last 2s.
`silverMult` ×2 applies. In classic mode there is no regeneration.

### Placement

- Level 4 at 12s.
- Level 6 at 18s.
- Never on screen at the same time as a necromancer.

## Code changes

- **Shared tween:** extract `leap`, `startLeap` and `updateLeap` from `Boss` into one helper
  that both `Boss` (`charge`) and `Enemy` (`pounce`) use. `Boss.cancelAttacks` still sends
  any move in progress home.
- **Silver check:** `silverMult` and the regeneration check use `o.fears === 'silver'`
  (enemy) instead of `o === G.boss`. The boss no longer has a silver rule.
- **Holy water:** `holyMult` doesn't change; the Horseman's clamp reads `player.holy`.
- **Removed:** the old `pounce` and `howl` boss attacks. Their logic now lives on the enemy.

## Testing (`tests/game.test.js`)

- Werewolf pounce target leads the player and stays inside the screen.
- Howl buff applies to enemies on screen and expires after 4s; raised enemies are not buffed.
- Silver stops werewolf regeneration; classic mode never regenerates.
- Werewolf leaves after 3 cycles.
- Horseman charge Y is clamped to `≤ H / 2` while holy water is active.
- Shooting the head stuns the rider, and boss damage is ×2 while the head is out.
- Boss 4 definition has `fears: 'holy'` and includes `charge`; phase 2 includes `headThrow`.

## Out of scope

- Werewolf as a loop-2 boss variant
- New sound effects beyond reusing `howl`, `dive` and `explode`
