# Animation Accessibility and Polish Design

Date: 2026-10-17
Status: Approved design, awaiting implementation plan

## Goal

Correct the animation audit findings and add the three identified polish opportunities without changing scoring, combat balance, leaderboard rules, or the approved impact effects. Freeze-frames on large hits, enemy hit-white feedback, enemy shattering, and the instant pause overlay remain intact.

Real-device performance profiling is outside this implementation slice. It remains a manual follow-up on representative 60 Hz and 120 Hz devices.

## Architecture

Keep motion state inside the existing canvas game architecture rather than introducing a new module or refactoring the state machine. Add narrowly scoped state and helpers for:

- live reduced-motion preference;
- fixed-tick screen-shake offsets;
- capped full-screen flash intensity;
- blink-rate limiting;
- boss-health trailing display;
- banner and title/table transition opacity;
- touch-button pressed state; and
- the world-rank-1 celebration timeline.

All timers and random shake offsets advance in the fixed 60 Hz update. Rendering consumes the resulting values and does not generate new shake offsets. This keeps motion intensity independent of display refresh rate.

The boss entrance and sway ramp remain owned by `Boss` in `js/entities.js`. The rest of the behavior remains in `js/game.js`, matching the current division of responsibility.

## Accessibility

Observe `window.matchMedia('(prefers-reduced-motion: reduce)')` at startup and subscribe to preference changes for the lifetime of the page.

When reduced motion is enabled:

- screen-shake offsets are always zero;
- full-screen white flash opacity is capped at `0.25`; and
- repeating blink requests are limited to at most three cycles per second.

For all players, full-screen flash opacity is capped at `0.60`.

Freeze-frames remain enabled because they communicate impact without moving the viewport. Enemy hit-white feedback and shatter effects also remain. Reduced motion changes only viewport movement, full-screen flash intensity, and rapid repetitive blinking.

## Result-Screen Skipping

Level-clear and victory screens continue to advance automatically at 4.5 seconds and 9 seconds respectively.

They also accept Enter, Space, or a tap after their score line is visible:

- level clear: skippable from 2.4 seconds;
- victory: skippable from 3 seconds.

Input before those thresholds does nothing, ensuring the complete bonus tally is shown at least once. Skipping follows the same next-level and next-loop paths as automatic advancement.

## Boss Entrance

Each boss records its entrance origin and normalized entrance time. Its vertical position moves to `targetY` over two seconds with a strong cubic ease-out, producing a soft stop.

After the entrance completes, horizontal and vertical sway amplitude ramps from zero to full over 0.6 seconds. Attack timing and the berserk clock begin under the same conditions as the current `fight` state; this change affects presentation only.

## Screen Shake

The fixed update computes a random `shakeX` and `shakeY` once per game step from the current shake magnitude. Rendering applies those stored offsets until the next update. A 120 Hz display can therefore render the same offset twice, rather than generating twice as many impulses as a 60 Hz display.

Shake decay remains update-driven. Reduced motion writes zero offsets even when an impact sets a nonzero shake magnitude, so gameplay code does not need separate accessibility branches at every impact source.

## Touch Feedback

The Pause button and an enabled ULT button show held-pointer feedback:

- scale to `0.95` around their centers; and
- use a brighter stroke/fill treatment.

Feedback begins on pointer down and ends on pointer up or cancellation. The disabled ULT button remains visually disabled and does not show an enabled press treatment. Hit-target sizes do not change.

## Boss Health Trail

The immediate boss-health bar continues to show current HP. A contrasting bar behind it retains the previous higher value and catches down to current HP over 0.4 seconds.

The trail snaps upward on healing, revival, or a newly spawned boss. It never trails upward, because that would read as delayed damage rather than healing. The effect is visual only and does not alter HP or phase thresholds.

## Banner and Title Fades

The level banner fades in over 0.2 seconds and fades out over its final 0.2 seconds. Its existing total lifetime and gameplay timing remain unchanged.

The title screen and score table crossfade over 0.2 seconds at each nine-second boundary. Both are drawn only as needed for the crossfade, and input continues to use the currently dominant screen's existing behavior. The transition does not delay starting a game or switching theme.

Under reduced motion, both features retain opacity fades because they remove hard visual cuts without moving content.

## World Rank 1 Celebration

When a leaderboard submission resolves to numeric rank 1, start the selected Champion burst once:

- emit one gold shockwave and a short gold/magenta/cyan particle burst;
- reveal a framed `WORLD #1` lockup; and
- keep Continue input available throughout.

The celebration is tied to the active run ID, like the existing submission result. Failed submissions, non-number results, non-first ranks, and stale responses from previous runs do not trigger it.

Reduced motion skips the burst and shows the static framed lockup immediately. The celebration does not add audio in this slice, avoiding a new sound-design dependency.

## Error and State Handling

- A live reduced-motion preference change takes effect on the next update/render cycle.
- Pointer cancellation clears button pressed state.
- State changes reset screen-specific visual timers so effects cannot leak into later screens.
- A late leaderboard response remains guarded by `runId` and cannot modify or celebrate a newer run.
- Existing global frame-error handling remains unchanged.

## Testing

Extend the headless game harness so `matchMedia` can represent coarse-pointer and reduced-motion queries independently and dispatch preference changes.

Add focused regression tests for:

- the `0.60` default and `0.25` reduced-motion flash caps;
- zero rendered shake under reduced motion;
- repeating blink rates no faster than three cycles per second under reduced motion;
- shake offsets changing on fixed updates rather than renders;
- level-clear and victory input thresholds and automatic timeouts;
- the two-second boss entrance and 0.6-second sway ramp;
- Pause and enabled-ULT held feedback, including pointer cancellation;
- boss-health trail timing, healing, revival, and boss replacement;
- banner and title/table opacity transitions;
- a one-shot rank-1 celebration and its reduced-motion static variant; and
- no celebration for failed, lower-rank, or stale submissions.

Run the full Node test suite plus syntax and diff checks. Manual verification covers feel on touch hardware, live preference changes, and comparable shake behavior on 60 Hz and 120 Hz displays. Device profiling remains explicitly unverified until performed on real hardware.

## Non-Goals

- Changing combat, scoring, boss phases, or leaderboard rules.
- Removing approved freeze-frames, enemy hit-white feedback, shattering, or instant pause behavior.
- Adding new audio assets.
- Refactoring the overall game state machine.
- Claiming real-device performance without profiling evidence.
