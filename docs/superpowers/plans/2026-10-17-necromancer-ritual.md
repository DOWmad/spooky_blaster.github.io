# Necromancer Ritual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the recurring necromancer visibly channel interruptible resurrection rituals over real corpses while preserving existing raised-minion rules and campaign structure.

**Architecture:** Keep ritual lifecycle state on `Enemy`, while `game.js` remains responsible for selecting/removing shared corpse records, materializing raised enemies, and producing game effects. Route every enemy damage source through the existing `hitTarget` seam so the necromancer accumulates final post-modifier damage consistently; render ritual state without mutating it.

**Tech Stack:** Browser JavaScript, HTML canvas, Node.js built-in test runner (`node:test`)

---

## File Structure

- Modify `tests/game.test.js`: add deterministic necromancer fixtures and lifecycle, interruption, cap, scaling, death, freeze, and withdrawal coverage.
- Modify `js/entities.js`: raise base health; add ritual constants/state, necromancer state-machine behavior, damage accumulation, and ritual/stun drawing.
- Modify `js/game.js`: replace immediate `raiseDead` with selection, completion, and interruption operations; funnel collision damage through `hitTarget`; clean up pending rituals on death.
- Modify `js/sprites.js`: cache green resurrection and cyan repair silhouettes for ritual previews.
- Modify `docs/superpowers/specs/2026-10-17-necromancer-ritual-design.md`: mark the reviewed design approved for implementation.

### Task 1: Ritual selection and successful resurrection

**Files:**
- Modify: `tests/game.test.js`
- Modify: `js/entities.js:528-823`
- Modify: `js/game.js:179-207`

- [ ] **Step 1: Add a resting-necromancer fixture and failing selection tests**

Add this helper after `fightBoss` in `tests/game.test.js`:

```js
function restingNecromancer(t, opts = {}) {
  const nec = new t.Enemy('necromancer', 240, 100, opts);
  Object.assign(nec, {
    y: 100,
    mode: 'cast',
    modeT: 0,
    necromancerTime: 0,
    ritualCooldown: 0,
  });
  t.G.enemies.push(nec);
  return nec;
}

function corpse(type, x, y, age, levelTime) {
  return { type, x, y, t: levelTime - age };
}
```

Add focused tests proving the first selection contracts:

```js
test('necromancer waits for real corpses instead of summoning fallback grunts', async () => {
  const t = await boot();
  t.play();
  const nec = restingNecromancer(t);
  nec.update(0.01, t.G);
  assert.equal(nec.maxHp, 30);
  assert.equal(nec.mode, 'cast');
  assert.equal(t.G.enemies.length, 1);
});

test('necromancer claims at most three nearby recent corpses in deterministic order', async () => {
  const t = await boot();
  t.play();
  t.G.levelTime = 10;
  const nec = restingNecromancer(t);
  const far = corpse('grunt', 450, 100, 1, t.G.levelTime);
  const old = corpse('swooper', 220, 100, 4, t.G.levelTime);
  const newer = corpse('shooter', 260, 100, 2, t.G.levelTime);
  const nearest = corpse('diver', 230, 100, 1, t.G.levelTime);
  const stale = corpse('phantom', 240, 100, 9, t.G.levelTime);
  t.G.corpses = [far, newer, stale, old, nearest];
  nec.update(0.01, t.G);
  assert.equal(nec.mode, 'ritual');
  assert.deepEqual(nec.ritualTargets.map(c => c.type), ['diver', 'swooper', 'shooter']);
  assert.deepEqual(t.G.corpses.map(c => c.type), ['grunt', 'phantom']);
});
```

Add a separate cap test with five living enemies owned by the necromancer and two valid corpses; assert that exactly one corpse is selected. With six owned enemies, assert that it remains in `cast` and consumes no corpse.

- [ ] **Step 2: Run the selection tests and verify RED**

Run:

```bash
node --test --test-name-pattern='necromancer.*(health|corpse|ritual|cap)' tests/game.test.js
```

Expected: FAIL because necromancers still have 10 HP and immediately call the old `raiseDead` behavior instead of entering a ritual with selected corpse snapshots.

- [ ] **Step 3: Add ritual constants and instance state**

In `js/entities.js`, change the necromancer definition to 30 HP and add one configuration object beside `REVIVABLE`:

```js
const NECROMANCER_RITUAL = {
  channel: 1.6,
  cooldown: 3.5,
  stun: 1,
  maxTargets: 3,
  maxOwned: 6,
  corpseAge: 8,
  range: 300,
  withdrawAfter: 18,
  maxSuccesses: 2,
};
```

Initialize these fields in `Enemy` without changing other enemy behavior:

```js
this.ritualTargets = [];
this.ritualTime = 0;
this.ritualDamage = 0;
this.ritualThreshold = Math.min(30, 20 + 2 * (opts.hpBonus || 0));
this.ritualCooldown = 0;
this.ritualSuccesses = 0;
this.necromancerTime = 0;
this.stunTime = 0;
```

- [ ] **Step 4: Replace immediate raising with explicit start and completion operations**

Replace `G.raiseDead` in `js/game.js` with:

```js
G.startNecromancerRitual = nec => {
  const own = G.enemies.filter(e => e.owner === nec && !e.dead).length;
  const budget = Math.min(NECROMANCER_RITUAL.maxTargets, NECROMANCER_RITUAL.maxOwned - own);
  if (budget <= 0) return false;
  const targets = G.corpses
    .filter(c => G.levelTime - c.t <= NECROMANCER_RITUAL.corpseAge
      && Math.hypot(c.x - nec.x, c.y - nec.y) <= NECROMANCER_RITUAL.range)
    .sort((a, b) => Math.hypot(a.x - nec.x, a.y - nec.y) - Math.hypot(b.x - nec.x, b.y - nec.y)
      || a.t - b.t)
    .slice(0, budget);
  if (!targets.length) return false;
  const selected = new Set(targets);
  G.corpses = G.corpses.filter(c => !selected.has(c));
  nec.ritualTargets = targets.map(c => ({ ...c }));
  nec.ritualTime = NECROMANCER_RITUAL.channel;
  nec.ritualDamage = 0;
  nec.setMode('ritual');
  return true;
};

G.completeNecromancerRitual = nec => {
  for (const c of nec.ritualTargets) {
    const raised = new Enemy(c.type, c.x, c.y, { raised: true, owner: nec, speedMul: nec.speedMul });
    raised.stopY = Math.max(raised.stopY, c.y);
    G.enemies.push(raised);
    for (let i = 0; i < 8; i++) G.particles.push({
      x: c.x + rand(-10, 10), y: c.y + 10, vx: 0, vy: rand(-140, -60),
      life: 0.6, max: 0.6, color: '#66ff66', size: 3,
    });
  }
  nec.ritualTargets = [];
  nec.ritualDamage = 0;
  nec.ritualSuccesses++;
  nec.ritualCooldown = NECROMANCER_RITUAL.cooldown;
  nec.setMode('cast');
  popup(Theme.halloween ? 'RISE!' : 'REBUILD!', nec.x, nec.y - 26, '#66ff66');
  Sound.sfx.raise();
};
```

- [ ] **Step 5: Implement the necromancer lifecycle state machine**

Replace the current `case 'necromancer'` branch in `Enemy.update` with explicit lifecycle handling:

```js
case 'necromancer':
  if (this.mode === 'enter') {
    this.y += this.speed * dt;
    if (this.y >= Math.min(this.stopY, 150)) this.setMode('cast');
    break;
  }
  if (this.mode !== 'leave') this.necromancerTime += dt;
  if (this.mode === 'cast') {
    if (this.necromancerTime >= NECROMANCER_RITUAL.withdrawAfter
      || this.ritualSuccesses >= NECROMANCER_RITUAL.maxSuccesses) {
      this.setMode('leave');
      break;
    }
    this.x += this.dir * 40 * dt;
    if (this.x < 40 || this.x > W - 40) this.dir *= -1;
    this.ritualCooldown = Math.max(0, this.ritualCooldown - dt);
    if (this.ritualCooldown === 0) game.startNecromancerRitual(this);
  } else if (this.mode === 'ritual') {
    this.ritualTime -= dt;
    if (this.ritualTime <= 0) game.completeNecromancerRitual(this);
  } else if (this.mode === 'stunned') {
    this.stunTime -= dt;
    if (this.stunTime <= 0) {
      this.ritualCooldown = NECROMANCER_RITUAL.cooldown;
      this.setMode('cast');
    }
  } else {
    this.y += this.speed * dt;
  }
  break;
```

- [ ] **Step 6: Add successful-ritual and withdrawal tests, then verify GREEN**

Add a successful ritual test using one `shooter` corpse, call `nec.update(1.61, G)`, and assert the new shooter has `raised === true`, `owner === nec`, `score === 150`, `drop === 0`, and `speedMul === nec.speedMul`. Add withdrawal tests that set `ritualSuccesses = 2` or `necromancerTime = 18`, call `update`, and assert `mode === 'leave'`. For the active-channel boundary, set `necromancerTime = 18`, `mode = 'ritual'`, and `ritualTime = 0.1`; assert the ritual completes before the following update changes the mode to `leave`. Add an owned-minion escape assertion proving an existing raised enemy remains alive when its owner leaves.

Run:

```bash
node --test --test-name-pattern='necromancer' tests/game.test.js
```

Expected: all necromancer tests pass.

- [ ] **Step 7: Commit this slice only if explicitly authorized**

```bash
git add tests/game.test.js js/entities.js js/game.js docs/superpowers/specs/2026-10-17-necromancer-ritual-design.md docs/superpowers/plans/2026-10-17-necromancer-ritual.md
git commit -m "feat: add necromancer resurrection ritual"
```

### Task 2: Damage interruption, stun, death, and freeze behavior

**Files:**
- Modify: `tests/game.test.js`
- Modify: `js/entities.js:801-809`
- Modify: `js/game.js:413-419,441-466,920-929`

- [ ] **Step 1: Write failing interruption tests**

Add tests that start a ritual with a corpse and then apply real friendly bullets through the game loop. Prove these exact contracts:

```js
assert.equal(nec.ritualThreshold, 20); // base campaign
assert.equal(new t.Enemy('necromancer', 0, 0, { hpBonus: 2 }).ritualThreshold, 24);
assert.equal(new t.Enemy('necromancer', 0, 0, { hpBonus: 99 }).ritualThreshold, 30);
```

- Nineteen post-modifier damage leaves the ritual active.
- The twentieth point cancels it, consumes its snapshots, creates no minion, enters `stunned`, and lasts one second.
- Ritual damage also lowers normal HP.
- A Holy Water bullet contributes doubled damage through the existing `holyMult` path.
- Killing a channeling necromancer cancels pending resurrection and crumbles already-raised minions.
- Ramming damage uses the same interruption-aware damage path.
- A black-cat spook pauses `ritualTime`, while damage during the freeze can still interrupt it.
- Setting `G.paused = true` and advancing frames leaves ritual, cooldown, stun, and withdrawal timers unchanged.

- [ ] **Step 2: Run interruption tests and verify RED**

Run:

```bash
node --test --test-name-pattern='necromancer.*(damage|interrupt|stun|death|spook|threshold)' tests/game.test.js
```

Expected: FAIL because ritual damage is not accumulated or broken yet.

- [ ] **Step 3: Accumulate ritual damage in `Enemy.hit`**

Before subtracting HP, add:

```js
if (this.type === 'necromancer' && this.mode === 'ritual') this.ritualDamage += dmg;
```

Keep the existing HP subtraction, flash, and boolean death return unchanged.

- [ ] **Step 4: Add the interruption operation and route all enemy damage through it**

Add to `js/game.js`:

```js
G.breakNecromancerRitual = nec => {
  if (nec.mode !== 'ritual') return;
  nec.ritualTargets = [];
  nec.ritualDamage = 0;
  nec.stunTime = NECROMANCER_RITUAL.stun;
  nec.setMode('stunned');
  shockwave(nec.x, nec.y, 70, Theme.halloween ? '#66ff66' : '#33ffff', 0.35, 4);
  popup(Theme.halloween ? 'RITUAL BROKEN' : 'REBUILD FAILED', nec.x, nec.y - 32,
    Theme.halloween ? '#66ff66' : '#33ffff');
};
```

In `hitTarget`, store the result of `o.hit(dmg)`. Kill as today when true; otherwise call `G.breakNecromancerRitual(o)` when a ritual's accumulated damage reaches its threshold, then play the normal hit sound unless `quiet`. Replace the direct ramming `e.hit(3)` call with `hitTarget(e, 3)` so every enemy-damage route uses this seam.

In `killEnemy`, clear `e.ritualTargets` before the necromancer's owned-minion cleanup. Selected corpses were already removed from `G.corpses`, so death dissolves rather than restores them.

- [ ] **Step 5: Run interruption tests and verify GREEN**

Run:

```bash
node --test --test-name-pattern='necromancer.*(damage|interrupt|stun|death|spook|threshold)' tests/game.test.js
```

Expected: all matching tests pass with no logged errors.

- [ ] **Step 6: Run all game tests to catch collision regressions**

Run:

```bash
node --test tests/game.test.js
```

Expected: all tests pass, including the existing ramming, Holy Water, black-cat, boss, touch, and leaderboard integration cases.

- [ ] **Step 7: Commit this slice only if explicitly authorized**

```bash
git add tests/game.test.js js/entities.js js/game.js
git commit -m "feat: make necromancer rituals interruptible"
```

### Task 3: Ritual silhouettes, beams, ward ring, and stun feedback

**Files:**
- Modify: `js/sprites.js:500-535`
- Modify: `js/entities.js:811-849`
- Modify: `tests/game.test.js`

- [ ] **Step 1: Add a failing headless draw smoke test**

Create a necromancer in `ritual` mode with one target snapshot and assert the sprite cache exposes the new themed silhouettes before exercising both draw states:

```js
test('necromancer ritual and stun states draw without errors', async () => {
  const t = await boot();
  t.play();
  const layers = vm.runInContext("Sprites.get('grunt')", t.context);
  assert.ok(layers.revive);
  assert.ok(layers.repair);
  const nec = new t.Enemy('necromancer', 240, 100);
  Object.assign(nec, {
    mode: 'ritual', ritualTime: 1, ritualDamage: 4,
    ritualTargets: [{ type: 'grunt', x: 200, y: 200 }],
  });
  nec.draw(blob, 1);
  nec.setMode('stunned');
  nec.draw(blob, 1.1);
  assert.deepEqual(t.errors, []);
});
```

- [ ] **Step 2: Run the draw test and verify RED**

Run:

```bash
node --test --test-name-pattern='necromancer.*draw' tests/game.test.js
```

Expected: FAIL on the new ritual-rendering contract or missing ritual silhouette canvases.

- [ ] **Step 3: Cache themed ritual silhouettes**

In `Sprites.make`, create two additional canvases alongside `img`, `flash`, and `gold`: `revive` filled `#66ff66` and `repair` filled `#33ffff`. Draw every non-empty sprite pixel into both and return them from the cached sprite object:

```js
return { img, flash, gold, revive, repair, w: img.width, h: img.height };
```

- [ ] **Step 4: Render ritual state without changing gameplay**

Add an `Enemy.drawRitual(ctx, t)` helper that returns immediately unless `mode === 'ritual'`. For each snapshot, draw the theme-appropriate silhouette at its corpse coordinates with pulsing 0.2–0.4 alpha, then draw a beam from that location to the necromancer whose alpha increases with `1 - ritualTime / 1.6`.

Draw five arc segments around the necromancer, with the visible count calculated from remaining stability:

```js
const remaining = Math.max(0, 1 - this.ritualDamage / this.ritualThreshold);
const segments = Math.ceil(5 * remaining);
```

Call `drawRitual` before drawing the necromancer sprite. While `mode === 'stunned'`, rotate the saved canvas around the enemy center by `Math.sin(t * 30) * 0.12` and flicker its alpha; restore the canvas exactly once on every path.

- [ ] **Step 5: Run the draw test and full automated suite**

Run:

```bash
node --test --test-name-pattern='necromancer.*draw' tests/game.test.js
node --test tests/*.test.js
node --check js/entities.js
node --check js/game.js
node --check js/sprites.js
```

Expected: all tests and syntax checks pass with no errors or warnings.

- [ ] **Step 6: Commit this slice only if explicitly authorized**

```bash
git add js/sprites.js js/entities.js tests/game.test.js
git commit -m "feat: show necromancer ritual feedback"
```

### Task 4: Browser validation and final review

**Files:**
- Review: `js/entities.js`
- Review: `js/game.js`
- Review: `js/sprites.js`
- Review: `tests/game.test.js`
- Review: `docs/superpowers/specs/2026-10-17-necromancer-ritual-design.md`

- [ ] **Step 1: Start the existing local game server**

Run this command and load `http://127.0.0.1:4173` in a real browser:

```bash
python3 -m http.server 4173 --bind 127.0.0.1
```

Do not claim visual or runtime success from headless tests alone.

- [ ] **Step 2: Validate Halloween behavior**

Start a Halloween game, set Level 5 through the game's existing state, and create recent `grunt`, `shooter`, and `phantom` corpse records around a resting necromancer through browser evaluation. Confirm: selected corpses are obvious, beams and five ward segments remain legible, interruption text and stun appear, success raises the correct enemies, two successes trigger withdrawal, and killing the necromancer crumbles its owned minions. The automated tests remain the exact proof for the 19/20-damage boundary.

- [ ] **Step 3: Validate classic behavior**

Switch themes and confirm the carrier shows cyan repair silhouettes/beams, `REBUILD FAILED`/`REBUILD!` copy, and identical timing and mechanics.

- [ ] **Step 4: Validate both loadout targets**

With a modest Level 5 loadout, confirm interruption takes roughly one second of accurate fire. With a heavily upgraded ship, confirm interruption is faster but a single ordinary main-gun volley remains below the base threshold.

- [ ] **Step 5: Run final non-visual verification**

Run:

```bash
node --test tests/*.test.js
node --check js/*.js
git diff --check
git status --short
```

Expected: all automated checks pass; the diff contains only the necromancer design/plan and implementation plus the user's pre-existing untracked mobile documents.

- [ ] **Step 6: Report without committing**

Summarize automated results, real-browser observations, and any environment limitation separately. Leave changes uncommitted unless the user explicitly authorizes `git commit`.
