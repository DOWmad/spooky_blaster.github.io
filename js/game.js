// Main loop, state machine, collisions and rendering.
// States: title -> playing -> levelclear -> playing ... -> victory (after the final boss) -> playing (next loop)
//         ... -> gameover -> entername -> leaderboard -> title
(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const STEP = 1 / 60;
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ';
  // Extra lives at widening score milestones, then every 300k; lives cap at MAX_LIVES
  const LIFE_MILESTONES = [50000, 150000, 300000, 500000, 750000, 1000000];
  const MAX_LIVES = 6;
  const MAX_TREATS = 3;
  const nextLifeAfter = score => LIFE_MILESTONES.find(m => m > score) ?? (Math.floor(score / 300000) + 1) * 300000;
  const reduceMotionQuery = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false, addEventListener() {} };
  const motion = {
    reduce: reduceMotionQuery.matches,
    shakeX: 0,
    shakeY: 0,
    bossHpOwner: null,
    bossHpTrail: 0,
    bossHpFrom: 0,
    bossHpTarget: 0,
    bossHpTime: 0,
    championTime: 0,
    championEmitted: false,
    flashAlpha: value => Math.min(value, motion.reduce ? 0.25 : 0.6),
    blinkRate: rate => Math.min(rate, motion.reduce ? 3 : rate),
    blink: (time, rate = 2) => Math.floor(time * motion.blinkRate(rate) * 2) % 2 === 0,
    bannerAlpha: remaining => Math.max(0, Math.min(1, remaining / 0.2, (2.5 - remaining) / 0.2)),
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
    startChampion(rank) {
      if (rank !== 1) return;
      motion.championTime = motion.reduce ? Infinity : 0.8;
      motion.championEmitted = motion.reduce;
    },
  };
  reduceMotionQuery.addEventListener('change', event => { motion.reduce = event.matches; });

  const G = {
    state: 'title', stateTime: 0, t: 0,
    score: 0, level: 1, lives: 3, nextLife: LIFE_MILESTONES[0],
    player: null, playerBullets: [], enemyBullets: [], enemies: [], asteroids: [],
    powerups: [], particles: [], texts: [], boss: null,
    phase: 'waves', phaseTime: 0, events: [], eventIdx: 0, levelTime: 0,
    combo: 0, comboTimer: 0, tookDamage: false, respawnTimer: 0, paused: false,
    shake: 0, flash: 0, bannerTime: 0, levelBonus: 0, perfectBonus: 0,
    name: [0, 0, 0], namePos: 0, lastRank: -1,
    ultCharge: 0, ultTime: 0,
    waves: [], hitstop: 0, bonusTimer: 0, bonusCount: 0, victory: false, livesBonus: 0, corpses: [],
    cat: null, catTimer: 0, treats: 0, spook: 0,
    runId: 0, runToken: null, worldRank: null,
    motion,
  };
  window.G = G; // handy for debugging from the console
  window.debugRender = () => render();

  // ---------- spawning helpers (also called by entities) ----------

  G.aimedShot = (x, y, speed) => {
    const p = G.player;
    const tx = p && p.alive ? p.x : W / 2;
    const ty = p && p.alive ? p.y : H;
    const a = Math.atan2(ty - y, tx - x);
    G.enemyBullets.push(new Bullet(x, y, Math.cos(a) * speed, Math.sin(a) * speed, false));
    Sound.sfx.enemyShoot();
  };

  G.fan = (x, y, angle, n, gap, speed) => {
    for (let i = 0; i < n; i++) {
      const a = angle + (i - (n - 1) / 2) * gap;
      G.enemyBullets.push(new Bullet(x, y, Math.cos(a) * speed, Math.sin(a) * speed, false));
    }
    Sound.sfx.enemyShoot();
  };

  G.angleTo = (x, y) => {
    const p = G.player;
    return p && p.alive ? Math.atan2(p.y - y, p.x - x) : Math.PI / 2;
  };

  G.ring = (x, y, n, speed, off = Math.random() * Math.PI) => {
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * Math.PI * 2;
      G.enemyBullets.push(new Bullet(x, y, Math.cos(a) * speed, Math.sin(a) * speed, false, { color: Theme.c.ringBullet }));
    }
    Sound.sfx.enemyShoot();
  };

  function explode(x, y, colors, n = 16, speed = 150) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(0.2, 1) * speed;
      const life = rand(0.3, 0.8);
      G.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life,
        color: colors[i % colors.length], size: rand(1.5, 3.5),
      });
    }
  }

  G.explode = explode;

  // Witch spells (Halloween): homing hex orb, starburst, or a control-reversing curse
  G.castSpell = w => {
    const a = G.angleTo(w.x, w.y);
    const roll = Math.random();
    const shot = (ang, speed, opts) =>
      G.enemyBullets.push(new Bullet(w.x, w.y + 10, Math.cos(ang) * speed, Math.sin(ang) * speed, false, opts));
    if (roll < 0.4) {
      shot(a, 150, { color: '#66ff33', r: 6, homing: 2.5 });
    } else if (roll < 0.75) {
      for (let i = 0; i < 6; i++) shot(a + (i / 6) * Math.PI * 2, 160, { color: '#cc66ff' });
    } else {
      shot(a, 170, { color: '#aa33ff', r: 7, curse: true, homing: 1.2 });
    }
    explode(w.x, w.y, ['#cc66ff', '#66ff33', '#ffffff'], 6, 70);
    Sound.sfx.spell();
  };

  // ---------- the black cat ----------
  G.catStole = cat => {
    popup('MEOW!', cat.x, cat.y - 20, '#ffee33');
    popup('STOLEN!', cat.x, cat.y - 36, '#ff3344');
    Sound.sfx.meow();
  };

  function badLuck() {
    const p = G.player;
    if (p.holy > 0) { popup('BLESSED', p.x, p.y - 30, '#66ccff'); return; }
    p.jam = 1.5;
    G.combo = 0;
    popup('BAD LUCK!', p.x, p.y - 30, '#aa33ff');
    Sound.sfx.meow();
  }

  // A fed cat hisses at your foes: enemies and their shots freeze, a boss drops its attack
  function feedCat(cat) {
    const p = G.player;
    G.treats--;
    G.spook = 5;
    if (G.boss) {
      G.boss.cancelAttacks();
      G.boss.stun = G.spook;
    }
    G.powerups.push(new PowerUp(cat.x, p.y - 60, randomPowerupKind()));
    cat.mode = 'flee';
    explode(cat.x, cat.y, ['#ff99cc', '#ffee33', '#ffffff'], 12, 100);
    popup('PURR!', cat.x, cat.y - 20, '#ff99cc');
    popup('SPOOKED!', p.x, p.y - 30, '#ffee33');
    Sound.sfx.purr();
  }

  function updateCat(dt) {
    if (!Theme.halloween) return;
    if (!G.cat) {
      if (G.phase !== 'waves' && G.phase !== 'boss') return;
      G.catTimer -= dt;
      if (G.catTimer <= 0) {
        G.cat = new BlackCat(G);
        G.catTimer = rand(25, 45);
      }
      return;
    }
    const cat = G.cat;
    const p = G.player;
    if (G.phase === 'bossdying') cat.mode = 'flee';
    cat.update(dt, G);
    // Crossing under the ship is bad luck (once per visit)
    if (cat.mode === 'walk' && !cat.crossed && p.alive && Math.abs(cat.x - p.x) < 12 && Math.abs(cat.y - p.y) < 40) {
      cat.crossed = true;
      if (G.treats > 0) feedCat(cat); else badLuck();
    }
    for (const b of G.playerBullets) {
      if (b.dead || b.pierce || dist2(b, cat) >= (cat.r + b.r) ** 2) continue;
      b.dead = true;
      cat.lives--;
      cat.flash = 0.08;
      Sound.sfx.hiss();
      if (cat.carrying) {
        G.powerups.push(new PowerUp(cat.x, cat.y, cat.carrying));
        cat.carrying = null;
      }
      cat.mode = 'flee';
      if (cat.lives <= 0) {
        explode(cat.x, cat.y, ['#22222e', '#aa33ff', '#ffee33'], 16, 120);
        popup('...FINE.', cat.x, cat.y - 20, '#cccccc');
        cat.dead = true;
        break;
      }
      popup(cat.lives === 8 ? 'HISS!' : `${cat.lives} LIVES`, cat.x, cat.y - 20, '#cccccc');
    }
    if (cat.dead) G.cat = null;
  }

  function cursePlayer() {
    const p = G.player;
    if (!p.alive || p.invuln > 0 || G.ultTime > 0) return;
    if (p.holy > 0) { popup('BLESSED', p.x, p.y - 30, '#66ccff'); return; }
    if (p.shields > 0) { p.shields--; p.invuln = 1; Sound.sfx.shieldHit(); return; }
    p.cursed = 3;
    popup('CURSED!', p.x, p.y - 30, '#aa33ff');
    Sound.sfx.curse();
  }

  // Reserve recent remains for an interruptible necromancer ritual.
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
      for (let i = 0; i < 8; i++) {
        G.particles.push({ x: c.x + rand(-10, 10), y: c.y + 10, vx: 0, vy: rand(-140, -60),
          life: 0.6, max: 0.6, color: '#66ff66', size: 3 });
      }
    }
    nec.ritualTargets = [];
    nec.ritualDamage = 0;
    nec.ritualSuccesses++;
    nec.ritualCooldown = NECROMANCER_RITUAL.cooldown;
    nec.setMode('cast');
    popup(Theme.halloween ? 'RISE!' : 'REBUILD!', nec.x, nec.y - 26, '#66ff66');
    Sound.sfx.raise();
  };

  G.breakNecromancerRitual = nec => {
    if (nec.mode !== 'ritual') return;
    nec.ritualTargets = [];
    nec.ritualDamage = 0;
    nec.stunTime = NECROMANCER_RITUAL.stun;
    nec.setMode('stunned');
    const color = Theme.halloween ? '#66ff66' : '#33ffff';
    shockwave(nec.x, nec.y, 70, color, 0.35, 4);
    popup(Theme.halloween ? 'RITUAL BROKEN' : 'REBUILD FAILED', nec.x, nec.y - 32, color);
  };

  function popup(text, x, y, color = '#ffffff') {
    G.texts.push({ text, x, y, color, life: 1 });
  }

  // ---------- death effects ----------

  // Expanding ring; `delay` staggers several rings from one blast
  function shockwave(x, y, maxR, color = '#ffffff', life = 0.4, width = 3, delay = 0) {
    G.waves.push({ x, y, maxR, color, life, max: life, width, delay });
  }

  // Break a sprite into tumbling chunks of itself
  function shatter(sprite, x, y, grid = 4, speed = 160) {
    const cw = sprite.w / grid;
    const ch = sprite.h / grid;
    for (let gx = 0; gx < grid; gx++) {
      for (let gy = 0; gy < grid; gy++) {
        const ox = (gx + 0.5) * cw - sprite.w / 2;
        const oy = (gy + 0.5) * ch - sprite.h / 2;
        const a = Math.atan2(oy, ox) + rand(-0.5, 0.5);
        const sp = rand(0.4, 1) * speed;
        const life = rand(0.5, 0.9);
        G.particles.push({
          x: x + ox, y: y + oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life, max: life,
          img: sprite.img, sx: gx * cw, sy: gy * ch, sw: cw, sh: ch, rot: 0, vr: rand(-10, 10), gravity: 220,
        });
      }
    }
  }

  function enemyDeathFx(e) {
    const big = e.type === 'tank' || e.type === 'minelayer' || e.type === 'bonus' || e.elite;
    shatter(Sprites.get(e.spriteKey(G.t)), e.x, e.y, big ? 5 : 3, big ? 220 : 150);
    shockwave(e.x, e.y, big ? 70 : 32, e.elite || e.type === 'bonus' ? '#ffcc00' : '#ffffff');
    explode(e.x, e.y, ['#ffffff', '#ff9933', '#ffee33', '#ff3344'], big ? 24 : 10);
    if (Theme.halloween) {
      // Spooky: a wisp of soul drifts up from the remains
      for (let i = 0; i < 3; i++) {
        G.particles.push({ x: e.x + rand(-6, 6), y: e.y, vx: rand(-10, 10), vy: rand(-70, -40),
          life: 1, max: 1, color: '#ccffcc', size: 3 });
      }
    }
    if (big) {
      G.hitstop = Math.max(G.hitstop, 0.05);
      G.shake = Math.max(G.shake, 6);
    }
  }

  // ---------- stars ----------

  const STAR_SPEED = [0, 20, 50, 110];
  const STAR_COLOR = ['', '#334466', '#6677aa', '#ccddff'];
  const stars = Array.from({ length: 100 }, () => ({
    x: Math.random() * W, y: Math.random() * H, z: 1 + Math.floor(Math.random() * 3),
  }));

  function warpFactor() {
    return G.state === 'levelclear' || G.state === 'victory' ? 1 + Math.min(G.stateTime, 2) * 4 : 1;
  }

  function updateStars(dt) {
    const warp = warpFactor();
    for (const s of stars) {
      s.y += STAR_SPEED[s.z] * warp * dt;
      if (s.y > H) { s.y -= H; s.x = Math.random() * W; }
    }
  }

  function drawStars() {
    const warp = warpFactor();
    for (const s of stars) {
      ctx.fillStyle = STAR_COLOR[s.z];
      const size = s.z === 3 ? 2 : 1;
      ctx.fillRect(s.x, s.y, size, size * (warp > 1.5 ? warp * s.z : 1));
    }
  }

  // ---------- game flow ----------

  function setState(s) {
    G.state = s;
    G.stateTime = 0;
  }

  function newGame() {
    G.score = 0;
    G.lives = 3;
    G.level = 1;
    G.nextLife = LIFE_MILESTONES[0];
    G.victory = false;
    G.lastRank = -1;
    G.ultCharge = 0;
    G.treats = 0;
    // Ask the world leaderboard for a run token in the background; a late reply is
    // ignored if another game has started since
    const run = ++G.runId;
    G.runToken = null;
    G.worldRank = null;
    G.motion.championTime = 0;
    G.motion.championEmitted = false;
    Leaderboard.world.startRun().then(token => { if (G.runId === run) G.runToken = token; });
    G.player = new Player();
    startLevel(1);
    setState('playing');
  }

  function startLevel(n) {
    G.playerBullets = [];
    G.enemyBullets = [];
    G.enemies = [];
    G.asteroids = [];
    G.powerups = [];
    G.boss = null;
    G.events = buildLevel(n);
    G.eventIdx = 0;
    G.levelTime = 0;
    G.phase = 'waves';
    G.phaseTime = 0;
    G.tookDamage = false;
    G.combo = 0;
    G.bannerTime = 2.5;
    G.paused = false;
    G.ultTime = 0;
    G.bonusTimer = rand(10, 22);
    G.bonusCount = 0;
    G.corpses = [];
    G.cat = null;
    G.catTimer = rand(15, 35);
    G.spook = 0;
    G.player.reset();
  }

  function spawnEvent(ev) {
    if (ev.kind === 'enemy') {
      // Now and then a regular enemy rolls as a tougher, richer elite
      const elite = ELITE_TYPES.includes(ev.type) && Math.random() < 0.05 + 0.01 * Math.min(G.level, 10);
      G.enemies.push(new Enemy(ev.type, ev.x, -20, elite ? { ...ev.opts, elite } : ev.opts));
    } else {
      G.asteroids.push(new Asteroid(ev.x, -40, ev.size, ev.vx, ev.vy));
    }
  }

  function addPoints(pts) {
    G.score += pts;
    while (G.score >= G.nextLife) {
      G.nextLife = nextLifeAfter(G.nextLife);
      if (G.lives < MAX_LIVES) {
        G.lives++;
        popup('1UP!', W / 2, H / 2, '#ff44dd');
        Sound.sfx.extraLife();
      }
    }
  }

  // Kill score with combo multiplier: every 8 quick kills adds x1, up to x5
  function scoreKill(base, x, y) {
    G.combo++;
    G.comboTimer = 1.5;
    const mult = Math.min(5, 1 + Math.floor(G.combo / 8));
    addPoints(base * mult);
    if (mult > 1 || base >= 300) popup(`${base * mult}`, x, y, mult > 1 ? '#ffee33' : '#ffffff');
    chargeUltimate(2 * mult);
  }

  // The ultimate only charges while the main gun is at MAX POWER and the beam isn't firing
  function chargeUltimate(amount) {
    if (G.player.power < MAX_POWER || G.ultTime > 0 || G.ultCharge >= 100) return;
    G.ultCharge = Math.min(100, G.ultCharge + amount);
    if (G.ultCharge >= 100) {
      popup('ULTIMATE READY', W / 2, H / 2 + 60, '#ffffff');
      Sound.sfx.extraLife();
    }
  }

  function activateUltimate() {
    G.ultCharge = 0;
    G.ultTime = 4;
    G.enemyBullets = [];
    G.flash = 0.8;
    G.shake = 12;
    Sound.sfx.ultimate();
  }

  // Omega beam: a wide column above the ship that melts everything in it
  function updateUltimate(dt) {
    G.ultTime = Math.max(0, G.ultTime - dt);
    const p = G.player;
    if (!p.alive) return;
    const half = 40;
    const dps = 40;
    for (const o of [...G.enemies, ...G.asteroids]) {
      if (o.dead || o.y >= p.y || Math.abs(o.x - p.x) >= half + o.r) continue;
      if (Theme.halloween && o.type === 'tank') { petrify(o); continue; }
      hitTarget(o, dps * dt * (Theme.halloween && o.type === 'diver' ? 3 : 1), true);
    }
    for (const b of G.enemyBullets) {
      if (b.y < p.y && Math.abs(b.x - p.x) < half) b.dead = true;
    }
    const boss = G.boss;
    if (boss && boss.y < p.y && Math.abs(boss.x - p.x) < half + boss.w * 0.42) {
      damageBoss(dps * dt * (Theme.halloween && boss.def.final ? 3 : 1)); // sunlight scorches Dracula
    }
    if (Math.random() < 0.6) {
      explode(p.x + rand(-half, half), rand(0, p.y), ['#ffffff', '#33ffff', '#ff44dd'], 2, 80);
    }
    G.shake = Math.max(G.shake, 2);
  }

  function maybeDrop(x, y, chance, kind = randomPowerupKind()) {
    if (Math.random() < chance) G.powerups.push(new PowerUp(x, y, kind));
  }

  // Damage an enemy or asteroid; `quiet` skips the hit blip for continuous damage
  function hitTarget(o, dmg, quiet = false) {
    if (o.dead || o.intangible) return;
    const killed = o.hit(dmg);
    if (killed) {
      if (o instanceof Asteroid) killAsteroid(o); else killEnemy(o);
    } else {
      if (o.type === 'necromancer' && o.mode === 'ritual' && o.ritualDamage >= o.ritualThreshold) {
        G.breakNecromancerRitual(o);
      }
      if (!quiet) Sound.sfx.hit();
    }
  }

  function splash(x, y, { radius, dmg, shake = 3, cluster = 0 }, direct) {
    explode(x, y, ['#ffee33', '#ff9933', '#ff3344', '#ffffff'], 10 + radius / 3, radius * 4);
    shockwave(x, y, radius, '#ff9933', 0.3, 4);
    const c = { x, y };
    for (const o of [...G.enemies, ...G.asteroids]) {
      if (o !== direct && !o.dead && dist2(c, o) < (radius + o.r) ** 2) hitTarget(o, dmg, true);
    }
    const b = G.boss;
    if (b && direct !== b && dist2(c, b) < (radius + b.w * 0.4) ** 2) damageBoss(dmg);
    // Top-level rockets burst into shrapnel
    for (let i = 0; i < cluster; i++) {
      const a = (i / cluster) * Math.PI * 2;
      G.playerBullets.push(new Bullet(x, y, Math.cos(a) * 320, Math.sin(a) * 320, true, { dmg: 1.5 }));
    }
    G.shake = Math.max(G.shake, shake);
    Sound.sfx.explode();
  }

  function killEnemy(e) {
    e.dead = true;
    e.ritualTargets = [];
    scoreKill(e.score, e.x, e.y);
    enemyDeathFx(e);
    if (REVIVABLE.has(e.type) && !e.raised) {
      G.corpses.push({ type: e.type, x: e.x, y: e.y, t: G.levelTime });
      if (G.corpses.length > 20) G.corpses.shift();
    }
    if (e.type === 'necromancer') {
      // Its minions crumble with it
      for (const m of G.enemies) {
        if (m.owner === e && !m.dead) { m.dead = true; enemyDeathFx(m); }
      }
      popup(Theme.halloween ? 'THE DEAD REST' : 'DRONES OFFLINE', e.x, e.y - 40, '#66ff66');
    }
    if (e.type === 'splitter') {
      for (const side of [-1, 1]) {
        G.enemies.push(new Enemy('mini', e.x + side * 8, e.y, { vx: side * rand(80, 140), speedMul: e.speedMul }));
      }
    }
    if (e.type === 'bonus') {
      for (let i = -1; i <= 1; i++) G.powerups.push(new PowerUp(e.x + i * 26, e.y, randomPowerupKind()));
      popup('BONUS!', e.x, e.y - 24, '#ffcc00');
      Sound.sfx.extraLife();
    }
    maybeDrop(e.x, e.y, e.drop, e.type === 'tank' ? 'power' : undefined);
    Sound.sfx.explode();
  }

  function killAsteroid(a) {
    a.dead = true;
    scoreKill(a.score, a.x, a.y);
    explode(a.x, a.y, ['#cc9966', '#886644', '#ffffff'], 6 + a.size * 6, 120);
    if (a.size > 1) {
      for (const side of [-1, 1]) {
        G.asteroids.push(new Asteroid(a.x, a.y, a.size - 1, a.vx + side * rand(40, 80), a.vy * rand(0.9, 1.3)));
      }
    }
    maybeDrop(a.x, a.y, 0.05);
    Sound.sfx.explode();
  }

  // ---------- Halloween folklore ----------
  const UNDEAD = new Set(['grunt', 'phantom', 'diver']); // ghouls, ghosts, vampires

  // Holy water burns the undead (x2) and melts witches (x3)
  function holyMult(o) {
    if (!Theme.halloween) return 1;
    if (o === G.boss) return o.def.sprite === 'boss3' || o.def.final ? 2 : 1;
    if (o.type === 'minelayer') return 3;
    return UNDEAD.has(o.type) || o.type === 'necromancer' ? 2 : 1;
  }

  // Silver hurts the werewolf (x2) and wounds it so it can't regenerate for a while
  function silverMult(o) {
    if (!Theme.halloween || o !== G.boss || o.def.fears !== 'silver') return 1;
    o.silverT = 2;
    return 2;
  }

  // Frankenstein's monster fears fire: rockets hit it twice as hard
  const fireMult = o => (Theme.halloween && o === G.boss && o.def.fears === 'fire' ? 2 : 1);

  // Garlic: vampires and bats recoil from the aura and take damage inside it
  function updateGarlic(dt) {
    const p = G.player;
    if (!p.alive || p.garlic <= 0 || !Theme.halloween) return;
    for (const e of G.enemies) {
      if (e.dead || (e.type !== 'diver' && e.type !== 'swooper')) continue;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > GARLIC_RADIUS + e.r) continue;
      if (e.type === 'diver') {
        // A diving vampire veers off and flees
        e.vx = (dx / d) * 380;
        e.vy = (dy / d) * 380;
        e.setMode('dive');
      } else {
        e.baseX += (dx / d) * 220 * dt;
        e.y += (dy / d) * 120 * dt;
      }
      hitTarget(e, 4 * dt, true);
      if (Math.random() < 0.2) explode(e.x, e.y, ['#f5f0d0', '#ccff99'], 2, 60);
    }
  }

  // Player laser: continuous piercing beam straight up from the nose
  function updateLaser(dt) {
    const p = G.player;
    if (!p.alive || !p.lasing) return;
    const spec = SECONDARY.laser.levels[p.secondary.level];
    for (const o of [...G.enemies, ...G.asteroids]) {
      if (!o.dead && o.y < p.y && Math.abs(o.x - p.x) < spec.width + o.r) hitTarget(o, spec.dps * dt, true);
    }
    const boss = G.boss;
    if (boss && boss.y < p.y && Math.abs(boss.x - p.x) < spec.width + boss.w * 0.42) damageBoss(spec.dps * dt);
  }

  // Sunbeam (Halloween ultimate): trolls turn to stone in sunlight
  function petrify(o) {
    o.hp = 0;
    shockwave(o.x, o.y, 60, '#aaaaaa', 0.4, 4);
    popup('STONE!', o.x, o.y - 20, '#cccccc');
    killEnemy(o);
  }

  function damageBoss(dmg) {
    const b = G.boss;
    if (!b || b.state !== 'fight' || b.dead) return;
    if (Theme.halloween && b.def.final && G.player.garlic > 0) dmg *= 2; // Dracula hates garlic
    b.hp -= dmg;
    b.flash = 0.05;
    chargeUltimate(dmg * 0.1);
    if (b.hp > 0) return;
    if (b.def.revives && !b.revived) reviveBoss(); else bossKilled();
  }

  // IT'S ALIVE! The monster is jolted back to life once, at 30% and angrier
  function reviveBoss() {
    const b = G.boss;
    b.revived = true;
    b.hp = b.maxHp * 0.3;
    b.cancelAttacks();
    b.stun = 1.5;
    G.enemyBullets = [];
    G.flash = 0.8;
    G.shake = 12;
    shockwave(b.x, b.y, 180, '#ccddff', 0.5, 5);
    popup(Theme.halloween ? "IT'S ALIVE!" : 'REBOOTING!', W / 2, H / 2 - 40, '#ccddff');
    Sound.sfx.bigExplode();
  }

  function bossKilled() {
    const b = G.boss;
    b.dead = true;
    b.hp = 0;
    G.victory = !!b.def.final;
    const bonus = b.def.final ? 50000 * (loopOf(G.level) + 1) : 5000 * G.level;
    addPoints(bonus);
    // Beat the berserk clock for a speed bonus
    const speedBonus = Math.max(0, Math.ceil(b.timeLeft)) * 500;
    if (speedBonus) {
      addPoints(speedBonus);
      popup(`SPEED BONUS ${speedBonus}`, b.x, b.y + 24, '#33ffff');
    }
    popup(`BOSS ${bonus}`, b.x, b.y, '#ffee33');
    G.enemyBullets = [];
    for (const e of G.enemies) {
      e.dead = true;
      explode(e.x, e.y, ['#ffffff', '#ff9933'], 10);
    }
    G.powerups.push(new PowerUp(b.x, b.y, 'ship'));
    G.phase = 'bossdying';
    G.phaseTime = 0;
    G.shake = 15;
    G.flash = 0.6;
    G.hitstop = 0.2;
    shockwave(b.x, b.y, 160, '#ffffff', 0.5, 5);
    Sound.sfx.bigExplode();
  }

  G.bossBerserk = () => {
    popup('BERSERK!', W / 2, H / 2 - 60, '#ff3344');
    G.flash = 0.4;
    G.shake = 12;
    Sound.sfx.warning();
  };

  G.bossPhaseChange = idx => {
    const b = G.boss;
    popup(`PHASE ${idx + 1}`, W / 2, H / 2 - 40, '#ff3344');
    G.enemyBullets = [];
    G.flash = 0.5;
    G.shake = 10;
    shockwave(b.x, b.y, 220, '#ff3344', 0.6, 5);
    Sound.sfx.bigExplode();
  };

  function levelClear() {
    G.levelBonus = 1000 * G.level;
    G.perfectBonus = G.tookDamage ? 0 : 5000 * G.level;
    addPoints(G.levelBonus + G.perfectBonus);
    G.boss = null;
    G.cat = null;
    if (G.player.alive) {
      for (const u of G.powerups) if (u.kind !== 'bomb') applyPowerup(u.kind);
    }
    G.powerups = [];
    G.enemyBullets = [];
    if (G.victory) {
      G.livesBonus = G.lives * 10000;
      addPoints(G.livesBonus);
      setState('victory');
    } else {
      setState('levelclear');
    }
    Sound.sfx.levelClear();
  }

  function damagePlayer() {
    const p = G.player;
    if (!p.alive || p.invuln > 0 || G.ultTime > 0) return;
    if (p.shields > 0) {
      p.shields--;
      p.invuln = 1;
      G.shake = 5;
      Sound.sfx.shieldHit();
      return;
    }
    p.alive = false;
    G.lives--;
    G.tookDamage = true;
    shatter(Sprites.get(p.mk === 1 ? 'player' : `player_mk${p.mk}`), p.x, p.y, 5, 260);
    for (let i = 0; i < 3; i++) shockwave(p.x, p.y, 90 + i * 50, i === 1 ? '#33ffff' : '#ffffff', 0.5, 4, i * 0.1);
    G.flash = 0.5;
    G.hitstop = 0.18;
    p.downgrade();
    G.ultCharge = 0;
    G.ultTime = 0;
    G.combo = 0;
    G.respawnTimer = 2;
    G.shake = 12;
    explode(p.x, p.y, ['#ffffff', '#33ffff', '#3366ff', '#ff3344'], 40, 220);
    Sound.sfx.playerDie();
  }

  function bomb() {
    G.enemyBullets = [];
    for (const o of [...G.enemies, ...G.asteroids]) hitTarget(o, 10, true);
    damageBoss(20);
    G.flash = 0.7;
    G.shake = 10;
    Sound.sfx.bigExplode();
  }

  function applyPowerup(kind) {
    const p = G.player;
    let label = POWERUPS[kind].name;
    let isMaxed = false;
    // Collecting an upgrade that can't go any higher pays out points instead
    const maxed = (pts = 1000) => { addPoints(pts); label = `MAXED +${pts}`; isMaxed = true; };
    switch (kind) {
      case 'power':
        if (p.power >= MAX_POWER) maxed();
        else {
          p.power++;
          label = p.power === MAX_POWER ? 'MAX POWER' : `POWER ${p.power}`;
        }
        break;
      case 'spread':
        if (p.spread >= 2) maxed(); else label = `SPREAD ${++p.spread}`;
        break;
      case 'rockets':
      case 'homing':
      case 'laser':
      case 'cross':
        if (!p.secondary) p.secondary = { kind, level: 1 };
        else if (p.secondary.kind !== kind) p.secondary.kind = kind; // swap, keep level
        else if (p.secondary.level >= MAX_SECONDARY) maxed();
        else p.secondary.level++;
        if (!isMaxed) label = `${SECONDARY[kind].name} ${p.secondary.level}`;
        break;
      case 'drone':
        if (p.drones.length >= MAX_DRONES) maxed(); else p.setDroneCount(p.drones.length + 1);
        break;
      case 'shield':
        if (p.shields >= p.maxShields) maxed();
        else label = `SHIELD ${++p.shields}/${p.maxShields}`;
        break;
      case 'ship':
        if (p.mk >= MAX_MK) maxed(5000);
        else {
          p.mk++;
          p.shields = p.maxShields;
          label = `SHIP MK${p.mk}`;
        }
        break;
      case 'rapid': p.rapid = 10; break;
      case 'garlic': p.garlic = 10; break;
      case 'holy': p.holy = 10; break;
      case 'silver': p.silver = 10; break;
      case 'treat':
        if (G.treats >= MAX_TREATS) maxed(); else label = `TREAT ${++G.treats}/${MAX_TREATS}`;
        break;
      case 'bomb': bomb(); break;
      case 'life':
        if (G.lives >= MAX_LIVES) maxed(); else G.lives++;
        break;
    }
    if (!isMaxed) addPoints(100);
    popup(label, p.x, p.y - 30, isMaxed ? '#ffee33' : POWERUPS[kind].color);
    Sound.sfx.powerup();
  }

  // ---------- touch targets (drawn on the canvas in touch mode) ----------

  const PAUSE_BTN = { x: W - 26, y: 104, r: 20 };
  const ULT_BTN = { x: W - 46, y: H - 112, r: 30 };
  const SAVE_BTN = { x: W / 2, y: 475, r: 32 }; // clear of the '-' row under the letters
  const NAME_Y = 350;
  const nameX = i => W / 2 + (i - 1) * 60;
  const THEME_LINE_Y = 562;
  const tapped = () => Input.taps().length > 0;
  // Generous hit circles: fingers are bigger than the drawn buttons
  const tapOn = b => Input.taps().find(t => Math.hypot(t.x - b.x, t.y - b.y) < b.r + 10);
  // The title screen alternates with the high-score table every 9 seconds
  const titleShowsTable = () => G.motion.titleAlphas(G.stateTime).table >= 0.5;

  // ---------- per-state updates ----------

  function updateTitle() {
    Leaderboard.world.refresh();
    const themeTap = !titleShowsTable() && Input.taps().find(t => Math.abs(t.y - THEME_LINE_Y) < 14);
    if (Input.wasPressed('KeyT') || themeTap) {
      Theme.toggle();
      Sound.sfx.select();
    } else if (Input.wasPressed('Enter', 'Space') || tapped()) {
      Sound.sfx.confirm();
      newGame();
    }
  }

  function updatePlaying(dt) {
    const pauseTap = G.paused ? Input.taps()[0] : tapOn(PAUSE_BTN);
    if (pauseTap) Input.release(pauseTap.id);
    if (Input.wasPressed('KeyP', 'Escape') || pauseTap) G.paused = !G.paused;
    if (G.paused) return;

    G.levelTime += dt;
    G.bannerTime = Math.max(0, G.bannerTime - dt);
    G.comboTimer -= dt;
    if (G.comboTimer <= 0) G.combo = 0;

    while (G.eventIdx < G.events.length && G.events[G.eventIdx].at <= G.levelTime) {
      spawnEvent(G.events[G.eventIdx++]);
    }

    // A bonus monster streaks across once or twice a level
    if (G.phase === 'waves' && G.bonusCount < 2) {
      G.bonusTimer -= dt;
      if (G.bonusTimer <= 0) {
        G.bonusCount++;
        G.bonusTimer = rand(15, 25);
        G.enemies.push(new Enemy('bonus', 0, 0, { hpBonus: loopOf(G.level) * 4 }));
        popup(Theme.halloween ? 'GOLDEN PUMPKIN!' : 'BONUS SAUCER!', W / 2, 110, '#ffcc00');
        Sound.sfx.bonus();
      }
    }

    // Level phases: waves -> warning -> boss -> bossdying -> levelclear
    if (G.phase === 'waves') {
      if (G.eventIdx >= G.events.length && !G.enemies.length && !G.asteroids.length) {
        G.phase = 'warning';
        G.phaseTime = 0;
        Sound.sfx.warning();
      }
    } else if (G.phase === 'warning') {
      G.phaseTime += dt;
      if (G.phaseTime >= 3) {
        G.boss = new Boss(G.level, isFinalLevel(G.level), loopOf(G.level));
        G.phase = 'boss';
      }
    } else if (G.phase === 'bossdying') {
      G.phaseTime += dt;
      const b = G.boss;
      if (Math.random() < 0.3) {
        const ex = b.x + rand(-b.w / 2, b.w / 2);
        const ey = b.y + rand(-b.h / 2, b.h / 2);
        explode(ex, ey, ['#ffffff', '#ff9933', '#ffee33'], 12);
        shockwave(ex, ey, rand(30, 60), '#ffee33', 0.35, 3);
        if (Math.random() < 0.3) Sound.sfx.explode();
      }
      G.shake = Math.max(G.shake, 4);
      if (G.phaseTime >= 2.5) {
        // Final blast: the boss shatters into pieces
        shatter(Sprites.get(b.def.sprite), b.x, b.y, 8, 320);
        for (let i = 0; i < 3; i++) shockwave(b.x, b.y, 260 + i * 60, i % 2 ? '#ff9933' : '#ffffff', 0.7, 6, i * 0.12);
        explode(b.x, b.y, ['#ffffff', '#ff9933', '#ffee33', '#ff3344'], 60, 320);
        G.flash = 1;
        G.hitstop = 0.25;
        Sound.sfx.bigExplode();
        return levelClear();
      }
    }

    const p = G.player;
    const ultTap = tapOn(ULT_BTN);
    if (ultTap) Input.release(ultTap.id);
    if (p.alive && G.ultCharge >= 100 && (Input.wasPressed('KeyE', 'ShiftLeft', 'ShiftRight') || ultTap)) activateUltimate();
    if (G.ultTime > 0) updateUltimate(dt);
    updateGarlic(dt);
    updateLaser(dt);
    updateCat(dt);
    if (p.alive) {
      p.update(dt, G);
    } else {
      G.respawnTimer -= dt;
      if (G.respawnTimer <= 0) {
        if (G.lives > 0) {
          p.reset();
          G.enemyBullets = [];
        } else {
          setState('gameover');
          Sound.sfx.gameOver();
          return;
        }
      }
    }

    G.spook = Math.max(0, G.spook - dt);
    const spooked = G.spook > 0;
    for (const list of [G.playerBullets, G.asteroids, G.powerups, ...(spooked ? [] : [G.enemyBullets, G.enemies])]) {
      for (const o of list) o.update(dt, G);
    }
    if (spooked) for (const e of G.enemies) e.flash = Math.max(0, e.flash - dt);
    if (G.boss && G.phase === 'boss') G.boss.update(dt, G);

    collide();

    G.playerBullets = G.playerBullets.filter(o => !o.dead);
    G.enemyBullets = G.enemyBullets.filter(o => !o.dead);
    G.enemies = G.enemies.filter(o => !o.dead);
    G.asteroids = G.asteroids.filter(o => !o.dead);
    G.powerups = G.powerups.filter(o => !o.dead);
  }

  function collide() {
    // Player bullets vs everything hostile
    for (const b of G.playerBullets) {
      if (b.dead) continue;
      const boss = G.boss;
      if (b.pierce) {
        const ready = o => (b.hits.get(o) ?? 0) <= G.t;
        for (const o of [...G.enemies, ...G.asteroids]) {
          if (!o.dead && !o.intangible && ready(o) && dist2(b, o) < (o.r + b.r) ** 2) {
            b.hits.set(o, G.t + 0.25);
            hitTarget(o, b.dmg * holyMult(o));
          }
        }
        if (boss && boss.state === 'fight' && !boss.dead && ready(boss) && boss.hitTest(b.x, b.y)) {
          b.hits.set(boss, G.t + 0.25);
          damageBoss(b.dmg * holyMult(boss));
        }
        continue;
      }
      let target = G.enemies.find(e => !e.dead && !e.intangible && dist2(b, e) < (e.r + b.r) ** 2)
        || G.asteroids.find(a => !a.dead && dist2(b, a) < (a.r + b.r) ** 2);
      if (!target && boss && boss.state === 'fight' && !boss.dead && boss.hitTest(b.x, b.y)) target = boss;
      if (!target) continue;
      b.dead = true;
      const mult = (b.holy ? holyMult(target) : 1) * (b.silver ? silverMult(target) : 1) * (b instanceof Rocket ? fireMult(target) : 1);
      if (mult > 1) explode(b.x, b.y, b.silver ? ['#e8eef8', '#ffffff'] : ['#66ccff', '#ffffff'], 4, 80);
      if (target === boss) {
        damageBoss(b.dmg * mult);
        if (!boss.dead) Sound.sfx.hit();
      } else {
        hitTarget(target, b.dmg * mult);
      }
      if (b.splash) splash(b.x, b.y, b.splash, target);
    }

    const p = G.player;
    if (!p.alive) return;

    for (const b of G.enemyBullets) {
      if (b.dead) continue;
      const blocker = p.drones.find(d => dist2(b, d) < (b.r + d.r) ** 2);
      if (blocker) {
        b.dead = true;
        explode(b.x, b.y, ['#33ffff', '#ffffff'], 4, 60);
        continue;
      }
      if (dist2(b, p) < (b.r + p.r) ** 2) {
        b.dead = true;
        if (b.curse) { cursePlayer(); continue; }
        damagePlayer();
        if (!p.alive) return;
      }
    }
    for (const e of G.enemies) {
      if (!e.dead && !e.intangible && dist2(e, p) < (e.r * 0.8 + p.r) ** 2) {
        const exposed = p.invuln <= 0 && G.ultTime <= 0;
        damagePlayer();
        if (exposed) hitTarget(e, 3);
        if (!p.alive) return;
      }
    }
    for (const a of G.asteroids) {
      if (!a.dead && dist2(a, p) < (a.r * 0.85 + p.r) ** 2) {
        damagePlayer();
        if (!p.alive) return;
      }
    }
    const boss = G.boss;
    if (boss && !boss.dead && boss.state === 'fight') {
      const hitBody = Math.abs(p.x - boss.x) < boss.w * 0.4 && Math.abs(p.y - boss.y) < boss.h * 0.35;
      const hitLaser = boss.laserActive && p.y > boss.y && boss.laser.xs.some(lx => Math.abs(p.x - lx) < 14 + p.r);
      if (hitBody || hitLaser) damagePlayer();
      if (!p.alive) return;
    }
    for (const u of G.powerups) {
      if (!u.dead && dist2(u, p) < (u.r + 14) ** 2) {
        u.dead = true;
        applyPowerup(u.kind);
      }
    }
  }

  const resultAdvancePressed = () => Input.wasPressed('Enter', 'Space') || tapped();

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

  function updateGameOver() {
    if (G.stateTime >= 3 || (G.stateTime > 1 && (Input.wasPressed('Enter') || tapped()))) {
      if (Leaderboard.qualifies(G.score) || Leaderboard.world.qualifies(G.score)) {
        G.name = [0, 0, 0];
        G.namePos = 0;
        setState('entername');
      } else {
        setState('leaderboard');
      }
    }
  }

  function updateEnterName() {
    const n = CHARS.length;
    // Touch: tap a letter to pick it, above it to go forward, below it to go back
    let up = Input.wasPressed('ArrowUp');
    let dn = Input.wasPressed('ArrowDown');
    for (const t of Input.taps()) {
      const i = [0, 1, 2].find(k => Math.abs(t.x - nameX(k)) < 30);
      if (i === undefined || Math.abs(t.y - NAME_Y) > 70) continue;
      G.namePos = i;
      if (t.y < NAME_Y - 22) up = true;
      else if (t.y > NAME_Y + 22) dn = true;
      else Sound.sfx.select();
    }
    if (up) {
      G.name[G.namePos] = (G.name[G.namePos] + 1) % n; Sound.sfx.select();
    }
    if (dn) {
      G.name[G.namePos] = (G.name[G.namePos] - 1 + n) % n; Sound.sfx.select();
    }
    if (Input.wasPressed('ArrowLeft', 'Backspace')) { G.namePos = Math.max(0, G.namePos - 1); Sound.sfx.select(); }
    if (Input.wasPressed('ArrowRight')) { G.namePos = Math.min(2, G.namePos + 1); Sound.sfx.select(); }
    for (const ch of Input.typedChars()) {
      const idx = CHARS.indexOf(ch);
      if (idx >= 0) {
        G.name[G.namePos] = idx;
        G.namePos = Math.min(2, G.namePos + 1);
        Sound.sfx.select();
      }
    }
    if (Input.wasPressed('Enter') || tapOn(SAVE_BTN)) {
      const name = G.name.map(i => CHARS[i]).join('').trim() || '???';
      G.lastRank = Leaderboard.add(name, G.score, G.level);
      submitWorld(name);
      Sound.sfx.confirm();
      setState('leaderboard');
    }
  }

  // Send the finished run to the world board; the leaderboard screen shows the outcome
  function submitWorld(name) {
    const token = G.runToken;
    G.runToken = null; // a token is good for one submission
    if (!token) { G.worldRank = 'failed'; return; }
    const run = G.runId;
    G.worldRank = 'pending';
    Leaderboard.world.submit(token, name, G.score, G.level).then(rank => {
      if (G.runId !== run) return;
      G.worldRank = rank ?? 'failed';
      G.motion.startChampion(rank);
      if (rank) Leaderboard.world.refresh(true);
    });
  }

  function updateLeaderboard() {
    Leaderboard.world.refresh();
    if (G.stateTime > 0.5 && (Input.wasPressed('Enter', 'Space') || tapped())) {
      Sound.sfx.confirm();
      setState('title');
    }
  }

  function updateEffects(dt) {
    for (const pt of G.particles) {
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= 0.98;
      pt.vy = pt.vy * 0.98 + (pt.gravity || 0) * dt;
      if (pt.vr) pt.rot += pt.vr * dt;
      pt.life -= dt;
    }
    G.particles = G.particles.filter(pt => pt.life > 0);
    for (const w of G.waves) {
      if (w.delay > 0) w.delay -= dt; else w.life -= dt;
    }
    G.waves = G.waves.filter(w => w.life > 0);
    for (const tx of G.texts) {
      tx.y -= 30 * dt;
      tx.life -= dt;
    }
    G.texts = G.texts.filter(tx => tx.life > 0);
    G.shake *= 0.9;
    if (G.shake < 0.3) G.shake = 0;
    G.flash = Math.max(0, G.flash - dt * 2);
  }

  function updateShakeOffset() {
    if (G.motion.reduce || (G.state === 'playing' && G.paused) || G.shake <= 0) {
      G.motion.shakeX = 0;
      G.motion.shakeY = 0;
    } else {
      G.motion.shakeX = rand(-G.shake, G.shake);
      G.motion.shakeY = rand(-G.shake, G.shake);
    }
  }

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

  function updateChampion(dt) {
    if (!G.motion.championTime || G.motion.championTime === Infinity) return;
    if (!G.motion.championEmitted) {
      G.motion.championEmitted = true;
      shockwave(W / 2, H - 90, 150, '#ffee33', 0.45, 4);
      explode(W / 2, H - 90, ['#ffee33', '#ff44dd', '#33ffff'], 24, 180);
    }
    G.motion.championTime = Math.max(0, G.motion.championTime - dt);
  }

  function update(dt) {
    G.t += dt;
    // Brief freeze-frame on big impacts. Returns false so key presses carry over.
    if (G.hitstop > 0) {
      G.hitstop -= dt;
      return false;
    }
    G.stateTime += dt;
    if (G.state !== 'entername') {
      if (Input.wasPressed('KeyM')) Sound.toggleMute();
      if (Input.wasPressed('KeyN')) Sound.toggleMusic();
    }
    updateStars(dt);
    if (!(G.state === 'playing' && G.paused)) updateEffects(dt);
    updateBossHealthTrail(dt);
    if (G.state === 'leaderboard') updateChampion(dt);
    switch (G.state) {
      case 'title': updateTitle(); break;
      case 'playing': updatePlaying(dt); break;
      case 'levelclear': updateLevelClear(); break;
      case 'victory': updateVictory(); break;
      case 'gameover': updateGameOver(); break;
      case 'entername': updateEnterName(); break;
      case 'leaderboard': updateLeaderboard(); break;
    }
    updateShakeOffset();
    Sound.music(currentTrack());
  }

  // Each level of the campaign has its own scene and stage theme
  const inGame = () => ['playing', 'levelclear', 'victory', 'gameover'].includes(G.state);
  const currentScene = () => (inGame() ? (G.level - 1) % CAMPAIGN_LENGTH : 0);

  // Stage theme during waves, boss theme for the fight, silence for the warning and paused
  function currentTrack() {
    if (G.state !== 'playing' || G.paused) return null;
    if (G.phase === 'waves') return `${Theme.prefix}stage${currentScene() + 1}`;
    if (G.phase === 'boss') return Theme.prefix + (G.boss && G.boss.def.final ? 'final' : 'boss');
    return null;
  }

  // ---------- rendering ----------

  function text(str, x, y, size, color, align = 'center') {
    ctx.font = `${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000000';
    ctx.fillText(str, x + 2, y + 2);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  const pad = (n, len = 6) => String(n).padStart(len, '0');
  const ENEMY_NAMES = {
    classic: { grunt: 'GRUNT', swooper: 'SWOOPER', shooter: 'GUNNER', tank: 'TANK',
      diver: 'DIVER', splitter: 'SPLITTER', minelayer: 'MINER', phantom: 'PHANTOM',
      necromancer: 'CARRIER' },
    halloween: { grunt: 'GHOUL', swooper: 'BAT', shooter: 'WARLOCK', tank: 'TROLL',
      diver: 'VAMPIRE', splitter: 'SPIDER', minelayer: 'WITCH', phantom: 'GHOST',
      necromancer: 'NECROMANCER' },
  };
  const blink = (rate = 2) => G.motion.blink(G.t, rate);
  const rainbow = offset => `hsl(${(G.t * 120 + offset) % 360}, 100%, 60%)`;

  function drawWorld() {
    for (const u of G.powerups) u.draw(ctx, G.t);
    if (G.cat) G.cat.draw(ctx, G.t);
    for (const a of G.asteroids) a.draw(ctx, G.t);
    for (const e of G.enemies) e.draw(ctx, G.t);
    if (G.boss && (G.phase !== 'bossdying' || blink(8))) G.boss.draw(ctx, G.t);
    for (const b of G.playerBullets) b.draw(ctx);
    for (const b of G.enemyBullets) b.draw(ctx);
    if (G.ultTime > 0 && G.player.alive) drawUltimateBeam();
    if (G.player && G.player.alive && G.player.lasing) drawPlayerLaser();
    if (G.player && G.player.alive && G.state !== 'gameover') G.player.draw(ctx, G.t);
  }

  function drawPlayerLaser() {
    const p = G.player;
    const spec = SECONDARY.laser.levels[p.secondary.level];
    const w = spec.width + Math.sin(G.t * 60) * 1;
    const top = p.y - 20;
    ctx.fillStyle = 'rgba(255, 50, 100, 0.45)';
    ctx.fillRect(p.x - w * 1.8, 0, w * 3.6, top);
    ctx.fillStyle = '#ff3366';
    ctx.fillRect(p.x - w, 0, w * 2, top);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(p.x - w / 3, 0, (w * 2) / 3, top);
    ctx.fillStyle = 'rgba(255, 200, 220, 0.8)';
    ctx.beginPath();
    ctx.arc(p.x, top, w * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawUltimateBeam() {
    const p = G.player;
    const fade = Math.min(1, G.ultTime * 2); // shrink out over the last half second
    const w = (40 + Math.sin(G.t * 50) * 4) * fade;
    const top = p.y - 16;
    ctx.fillStyle = Theme.halloween ? `hsl(45, 100%, ${60 + Math.sin(G.t * 30) * 10}%)` : rainbow(0);
    ctx.globalAlpha = 0.35;
    ctx.fillRect(p.x - w * 1.3, 0, w * 2.6, top);
    ctx.globalAlpha = 0.8;
    ctx.fillRect(p.x - w, 0, w * 2, top);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(p.x - w * 0.45, 0, w * 0.9, top);
  }

  function drawEffects() {
    for (const pt of G.particles) {
      ctx.globalAlpha = Math.max(0, pt.life / pt.max);
      if (pt.img) {
        ctx.save();
        ctx.translate(pt.x, pt.y);
        ctx.rotate(pt.rot);
        ctx.drawImage(pt.img, pt.sx, pt.sy, pt.sw, pt.sh, -pt.sw / 2, -pt.sh / 2, pt.sw, pt.sh);
        ctx.restore();
      } else {
        ctx.fillStyle = pt.color;
        ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
      }
    }
    for (const w of G.waves) {
      if (w.delay > 0) continue;
      const k = w.life / w.max;
      ctx.globalAlpha = k;
      ctx.strokeStyle = w.color;
      ctx.lineWidth = w.width * k + 1;
      ctx.beginPath();
      ctx.arc(w.x, w.y, w.maxR * (1 - k) + 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const tx of G.texts) {
      ctx.globalAlpha = Math.min(1, tx.life * 2);
      text(tx.text, tx.x, tx.y, 10, tx.color);
    }
    ctx.globalAlpha = 1;
  }

  function drawHud() {
    text('SCORE', 12, 16, 10, Theme.c.label, 'left');
    text(pad(G.score), 12, 32, 12, '#ffffff', 'left');
    text('HI', W / 2, 16, 10, Theme.c.label);
    text(pad(Math.max(Leaderboard.hiScore(), G.score)), W / 2, 32, 12, '#ffffff');
    text('LEVEL', W - 12, 16, 10, Theme.c.label, 'right');
    text(String(G.level), W - 12, 32, 12, '#ffffff', 'right');

    const mult = Math.min(5, 1 + Math.floor(G.combo / 8));
    if (mult > 1) text(`x${mult} COMBO`, 12, 50, 8, '#ffee33', 'left');

    // Lives
    const ship = Sprites.get('player');
    const lw = ship.w * 0.6;
    const lh = ship.h * 0.6;
    const shown = Math.min(G.lives, 5);
    for (let i = 0; i < shown; i++) ctx.drawImage(ship.img, 10 + i * (lw + 4), H - lh - 10, lw, lh);
    if (G.lives > 5) text(`x${G.lives}`, 10 + shown * (lw + 4) + 4, H - lh / 2 - 10, 8, '#ffffff', 'left');

    // Active power-ups
    const p = G.player;
    let x = W - 12;
    if (p.shields) { text(`O${p.shields}`, x, H - 18, 10, POWERUPS.shield.color, 'right'); x -= 36; }
    if (p.rapid > 0) {
      const bw = 50;
      ctx.fillStyle = '#333333';
      ctx.fillRect(x - bw, H - 14, bw, 6);
      ctx.fillStyle = POWERUPS.rapid.color;
      ctx.fillRect(x - bw, H - 14, bw * (p.rapid / 10), 6);
      text('R', x - bw - 6, H - 11, 8, POWERUPS.rapid.color, 'right');
      x -= bw + 28;
    }

    // Upgrade row: main gun pips, spread, secondary weapon, drones
    const ry = H - 44;
    text('PWR', 12, ry, 8, POWERUPS.power.color, 'left');
    for (let i = 0; i < MAX_POWER; i++) {
      ctx.fillStyle = i < p.power ? POWERUPS.power.color : '#333333';
      ctx.fillRect(40 + i * 10, ry - 4, 8, 8);
    }
    let cx = 100;
    const chip = (str, color) => { text(str, cx, ry, 8, color, 'left'); cx += str.length * 8 + 12; };
    if (p.mk > 1) chip(`MK${p.mk}`, POWERUPS.ship.color);
    if (p.spread > 0) chip(`S${p.spread}`, POWERUPS.spread.color);
    if (p.secondary) chip(`${SECONDARY[p.secondary.kind].label}${p.secondary.level}`, POWERUPS[p.secondary.kind].color);
    if (p.drones.length) chip(`D${p.drones.length}`, POWERUPS.drone.color);
    if (p.garlic > 0) chip(`G${Math.ceil(p.garlic)}`, POWERUPS.garlic.color);
    if (p.holy > 0) chip(`W${Math.ceil(p.holy)}`, POWERUPS.holy.color);
    if (p.silver > 0) chip(`Ag${Math.ceil(p.silver)}`, POWERUPS.silver.color);
    if (G.treats) chip(`T${G.treats}`, POWERUPS.treat.color);
    if (G.spook > 0) chip(`SPOOK${Math.ceil(G.spook)}`, '#ffee33');
    if (p.cursed > 0 && blink(4)) chip('CURSED', '#aa33ff');
    if (p.jam > 0 && blink(4)) chip('JAMMED', '#aa33ff');

    // Ultimate meter - locked until MAX POWER
    const ux = 190;
    const uw = 100;
    const uy = H - 22;
    const ready = G.ultCharge >= 100;
    text('ULT', ux - 6, uy + 3, 8, ready ? rainbow(0) : '#ffffff', 'right');
    ctx.fillStyle = '#222222';
    ctx.fillRect(ux, uy, uw, 7);
    ctx.fillStyle = G.ultTime > 0 ? '#ffffff' : ready ? rainbow(0) : '#ff44dd';
    ctx.fillRect(ux, uy, uw * (G.ultTime > 0 ? G.ultTime / 4 : G.ultCharge / 100), 7);
    if (p.power < MAX_POWER && G.ultTime <= 0) text('MAX PWR', ux + uw / 2, uy + 4, 6, '#666666');
    if (ready && blink(3)) text(`${Input.touch ? 'TAP ULT' : 'PRESS E'} FOR ${Theme.halloween ? 'SUNBEAM' : 'ULTIMATE'}`, W / 2, H - 70, 10, '#ffffff');
    if (Input.touch) drawTouchButtons(ready);

    // Boss health
    const b = G.boss;
    if (b && G.phase === 'boss') {
      text(Theme.halloween ? b.def.hname : b.def.name, W / 2, 62, 8, '#ff44dd');
      ctx.fillStyle = '#331122';
      ctx.fillRect(40, 72, W - 80, 8);
      ctx.fillStyle = '#ff9933';
      ctx.fillRect(40, 72, (W - 80) * Math.max(0, G.motion.bossHpTrail / b.maxHp), 8);
      ctx.fillStyle = b.berserk ? (blink(8) ? '#ff0000' : '#ffffff') : b.raging ? (blink(4) ? '#ff3344' : '#ff9933') : '#ff44dd';
      ctx.fillRect(40, 72, (W - 80) * Math.max(0, b.hp / b.maxHp), 8);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.strokeRect(40.5, 72.5, W - 81, 7);
      ctx.fillStyle = '#ffffff';
      for (const ph of b.def.phases) {
        if (ph.hp < 1) ctx.fillRect(40 + (W - 80) * ph.hp - 1, 70, 2, 12);
      }
      if (b.state === 'fight') {
        if (b.berserk) {
          if (blink(4)) text('BERSERK!', W / 2, 92, 8, '#ff3344');
        } else {
          const urgent = b.timeLeft < 10;
          text(`BERSERK IN ${Math.ceil(b.timeLeft)}`, W / 2, 92, 8,
            urgent ? (blink(4) ? '#ff3344' : '#ffffff') : '#aaaaaa');
        }
      }
    }
  }

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

  function drawTouchButtons(ultReady) {
    const pausePressed = Input.isTouching(PAUSE_BTN.x, PAUSE_BTN.y, PAUSE_BTN.r + 10);
    const ultPressed = ultReady && Input.isTouching(ULT_BTN.x, ULT_BTN.y, ULT_BTN.r + 10);
    drawButton(PAUSE_BTN, '#ffffff', pausePressed ? 0.75 : 0.5, pausePressed, () => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-6, -7, 4, 14);
      ctx.fillRect(2, -7, 4, 14);
    });
    drawButton(ULT_BTN, ultReady ? rainbow(0) : '#666666', ultReady ? (ultPressed ? 1 : 0.9) : 0.4, ultPressed, () => {
      ctx.globalAlpha = ultReady ? 1 : 0.4;
      text('ULT', 1, 1, 10, ultReady ? '#ffffff' : '#888888');
    });
  }

  function drawPlayingOverlays() {
    if (G.bannerTime > 0) {
      ctx.save();
      ctx.globalAlpha = G.motion.bannerAlpha(G.bannerTime);
      const loop = loopOf(G.level);
      text(isFinalLevel(G.level) ? 'FINAL LEVEL' : `LEVEL ${G.level}`, W / 2, H / 2 - 20, 24, rainbow(0));
      if (loop > 0) text(`LOOP ${loop + 1}`, W / 2, H / 2 - 56, 10, '#ff3344');
      text(Backgrounds.name(currentScene()), W / 2, H / 2 + 46, 10, Theme.c.label);
      if (blink(3)) text('GET READY', W / 2, H / 2 + 16, 12, '#ffffff');
      ctx.restore();
    }
    if (G.phase === 'warning') {
      ctx.fillStyle = `rgba(255, 0, 40, ${0.15 + Math.sin(G.phaseTime * 8) * 0.1})`;
      ctx.fillRect(0, H / 2 - 50, W, 100);
      if (blink(3)) text('WARNING', W / 2, H / 2 - 12, 32, Theme.c.label);
      text(isFinalLevel(G.level) ? 'FINAL BOSS APPROACHING' : 'BOSS APPROACHING', W / 2, H / 2 + 28, 10, '#ffffff');
    }
    if (G.paused) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(0, 0, W, H);
      text('PAUSED', W / 2, H / 2 - 10, 24, '#ffffff');
      text(Input.touch ? 'TAP TO RESUME' : 'P TO RESUME', W / 2, H / 2 + 24, 10, '#aaaaaa');
    }
  }

  function drawTitleCard() {
    if (Theme.halloween) {
      const flicker = !G.motion.reduce && Math.random() < 0.05 ? '#ffffff' : '#ff9933';
      text('SPOOKY', W / 2, 90, 40, flicker);
      text('BLASTER', W / 2, 140, 40, '#9944ee');
    } else {
      text('STAR', W / 2, 90, 40, rainbow(0));
      text('BLASTER', W / 2, 140, 40, rainbow(60));
    }

    text('- SCORE TABLE -', W / 2, 192, 10, Theme.c.label);
    const names = Theme.halloween ? ENEMY_NAMES.halloween : ENEMY_NAMES.classic;
    Object.keys(names).forEach((key, i) => {
      const s = Sprites.get(key);
      const x = 30 + (i % 3) * 150;
      const y = 218 + Math.floor(i / 3) * 32;
      ctx.drawImage(s.img, x - s.w / 2, y - s.h / 2);
      text(names[key], x + 26, y - 6, 8, Theme.c.label, 'left');
      text(`${ENEMY_TYPES[key].score}`, x + 26, y + 7, 8, '#ffffff', 'left');
    });

    text('- POWER-UPS -', W / 2, 348, 10, Theme.c.label);
    activePowerupKinds().forEach((kind, i) => {
      const x = 40 + (i % 3) * 150;
      const y = 370 + Math.floor(i / 3) * 23;
      const u = new PowerUp(x, y, kind);
      u.t = G.t;
      u.draw(ctx);
      text(POWERUPS[kind].name, x + 20, y, 8, POWERUPS[kind].color, 'left');
    });

    const tips = Theme.halloween
      ? ['MAX POWER KILLS CHARGE THE SUNBEAM', 'GARLIC REPELS VAMPIRES AND BATS', 'HOLY WATER BURNS THE UNDEAD',
        'SUNLIGHT TURNS TROLLS TO STONE', 'WATER MELTS WITCHES', 'SILVER BULLETS SLAY WEREWOLVES',
        'THE MONSTER FEARS FIRE - USE ROCKETS', 'HOLY CROSSES RETURN TO YOUR HAND',
        'SLAY THE NECROMANCER AND HIS DEAD CRUMBLE', 'BEAT BOSSES BEFORE THEY GO BERSERK',
        'WITCHES CURSE YOU - HOLY WATER PROTECTS', 'NEVER LET A BLACK CAT CROSS YOUR PATH',
        'A TREAT TURNS A BLACK CAT INTO GOOD LUCK']
      : ['MAX POWER KILLS CHARGE THE ULTIMATE', 'LASERS PIERCE EVERYTHING IN THEIR PATH',
        'DESTROY CARRIERS BEFORE THEY REBUILD', 'BEAT BOSSES BEFORE THEY GO BERSERK'];
    text(tips[Math.floor(G.stateTime / 3) % tips.length], W / 2, 500, 8, Theme.halloween ? '#ffcc00' : rainbow(0));
    const themeName = Theme.halloween ? 'HALLOWEEN' : 'CLASSIC';
    const themeColor = Theme.halloween ? '#ff9933' : '#33ffff';
    if (Input.touch) {
      text('DRAG TO MOVE - AUTO FIRE', W / 2, 522, 8, '#aaaaaa');
      text('BUTTONS: ULT (BOTTOM) PAUSE (TOP)', W / 2, 542, 8, '#aaaaaa');
      text(`THEME: ${themeName} (TAP TO CHANGE)`, W / 2, THEME_LINE_Y, 8, themeColor);
    } else {
      text('ARROWS/WASD MOVE  SPACE FIRE', W / 2, 522, 8, '#aaaaaa');
      text('E ULTIMATE P PAUSE M MUTE N MUSIC', W / 2, 542, 8, '#aaaaaa');
      text(`T THEME: ${themeName}`, W / 2, THEME_LINE_Y, 8, themeColor);
    }
  }

  function drawTitle() {
    const alphas = G.motion.titleAlphas(G.stateTime);
    if (alphas.title > 0) {
      ctx.save();
      ctx.globalAlpha = alphas.title;
      drawTitleCard();
      ctx.restore();
    }
    if (alphas.table > 0) {
      ctx.save();
      ctx.globalAlpha = alphas.table;
      drawBestTable(false);
      ctx.restore();
    }
    const play = Input.touch ? 'TAP TO PLAY' : 'PRESS ENTER TO PLAY';
    if (blink(1.5)) text(play, W / 2, 594, 12, '#ffffff');
  }

  // World top 10 when we have it; otherwise the local table, marked offline
  function drawBestTable(highlightLocal) {
    const world = Leaderboard.world.top;
    if (world) {
      const r = G.worldRank;
      drawLeaderboardTable('WORLD TOP 10', world, typeof r === 'number' && r <= 10 ? r - 1 : -1);
    } else {
      drawLeaderboardTable('HIGH SCORES (OFFLINE)', Leaderboard.all(), highlightLocal ? G.lastRank : -1);
    }
  }

  function drawLeaderboardTable(title, list, highlightIdx) {
    text(title, W / 2, 80, 20, rainbow(0));
    text('RANK', 60, 130, 10, Theme.c.label, 'left');
    text('NAME', 160, 130, 10, Theme.c.label, 'left');
    text('SCORE', 340, 130, 10, Theme.c.label, 'right');
    text('LV', 420, 130, 10, Theme.c.label, 'right');
    for (let i = 0; i < 10; i++) {
      const y = 166 + i * 34;
      const e = list[i];
      const highlight = i === highlightIdx;
      const color = highlight ? (blink(4) ? '#ffee33' : '#ff9933') : i < 3 ? '#33ffff' : '#ffffff';
      text(`${i + 1}`.padStart(2, ' '), 60, y, 12, color, 'left');
      if (e) {
        text(e.name, 160, y, 12, color, 'left');
        text(pad(e.score), 340, y, 12, color, 'right');
        text(String(e.level ?? '-'), 420, y, 12, color, 'right');
      } else {
        text('---', 160, y, 12, '#444444', 'left');
      }
    }
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    Backgrounds.draw(ctx, currentScene(), G.t);
    drawStars();

    ctx.save();
    if (G.motion.shakeX || G.motion.shakeY) ctx.translate(G.motion.shakeX, G.motion.shakeY);
    if (inGame()) drawWorld();
    drawEffects();
    ctx.restore();

    if (G.flash > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${G.motion.flashAlpha(G.flash)})`;
      ctx.fillRect(0, 0, W, H);
    }

    switch (G.state) {
      case 'title':
        drawTitle();
        break;
      case 'playing':
        drawHud();
        drawPlayingOverlays();
        break;
      case 'levelclear':
        drawHud();
        text(`LEVEL ${G.level} CLEAR!`, W / 2, H / 2 - 80, 20, rainbow(0));
        if (G.stateTime > 0.8) text(`CLEAR BONUS   ${G.levelBonus}`, W / 2, H / 2 - 20, 10, '#ffffff');
        if (G.stateTime > 1.6) {
          text(G.perfectBonus ? `NO DAMAGE     ${G.perfectBonus}` : 'NO DAMAGE     -', W / 2, H / 2 + 10, 10,
            G.perfectBonus ? '#ffee33' : '#666666');
        }
        if (G.stateTime > 2.4) text(`SCORE ${pad(G.score)}`, W / 2, H / 2 + 60, 14, '#33ffff');
        break;
      case 'victory': {
        drawHud();
        const foe = Theme.halloween ? FINAL_BOSS.hname : `THE ${FINAL_BOSS.name}`;
        text('VICTORY!', W / 2, H / 2 - 110, 32, rainbow(0));
        text(`${foe} IS DESTROYED`, W / 2, H / 2 - 60, 10, '#ffffff');
        if (G.stateTime > 1.5) text(`LIVES BONUS  ${G.lives} x 10000`, W / 2, H / 2 - 10, 10, '#ffee33');
        if (G.stateTime > 3) text(`SCORE ${pad(G.score)}`, W / 2, H / 2 + 30, 14, '#33ffff');
        if (G.stateTime > 5 && blink(2)) text(`LOOP ${loopOf(G.level) + 2} BEGINS...`, W / 2, H / 2 + 90, 12, '#ff3344');
        break;
      }
      case 'gameover':
        drawHud();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, W, H);
        text('GAME OVER', W / 2, H / 2 - 20, 32, Theme.c.label);
        text(`FINAL SCORE ${pad(G.score)}`, W / 2, H / 2 + 30, 12, '#ffffff');
        break;
      case 'entername': {
        text('NEW HIGH SCORE!', W / 2, 160, 20, rainbow(0));
        text(pad(G.score), W / 2, 210, 16, '#ffffff');
        text('ENTER YOUR INITIALS', W / 2, 280, 10, Theme.c.label);
        for (let i = 0; i < 3; i++) {
          const x = nameX(i);
          const active = i === G.namePos;
          const ch = CHARS[G.name[i]];
          text(ch === ' ' ? '_' : ch, x, NAME_Y, 32, active ? '#ffee33' : '#ffffff');
          if (Input.touch) {
            text('+', x, NAME_Y - 46, 16, '#aaaaaa');
            text('-', x, NAME_Y + 48, 16, '#aaaaaa');
          }
          if (active && blink(3)) {
            ctx.fillStyle = '#ffee33';
            ctx.fillRect(x - 18, 376, 36, 4);
          }
        }
        if (Input.touch) {
          drawButton(SAVE_BTN, '#ffee33', 0.9);
          ctx.globalAlpha = 1;
          text('SAVE', SAVE_BTN.x, SAVE_BTN.y, 12, '#ffee33');
          text('TAP + / - TO PICK LETTERS', W / 2, 535, 8, '#aaaaaa');
        } else {
          text('TYPE OR UP/DOWN TO PICK', W / 2, 440, 8, '#aaaaaa');
          text('LEFT/RIGHT TO MOVE', W / 2, 460, 8, '#aaaaaa');
          text('ENTER TO SAVE', W / 2, 480, 8, '#aaaaaa');
        }
        break;
      }
      case 'leaderboard':
        drawBestTable(true);
        if (G.worldRank === 'pending') text('SUBMITTING...', W / 2, H - 90, 10, '#aaaaaa');
        else if (G.worldRank === 'failed') text('NOT SUBMITTED - SAVED ON THIS DEVICE', W / 2, H - 90, 8, '#ff9933');
        else if (G.worldRank === 1) {
          ctx.strokeStyle = '#ffee33';
          ctx.lineWidth = 2;
          ctx.strokeRect(105.5, H - 121.5, 269, 52);
          text('YOU REACHED', W / 2, H - 106, 8, '#33ffff');
          text('WORLD #1', W / 2, H - 86, 16, '#ffee33');
        } else if (typeof G.worldRank === 'number') {
          text(`WORLD RANK #${G.worldRank}`, W / 2, H - 90, 12, '#ffee33');
        }
        if (blink(1.5)) text(Input.touch ? 'TAP TO CONTINUE' : 'PRESS ENTER', W / 2, H - 50, 12, '#ffffff');
        break;
    }

    if (Sound.isMuted()) text('MUTED', W - 12, H - 40, 8, '#666666', 'right');
    else if (!Sound.isMusicOn()) text('MUSIC OFF', W - 12, H - 40, 8, '#666666', 'right');
  }

  // ---------- main loop (fixed timestep) ----------

  let last = performance.now();
  let acc = 0;

  // An error must never stop the loop (that looks like a freeze): skip the bad
  // frame, keep going, and show what happened so it can be reported.
  let lastError = null;
  function reportError(err) {
    const msg = String(err && err.message || err);
    if (!lastError || lastError.msg !== msg) console.error('Star Blaster error:', err);
    lastError = { msg, until: G.t + 6 };
  }

  function frame(now) {
    acc += Math.min(0.25, (now - last) / 1000);
    last = now;
    while (acc >= STEP) {
      acc -= STEP;
      let advanced = true;
      try {
        advanced = update(STEP) !== false;
      } catch (err) {
        reportError(err);
      }
      if (advanced) Input.endStep();
    }
    try {
      render();
    } catch (err) {
      reportError(err);
    }
    if (lastError && G.t < lastError.until) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.font = `8px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ff3344';
      ctx.fillText(`ERROR: ${lastError.msg}`.slice(0, 58), 6, H - 4);
    }
    requestAnimationFrame(frame);
  }

  function start() {
    Sprites.init();
    G.player = new Player();
    last = performance.now();
    requestAnimationFrame(frame);
  }

  // Wait briefly for the pixel font so canvas text renders in it; fall back after 1.5s
  const fontReady = document.fonts ? document.fonts.load(`16px ${FONT}`) : Promise.resolve();
  Promise.race([fontReady, new Promise(r => setTimeout(r, 1500))]).catch(() => {}).finally(start);
})();
