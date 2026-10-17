// Headless tests: loads the real game scripts into a stubbed browser and steps
// the main loop by hand. Run with `node --test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SCRIPTS = ['theme', 'sprites', 'audio', 'input', 'leaderboard', 'entities', 'levels', 'backgrounds', 'game'];
const FRAME_MS = 1000 / 60;

// Stands in for a canvas context: every property is callable and returns itself
const blob = new Proxy(function () {}, { get: () => blob, apply: () => blob, set: () => true });

// Boots a fresh Halloween game sitting on the title screen. `phone` fakes a touchscreen;
// `fetch` stands in for the network (default: offline).
async function boot({ phone = false, fetch = () => Promise.reject(new Error('offline')) } = {}) {
  const listeners = {};
  const errors = [];
  let raf = null;
  let now = 0;
  const canvas = () => ({ width: 0, height: 0, getContext: () => blob });
  // The game canvas is 480x640, shown at half size on screen
  const gameCanvas = { width: 480, height: 640, getContext: () => blob,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 240, height: 320 }) };
  const sandbox = {
    document: { getElementById: () => gameCanvas, createElement: canvas },
    matchMedia: q => ({ matches: phone && q === '(pointer: coarse)' }),
    localStorage: { getItem: k => (k === 'starblaster.theme' ? 'halloween' : null), setItem() {} },
    addEventListener: (type, fn) => (listeners[type] ||= []).push(fn),
    requestAnimationFrame: fn => { raf = fn; },
    performance: { now: () => now },
    console: { ...console, error: (...a) => errors.push(a.join(' ')) },
    setTimeout,
    setInterval() {}, // music scheduler - nothing to play here
    fetch, AbortController, clearTimeout,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const name of SCRIPTS) {
    const file = path.join(__dirname, '..', 'js', `${name}.js`);
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  }
  await new Promise(r => setTimeout(r, 0)); // the game starts once the font promise settles

  const game = vm.runInContext('({ G, Bullet, Enemy, PowerUp, BlackCat, Boss, Rocket })', sandbox);
  const key = (type, code) => (listeners[type] || []).forEach(fn => fn({ code, repeat: false, preventDefault() {} }));
  // Touch helpers take game coordinates and convert to screen pixels
  const finger = (type, x, y, id = 1) =>
    (listeners[type] || []).forEach(fn => fn({ pointerType: 'touch', pointerId: id, clientX: x / 2, clientY: y / 2 }));
  const tap = (x, y, id = 1) => { finger('pointerdown', x, y, id); finger('pointerup', x, y, id); };
  const run = seconds => {
    for (let i = 0; i < Math.round(seconds * 60); i++) raf(now += FRAME_MS);
  };
  // Start a game with an empty level so each test controls what is on screen
  const play = () => {
    key('keydown', 'Enter');
    run(0.1);
    key('keyup', 'Enter');
    Object.assign(game.G, { events: [], bonusCount: 2, catTimer: 999 });
    return game.G.player;
  };
  const catUnderShip = () => {
    const cat = new game.BlackCat(game.G);
    Object.assign(cat, { x: game.G.player.x - 5, y: game.G.player.y + 18, vx: 90 });
    return (game.G.cat = cat);
  };
  const Input = vm.runInContext('Input', sandbox);
  // Let pending network promises settle
  const flush = () => new Promise(r => setImmediate(r));
  return { ...game, Input, key, finger, tap, run, play, catUnderShip, errors, flush, context: sandbox };
}

// A fake leaderboard server: routes by the last path segment and records each request
function fakeServer(routes) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    const action = url.split('/').pop();
    calls.push({ action, method: opts.method || 'GET', headers: opts.headers || {}, cache: opts.cache, body: opts.body ? JSON.parse(opts.body) : undefined });
    const reply = routes[action];
    if (!reply) return { ok: false, status: 404, json: async () => ({}) };
    const [status, data] = typeof reply === 'function' ? reply(calls[calls.length - 1]) : reply;
    return { ok: status >= 200 && status < 300, status, json: async () => data };
  };
  return { fetch, calls };
}

test('boots to the title screen and starts a game without errors', async () => {
  const t = await boot();
  assert.equal(t.G.state, 'title');
  t.run(0.5);
  t.play();
  t.run(2);
  assert.equal(t.G.state, 'playing');
  assert.deepEqual(t.errors, []);
});

test('a black cat crossing under the ship jams the guns', async () => {
  const t = await boot();
  const p = t.play();
  t.catUnderShip();
  t.run(0.2);
  assert.ok(p.jam > 0);
  assert.equal(t.G.spook, 0);
});

test('treats stack up to three', async () => {
  const t = await boot();
  const p = t.play();
  for (let i = 0; i < 4; i++) {
    t.G.powerups.push(new t.PowerUp(p.x, p.y, 'treat'));
    t.run(0.1);
  }
  assert.equal(t.G.treats, 3);
});

test('feeding the cat a treat freezes enemies and their shots for 5 seconds', async () => {
  const t = await boot();
  const p = t.play();
  const tank = new t.Enemy('tank', 100, 200);
  const shot = new t.Bullet(300, 100, 0, 100, false);
  t.G.enemies.push(tank);
  t.G.enemyBullets.push(shot);
  t.G.treats = 1;
  const cat = t.catUnderShip();
  t.run(0.2);
  assert.equal(t.G.treats, 0);
  assert.equal(p.jam, 0);
  assert.equal(cat.mode, 'flee');
  assert.equal(t.G.powerups.length, 1);

  const frozenAt = [tank.y, shot.y];
  t.run(4.5);
  assert.deepEqual([tank.y, shot.y], frozenAt);
  t.run(1);
  assert.equal(t.G.spook, 0);
  assert.ok(tank.y > frozenAt[0]);
  assert.deepEqual(t.errors, []);
});

test('feeding the cat stuns a boss and cancels its attack', async () => {
  const t = await boot();
  t.play();
  const boss = new t.Boss(1);
  Object.assign(boss, { y: boss.targetY, state: 'fight' });
  Object.assign(t.G, { boss, phase: 'boss', treats: 1 });
  boss.attack('laser', t.G);
  boss.attack('wave', t.G);
  t.catUnderShip();
  t.run(0.2);
  const clock = boss.timeLeft;
  t.run(1);
  assert.equal(boss.laser, null);
  assert.equal(boss.queue.length, 0);
  assert.ok(boss.stun > 0);
  assert.equal(boss.timeLeft, clock);
  assert.equal(t.G.enemyBullets.length, 0);
});

test('dying with a level-1 laser while firing does not lock the game', async () => {
  const t = await boot();
  const p = t.play();
  p.secondary = { kind: 'laser', level: 1 };
  t.key('keydown', 'Space');
  t.run(0.2);
  assert.equal(p.lasing, true);
  p.invuln = 0;
  t.G.enemyBullets.push(new t.Bullet(p.x, p.y, 0, 0, false));
  t.run(0.1);
  assert.equal(p.alive, false);
  t.key('keyup', 'Space');
  t.run(2.5);
  const x = p.x;
  t.key('keydown', 'ArrowLeft');
  t.run(0.3);
  assert.equal(p.alive, true);
  assert.ok(p.x < x, 'respawned ship can move');
  assert.deepEqual(t.errors, []);
});

test('ramming only hurts an enemy when the hit costs the player', async () => {
  const t = await boot();
  const p = t.play();
  const tank = new t.Enemy('tank', p.x, p.y);
  tank.speed = 0;
  t.G.enemies.push(tank);
  p.invuln = 5;
  t.run(0.3);
  assert.equal(tank.hp, 12);
  p.invuln = 0;
  p.shields = 1;
  t.run(0.3);
  assert.equal(p.shields, 0);
  assert.equal(tank.hp, 9);
  assert.equal(p.alive, true);
});

test('an already-destroyed enemy bullet cannot hit the player', async () => {
  const t = await boot();
  const p = t.play();
  p.invuln = 0;
  const shot = new t.Bullet(p.x, p.y, 0, 0, false);
  shot.dead = true;
  t.G.enemyBullets.push(shot);
  t.run(0.1);
  assert.equal(p.alive, true);
});

test('a faded-out elite phantom holds its fire', async () => {
  const t = await boot();
  t.play();
  const phantom = new t.Enemy('phantom', 100, 150, { elite: true });
  phantom.setMode('hidden');
  phantom.fireTimer = 0;
  phantom.update(0.016, t.G);
  assert.equal(t.G.enemyBullets.length, 0);
  phantom.setMode('visible');
  phantom.fireTimer = 0;
  phantom.update(0.016, t.G);
  assert.equal(t.G.enemyBullets.length, 1);
});

test('the cat runs off when a boss dies and is gone by level clear', async () => {
  const t = await boot();
  t.play();
  const boss = new t.Boss(1);
  Object.assign(boss, { y: 140, dead: true });
  Object.assign(t.G, { boss, phase: 'bossdying', phaseTime: 0 });
  const cat = new t.BlackCat(t.G);
  Object.assign(cat, { x: 240, vx: 90 });
  t.G.cat = cat;
  t.run(0.4);
  assert.equal(cat.mode, 'flee');
  assert.notEqual(cat.x, 240);
  t.run(2.5);
  assert.equal(t.G.state, 'levelclear');
  assert.equal(t.G.cat, null);
});

// Put a boss in its fight, holding its fire unless the test makes it attack
function fightBoss(t, level) {
  const boss = new t.Boss(level);
  Object.assign(boss, { y: boss.targetY, state: 'fight', attackTimer: 999 });
  Object.assign(t.G, { boss, phase: 'boss' });
  return boss;
}

test('each campaign level has its own boss, and the order repeats each loop', async () => {
  const t = await boot();
  const names = [1, 2, 3, 4, 5, 6, 10, 11].map(n => new t.Boss(n, n % 6 === 0).def.hname);
  assert.deepEqual(names, ['PUMPKIN KING', 'SPIDER QUEEN', 'THE REAPER', 'WEREWOLF', 'THE MONSTER', 'DRACULA', 'WEREWOLF', 'THE MONSTER']);
});

test('werewolf enemies no longer appear in any level', async () => {
  const t = await boot();
  const types = [1, 2, 3, 4, 5, 6].flatMap(n => vm.runInContext(`buildLevel(${n})`, t.context).map(ev => ev.type));
  assert.ok(!types.includes('werewolf'));
});

test('the werewolf pounces at the player and springs back to its perch', async () => {
  const t = await boot();
  const p = t.play();
  p.invuln = 99;
  const boss = fightBoss(t, 4);
  boss.attack('pounce', t.G);
  const home = boss.y;
  let lowest = boss.y;
  for (let i = 0; i < 30; i++) { t.run(0.1); lowest = Math.max(lowest, boss.y); }
  assert.ok(lowest > p.y - 30, `reached the player (lowest ${lowest}, player ${p.y})`);
  assert.equal(boss.leap, null);
  assert.ok(Math.abs(boss.y - home) < 20, 'back home');
});

test('the werewolf regenerates unless wounded by silver', async () => {
  const t = await boot();
  const p = t.play();
  p.invuln = 99;
  const boss = fightBoss(t, 4);
  boss.hp = 500;
  t.run(1);
  assert.ok(boss.hp > 500, 'heals on its own');

  boss.hp = 500;
  t.G.playerBullets.push(new t.Bullet(boss.x, boss.y, 0, 0, true, { dmg: 1, silver: true }));
  t.run(1 / 60);
  const wounded = boss.hp;
  assert.ok(Math.abs(wounded - 498) < 0.5, 'silver does double damage');
  t.run(1.5);
  assert.equal(boss.hp, wounded, 'no healing while wounded');
  t.run(1);
  assert.ok(boss.hp > wounded, 'heals again once the wound wears off');
});

test("the monster's lightning strikes the player's column", async () => {
  const t = await boot();
  const p = t.play();
  const boss = fightBoss(t, 5);
  boss.attack('lightning', t.G);
  assert.deepEqual([...boss.laser.xs], [p.x]); // copy: arrays from the game's sandbox have a different prototype
  p.invuln = 0;
  p.shields = 1;
  t.run(0.9);
  assert.equal(p.shields, 0);
});

test('the monster comes back to life once, then dies for good', async () => {
  const t = await boot();
  const p = t.play();
  p.invuln = 99;
  const boss = fightBoss(t, 5);
  const finish = () => {
    boss.stun = 0;
    boss.hp = 1;
    t.G.playerBullets.push(new t.Bullet(boss.x, boss.y, 0, 0, true, { dmg: 5 }));
    t.run(1 / 60);
  };
  finish();
  assert.equal(boss.dead, false);
  assert.equal(boss.revived, true);
  assert.equal(Math.round(boss.hp), Math.round(boss.maxHp * 0.3));
  finish();
  assert.equal(boss.dead, true);
  assert.equal(t.G.phase, 'bossdying');
});

test('rockets hit the monster twice as hard', async () => {
  const t = await boot();
  const p = t.play();
  p.invuln = 99;
  const boss = fightBoss(t, 5);
  const hp = boss.hp;
  t.G.playerBullets.push(new t.Rocket(boss.x, boss.y, 1));
  t.run(1 / 60);
  assert.equal(hp - boss.hp, 6);
  assert.deepEqual(t.errors, []);
});

// ---------- touch controls ----------

// Start a game by tapping, with an empty level
function playByTouch(t) {
  t.tap(240, 300);
  t.run(0.1);
  Object.assign(t.G, { events: [], bonusCount: 2, catTimer: 999, bannerTime: 0 });
  return t.G.player;
}

test('phones start in touch mode; desktops start in keyboard mode', async () => {
  assert.equal((await boot({ phone: true })).Input.touch, true);
  assert.equal((await boot()).Input.touch, false);
});

test('a tap on the title screen starts the game', async () => {
  const t = await boot({ phone: true });
  playByTouch(t);
  assert.equal(t.G.state, 'playing');
});

test('tapping the theme line switches theme instead of starting', async () => {
  const t = await boot({ phone: true });
  const halloween = vm.runInContext('Theme.halloween', t.context);
  t.tap(240, 562);
  t.run(0.1);
  assert.equal(t.G.state, 'title');
  assert.equal(vm.runInContext('Theme.halloween', t.context), !halloween);
});

test('dragging moves the ship by the distance the finger travels', async () => {
  const t = await boot({ phone: true });
  const p = playByTouch(t);
  const [x0, y0] = [p.x, p.y];
  t.finger('pointerdown', 300, 500);
  t.finger('pointermove', 260, 470);
  t.run(1 / 60);
  assert.equal(p.x, x0 - 40);
  assert.equal(p.y, y0 - 30);
  t.finger('pointerup', 260, 470);
  t.run(0.1);
  assert.equal(p.x, x0 - 40, 'stays put once the finger lifts');
});

test('touch mode fires automatically while playing', async () => {
  const t = await boot({ phone: true });
  playByTouch(t);
  t.run(0.5);
  assert.ok(t.G.playerBullets.length > 0);
});

test('the pause button pauses without moving the ship, and any tap resumes', async () => {
  const t = await boot({ phone: true });
  const p = playByTouch(t);
  const x0 = p.x;
  t.finger('pointerdown', 480 - 26, 104);
  t.finger('pointermove', 400, 104);
  t.run(1 / 60);
  assert.equal(t.G.paused, true);
  assert.equal(p.x, x0);
  t.finger('pointerup', 400, 104);
  t.tap(100, 300);
  t.run(1 / 60);
  assert.equal(t.G.paused, false);
});

test('the ULT button fires the ultimate once it is charged', async () => {
  const t = await boot({ phone: true });
  playByTouch(t);
  t.tap(480 - 46, 640 - 112);
  t.run(1 / 60);
  assert.equal(t.G.ultTime, 0, 'not charged yet');
  t.G.ultCharge = 100;
  t.tap(480 - 46, 640 - 112);
  t.run(1 / 60);
  assert.ok(t.G.ultTime > 0);
});

test('initials can be entered and saved by tapping', async () => {
  const t = await boot({ phone: true });
  playByTouch(t);
  Object.assign(t.G, { score: 999999, lives: 1 });
  t.G.player.invuln = 0;
  t.G.enemyBullets.push(new t.Bullet(t.G.player.x, t.G.player.y, 0, 0, false));
  t.run(6);
  assert.equal(t.G.state, 'entername');
  t.tap(180, 304); // '+' above the first letter: A -> B
  t.run(1 / 60);
  t.tap(240, 398); // '-' below the second letter: A wraps back to a space
  t.run(1 / 60);
  assert.equal(t.G.namePos, 1);
  t.tap(240, 475); // SAVE
  t.run(1 / 60);
  assert.equal(t.G.state, 'leaderboard');
  assert.equal(vm.runInContext('Leaderboard.all()[0].name', t.context), 'B A');
});

test('pressing a key switches back to keyboard mode', async () => {
  const t = await boot({ phone: true });
  t.key('keydown', 'ArrowLeft');
  assert.equal(t.Input.touch, false);
});

// ---------- world leaderboard client ----------

const WORLD = [
  { name: 'ACE', score: 90000, level: 7, at: '2026-10-17T10:00:00Z' },
  { name: 'BOB', score: 50000, level: 5, at: '2026-10-17T11:00:00Z' },
];

test('the world top 10 is fetched with the publishable key and feeds the HI score', async () => {
  const server = fakeServer({ top: [200, WORLD] });
  const t = await boot({ fetch: server.fetch });
  const world = vm.runInContext('Leaderboard.world', t.context);
  await world.refresh(true);
  assert.equal(world.top.length, 2);
  assert.equal(world.top[0].name, 'ACE');
  assert.match(server.calls[0].headers.apikey, /^sb_publishable_/);
  assert.equal(server.calls[0].headers.Authorization, undefined, 'never a bearer token');
  assert.equal(vm.runInContext('Leaderboard.hiScore()', t.context), 90000);
});

test('offline: no world table, and the local HI score still works', async () => {
  const t = await boot();
  const world = vm.runInContext('Leaderboard.world', t.context);
  assert.equal(await world.refresh(true), null);
  assert.equal(world.top, null);
  assert.equal(vm.runInContext('Leaderboard.hiScore()', t.context), 30000);
});

test('malformed world data is filtered, never trusted', async () => {
  const junk = [
    { name: 'OK', score: 100, level: 1 },
    { name: 123, score: 5 }, { name: 'X', score: 'lots' }, null,
    { name: 'A'.repeat(50), score: 10, level: 1 },
  ];
  for (const reply of [[200, junk], [200, { not: 'an array' }], [500, {}]]) {
    const t = await boot({ fetch: fakeServer({ top: reply }).fetch });
    const world = vm.runInContext('Leaderboard.world', t.context);
    await world.refresh(true);
    const top = world.top;
    assert.ok(top === null || top.every(e => typeof e.name === 'string' && e.name.length <= 3 && Number.isFinite(e.score)));
    t.run(10); // the title screen alternates to the table; drawing it must not throw
    assert.deepEqual(t.errors, []);
  }
});

test('refresh is throttled to once a minute unless forced', async () => {
  const server = fakeServer({ top: [200, WORLD] });
  const t = await boot({ fetch: server.fetch });
  const world = vm.runInContext('Leaderboard.world', t.context);
  await world.refresh();
  await world.refresh();
  assert.equal(server.calls.length, 1);
  await world.refresh(true);
  assert.equal(server.calls.length, 2);
});

test('startRun and submit speak the server protocol', async () => {
  const server = fakeServer({ start: [200, { token: 'tok-1' }], submit: [200, { rank: 3 }] });
  const t = await boot({ fetch: server.fetch });
  const world = vm.runInContext('Leaderboard.world', t.context);
  assert.equal(await world.startRun(), 'tok-1');
  assert.equal(await world.submit('tok-1', 'ABC', 1200, 2), 3);
  assert.deepEqual(server.calls[0].body, {});
  assert.deepEqual(server.calls[1].body, { token: 'tok-1', name: 'ABC', score: 1200, level: 2 });
  assert.equal(server.calls[1].method, 'POST');
});

test('a rejected or failed submit resolves to null', async () => {
  for (const reply of [[400, { error: 'rejected' }], [200, { rank: 'first' }]]) {
    const t = await boot({ fetch: fakeServer({ submit: reply }).fetch });
    assert.equal(await vm.runInContext('Leaderboard.world', t.context).submit('tok', 'ABC', 10, 1), null);
  }
  const t = await boot();
  assert.equal(await vm.runInContext('Leaderboard.world', t.context).startRun(), null);
});

// ---------- world leaderboard in the game ----------

// Play until game over with a qualifying score, then sit on the initials screen
function reachInitials(t, score = 999999) {
  const p = t.play();
  Object.assign(t.G, { score, lives: 1 });
  p.invuln = 0;
  t.G.enemyBullets.push(new t.Bullet(p.x, p.y, 0, 0, false));
  t.run(6);
  assert.equal(t.G.state, 'entername');
}

test('a game asks for a run token, and saving initials submits the score with it', async () => {
  const server = fakeServer({ top: [200, WORLD], start: [200, { token: 'tok-9' }], submit: [200, { rank: 1 }] });
  const t = await boot({ fetch: server.fetch });
  t.run(0.2);
  await t.flush();
  reachInitials(t);
  await t.flush();
  t.key('keydown', 'Enter');
  t.run(1 / 60);
  assert.equal(t.G.worldRank, 'pending');
  await t.flush();
  assert.equal(t.G.worldRank, 1);
  const submit = server.calls.find(c => c.action === 'submit');
  assert.deepEqual(submit.body, { token: 'tok-9', name: 'AAA', score: 999999, level: 1 }); // initials start as AAA
  assert.equal(t.G.state, 'leaderboard');
});

test('offline at the start: saving initials skips the world submit and saves locally', async () => {
  // start fails but submit would succeed: only a working "no token, no submit" guard yields 'failed'
  const server = fakeServer({ start: [503, {}], submit: [200, { rank: 1 }] });
  const t = await boot({ fetch: server.fetch });
  reachInitials(t);
  await t.flush();
  t.key('keydown', 'Enter');
  t.run(1 / 60);
  await t.flush();
  assert.equal(t.G.worldRank, 'failed');
  assert.equal(server.calls.filter(c => c.action === 'submit').length, 0, 'no submit without a run token');
  assert.equal(vm.runInContext('Leaderboard.all()[0].score', t.context), 999999);
});

test('a dropped connection at submit time shows NOT SUBMITTED, local save intact', async () => {
  let online = true;
  const server = fakeServer({ start: [200, { token: 'tok-1' }] });
  const t = await boot({ fetch: (url, opts) => (online ? server.fetch(url, opts) : Promise.reject(new Error('offline'))) });
  reachInitials(t);
  await t.flush();
  online = false;
  t.key('keydown', 'Enter');
  t.run(1 / 60);
  await t.flush();
  assert.equal(t.G.worldRank, 'failed');
  assert.equal(vm.runInContext('Leaderboard.all()[0].score', t.context), 999999);
});

test("a late answer from an old game doesn't touch the new game", async () => {
  let release;
  const server = fakeServer({ start: [200, { token: 'tok-1' }] });
  const slowSubmit = new Promise(r => { release = r; });
  const t = await boot({
    fetch: (url, opts) => (url.endsWith('/submit')
      ? slowSubmit.then(() => ({ ok: true, status: 200, json: async () => ({ rank: 4 }) }))
      : server.fetch(url, opts)),
  });
  reachInitials(t);
  await t.flush();
  t.key('keydown', 'Enter');
  t.run(1 / 60);
  t.run(1);
  t.key('keydown', 'Space'); // leaderboard -> title
  t.run(1 / 60);
  t.key('keyup', 'Space');
  t.run(0.1);
  t.play(); // a new game starts while the old submit is still in flight
  release();
  await t.flush();
  assert.equal(t.G.worldRank, null);
});

test('a score that only makes the world top 10 still gets initials entry', async () => {
  const t = await boot({ fetch: fakeServer({ top: [200, WORLD] }).fetch });
  for (let i = 0; i < 10; i++) vm.runInContext(`Leaderboard.add('TOP', ${1e7 + i}, 9)`, t.context);
  await vm.runInContext('Leaderboard.world', t.context).refresh(true);
  reachInitials(t, 60000); // beats nothing locally, but the world list has only 2 entries
});

test('world requests bypass the browser cache, so a fresh score shows up straight away', async () => {
  // The server sends cache-control: max-age=30; without this the refresh right after
  // submitting returned the stale cached list (seen in the live end-to-end check).
  const server = fakeServer({ top: [200, WORLD], start: [200, { token: 't' }], submit: [200, { rank: 1 }] });
  const t = await boot({ fetch: server.fetch });
  const world = vm.runInContext('Leaderboard.world', t.context);
  await world.refresh(true);
  await world.startRun();
  await world.submit('t', 'ABC', 10, 1);
  assert.deepEqual([...server.calls.map(c => c.cache)], ['no-store', 'no-store', 'no-store']);
});
