# Necromancer Ritual Design

Date: 2026-10-17
Status: approved for implementation

## Goal

Turn the existing necromancer into a recurring battlefield commander whose resurrection ritual creates a clear target-priority decision. The encounter should reward focused fire and strong ship upgrades without becoming a miniboss or adding a new resource system.

The classic-theme carrier keeps identical mechanics, presented as a repair unit rebuilding wrecks.

## Scope

This change deepens the existing `necromancer` enemy. It does not add a new enemy, boss, pickup, campaign level, input, scoring system, or persistent state.

Existing rules remain:

- Raised enemies are worth half score and drop no pickups.
- A necromancer may control at most six living raised enemies.
- Killing a necromancer makes its living raised enemies crumble without awarding their score.
- Only types already recorded as revivable can become corpses.

## Encounter

### Baseline durability

- Increase the necromancer's base health from 10 to **50** (raised from 30 after playtesting: Halloween holy water doubles damage, so 30 HP broke the ritual and killed it in one burst).
- Keep the existing gentle campaign-loop health bonus supplied by `buildLevel`.
- Keep its current score, movement speed, drop chance, entry movement, and horizontal hover movement.

The resulting enemy is tougher than a tank but remains a normal enemy: concentrated late-game fire can kill it quickly, and it has no boss health bar or phase transitions.

### Selecting a ritual

Once the necromancer reaches its hover position, it may begin a ritual when all of these conditions are true:

1. It is not stunned, leaving, or already channeling.
2. At least one eligible corpse is no more than eight seconds old and within 300 pixels.
3. It controls fewer than six living raised enemies.
4. Its ritual cooldown has elapsed.

The ritual selects up to three corpses, limited by the remaining six-minion capacity. Nearest corpses are selected first; equal-distance ties use the older corpse first so selection is deterministic.

Selected corpses are removed from the shared corpse pool as soon as channeling starts. They therefore cannot be selected by another necromancer. They are either raised when the ritual succeeds or dissolved when it fails.

The necromancer does **not** conjure replacement grunts when there are no corpses. It continues hovering until a corpse becomes available, it reaches its withdrawal condition, or the player kills it.

### Channel and interruption

- Channel duration: **1.6 seconds**.
- Base interruption threshold: **20 actual damage** received during that channel.
- Later loops add two damage to the threshold per completed six-level campaign, capped at **30 damage**.
- Damage counts after weapon and folklore modifiers. Holy Water, rockets, drones, lasers, and the ultimate therefore retain their normal value.
- Ritual damage also reduces the necromancer's normal health.
- Damage received before channeling does not count toward the ritual threshold.

If the accumulated channel damage reaches the threshold:

1. The ritual is cancelled immediately.
2. The selected corpses dissolve and cannot be selected again.
3. The necromancer is stunned for **1.0 second**.
4. Its accumulated ritual damage resets.
5. A **3.5-second** ritual cooldown begins after the stun.

If the necromancer dies during the channel, normal death handling cancels the ritual, dissolves its selected corpses, and crumbles its existing raised minions.

### Successful ritual

When the uninterrupted 1.6-second channel completes, each selected corpse returns as the same enemy type at its recorded position. Existing raised-enemy rules apply: half score, no drop, ownership by this necromancer, and the necromancer's level speed multiplier.

After success:

- The ritual damage accumulator resets.
- The same 3.5-second cooldown begins.
- The successful-ritual count increases by one.

### Withdrawal

The necromancer stops starting new rituals after either:

- **18 seconds** have elapsed since it reached its hover position; or
- it has completed **two successful rituals**.

If a ritual is active when a withdrawal condition is reached, that ritual resolves before the necromancer leaves. Raised enemies remain alive if their necromancer escapes; this is the penalty for allowing it to withdraw. Killing it before it leaves still crumbles them.

## Player feedback

The ritual must be readable without looking away from the playfield:

- The necromancer stops its horizontal drift while channeling.
- Each selected corpse displays a translucent green silhouette of the enemy being raised.
- A green beam connects each silhouette to the necromancer and brightens as the ritual nears completion.
- A five-segment ward ring surrounds the necromancer. Segments break as channel damage approaches the interruption threshold, giving approximate rather than numeric progress.
- The necromancer continues using the existing hit flash, so successful focus fire remains tactile.
- Interruption produces a compact green shockwave, dissolves the silhouettes, and displays `RITUAL BROKEN` in the Halloween theme or `REBUILD FAILED` in the classic theme.
- Success uses the existing rise particles and sound, with `RISE!` or `REBUILD!` displayed once for the whole group.
- During its one-second stun, the necromancer flickers and its sprite tilts slightly; it cannot move or begin another ritual.

The classic carrier substitutes repair beams and translucent wreck silhouettes while preserving timing and mechanics.

## State and code boundaries

The feature stays within the existing enemy and game systems:

- `Enemy` owns its ritual state: selected corpse snapshots, channel timer, ritual damage, cooldown, stun, and successful-ritual count.
- The game owns the shared corpse pool and provides the operation that turns selected snapshots into raised enemies.
- The collision/damage path reports the final damage actually applied to a necromancer so its active ritual can accumulate the same post-modifier value.
- Drawing reads the necromancer's ritual state to render silhouettes, beams, ward segments, and stun feedback. It does not mutate gameplay state.
- Level scripts keep their existing necromancer placements in Levels 5 and 6.

No global soul meter, ritual projectile, new formation type, or boss subsystem is introduced.

## Edge cases

- If fewer than three corpses are eligible, the ritual raises the available one or two.
- If the remaining ownership capacity is one, only one corpse is selected.
- A necromancer at the six-minion cap waits; it does not consume corpses or start an empty ritual.
- Two necromancers cannot target the same corpse because selection removes it from the shared pool immediately.
- An interrupted ritual never returns its selected corpses to the pool.
- Killing or removing the necromancer during its ritual cannot produce raised enemies afterward.
- The global black-cat spook pauses the ritual timer with the rest of enemy movement. Damage can still interrupt the frozen ritual.
- Pausing the game freezes ritual, cooldown, stun, and withdrawal timers through the existing paused-game behavior.
- The loop-scaled threshold stops growing at 30 so an infinite campaign remains mechanically interruptible.

## Testing

Add focused cases to the existing headless game test harness:

1. A necromancer does not begin a ritual without an eligible corpse and does not create fallback grunts.
2. It selects at most three eligible corpses, respects distance and age limits, and obeys the six-owned-minion cap.
3. Selection is deterministic and removes selected corpses from the shared pool, preventing a second necromancer from claiming them.
4. At loop zero, 19 damage does not interrupt while 20 damage does; later-loop scaling increases by two and caps at 30.
5. Post-modifier damage contributes to both health loss and ritual interruption.
6. Interruption dissolves the selected corpses, creates no minions, applies a one-second stun, and starts the cooldown after the stun.
7. An uninterrupted 1.6-second ritual raises the selected enemy types with ownership, half score, no drops, and the correct speed multiplier.
8. Killing the necromancer during a ritual cancels pending resurrection and crumbles its already-raised minions.
9. The necromancer starts no further ritual after 18 seconds or two successes, finishes an active ritual before leaving, and leaves raised minions behind if it escapes.
10. The black-cat spook pauses ritual progress.

Run the full existing automated suite and JavaScript syntax checks. Because ritual readability is visual and timing-dependent, also perform a browser playthrough in both Halloween and classic themes at a normal loadout and a heavily upgraded loadout. Confirm that corpse targets, remaining ward strength, interruption, success, stun, and withdrawal are understandable during a busy Level 5 or Level 6 wave.

## Success criteria

- A player can identify which corpses will return and understand that focused fire interrupts the ritual.
- A modest Level 5 loadout must hold fire on the necromancer for roughly one second; a strong loadout interrupts faster but an ordinary main-gun volley does not break the ritual by itself.
- Ignoring the necromancer can restore up to three meaningful enemies per ritual, making it a priority without stopping the surrounding wave.
- Killing it remains the cleanest answer because all of its surviving raised minions crumble.
- The encounter uses existing campaign structure and leaves unrelated combat, scoring, controls, leaderboard behavior, and persistence unchanged.

## Out of scope

- A necromancer boss or miniboss
- Soul collection or a player-visible soul resource
- Linked necromancer covens
- New undead enemy types
- Changes to boss resurrection, including Frankenstein's monster
- New player weapons or folklore pickups
