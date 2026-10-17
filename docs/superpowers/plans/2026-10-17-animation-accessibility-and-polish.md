# Animation Accessibility and Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Honor reduced-motion preferences, correct refresh-rate-dependent shake, improve transition physicality and touch feedback, and add the approved boss-health, fade, and world-rank-1 polish without altering game rules.

**Architecture:** Keep the existing canvas state machine and add a small `G.motion` state object plus pure motion helpers in `js/game.js`. Update motion exclusively from the fixed 60 Hz game step; rendering reads stored values. Keep boss-owned motion in `js/entities.js` and extend `js/input.js` only with active-touch inspection needed for held-button feedback.

**Tech Stack:** Browser JavaScript, Canvas 2D, fixed-timestep `requestAnimationFrame` loop, Node.js built-in test runner, `vm` headless browser harness.

**Design reference:** `docs/superpowers/specs/2026-10-17-animation-accessibility-and-polish-design.md`

**Commit policy:** The user requires explicit authorization before commits. Each task ends with a commit-ready checkpoint; run the listed `git add` and `git commit` commands only after that authorization. Otherwise leave the verified edits uncommitted and continue only when authorized to do so.

---

## File Map

- Modify `js/game.js`: motion preference, flash/blink policy, fixed-tick shake, result skipping, HUD trail, fades, and rank-1 celebration.
- Modify `js/entities.js`: accessible entity blinking and boss entrance/sway ramp.
- Modify `js/input.js`: expose whether an active touch is inside a canvas control.
- Modify `tests/game.test.js`: configurable media-query harness, observable canvas calls, and all regressions.
- No new runtime files.

### Task 1: Make the test harness observe media-query changes

**Files:**
- Modify: `tests/game.test.js:9-72`

- [ ] **Step 1: Extend `boot` with controllable media queries**

Keep the existing opaque canvas context. Replace the current `matchMedia` stub with stable media-query objects:

```js
async function boot({ phone = false, reduceMotion = false, fetch = () => Promise.reject(new Error('offline')) } = {}) {
  const listeners = {};
  const errors = [];
  let raf = null;
  let now = 0;

  const media = new Map();
  const mediaQuery = query => {
    if (!media.has(query)) {
      const changes = new Set();
      const mql = {
        media: query,
        matches: query === '(pointer: coarse)' ? phone
          : query === '(prefers-reduced-motion: reduce)' ? reduceMotion
            : false,
        addEventListener: (type, fn) => { if (type === 'change') changes.add(fn); },
        removeEventListener: (type, fn) => { if (type === 'change') changes.delete(fn); },
        setMatches(matches) {
          this.matches = matches;
          for (const fn of changes) fn({ matches, media: query });
        },
      };
      media.set(query, mql);
    }
    return media.get(query);
  };
```

In the sandbox, use `matchMedia: mediaQuery`. Return these test controls from `boot`:

```js
return {
  ...game, Input, key, finger, tap, run, play, catUnderShip, errors, flush,
  mediaQuery, context: sandbox,
};
```

- [ ] **Step 2: Run the existing suite to prove the harness remains compatible**

Run: `node --test tests/game.test.js`

Expected: all existing tests pass; no test reports a `matchMedia` error.

- [ ] **Step 3: Commit-ready checkpoint**

After explicit commit authorization only:

```bash
git add tests/game.test.js
git commit -m "test(animation): expose media and canvas state"
```

### Task 2: Centralize reduced-motion, flash, blink, and fixed-tick shake policy

**Files:**
- Modify: `js/game.js:10-26, 1039-1061, 1118-1121, 1435-1450`
- Modify: `js/entities.js:625-718, 1117-1185`
- Test: `tests/game.test.js`

- [ ] **Step 1: Write failing tests for motion preference, caps, blink rate, and stable shake**

Append focused tests:

```js
test('motion policy caps flashes and follows reduced motion live', async () => {
  const t = await boot();
  assert.equal(t.G.motion.flashAlpha(1), 0.6);
  t.mediaQuery('(prefers-reduced-motion: reduce)').setMatches(true);
  assert.equal(t.G.motion.reduce, true);
  assert.equal(t.G.motion.flashAlpha(1), 0.25);
});

test('reduced motion removes shake and limits requested blink rates', async () => {
  const t = await boot({ reduceMotion: true });
  t.play();
  t.G.shake = 15;
  t.run(1 / 60);
  assert.deepEqual([t.G.motion.shakeX, t.G.motion.shakeY], [0, 0]);
  assert.equal(t.G.motion.blinkRate(8), 3);
  assert.equal(t.G.motion.blinkRate(2), 2);
});

test('shake offsets change on game ticks and not extra renders', async () => {
  const t = await boot();
  t.play();
  t.G.shake = 15;
  t.run(1 / 60);
  const first = [t.G.motion.shakeX, t.G.motion.shakeY];
  vm.runInContext('render()', t.context);
  vm.runInContext('render()', t.context);
  assert.deepEqual([t.G.motion.shakeX, t.G.motion.shakeY], first);
  t.run(1 / 60);
  assert.notDeepEqual([t.G.motion.shakeX, t.G.motion.shakeY], first);
});
```

Expose a debug-only render hook beside `window.G = G` so the final test can render without advancing:

```js
window.render = () => render();
```

- [ ] **Step 2: Run the tests and verify the expected RED state**

Run: `node --test --test-name-pattern="motion policy|reduced motion|shake offsets" tests/game.test.js`

Expected: FAIL because `G.motion` and the render hook do not exist.

- [ ] **Step 3: Add the live preference and motion helpers**

Near the top of `js/game.js`, after constants and before `G`, add:

```js
const reduceMotionQuery = window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false, addEventListener() {} };

const motion = {
  reduce: reduceMotionQuery.matches,
  shakeX: 0,
  shakeY: 0,
  flashAlpha: value => Math.min(value, motion.reduce ? 0.25 : 0.6),
  blinkRate: rate => Math.min(rate, motion.reduce ? 3 : rate),
  blink: (time, rate = 2) => Math.floor(time * motion.blinkRate(rate) * 2) % 2 === 0,
};
reduceMotionQuery.addEventListener('change', event => { motion.reduce = event.matches; });
```

Add `motion` to `G`:

```js
const G = {
  // existing fields...
  motion,
};
```

Replace the local blink helper with:

```js
const blink = (rate = 2) => G.motion.blink(G.t, rate);
```

- [ ] **Step 4: Compute shake offsets in the fixed update and consume them in render**

Add a separate fixed-step helper:

```js
function updateShakeOffset() {
  if (G.motion.reduce || (G.state === 'playing' && G.paused) || G.shake <= 0) {
    G.motion.shakeX = 0;
    G.motion.shakeY = 0;
  } else {
    G.motion.shakeX = rand(-G.shake, G.shake);
    G.motion.shakeY = rand(-G.shake, G.shake);
  }
}
```

Call `updateShakeOffset()` after the state switch in `update(dt)`, so impacts created during that tick are represented immediately and pausing clears any stored offset. Hitstop continues returning before this call, preserving its frozen frame.

Replace render-time randomness and the flash alpha expression with:

```js
if (G.motion.shakeX || G.motion.shakeY) ctx.translate(G.motion.shakeX, G.motion.shakeY);
```

```js
ctx.fillStyle = `rgba(255, 255, 255, ${G.motion.flashAlpha(G.flash)})`;
```

- [ ] **Step 5: Route rapid entity blinking through the shared policy**

In `js/entities.js`, replace the diver, witch, mine, boss-pounce, and boss-stun parity expressions with the shared clock:

```js
this.flash = game.motion.blink(this.modeT, 6) ? 0.02 : 0;  // diver lock-on
this.flash = game.motion.blink(this.spellT, 10) ? 0.02 : 0; // witch wind-up
this.flash = game.motion.blink(this.t, 7) ? 0.02 : 0;       // mine fuse
this.flash = game.motion.blink(lp.t, 6) ? 0.02 : 0;         // boss crouch
this.flash = game.motion.blink(this.stun, 6) ? 0.02 : 0;    // boss stun
```

Keep ordinary hit-white duration assignments such as `this.flash = 0.06` unchanged.

- [ ] **Step 6: Run focused and full tests**

Run: `node --test --test-name-pattern="motion policy|reduced motion|shake offsets" tests/game.test.js`

Expected: the three new tests pass.

Run: `node --test tests/game.test.js`

Expected: all tests pass.

- [ ] **Step 7: Commit-ready checkpoint**

After explicit commit authorization only:

```bash
git add js/game.js js/entities.js tests/game.test.js
git commit -m "fix(animation): honor reduced motion"
```

### Task 3: Make level-clear and victory results skippable after their tallies

**Files:**
- Modify: `js/game.js:950-965`
- Test: `tests/game.test.js`

- [ ] **Step 1: Write failing result-screen input tests**

Append:

```js
test('level clear ignores early input and skips after the score appears', async () => {
  const t = await boot();
  t.play();
  Object.assign(t.G, { state: 'levelclear', stateTime: 2.3, level: 1 });
  t.key('keydown', 'Enter');
  t.run(1 / 60);
  assert.equal(t.G.state, 'levelclear');
  t.key('keyup', 'Enter');
  t.run(0.2);
  t.key('keydown', 'Enter');
  t.run(1 / 60);
  assert.equal(t.G.state, 'playing');
  assert.equal(t.G.level, 2);
});

test('victory ignores early taps and skips after the score appears', async () => {
  const t = await boot({ phone: true });
  t.play();
  Object.assign(t.G, { state: 'victory', stateTime: 2.9, victory: true, level: 10 });
  t.tap(240, 400);
  t.run(1 / 60);
  assert.equal(t.G.state, 'victory');
  t.run(0.2);
  t.tap(240, 400);
  t.run(1 / 60);
  assert.equal(t.G.state, 'playing');
  assert.equal(t.G.level, 11);
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `node --test --test-name-pattern="level clear ignores|victory ignores" tests/game.test.js`

Expected: FAIL because both states still wait for their automatic timeout.

- [ ] **Step 3: Add one shared result-input predicate and update both states**

In `js/game.js`, add:

```js
const resultAdvancePressed = () => Input.wasPressed('Enter', 'Space') || tapped();
```

Update the two functions:

```js
function updateLevelClear() {
  if (G.stateTime >= 4.5 || (G.stateTime >= 2.4 && resultAdvancePressed())) {
    G.level++;
    startLevel(G.level);
    setState('playing');
  }
}

function updateVictory() {
  if (G.stateTime >= 9 || (G.stateTime >= 3 && resultAdvancePressed())) {
    G.victory = false;
    G.level++;
    startLevel(G.level);
    setState('playing');
  }
}
```

- [ ] **Step 4: Run focused and full tests**

Run: `node --test --test-name-pattern="level clear ignores|victory ignores" tests/game.test.js`

Expected: both tests pass.

Run: `node --test tests/game.test.js`

Expected: all tests pass.

- [ ] **Step 5: Commit-ready checkpoint**

After explicit commit authorization only:

```bash
git add js/game.js tests/game.test.js
git commit -m "fix(animation): allow result screens to skip"
```

### Task 4: Ease the boss entrance and ramp its sway

**Files:**
- Modify: `js/entities.js:1066-1095, 1150-1178`
- Test: `tests/game.test.js`

- [ ] **Step 1: Write failing boss-motion tests**

Append:

```js
test('boss entrance eases to its target over two seconds', async () => {
  const t = await boot();
  t.play();
  const boss = new t.Boss(1);
  const startY = boss.y;
  boss.update(1, t.G);
  assert.ok(boss.y > startY + (boss.targetY - startY) * 0.5, 'ease-out covers most distance early');
  assert.equal(boss.state, 'enter');
  boss.update(1, t.G);
  assert.equal(boss.y, boss.targetY);
  assert.equal(boss.state, 'fight');
});

test('boss sway ramps from zero after entering', async () => {
  const t = await boot();
  t.play();
  const boss = new t.Boss(1);
  boss.update(2, t.G);
  const x0 = boss.x;
  boss.update(0.1, t.G);
  assert.ok(boss.swayMix > 0 && boss.swayMix < 1);
  assert.ok(Math.abs(boss.x - x0) < 20, 'sway begins gently');
  boss.update(0.5, t.G);
  assert.equal(boss.swayMix, 1);
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `node --test --test-name-pattern="boss entrance eases|boss sway ramps" tests/game.test.js`

Expected: FAIL because entrance is constant-speed and `swayMix` does not exist.

- [ ] **Step 3: Add entrance and sway state in the constructor**

In `Boss`:

```js
this.enterFromY = this.y;
this.enterTime = 0;
this.enterDuration = 2;
this.swayMix = 0;
```

- [ ] **Step 4: Replace constant-speed entrance and multiply sway by the ramp**

Use a cubic ease-out:

```js
if (this.state === 'enter') {
  this.enterTime = Math.min(this.enterDuration, this.enterTime + dt);
  const k = this.enterTime / this.enterDuration;
  const eased = 1 - (1 - k) ** 3;
  this.y = this.enterFromY + (this.targetY - this.enterFromY) * eased;
  if (k >= 1) { this.y = this.targetY; this.state = 'fight'; }
  return;
}
```

Before normal boss movement, advance the ramp and apply it to both sway axes:

```js
this.swayMix = Math.min(1, this.swayMix + dt / 0.6);
```

```js
this.x = W / 2 + Math.sin(this.moveT * 0.7 * this.speedMul) * range * this.swayMix;
this.y = this.targetY + Math.sin(this.moveT * 1.3) * 15 * this.swayMix;
```

- [ ] **Step 5: Run focused and full tests**

Run: `node --test --test-name-pattern="boss entrance eases|boss sway ramps" tests/game.test.js`

Expected: both tests pass.

Run: `node --test tests/game.test.js`

Expected: all tests pass, including existing boss fight tests.

- [ ] **Step 6: Commit-ready checkpoint**

After explicit commit authorization only:

```bash
git add js/entities.js tests/game.test.js
git commit -m "fix(animation): ease boss entrances"
```

### Task 5: Add held touch feedback to Pause and ULT

**Files:**
- Modify: `js/input.js:8-65`
- Modify: `js/game.js:1308-1317`
- Test: `tests/game.test.js`

- [ ] **Step 1: Write failing active-touch and cancellation tests**

Append:

```js
test('touch controls expose held press feedback and clear it on release', async () => {
  const t = await boot({ phone: true });
  playByTouch(t);
  t.finger('pointerdown', 480 - 46, 640 - 112, 9);
  assert.equal(t.Input.isTouching(480 - 46, 640 - 112, 30), true);
  t.finger('pointerup', 480 - 46, 640 - 112, 9);
  assert.equal(t.Input.isTouching(480 - 46, 640 - 112, 30), false);
});

test('pointer cancellation clears touch-control feedback', async () => {
  const t = await boot({ phone: true });
  playByTouch(t);
  t.finger('pointerdown', 480 - 26, 104, 7);
  assert.equal(t.Input.isTouching(480 - 26, 104, 20), true);
  t.finger('pointercancel', 480 - 26, 104, 7);
  assert.equal(t.Input.isTouching(480 - 26, 104, 20), false);
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `node --test --test-name-pattern="touch controls expose|pointer cancellation clears" tests/game.test.js`

Expected: FAIL because `Input.isTouching` does not exist.

- [ ] **Step 3: Track active touch positions in `Input`**

Add `const activeTouches = new Map();`. On pointer down and move, update it with game coordinates. Replace the lift handler and blur cleanup with:

```js
const lift = e => {
  activeTouches.delete(e.pointerId);
  if (e.pointerId === dragId) dragId = null;
};
```

```js
addEventListener('blur', () => {
  down.clear();
  activeTouches.clear();
  dragId = null;
});
```

Expose:

```js
isTouching: (x, y, r) => [...activeTouches.values()]
  .some(p => Math.hypot(p.x - x, p.y - y) < r),
```

- [ ] **Step 4: Draw each control around its own center with press treatment**

Change `drawButton` to accept `pressed` and transform locally:

```js
function drawButton(b, color, alpha, pressed = false, drawContent = () => {}) {
  ctx.save();
  ctx.translate(b.x, b.y);
  if (pressed) ctx.scale(0.95, 0.95);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = pressed ? 'rgba(255, 255, 255, 0.22)' : 'rgba(0, 0, 0, 0.35)';
  ctx.strokeStyle = color;
  ctx.lineWidth = pressed ? 3 : 2;
  ctx.beginPath();
  ctx.arc(0, 0, b.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.globalAlpha = 1;
  drawContent();
  ctx.restore();
}
```

In `drawTouchButtons`, compute:

```js
const pausePressed = Input.isTouching(PAUSE_BTN.x, PAUSE_BTN.y, PAUSE_BTN.r + 10);
const ultPressed = ultReady && Input.isTouching(ULT_BTN.x, ULT_BTN.y, ULT_BTN.r + 10);
```

Then draw each complete control inside that transform:

```js
drawButton(PAUSE_BTN, '#ffffff', pausePressed ? 0.75 : 0.5, pausePressed, () => {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-6, -7, 4, 14);
  ctx.fillRect(2, -7, 4, 14);
});
drawButton(ULT_BTN, ultReady ? rainbow(0) : '#666666', ultReady ? (ultPressed ? 1 : 0.9) : 0.4, ultPressed, () => {
  text('ULT', 1, 1, 10, ultReady ? '#ffffff' : '#888888');
});
```

- [ ] **Step 5: Run focused and full tests**

Run: `node --test --test-name-pattern="touch controls expose|pointer cancellation clears|pause button|ULT button" tests/game.test.js`

Expected: new and existing touch-control tests pass.

Run: `node --test tests/game.test.js`

Expected: all tests pass.

- [ ] **Step 6: Commit-ready checkpoint**

After explicit commit authorization only:

```bash
git add js/input.js js/game.js tests/game.test.js
git commit -m "feat(animation): add touch press feedback"
```

### Task 6: Add the trailing boss-health bar

**Files:**
- Modify: `js/game.js:16-26, 1039-1061, 1277-1303`
- Test: `tests/game.test.js`

- [ ] **Step 1: Write failing tests for damage, healing, and replacement**

Append:

```js
test('boss health trail catches down over 0.4 seconds', async () => {
  const t = await boot();
  t.play();
  const boss = new t.Boss(1);
  Object.assign(boss, { state: 'fight', y: boss.targetY });
  Object.assign(t.G, { boss, phase: 'boss' });
  t.run(1 / 60);
  boss.hp = boss.maxHp / 2;
  t.run(0.2);
  assert.ok(t.G.motion.bossHpTrail > boss.hp && t.G.motion.bossHpTrail < boss.maxHp);
  t.run(0.25);
  assert.equal(t.G.motion.bossHpTrail, boss.hp);
});

test('boss health trail snaps upward for healing and boss replacement', async () => {
  const t = await boot();
  t.play();
  const first = new t.Boss(1);
  Object.assign(first, { state: 'fight', hp: first.maxHp / 2 });
  Object.assign(t.G, { boss: first, phase: 'boss' });
  t.run(1 / 60);
  first.hp = first.maxHp;
  t.run(1 / 60);
  assert.equal(t.G.motion.bossHpTrail, first.maxHp);
  const second = new t.Boss(2);
  Object.assign(t.G, { boss: second, phase: 'boss' });
  t.run(1 / 60);
  assert.equal(t.G.motion.bossHpOwner, second);
  assert.equal(t.G.motion.bossHpTrail, second.hp);
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `node --test --test-name-pattern="boss health trail" tests/game.test.js`

Expected: FAIL because boss trail state does not exist.

- [ ] **Step 3: Add and update trail state**

Add to `motion`:

```js
bossHpOwner: null,
bossHpTrail: 0,
bossHpFrom: 0,
bossHpTarget: 0,
bossHpTime: 0,
```

Add this helper and call it from `update(dt)` before the state switch:

```js
function updateBossHealthTrail(dt) {
  const boss = G.boss;
  if (!boss || G.phase !== 'boss') {
    G.motion.bossHpOwner = null;
    G.motion.bossHpTrail = 0;
    G.motion.bossHpFrom = 0;
    G.motion.bossHpTarget = 0;
    G.motion.bossHpTime = 0;
    return;
  }
  if (G.motion.bossHpOwner !== boss || boss.hp > G.motion.bossHpTarget) {
    G.motion.bossHpOwner = boss;
    G.motion.bossHpTrail = boss.hp;
    G.motion.bossHpFrom = boss.hp;
    G.motion.bossHpTarget = boss.hp;
    G.motion.bossHpTime = 0;
    return;
  }
  if (boss.hp < G.motion.bossHpTarget) {
    G.motion.bossHpFrom = G.motion.bossHpTrail;
    G.motion.bossHpTarget = boss.hp;
    G.motion.bossHpTime = 0;
  }
  G.motion.bossHpTime = Math.min(0.4, G.motion.bossHpTime + dt);
  const k = G.motion.bossHpTime / 0.4;
  G.motion.bossHpTrail = G.motion.bossHpFrom
    + (G.motion.bossHpTarget - G.motion.bossHpFrom) * k;
}
```

- [ ] **Step 4: Draw the trail behind immediate health**

Between the health background and current-health fill, draw:

```js
ctx.fillStyle = '#ff9933';
ctx.fillRect(40, 72, (W - 80) * Math.max(0, G.motion.bossHpTrail / b.maxHp), 8);
```

Then draw the existing current-health bar on top.

- [ ] **Step 5: Run focused and full tests**

Run: `node --test --test-name-pattern="boss health trail" tests/game.test.js`

Expected: both tests pass.

Run: `node --test tests/game.test.js`

Expected: all tests pass.

- [ ] **Step 6: Commit-ready checkpoint**

After explicit commit authorization only:

```bash
git add js/game.js tests/game.test.js
git commit -m "feat(animation): trail boss health damage"
```

### Task 7: Fade the level banner and title/table handoff

**Files:**
- Modify: `js/game.js:747-761, 1320-1400`
- Test: `tests/game.test.js`

- [ ] **Step 1: Write failing opacity-helper tests**

Append:

```js
test('level banner fades over 0.2 seconds at each edge', async () => {
  const t = await boot();
  assert.equal(t.G.motion.bannerAlpha(2.5), 0);
  assert.ok(Math.abs(t.G.motion.bannerAlpha(2.4) - 0.5) < 1e-9);
  assert.equal(t.G.motion.bannerAlpha(1.25), 1);
  assert.equal(t.G.motion.bannerAlpha(0.1), 0.5);
  assert.equal(t.G.motion.bannerAlpha(0), 0);
});

test('title and table crossfade over 0.2 seconds', async () => {
  const t = await boot();
  const midpoint = t.G.motion.titleAlphas(8.9);
  assert.ok(Math.abs(midpoint.title - 0.5) < 1e-9);
  assert.ok(Math.abs(midpoint.table - 0.5) < 1e-9);
  assert.deepEqual(t.G.motion.titleAlphas(9), { title: 0, table: 1 });
  const secondMidpoint = t.G.motion.titleAlphas(17.9);
  assert.ok(Math.abs(secondMidpoint.title - 0.5) < 1e-9);
  assert.ok(Math.abs(secondMidpoint.table - 0.5) < 1e-9);
  assert.deepEqual(t.G.motion.titleAlphas(18), { title: 1, table: 0 });
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `node --test --test-name-pattern="level banner fades|title and table crossfade" tests/game.test.js`

Expected: FAIL because the opacity helpers do not exist.

- [ ] **Step 3: Add deterministic fade helpers**

Add to `motion`:

```js
bannerAlpha: remaining => Math.min(1, remaining / 0.2, (2.5 - remaining) / 0.2),
titleAlphas: time => {
  const cycle = ((time % 18) + 18) % 18;
  if (cycle < 8.8) return { title: 1, table: 0 };
  if (cycle < 9) {
    const table = (cycle - 8.8) / 0.2;
    return { title: 1 - table, table };
  }
  if (cycle < 17.8) return { title: 0, table: 1 };
  const title = (cycle - 17.8) / 0.2;
  return { title, table: 1 - title };
},
```

- [ ] **Step 4: Render banner and both title states with scoped alpha**

Wrap the banner block in `ctx.save()`, multiply `ctx.globalAlpha` by `G.motion.bannerAlpha(G.bannerTime)`, and restore afterward.

Split the current `drawTitle` into `drawTitleCard()` and the existing `drawBestTable(false)` path. Remove the play prompt from both old branches. In `drawTitle()`, get `titleAlphas(G.stateTime)`, draw each nonzero branch inside its own save/restore, and draw the play prompt once at full opacity after both branches. Keep theme taps active only while `titleAlphas(G.stateTime).title >= 0.5`.

- [ ] **Step 5: Run focused and full tests**

Run: `node --test --test-name-pattern="level banner fades|title and table crossfade|title screen" tests/game.test.js`

Expected: fade tests and existing title tests pass.

Run: `node --test tests/game.test.js`

Expected: all tests pass.

- [ ] **Step 6: Commit-ready checkpoint**

After explicit commit authorization only:

```bash
git add js/game.js tests/game.test.js
git commit -m "feat(animation): soften banner and title cuts"
```

### Task 8: Add the one-shot Champion burst for world rank 1

**Files:**
- Modify: `js/game.js:16-26, 292-310, 1017-1030, 1039-1061, 1517-1525`
- Test: `tests/game.test.js`

- [ ] **Step 1: Write failing success, reduced-motion, and negative tests**

Append:

```js
test('world rank one starts one champion burst without blocking continue', async () => {
  const server = fakeServer({ top: [200, WORLD], start: [200, { token: 'champ' }], submit: [200, { rank: 1 }] });
  const t = await boot({ fetch: server.fetch });
  reachInitials(t);
  await t.flush();
  t.key('keydown', 'Enter');
  t.run(1 / 60);
  await t.flush();
  assert.equal(t.G.worldRank, 1);
  assert.ok(t.G.motion.championTime > 0);
  assert.equal(t.G.motion.championEmitted, false);
  t.run(1 / 60);
  assert.equal(t.G.motion.championEmitted, true);
  const emittedWaves = t.G.waves.length;
  t.run(0.2);
  assert.equal(t.G.waves.length, emittedWaves, 'shockwave is not emitted again');
  t.key('keyup', 'Enter');
  t.run(0.6);
  t.key('keydown', 'Enter');
  t.run(1 / 60);
  assert.equal(t.G.state, 'title');
});

test('reduced motion shows static world rank one without a burst', async () => {
  const server = fakeServer({ top: [200, WORLD], start: [200, { token: 'champ' }], submit: [200, { rank: 1 }] });
  const t = await boot({ fetch: server.fetch, reduceMotion: true });
  reachInitials(t);
  await t.flush();
  t.key('keydown', 'Enter');
  t.run(1 / 60);
  await t.flush();
  assert.equal(t.G.motion.championTime, Infinity);
  assert.equal(t.G.motion.championEmitted, true);
  assert.equal(t.G.particles.length, 0);
});

test('lower, failed, and stale world ranks do not celebrate', async () => {
  const t = await boot();
  t.G.motion.startChampion(2);
  assert.equal(t.G.motion.championTime, 0);
  t.G.motion.startChampion(null);
  assert.equal(t.G.motion.championTime, 0);
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `node --test --test-name-pattern="champion burst|static world rank|do not celebrate" tests/game.test.js`

Expected: FAIL because champion motion state does not exist.

- [ ] **Step 3: Add champion state and reset it per run**

Add to `motion`:

```js
championTime: 0,
championEmitted: false,
startChampion(rank) {
  if (rank !== 1) return;
  motion.championTime = motion.reduce ? Infinity : 0.8;
  motion.championEmitted = motion.reduce;
},
```

In `newGame()`, reset both fields. In the guarded submit resolution, call `G.motion.startChampion(rank)` only after verifying the active `runId` and assigning `G.worldRank`.

- [ ] **Step 4: Emit the burst once and update its timer**

Add:

```js
function updateChampion(dt) {
  if (!G.motion.championTime || G.motion.championTime === Infinity) return;
  if (!G.motion.championEmitted) {
    G.motion.championEmitted = true;
    shockwave(W / 2, H - 90, 150, '#ffee33', 0.45, 4);
    explode(W / 2, H - 90, ['#ffee33', '#ff44dd', '#33ffff'], 24, 180);
  }
  G.motion.championTime = Math.max(0, G.motion.championTime - dt);
}
```

Call it from `update(dt)` while on the leaderboard.

- [ ] **Step 5: Draw the selected framed lockup**

When `G.worldRank === 1`, replace the ordinary rank line with a centered framed lockup that does not cover the Continue prompt:

```js
ctx.strokeStyle = '#ffee33';
ctx.lineWidth = 2;
ctx.strokeRect(105.5, H - 121.5, 269, 52);
text('YOU REACHED', W / 2, H - 106, 8, '#33ffff');
text('WORLD #1', W / 2, H - 86, 16, '#ffee33');
```

Other numeric ranks continue to use the existing single-line treatment.

- [ ] **Step 6: Run focused and full tests**

Run: `node --test --test-name-pattern="champion burst|static world rank|do not celebrate|late answer" tests/game.test.js`

Expected: celebration and stale-response tests pass.

Run: `node --test tests/game.test.js`

Expected: all tests pass.

- [ ] **Step 7: Commit-ready checkpoint**

After explicit commit authorization only:

```bash
git add js/game.js tests/game.test.js
git commit -m "feat(animation): celebrate world rank one"
```

### Task 9: Final verification and manual-device checklist

**Files:**
- Verify: `js/game.js`
- Verify: `js/entities.js`
- Verify: `js/input.js`
- Verify: `tests/game.test.js`

- [ ] **Step 1: Run the complete automated suite**

Run: `node --test`

Expected: all tests pass with zero failures, uncaught errors, or warnings.

- [ ] **Step 2: Run syntax checks on every changed script**

Run:

```bash
node --check js/game.js
node --check js/entities.js
node --check js/input.js
node --check tests/game.test.js
```

Expected: every command exits 0 without output.

- [ ] **Step 3: Check whitespace and review only the intended diff**

Run: `git diff --check`

Expected: no output.

Run: `git diff -- js/game.js js/entities.js js/input.js tests/game.test.js docs/superpowers/specs/2026-10-17-animation-accessibility-and-polish-design.md docs/superpowers/plans/2026-10-17-animation-accessibility-and-polish.md`

Expected: only the approved animation/accessibility work appears. The unrelated untracked mobile-playability documents remain untouched.

- [ ] **Step 4: Perform browser feel checks**

Check each behavior in a browser:

1. Toggle the OS reduced-motion setting while the game is open; shake stops on the next update, flashes become gentler, and rapid blink cues slow without a reload.
2. Confirm large-hit freeze-frames, enemy hit-white, shattering, and instant pause remain present.
3. Hold and release Pause and charged ULT on touch hardware; the complete button scales and brightens without changing its hit target.
4. Damage and heal a boss; immediate HP and the 0.4-second damage trail read correctly.
5. Watch both title/table boundaries and both level-banner edges for clean 0.2-second opacity fades.
6. Submit a rank-1 test response; the Champion burst plays once, the frame remains, and Continue works throughout.

- [ ] **Step 5: Record the unresolved real-device evidence boundary**

Do not claim performance verification until the game is profiled on representative 60 Hz and 120 Hz hardware. Record the device/browser, frame-rate trace, and whether fixed-tick shake feels equivalent. Treat this as manual evidence, not an automated-pass claim.

- [ ] **Step 6: Final commit-ready checkpoint**

After explicit commit authorization only:

```bash
git add js/game.js js/entities.js js/input.js tests/game.test.js docs/superpowers/specs/2026-10-17-animation-accessibility-and-polish-design.md docs/superpowers/plans/2026-10-17-animation-accessibility-and-polish.md
git commit -m "feat(animation): improve accessibility and game feel"
```
