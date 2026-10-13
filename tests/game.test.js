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

// Boots a fresh Halloween game sitting on the title screen
async function boot() {
  const listeners = {};
  const errors = [];
  let raf = null;
  let now = 0;
  const canvas = () => ({ width: 0, height: 0, getContext: () => blob });
  const sandbox = {
    document: { getElementById: canvas, createElement: canvas },
    localStorage: { getItem: k => (k === 'starblaster.theme' ? 'halloween' : null), setItem() {} },
    addEventListener: (type, fn) => (listeners[type] ||= []).push(fn),
    requestAnimationFrame: fn => { raf = fn; },
    performance: { now: () => now },
    console: { ...console, error: (...a) => errors.push(a.join(' ')) },
    setTimeout,
    setInterval() {}, // music scheduler - nothing to play here
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const name of SCRIPTS) {
    const file = path.join(__dirname, '..', 'js', `${name}.js`);
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  }
  await new Promise(r => setTimeout(r, 0)); // the game starts once the font promise settles

  const game = vm.runInContext('({ G, Bullet, Enemy, PowerUp, BlackCat, Boss })', sandbox);
  const key = (type, code) => (listeners[type] || []).forEach(fn => fn({ code, repeat: false, preventDefault() {} }));
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
  return { ...game, key, run, play, catUnderShip, errors };
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
