// Game entities. Each has update(dt, game) and draw(ctx, t), plus a `dead` flag
// that the game loop uses to sweep it out of its list.
const W = 480;
const H = 640;
const FONT = '"Press Start 2P", monospace';

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

class Bullet {
  constructor(x, y, vx, vy, friendly, opts = {}) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.friendly = friendly;
    this.dmg = opts.dmg ?? 1;
    this.holy = !!opts.holy;
    this.silver = !!opts.silver;
    this.homing = opts.homing || 0; // seconds left steering toward the player
    this.curse = !!opts.curse;      // witch curse: reverses controls instead of damaging
    this.gravity = opts.gravity || 0; // lobbed shots arc up and fall back down
    this.r = opts.r ?? (friendly ? 2 + this.dmg : 4);
    this.color = opts.color ?? (friendly ? Bullet.friendlyColor(this.dmg) : Theme.c.enemyBullet);
    this.dead = false;
  }

  // Player shots change color as the gun gets stronger
  static friendlyColor(dmg) {
    if (dmg >= 2) return '#33ffff';
    if (dmg > 1) return '#ff9933';
    return '#ffee33';
  }

  update(dt, game) {
    if (this.homing > 0 && game) {
      this.homing -= dt;
      const speed = Math.hypot(this.vx, this.vy);
      const cur = Math.atan2(this.vy, this.vx);
      const want = game.angleTo(this.x, this.y);
      const diff = ((((want - cur) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      const a = cur + clamp(diff, -2.5 * dt, 2.5 * dt);
      this.vx = Math.cos(a) * speed;
      this.vy = Math.sin(a) * speed;
    }
    this.vy += this.gravity * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    // Lobbed shots may peak just above the screen and come back, so only cull them far up
    const top = this.gravity ? -200 : -20;
    if (this.y < top || this.y > H + 20 || this.x < -20 || this.x > W + 20) this.dead = true;
  }

  draw(ctx) {
    if (this.friendly) {
      const w = 1 + this.dmg * 2;
      const h = 10 + this.dmg * 2;
      ctx.fillStyle = this.color;
      ctx.fillRect(this.x - w / 2, this.y - h / 2, w, h);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(this.x - w / 6, this.y - h / 2 + 1, w / 3, h / 2);
    } else if (this.curse) {
      // Swirling curse
      const t = performance.now() / 100;
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, t % (Math.PI * 2), (t % (Math.PI * 2)) + Math.PI * 1.4);
      ctx.stroke();
      ctx.fillStyle = '#ffccff';
      ctx.fillRect(this.x - 2, this.y - 2, 4, 4);
    } else {
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(this.x - 1, this.y - 1, 2, 2);
    }
  }
}

// Homing missile fired at max weapon power. Lives in playerBullets so the
// normal bullet collision code handles it.
class Missile {
  constructor(x, y, side) {
    this.x = x;
    this.y = y;
    this.friendly = true;
    this.dmg = 2;
    this.r = 4;
    this.angle = -Math.PI / 2 + side * 0.7;
    this.speed = 300;
    this.t = 0;
    this.dead = false;
  }

  findTarget(game) {
    let best = null;
    let bestD = Infinity;
    for (const o of [...game.enemies, ...game.asteroids]) {
      if (o.dead || o.y < 0 || o.intangible) continue;
      const d = dist2(this, o);
      if (d < bestD) { bestD = d; best = o; }
    }
    const b = game.boss;
    if (b && b.state === 'fight' && !b.dead && dist2(this, b) < bestD) best = b;
    return best;
  }

  update(dt, game) {
    this.t += dt;
    const target = this.t > 0.1 ? this.findTarget(game) : null;
    if (target) {
      const want = Math.atan2(target.y - this.y, target.x - this.x);
      const diff = ((((want - this.angle) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      this.angle += clamp(diff, -6 * dt, 6 * dt);
    }
    this.speed = Math.min(520, this.speed + 400 * dt);
    this.x += Math.cos(this.angle) * this.speed * dt;
    this.y += Math.sin(this.angle) * this.speed * dt;
    game.particles.push({
      x: this.x, y: this.y, vx: 0, vy: 0, life: 0.25, max: 0.25, color: '#888888', size: 2,
    });
    if (this.t > 3 || this.y < -20 || this.y > H + 20 || this.x < -20 || this.x > W + 20) this.dead = true;
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-5, -1.5, 8, 3);
    ctx.fillStyle = '#ff3344';
    ctx.fillRect(3, -1.5, 3, 3);
    ctx.restore();
  }
}

// Main gun per weapon power level: parallel barrel offsets and damage per shot
const GUN_LEVELS = [
  null,
  { offsets: [0], dmg: 1 },
  { offsets: [-5, 5], dmg: 1 },
  { offsets: [-6, 6], dmg: 1.5 },
  { offsets: [-9, 0, 9], dmg: 1.5 },
  { offsets: [-12, -4, 4, 12], dmg: 1.75 },
];
const MAX_POWER = GUN_LEVELS.length - 1;
const SHIP_SPEED = [0, 260, 290, 320];
const GARLIC_RADIUS = 90;
const MAX_MK = SHIP_SPEED.length - 1;

// Straight-firing rocket: accelerates, explodes on impact for splash damage.
// Higher levels are bigger, hit harder, blast wider and (at L3) burst into shrapnel.
const ROCKET_LEVELS = [
  null,
  { dmg: 3,   radius: 40, splashDmg: 2, scale: 1,   shake: 2 },
  { dmg: 4.5, radius: 55, splashDmg: 3, scale: 1.4, shake: 4 },
  { dmg: 6,   radius: 75, splashDmg: 4, scale: 1.8, shake: 7, cluster: 6 },
];

class Rocket {
  constructor(x, y, level = 1) {
    const spec = ROCKET_LEVELS[level];
    this.x = x;
    this.y = y;
    this.friendly = true;
    this.level = level;
    this.dmg = spec.dmg;
    this.scale = spec.scale;
    this.splash = { radius: spec.radius, dmg: spec.splashDmg, shake: spec.shake, cluster: spec.cluster || 0 };
    this.r = 4 + spec.scale * 2;
    this.vy = -120;
    this.dead = false;
  }

  update(dt, game) {
    this.vy = Math.max(-640, this.vy - 900 * dt);
    this.y += this.vy * dt;
    for (let i = 0; i < this.level; i++) {
      game.particles.push({
        x: this.x + rand(-1, 1) * this.scale, y: this.y + 8 * this.scale, vx: rand(-15, 15) * this.scale, vy: 60,
        life: 0.3, max: 0.3, color: Math.random() < 0.5 ? '#ff9933' : '#ffee33', size: 2 + this.scale,
      });
    }
    if (this.y < -20) this.dead = true;
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(this.scale, this.scale);
    ctx.fillStyle = this.level >= 3 ? '#ffcc00' : '#ccccdd';
    ctx.fillRect(-2, -6, 4, 12);
    ctx.fillStyle = '#ff3344';
    ctx.fillRect(-2, -8, 4, 3);
    ctx.fillRect(-4, 3, 2, 4);
    ctx.fillRect(2, 3, 2, 4);
    ctx.restore();
  }
}

// Holy cross (Halloween): thrown boomerang-style, passes through enemies on the way
// out and back, hitting each at most every 0.25s. Counts as holy.
class HolyCross {
  constructor(x, y, dmg, angle) {
    this.x = x;
    this.y = y;
    this.friendly = true;
    this.pierce = true;
    this.holy = true;
    this.dmg = dmg;
    this.r = 10;
    this.vx = Math.sin(angle) * 260;
    this.vy = -700;
    this.rot = 0;
    this.t = 0;
    this.hits = new Map(); // target -> time it can be hit again
    this.dead = false;
  }

  update(dt, game) {
    this.t += dt;
    this.vy += 620 * dt;
    this.vx *= 0.985;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.rot += 14 * dt;
    const p = game.player;
    // Returns to the thrower; caught (or lost) once it passes back by the ship
    if (this.t > 0.8 && (!p.alive || this.y > p.y + 20)) this.dead = true;
    if (this.y > H + 20 || this.t > 4) this.dead = true;
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rot);
    ctx.fillStyle = '#ffdd66';
    ctx.fillRect(-2, -9, 4, 18);
    ctx.fillRect(-7, -4, 14, 4);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-1, -8, 2, 6);
    ctx.restore();
  }
}

// Secondary weapons by level: fire interval and how many fire per volley.
// The laser is continuous instead: beam half-width and damage per second.
const SECONDARY = {
  rockets: { name: 'ROCKETS', label: 'X', levels: [null, { every: 0.6, pair: false }, { every: 0.55, pair: true }, { every: 0.38, pair: true }] },
  homing:  { name: 'HOMING',  label: 'H', levels: [null, { every: 0.6, pair: false }, { every: 0.4, pair: false }, { every: 0.4, pair: true }] },
  laser:   { name: 'LASER',   label: 'L', levels: [null, { width: 3, dps: 7 }, { width: 5, dps: 11 }, { width: 8, dps: 16 }] },
  cross:   { name: 'CROSS',   label: 'C', levels: [null, { every: 1.2, pair: false, dmg: 2 }, { every: 1.0, pair: false, dmg: 3 }, { every: 0.9, pair: true, dmg: 3 }] },
};
const MAX_SECONDARY = 3;
const MAX_DRONES = 2;

// Escort drone: flies beside the player, mirrors main gun fire, blocks enemy bullets
class Drone {
  constructor(side) {
    this.side = side;
    this.x = W / 2;
    this.y = H + 20;
    this.r = 8;
    this.t = 0;
  }

  update(dt, player) {
    this.t += dt;
    const tx = player.x + this.side * 34;
    const ty = player.y + 12 + Math.sin(this.t * 4 + this.side) * 3;
    const k = 1 - Math.exp(-12 * dt); // frame-rate independent smoothing
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.t * 3);
    ctx.strokeStyle = '#33ffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(-6, -6, 12, 12);
    ctx.restore();
    ctx.fillStyle = Math.floor(this.t * 8) % 2 ? '#ffffff' : '#33ffff';
    ctx.fillRect(this.x - 2, this.y - 2, 4, 4);
  }
}

class Player {
  constructor() {
    this.power = 1;    // 1..MAX_POWER main gun level, lost one level on death
    this.spread = 0;   // 0..2 - extra angled bullet pairs, lost one level on death
    this.rapid = 0;    // seconds of rapid fire left
    this.mk = 1;       // ship class 1..MAX_MK: faster, holds more shield layers
    this.shields = 0;  // each layer absorbs one hit
    this.garlic = 0;   // Halloween: seconds of garlic aura (repels vampires and bats)
    this.holy = 0;     // Halloween: seconds of holy-water shots (burn the undead)
    this.silver = 0;   // Halloween: seconds of silver shots (slay werewolves)
    this.cursed = 0;   // Halloween: seconds of reversed controls from a witch's curse
    this.jam = 0;      // Halloween: seconds of jammed guns (black cat crossed your path)
    this.secondary = null; // { kind: 'rockets' | 'homing', level: 1..MAX_SECONDARY }
    this.drones = [];
    this.reset();
  }

  setDroneCount(n) {
    while (this.drones.length < n) this.drones.push(new Drone(this.drones.length % 2 ? 1 : -1));
    this.drones.length = n;
    for (const d of this.drones) { d.x = this.x; d.y = this.y; }
  }

  get maxShields() { return this.mk + 1; }
  get speed() { return SHIP_SPEED[this.mk]; }

  // Called on death: every upgrade path drops one level
  downgrade() {
    this.mk = Math.max(1, this.mk - 1);
    this.shields = 0;
    this.power = Math.max(1, this.power - 1);
    this.spread = Math.max(0, this.spread - 1);
    this.rapid = 0;
    this.garlic = 0;
    this.holy = 0;
    this.silver = 0;
    this.cursed = 0;
    this.jam = 0;
    if (this.secondary && --this.secondary.level <= 0) this.secondary = null;
    this.setDroneCount(Math.max(0, this.drones.length - 1));
  }

  reset() {
    this.x = W / 2;
    this.y = H - 80;
    this.invuln = 2.5;
    this.cool = 0;
    this.secondaryCool = 0;
    this.secondarySide = 1;
    this.lasing = false;
    this.alive = true;
    if (this.drones) for (const d of this.drones) { d.x = this.x; d.y = H + 20; }
  }

  get r() { return 5; } // tiny hitbox, classic shmup style

  update(dt, game) {
    let dx = 0;
    let dy = 0;
    if (Input.isDown('ArrowLeft', 'KeyA')) dx -= 1;
    if (Input.isDown('ArrowRight', 'KeyD')) dx += 1;
    if (Input.isDown('ArrowUp', 'KeyW')) dy -= 1;
    if (Input.isDown('ArrowDown', 'KeyS')) dy += 1;
    if (dx && dy) { dx *= Math.SQRT1_2; dy *= Math.SQRT1_2; }
    // Touch: the ship travels as far as the finger did
    const flip = this.cursed > 0 ? -1 : 1;
    const drag = Input.drag();
    this.cursed = Math.max(0, this.cursed - dt);
    this.jam = Math.max(0, this.jam - dt);
    this.x = clamp(this.x + flip * (dx * this.speed * dt + drag.x), 18, W - 18);
    this.y = clamp(this.y + flip * (dy * this.speed * dt + drag.y), 60, H - 30);

    this.invuln = Math.max(0, this.invuln - dt);
    this.rapid = Math.max(0, this.rapid - dt);
    this.garlic = Math.max(0, this.garlic - dt);
    this.holy = Math.max(0, this.holy - dt);
    this.silver = Math.max(0, this.silver - dt);
    for (const d of this.drones) d.update(dt, this);

    this.cool -= dt;
    this.secondaryCool -= dt;
    const trigger = (Input.isDown('Space') || Input.touch) && this.jam <= 0; // touch auto-fires
    this.lasing = trigger && !!this.secondary && this.secondary.kind === 'laser';
    if (trigger) {
      if (this.cool <= 0) {
        this.fire(game);
        this.cool = this.rapid > 0 ? 0.07 : 0.16;
      }
      if (this.secondary && !this.lasing && this.secondaryCool <= 0) this.fireSecondary(game);
    }
  }

  fireSecondary(game) {
    const { kind, level } = this.secondary;
    const spec = SECONDARY[kind].levels[level];
    if (kind === 'cross') {
      for (const a of spec.pair ? [-0.3, 0.3] : [0]) game.playerBullets.push(new HolyCross(this.x, this.y - 10, spec.dmg, a));
      this.secondaryCool = spec.every;
      return;
    }
    const sides = spec.pair ? [-1, 1] : [(this.secondarySide *= -1)];
    for (const side of sides) {
      const x = this.x + side * 12;
      game.playerBullets.push(kind === 'rockets' ? new Rocket(x, this.y, level) : new Missile(x, this.y, side));
    }
    this.secondaryCool = spec.every;
  }

  fire(game) {
    const speed = 560;
    const gun = GUN_LEVELS[this.power];
    // Holy water and silver can be active together; silver shows on top
    const ammo = {};
    if (this.holy > 0) Object.assign(ammo, { holy: true, color: '#66ccff' });
    if (this.silver > 0) Object.assign(ammo, { silver: true, color: '#e8eef8' });
    for (const off of gun.offsets) {
      game.playerBullets.push(new Bullet(this.x + off, this.y - 14, 0, -speed, true, { dmg: gun.dmg, ...ammo }));
    }
    const angled = a => game.playerBullets.push(
      new Bullet(this.x, this.y - 14, Math.sin(a) * speed, -Math.cos(a) * speed, true));
    if (this.spread >= 1) { angled(-0.18); angled(0.18); }
    if (this.spread >= 2) { angled(-0.36); angled(0.36); }
    for (const d of this.drones) {
      game.playerBullets.push(new Bullet(d.x, d.y - 8, 0, -speed, true, { dmg: gun.dmg, ...ammo }));
    }
    Sound.sfx.shoot();
  }

  draw(ctx, t) {
    for (const d of this.drones) d.draw(ctx);
    if (this.invuln > 0 && Math.floor(t * 20) % 2) return;
    const s = Sprites.get(this.mk === 1 ? 'player' : `player_mk${this.mk}`);
    // Max power aura
    if (this.power === MAX_POWER) {
      ctx.fillStyle = `rgba(255, 238, 51, ${0.12 + Math.sin(t * 8) * 0.06})`;
      ctx.beginPath();
      ctx.arc(this.x, this.y, s.w * 0.75, 0, Math.PI * 2);
      ctx.fill();
    }
    // Engine flame grows with ship class
    const fw = 4 + this.mk * 2;
    const fh = (6 + Math.random() * 6) * (1 + 0.3 * (this.mk - 1));
    ctx.fillStyle = '#ff9933';
    ctx.fillRect(this.x - fw / 2, this.y + s.h / 2 - 2, fw, fh);
    ctx.fillStyle = '#ffee33';
    ctx.fillRect(this.x - fw / 4, this.y + s.h / 2 - 2, fw / 2, fh * 0.6);
    ctx.drawImage(s.img, Math.round(this.x - s.w / 2), Math.round(this.y - s.h / 2));
    this.drawLoadout(ctx, s);
    // Curse: purple motes spinning around the ship
    if (this.cursed > 0) {
      ctx.fillStyle = '#aa33ff';
      for (let i = 0; i < 6; i++) {
        const a = -t * 5 + (i / 6) * Math.PI * 2;
        ctx.fillRect(this.x + Math.cos(a) * 18 - 2, this.y + Math.sin(a) * 18 - 2, 4, 4);
      }
    }
    // Garlic aura: a pungent ring with bulbs orbiting the ship
    if (this.garlic > 0) {
      ctx.strokeStyle = `rgba(240, 235, 200, ${0.25 + Math.sin(t * 6) * 0.1})`;
      ctx.setLineDash([4, 6]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.x, this.y, GARLIC_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#f5f0d0';
      for (let i = 0; i < 4; i++) {
        const a = t * 2 + (i / 4) * Math.PI * 2;
        const bx = this.x + Math.cos(a) * GARLIC_RADIUS;
        const by = this.y + Math.sin(a) * GARLIC_RADIUS;
        ctx.beginPath();
        ctx.arc(bx, by, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(bx - 1, by - 7, 2, 3);
      }
    }
    // One ring per shield layer
    ctx.lineWidth = 2;
    for (let i = 0; i < this.shields; i++) {
      ctx.strokeStyle = `rgba(80, 220, 255, ${0.6 + Math.sin(t * 10 + i) * 0.3})`;
      ctx.beginPath();
      ctx.arc(this.x, this.y, 24 + i * 5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Weapons are bolted onto the hull so upgrades are visible on the ship itself
  drawLoadout(ctx, s) {
    const top = this.y - s.h / 2;
    const gun = GUN_LEVELS[this.power];
    const bw = this.power >= 3 ? 3 : 2;
    for (const off of gun.offsets) {
      ctx.fillStyle = '#aab0c0';
      ctx.fillRect(this.x + off - bw / 2, top - 3, bw, 7);
      ctx.fillStyle = Bullet.friendlyColor(gun.dmg);
      ctx.fillRect(this.x + off - bw / 2, top - 5, bw, 2);
    }
    const wing = s.w / 2;
    if (this.spread >= 1) {
      ctx.fillStyle = '#33ff66';
      ctx.fillRect(this.x - wing, this.y + 1, 3, 4);
      ctx.fillRect(this.x + wing - 3, this.y + 1, 3, 4);
    }
    if (this.spread >= 2) {
      ctx.fillStyle = '#33ff66';
      ctx.fillRect(this.x - wing + 4, this.y - 4, 3, 4);
      ctx.fillRect(this.x + wing - 7, this.y - 4, 3, 4);
    }
    if (this.secondary && this.secondary.kind === 'laser') {
      // Laser emitter crystal on the nose, bigger per level
      const lv = this.secondary.level;
      ctx.fillStyle = '#ff3366';
      ctx.fillRect(this.x - lv, top - 8 - lv, lv * 2, lv + 3);
    } else if (this.secondary && this.secondary.kind === 'cross') {
      ctx.fillStyle = '#ffdd66';
      ctx.fillRect(this.x - 1, this.y + 2, 2, 8);
      ctx.fillRect(this.x - 3, this.y + 4, 6, 2);
    } else if (this.secondary) {
      const lv = this.secondary.level;
      const rockets = this.secondary.kind === 'rockets';
      const len = 5 + lv * 3;
      const podW = rockets ? 2 + lv : 3;
      for (const side of [-1, 1]) {
        const px = this.x + side * (wing - 7) - podW / 2;
        const py = this.y + 4;
        ctx.fillStyle = rockets ? '#8a8f9a' : '#ccccff';
        ctx.fillRect(px, py, podW, len);
        ctx.fillStyle = rockets ? '#ff3344' : '#ffffff';
        if (rockets) ctx.fillRect(px, py - 2, podW, 2);
        else for (let i = 0; i < lv; i++) ctx.fillRect(px + 1, py + 1 + i * 3, 1, 2);
      }
    }
  }
}

const ENEMY_TYPES = {
  grunt:     { sprite: 'grunt',     hp: 1,  score: 100,  speed: 110, r: 14, drop: 0.05 },
  swooper:   { sprite: 'swooper',   hp: 1,  score: 150,  speed: 140, r: 14, drop: 0.05 },
  shooter:   { sprite: 'shooter',   hp: 3,  score: 300,  speed: 120, r: 15, drop: 0.12 },
  tank:      { sprite: 'tank',      hp: 12, score: 800,  speed: 45,  r: 20, drop: 1 },
  diver:     { sprite: 'diver',     hp: 2,  score: 200,  speed: 90,  r: 13, drop: 0.08 },
  splitter:  { sprite: 'splitter',  hp: 4,  score: 250,  speed: 60,  r: 15, drop: 0.08 },
  mini:      { sprite: 'mini',      hp: 1,  score: 50,   speed: 170, r: 9,  drop: 0.02 },
  minelayer: { sprite: 'minelayer', hp: 6,  score: 500,  speed: 90,  r: 18, drop: 0.5 },
  mine:      { sprite: 'mine',      hp: 1,  score: 50,   speed: 50,  r: 9,  drop: 0 },
  phantom:   { sprite: 'phantom',   hp: 4,  score: 400,  speed: 100, r: 14, drop: 0.2 },
  bonus:     { sprite: 'bonus',     hp: 10, score: 3000, speed: 150, r: 18, drop: 0 },
  necromancer: { sprite: 'necromancer', hp: 30, score: 1000, speed: 70, r: 16, drop: 0.4 },
};
// Types a necromancer can raise from their remains
const REVIVABLE = new Set(['grunt', 'swooper', 'shooter', 'diver', 'splitter', 'phantom']);
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
// Types that can roll as a gold-outlined elite
const ELITE_TYPES = ['grunt', 'swooper', 'shooter', 'tank', 'diver', 'splitter', 'phantom'];

class Enemy {
  constructor(type, x, y, opts = {}) {
    const def = ENEMY_TYPES[type];
    this.type = type;
    this.sprite = def.sprite;
    this.x = x;
    this.y = y;
    this.baseX = x;
    this.t = 0;
    this.elite = !!opts.elite;
    this.hp = this.maxHp = (def.hp + (opts.hpBonus || 0)) * (this.elite ? 3 : 1);
    this.spellT = rand(0.8, 1.5);    // Halloween witches: time to next spell
    this.raised = !!opts.raised;     // brought back by a necromancer: half points, no drops
    this.owner = opts.owner || null;
    this.score = def.score * (this.elite ? 2 : 1);
    this.speedMul = opts.speedMul || 1;
    this.speed = def.speed * this.speedMul;
    this.fireMul = (opts.fireMul || 1) * (this.elite ? 1.5 : 1);
    this.r = def.r;
    this.drop = this.elite ? 1 : def.drop;
    if (this.raised) { this.score = Math.floor(this.score / 2); this.drop = 0; }
    this.amp = opts.amp ?? 70;
    this.freq = opts.freq ?? 2.5;
    this.stopY = opts.stopY ?? rand(90, 230);
    this.dir = Math.random() < 0.5 ? -1 : 1;
    this.fireTimer = rand(0.8, 1.8) / this.fireMul;
    this.vx = opts.vx || 0;
    this.vy = 0;
    this.mode = 'enter';
    this.modeT = 0;
    this.cycles = 0;
    this.burst = 0;
    this.burstT = 0;
    this.flash = 0;
    this.dead = false;
    this.ritualTargets = [];
    this.ritualTime = 0;
    this.ritualDamage = 0;
    this.ritualThreshold = Math.min(30, 20 + 2 * (opts.hpBonus || 0));
    this.ritualCooldown = 0;
    this.ritualSuccesses = 0;
    this.necromancerTime = 0;
    this.stunTime = 0;
    if (type === 'minelayer' || type === 'bonus') {
      // Side-crossers: enter from one edge and fly to the other
      const from = opts.side || (Math.random() < 0.5 ? -1 : 1);
      this.x = from < 0 ? -30 : W + 30;
      this.y = this.baseY = opts.y ?? rand(70, 150);
      this.vx = -from * this.speed;
    }
  }

  // Phantoms can't be hit while faded out
  get intangible() {
    if (this.type !== 'phantom') return false;
    return this.mode === 'hidden' || (this.mode === 'fadeout' && this.modeT > 0.2) || (this.mode === 'fadein' && this.modeT < 0.2);
  }

  get alpha() {
    if (this.type !== 'phantom') return 1;
    if (this.mode === 'fadeout') return Math.max(0, 1 - this.modeT / 0.4);
    if (this.mode === 'hidden') return 0;
    if (this.mode === 'fadein') return Math.min(1, this.modeT / 0.4);
    return 1;
  }

  setMode(mode) {
    this.mode = mode;
    this.modeT = 0;
  }

  // Shooters mix up their attacks so they don't feel scripted
  shooterAttack(game) {
    const roll = Math.random();
    if (roll < 0.4) game.aimedShot(this.x, this.y + 10, rand(180, 230));
    else if (roll < 0.7) game.fan(this.x, this.y + 10, game.angleTo(this.x, this.y), 3, rand(0.15, 0.3), 180);
    else { this.burst = 3; this.burstT = 0; }
  }

  tankAttack(game) {
    const roll = Math.random();
    if (roll < 0.4) game.fan(this.x, this.y + 16, Math.PI / 2, 5, 0.25, 150);
    else if (roll < 0.7) game.ring(this.x, this.y, 10, 120);
    else game.fan(this.x, this.y + 16, game.angleTo(this.x, this.y), 7, 0.12, 130);
  }

  update(dt, game) {
    this.t += dt;
    this.modeT += dt;
    this.flash = Math.max(0, this.flash - dt);
    const firing = this.y > 0 && this.y < H * 0.7;

    switch (this.type) {
      case 'grunt':
        this.y += this.speed * dt;
        this.x = this.baseX + Math.sin(this.t * 3) * 12;
        break;
      case 'swooper':
        this.y += this.speed * dt;
        this.x = this.baseX + Math.sin(this.t * this.freq) * this.amp;
        break;
      case 'shooter': {
        // Fly in, hover and strafe while firing, then leave
        const hovering = this.t < 7;
        if (!hovering || this.y < this.stopY) {
          this.y += this.speed * dt;
        } else {
          this.x += this.dir * 60 * dt;
          if (this.x < 30 || this.x > W - 30) this.dir *= -1;
        }
        this.fireTimer -= dt;
        if (hovering && this.fireTimer <= 0 && this.y > 0) {
          this.fireTimer = rand(1.3, 2) / this.fireMul;
          this.shooterAttack(game);
        }
        break;
      }
      case 'tank':
        this.y += this.speed * dt;
        this.fireTimer -= dt;
        if (this.fireTimer <= 0 && this.y > 20) {
          this.fireTimer = rand(1.8, 2.6) / this.fireMul;
          this.tankAttack(game);
        }
        break;
      case 'diver':
        // Drop in, flash while locking on, then dive at where the player was
        if (this.mode === 'enter') {
          this.y += this.speed * 1.5 * dt;
          if (this.y >= this.stopY * 0.6) this.setMode('aim');
        } else if (this.mode === 'aim') {
          this.flash = game.motion.blink(this.modeT, 6) ? 0.02 : 0;
          if (this.modeT > 0.6) {
            const a = game.angleTo(this.x, this.y);
            const s = 380 * this.speedMul;
            this.vx = Math.cos(a) * s;
            this.vy = Math.sin(a) * s;
            this.setMode('dive');
            Sound.sfx.dive();
          }
        } else {
          this.x += this.vx * dt;
          this.y += this.vy * dt;
          if (this.x < -40 || this.x > W + 40 || this.y < -60) this.dead = true;
        }
        break;
      case 'splitter':
        this.y += this.speed * dt;
        this.x = this.baseX + Math.sin(this.t * 2) * 30;
        break;
      case 'mini':
        this.x += this.vx * dt;
        this.y += this.speed * dt;
        if (this.x < 10 || this.x > W - 10) { this.vx *= -1; this.x = clamp(this.x, 10, W - 10); }
        break;
      case 'minelayer':
        this.x += this.vx * dt;
        this.y = this.baseY + Math.sin(this.t * 2) * 8;
        this.fireTimer -= dt;
        if (this.fireTimer <= 0 && this.x > 20 && this.x < W - 20) {
          this.fireTimer = (rand(0.7, 1.1) / this.fireMul) * (Theme.halloween ? 1.6 : 1);
          game.enemies.push(new Enemy('mine', this.x, this.y + 12, { speedMul: this.speedMul }));
        }
        // Halloween witches also cast spells, flashing as they wind up
        if (Theme.halloween && this.x > 30 && this.x < W - 30) {
          this.spellT -= dt;
          if (this.spellT < 0.3) this.flash = game.motion.blink(this.spellT, 10) ? 0.02 : 0;
          if (this.spellT <= 0) {
            this.spellT = rand(1.6, 2.4) / this.fireMul;
            game.castSpell(this);
          }
        }
        if ((this.vx > 0 && this.x > W + 40) || (this.vx < 0 && this.x < -40)) this.dead = true;
        break;
      case 'mine':
        // Blinks faster as the fuse runs down, then bursts into a ring
        this.y += this.speed * dt;
        if (this.t > 2.2) this.flash = game.motion.blink(this.t, 7) ? 0.02 : 0;
        if (this.t > 3.2 || this.y > H - 110) {
          game.ring(this.x, this.y, 8, 130);
          game.explode(this.x, this.y, ['#ff3344', '#ffee33', '#ffffff'], 10, 100);
          this.dead = true;
        }
        break;
      case 'phantom':
        if (this.mode === 'enter') {
          this.y += this.speed * dt;
          if (this.y >= this.stopY) { this.setMode('visible'); this.fired = false; }
        } else if (this.mode === 'visible') {
          if (!this.fired && this.modeT > 0.9) {
            this.fired = true;
            game.fan(this.x, this.y + 10, game.angleTo(this.x, this.y), 3, 0.25, 200);
          }
          if (this.modeT > 1.6) {
            if (game.player.holy > 0) { this.modeT = 0.85; this.fired = false; } // can't fade while blessed
            else this.setMode('fadeout');
          }
        } else if (this.mode === 'fadeout') {
          if (this.modeT > 0.4) this.setMode('hidden');
        } else if (this.mode === 'hidden') {
          if (this.modeT > 0.5) {
            if (++this.cycles >= 3) {
              this.setMode('leave');
            } else {
              this.x = rand(40, W - 40);
              this.y = rand(70, 260);
              this.setMode('fadein');
            }
          }
        } else if (this.mode === 'fadein') {
          if (this.modeT > 0.4) { this.setMode('visible'); this.fired = false; }
        } else {
          this.y += this.speed * 1.5 * dt;
        }
        break;
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
      case 'bonus':
        this.x += this.vx * dt;
        this.y = this.baseY + Math.sin(this.t * 5) * 14;
        if ((this.vx > 0 && this.x > W + 40) || (this.vx < 0 && this.x < -40)) this.dead = true;
        break;
    }

    // Shooter bursts and elite potshots
    if (this.burst > 0) {
      this.burstT -= dt;
      if (this.burstT <= 0) {
        game.aimedShot(this.x, this.y + 10, 240);
        this.burst--;
        this.burstT = 0.12;
      }
    }
    if (this.elite && firing && !this.intangible && this.type !== 'shooter' && this.type !== 'tank') {
      this.fireTimer -= dt;
      if (this.fireTimer <= 0) {
        this.fireTimer = rand(1.5, 2.5);
        game.aimedShot(this.x, this.y + 10, 200);
      }
    }

    if (this.y > H + 40) this.dead = true; // escaped - no score
  }

  hit(dmg) {
    if (this.type === 'necromancer' && this.mode === 'ritual') this.ritualDamage += dmg;
    this.hp -= dmg;
    this.flash = 0.06;
    return this.hp <= 0;
  }

  spriteKey(t) {
    return this.type === 'grunt' && Math.floor(t * 4) % 2 ? 'grunt2' : this.sprite;
  }

  drawRitual(ctx, t) {
    if (this.mode !== 'ritual' || !this.ritualTargets.length) return;
    const progress = clamp(1 - this.ritualTime / NECROMANCER_RITUAL.channel, 0, 1);
    const color = Theme.halloween ? '#66ff66' : '#33ffff';
    ctx.save();
    for (const target of this.ritualTargets) {
      const s = Sprites.get(target.type);
      ctx.globalAlpha = 0.25 + progress * 0.55;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1 + progress * 2;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
      ctx.globalAlpha = 0.2 + Math.sin(t * 10 + target.x) * 0.08 + progress * 0.12;
      ctx.drawImage(Theme.halloween ? s.revive : s.repair,
        Math.round(target.x - s.w / 2), Math.round(target.y - s.h / 2));
    }
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    const remaining = Math.max(0, 1 - this.ritualDamage / this.ritualThreshold);
    const segments = Math.ceil(5 * remaining);
    for (let i = 0; i < segments; i++) {
      const start = -Math.PI / 2 + (i / 5) * Math.PI * 2 + 0.08;
      const end = -Math.PI / 2 + ((i + 1) / 5) * Math.PI * 2 - 0.08;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r + 10, start, end);
      ctx.stroke();
    }
    ctx.restore();
  }

  draw(ctx, t) {
    const alpha = this.alpha;
    if (alpha <= 0) return;
    this.drawRitual(ctx, t);
    const s = Sprites.get(this.spriteKey(t));
    const x = Math.round(this.x - s.w / 2);
    const y = Math.round(this.y - s.h / 2);
    ctx.save();
    ctx.globalAlpha = alpha;
    if (this.mode === 'stunned') {
      ctx.translate(this.x, this.y);
      ctx.rotate(Math.sin(t * 30) * 0.12);
      ctx.translate(-this.x, -this.y);
      ctx.globalAlpha = alpha * (G.motion.blink(t, 6) ? 1 : 0.45); // slowed by reduced motion
    }
    if (this.raised) {
      ctx.fillStyle = `rgba(100, 255, 120, ${0.15 + Math.sin(t * 6) * 0.08})`;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r * 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
    // Side-crossers face their direction of travel
    if (this.type === 'minelayer' && this.vx > 0) {
      ctx.translate(this.x * 2, 0);
      ctx.scale(-1, 1);
    }
    if (this.elite) {
      ctx.globalAlpha = alpha * (0.6 + Math.sin(t * 10) * 0.4);
      for (const [ox, oy] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) ctx.drawImage(s.gold, x + ox, y + oy);
      ctx.globalAlpha = alpha;
    }
    ctx.drawImage(this.flash > 0 ? s.flash : s.img, x, y);
    ctx.restore();
  }
}

class Asteroid {
  constructor(x, y, size, vx, vy) {
    this.x = x;
    this.y = y;
    this.size = size; // 3 = big, 2 = medium, 1 = small
    this.r = [0, 11, 20, 30][size];
    this.hp = size * 2;
    this.score = [0, 50, 100, 200][size];
    this.vx = vx ?? rand(-40, 40);
    this.vy = vy ?? rand(50, 100);
    this.rot = rand(0, Math.PI * 2);
    this.spin = rand(-2, 2);
    this.verts = Array.from({ length: 10 }, () => rand(0.7, 1.1));
    this.flash = 0;
    this.dead = false;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.rot += this.spin * dt;
    this.flash = Math.max(0, this.flash - dt);
    if (this.x < this.r) { this.x = this.r; this.vx = Math.abs(this.vx); }
    if (this.x > W - this.r) { this.x = W - this.r; this.vx = -Math.abs(this.vx); }
    if (this.y > H + 40) this.dead = true;
  }

  hit(dmg) {
    this.hp -= dmg;
    this.flash = 0.06;
    return this.hp <= 0;
  }

  draw(ctx) {
    ctx.beginPath();
    this.verts.forEach((v, i) => {
      const a = this.rot + (i / this.verts.length) * Math.PI * 2;
      const px = this.x + Math.cos(a) * this.r * v;
      const py = this.y + Math.sin(a) * this.r * v;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fillStyle = this.flash > 0 ? '#ffffff' : Theme.c.rockFill;
    ctx.fill();
    ctx.strokeStyle = Theme.c.rockStroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

const POWERUPS = {
  power:   { label: 'P', name: 'POWER',   color: '#ffee33', weight: 25 },
  spread:  { label: 'S', name: 'SPREAD',  color: '#33ff66', weight: 18 },
  rapid:   { label: 'R', name: 'RAPID',   color: '#ff9933', weight: 14 },
  rockets: { label: 'X', name: 'ROCKETS', color: '#ff6633', weight: 10 },
  homing:  { label: 'H', name: 'HOMING',  color: '#ccccff', weight: 10 },
  drone:   { label: 'D', name: 'DRONE',   color: '#33ffff', weight: 8 },
  laser:   { label: 'L', name: 'LASER',   color: '#ff3366', weight: 8 },
  shield:  { label: 'O', name: 'SHIELD',  color: '#3399ff', weight: 12 },
  ship:    { label: 'U', name: 'UPGRADE', color: '#ffffff', weight: 3 },
  bomb:    { label: 'B', name: 'BOMB',    color: '#ff3344', weight: 9 },
  life:    { label: '+', name: '1UP',     color: '#ff44dd', weight: 2 },
  // Halloween folklore pickups
  garlic:  { label: 'G', name: 'GARLIC',  color: '#f5f0d0', weight: 7, theme: 'halloween' },
  holy:    { label: 'W', name: 'HOLY WATER', color: '#66ccff', weight: 7, theme: 'halloween' },
  silver:  { label: 'Ag', name: 'SILVER', color: '#e8eef8', weight: 7, theme: 'halloween' },
  cross:   { label: 'C', name: 'CROSS',   color: '#ffdd66', weight: 6, theme: 'halloween' },
  treat:   { label: 'T', name: 'TREAT',   color: '#ff99cc', weight: 8, theme: 'halloween' },
};

// Power-ups available in the current theme
const activePowerupKinds = () =>
  Object.keys(POWERUPS).filter(k => !POWERUPS[k].theme || (POWERUPS[k].theme === 'halloween' && Theme.halloween));

function randomPowerupKind() {
  const kinds = activePowerupKinds();
  let roll = Math.random() * kinds.reduce((sum, k) => sum + POWERUPS[k].weight, 0);
  for (const k of kinds) {
    roll -= POWERUPS[k].weight;
    if (roll <= 0) return k;
  }
  return kinds[0];
}

class PowerUp {
  constructor(x, y, kind) {
    this.x = x;
    this.y = y;
    this.kind = kind;
    this.r = 11;
    this.t = 0;
    this.dead = false;
  }

  update(dt) {
    this.t += dt;
    this.y += 70 * dt;
    this.x = clamp(this.x + Math.sin(this.t * 3) * 30 * dt, 12, W - 12);
    if (this.y > H + 20) this.dead = true;
  }

  draw(ctx) {
    const def = POWERUPS[this.kind];
    const s = 11 * (1 + Math.sin(this.t * 8) * 0.1);
    ctx.fillStyle = '#000000';
    ctx.fillRect(this.x - s, this.y - s, s * 2, s * 2);
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 2;
    ctx.strokeRect(this.x - s, this.y - s, s * 2, s * 2);
    ctx.fillStyle = def.color;
    ctx.font = `10px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.label, this.x + 1, this.y + 1);
  }
}

// Black cat (Halloween): wanders along the player's row being a menace. Crossing
// under the ship brings bad luck, it steals pickups, and it has nine lives.
// Carry a treat and it eats that instead, spooking your foes as thanks.
class BlackCat {
  constructor(game) {
    const from = Math.random() < 0.5 ? -1 : 1;
    this.x = from < 0 ? -20 : W + 20;
    this.y = clamp(game.player.y + 18, 120, H - 20);
    this.vx = -from * 90;
    this.face = -from;
    this.mode = 'walk';
    this.lives = 9;
    this.r = 12;
    this.t = 0;
    this.target = null;
    this.carrying = null;
    this.crossed = false;
    this.flash = 0;
    this.dead = false;
  }

  update(dt, game) {
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt);
    if (this.mode === 'walk') {
      // Spots loot now and then and goes for it
      const loot = game.powerups.find(u => !u.dead && u.y > 40);
      if (loot && Math.random() < dt * 1.5) { this.mode = 'pounce'; this.target = loot; }
      this.x += this.vx * dt;
      this.y += (clamp(game.player.y + 18, 120, H - 20) - this.y) * Math.min(1, dt * 2);
    } else if (this.mode === 'pounce') {
      const u = this.target;
      if (!u || u.dead) {
        this.mode = 'flee';
      } else {
        const a = Math.atan2(u.y - this.y, u.x - this.x);
        this.x += Math.cos(a) * 320 * dt;
        this.y += Math.sin(a) * 320 * dt;
        this.face = Math.cos(a) < 0 ? -1 : 1;
        if (dist2(this, u) < 20 ** 2) {
          u.dead = true;
          this.carrying = u.kind;
          this.mode = 'flee';
          game.catStole(this);
        }
      }
    } else {
      const dir = this.x < W / 2 ? -1 : 1;
      this.face = dir;
      this.x += dir * 260 * dt;
      if (this.carrying) this.y -= 20 * dt;
    }
    if (this.x < -40 || this.x > W + 40) this.dead = true;
  }

  draw(ctx, t) {
    const s = Sprites.get(Math.floor(t * 8) % 2 ? 'cat2' : 'cat');
    ctx.save();
    ctx.translate(Math.round(this.x), Math.round(this.y));
    if (this.face < 0) ctx.scale(-1, 1);
    // Faint outline so a black cat shows up on a night sky
    ctx.globalAlpha = 0.45;
    for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) ctx.drawImage(s.flash, -s.w / 2 + ox, -s.h / 2 + oy);
    ctx.globalAlpha = 1;
    ctx.drawImage(this.flash > 0 ? s.flash : s.img, -s.w / 2, -s.h / 2);
    if (this.carrying) {
      ctx.fillStyle = POWERUPS[this.carrying].color;
      ctx.fillRect(s.w / 2 - 4, -2, 8, 8);
    }
    ctx.restore();
  }
}

// One boss per campaign level (the last level is the final boss). Each has HP-threshold phases; within a phase it picks attacks at random
// (never the same one twice running) so fights don't feel scripted.
const BOSS_DEFS = [
  { name: 'MOTHERSHIP', hname: 'PUMPKIN KING', sprite: 'boss1', hp: 480, phases: [
    { hp: 1, patterns: ['fan', 'aimed', 'minions', 'rain'] },
    { hp: 0.5, patterns: ['fan', 'aimed', 'minions', 'ring', 'rain', 'cross'] },
  ] },
  { name: 'CRAB KING', hname: 'SPIDER QUEEN', sprite: 'boss2', hp: 560, phases: [
    { hp: 1, patterns: ['aimed', 'spiral', 'laser', 'wave'] },
    { hp: 0.5, patterns: ['aimed', 'spiral', 'laser', 'wave', 'fan', 'cross'] },
  ] },
  { name: 'THE EYE', hname: 'THE REAPER', sprite: 'boss3', hp: 650, phases: [
    { hp: 1, patterns: ['ring', 'laser', 'spiral', 'wave'] },
    { hp: 0.5, patterns: ['ring', 'laser', 'spiral', 'wave', 'minions', 'rain'] },
  ] },
  // Leaves its perch to pounce at the player. Halloween: regenerates unless wounded by silver.
  { name: 'ALPHA PROWLER', hname: 'WEREWOLF', sprite: 'boss4', hp: 560, fears: 'silver', phases: [
    { hp: 1, patterns: ['pounce', 'fan', 'aimed', 'howl'] },
    { hp: 0.5, patterns: ['pounce', 'fan', 'aimed', 'howl', 'rain'] },
  ] },
  // Slow and tanky; calls down lightning and has to be killed twice. Halloween: fears fire.
  { name: 'THE GOLEM', hname: 'THE MONSTER', sprite: 'boss5', hp: 500, fears: 'fire', revives: true, phases: [
    { hp: 1, patterns: ['lightning', 'stomp', 'rain', 'aimed'] },
    { hp: 0.5, patterns: ['lightning', 'stomp', 'rain', 'fan', 'ring'] },
  ] },
];

const FINAL_BOSS = {
  name: 'OVERLORD', hname: 'DRACULA', sprite: 'boss_final', hp: 2400, final: true, phases: [
    { hp: 1, interval: 1.6, patterns: ['fan', 'aimed', 'summonDivers', 'ring', 'rain'] },
    { hp: 0.66, interval: 1.3, patterns: ['twinLaser', 'spiral', 'wave', 'summonPhantoms', 'cross'] },
    { hp: 0.33, interval: 1.0, patterns: ['doubleSpiral', 'twinLaser', 'ring', 'aimed', 'summonDivers', 'rain', 'cross'] },
  ],
};

const randInt = (a, b) => Math.floor(rand(a, b + 1));

class Boss {
  constructor(level, final = false, loop = 0) {
    this.def = final ? FINAL_BOSS : BOSS_DEFS[(level - 1) % CAMPAIGN_LENGTH];
    this.maxHp = Math.round(final ? this.def.hp * (1 + 0.5 * loop) : this.def.hp * (1 + 0.25 * (level - 1)));
    this.hp = this.maxHp;
    const s = Sprites.get(this.def.sprite);
    this.w = s.w;
    this.h = s.h;
    this.x = W / 2;
    this.y = -this.h;
    this.targetY = final ? 150 : 140;
    this.state = 'enter';
    this.enterFromY = this.y;
    this.enterTime = 0;
    this.enterDuration = 2;
    this.swayMix = 0;
    this.t = 0;
    this.moveT = 0;     // movement clock - pauses while holding still so the boss never snaps
    this.speedMul = 1 + 0.06 * (level - 1);
    this.attackTimer = 1.2;
    this.lastPattern = null;
    this.phaseIdx = 0;
    this.stun = 0;
    this.flash = 0;
    this.queue = [];    // timed actions: [{ t, fn }]
    this.spiral = null;
    this.laser = null;
    this.leap = null;   // werewolf pounce in progress
    this.silverT = 0;   // while > 0, silver wounds stop werewolf regeneration
    this.revived = false;
    // Time pressure: when the clock runs out the boss goes berserk
    this.timeLimit = final ? 100 : 55;
    this.timeLeft = this.timeLimit;
    this.berserk = false;
    this.doomT = 0;
    this.dead = false;
  }

  get raging() { return this.phaseIdx > 0 || this.berserk; }
  get phase() { return this.def.phases[this.phaseIdx]; }
  get laserActive() { return !!this.laser && this.laser.t >= this.laser.warn; }
  get busy() { return this.queue.length > 0 || !!this.spiral || !!this.laser || !!this.leap; }

  // Drop the current attack. A werewolf in mid-pounce still springs back home.
  cancelAttacks() {
    this.queue = [];
    this.spiral = null;
    this.laser = null;
    if (this.leap) this.startLeap('return', this.leap.home, 0.6);
  }

  startLeap(stage, to, dur) {
    Object.assign(this.leap, { stage, t: 0, dur, fx: this.x, fy: this.y, tx: to.x, ty: to.y });
  }

  // Pounce: crouch (flashing), leap at the player, land, maybe go again, then spring home
  updateLeap(dt, game) {
    const lp = this.leap;
    lp.t += dt;
    const k = Math.min(1, lp.t / lp.dur);
    const e = k * k * (3 - 2 * k);
    this.x = lp.fx + (lp.tx - lp.fx) * e;
    this.y = lp.fy + (lp.ty - lp.fy) * e;
    if (lp.stage === 'crouch') this.flash = game.motion.blink(lp.t, 6) ? 0.02 : 0;
    if (k < 1) return;
    if (lp.stage === 'crouch') {
      const p = game.player;
      const target = p.alive ? { x: p.x, y: p.y } : { ...lp.home };
      target.x = clamp(target.x, this.w / 2, W - this.w / 2);
      target.y = Math.min(target.y, H - this.h / 2);
      this.startLeap('jump', target, 0.45);
      Sound.sfx.dive();
    } else if (lp.stage === 'jump') {
      game.shake = Math.max(game.shake, 8);
      Sound.sfx.explode();
      this.startLeap('land', this, 0.2);
    } else if (lp.stage === 'land') {
      if (--lp.left > 0) this.startLeap('crouch', this, 0.35);
      else this.startLeap('return', lp.home, 0.6);
    } else {
      this.leap = null;
    }
  }

  // Queue `n` actions spaced `gap` seconds apart
  schedule(n, gap, fn) {
    for (let i = 0; i < n; i++) this.queue.push({ t: i * gap, fn: () => fn(i) });
  }

  update(dt, game) {
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt);
    if (this.state === 'enter') {
      this.enterTime = Math.min(this.enterDuration, this.enterTime + dt);
      const k = this.enterTime / this.enterDuration;
      const eased = 1 - (1 - k) ** 3;
      this.y = this.enterFromY + (this.targetY - this.enterFromY) * eased;
      if (k >= 1) { this.y = this.targetY; this.state = 'fight'; }
      return;
    }

    this.swayMix = Math.min(1, this.swayMix + dt / 0.6);

    // Phase change (HP thresholds)
    const frac = this.hp / this.maxHp;
    let idx = 0;
    this.def.phases.forEach((ph, i) => { if (frac <= ph.hp) idx = i; });
    if (idx > this.phaseIdx) {
      this.phaseIdx = idx;
      this.lastPattern = null;
      if (this.def.final) {
        this.cancelAttacks();
        this.stun = 1.5;
        game.bossPhaseChange(idx);
      }
    }

    if (this.leap) this.updateLeap(dt, game);
    else if (!this.laser) {
      this.moveT += dt;
      const range = W / 2 - this.w / 2 - 10;
      this.x = W / 2 + Math.sin(this.moveT * 0.7 * this.speedMul) * range * this.swayMix;
      this.y = this.targetY + Math.sin(this.moveT * 1.3) * 15 * this.swayMix;
    }

    if (this.stun > 0) {
      this.stun -= dt;
      this.flash = game.motion.blink(this.stun, 6) ? 0.02 : 0;
      return;
    }

    // Halloween folklore: the werewolf heals from anything but silver
    this.silverT -= dt;
    if (Theme.halloween && this.def.fears === 'silver' && this.silverT <= 0) {
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.01 * dt);
    }

    this.timeLeft -= dt;
    if (this.timeLeft <= 0 && !this.berserk) {
      this.berserk = true;
      game.bossBerserk();
    }
    if (this.berserk) {
      // Doom barrage: a dense ring plus an aimed spread every few seconds
      this.doomT -= dt;
      if (this.doomT <= 0) {
        this.doomT = 5;
        game.ring(this.x, this.y, 36, 170);
        game.fan(this.x, this.y + this.h / 2, game.angleTo(this.x, this.y), 5, 0.12, 240);
      }
    }

    for (const q of this.queue) {
      q.t -= dt;
      if (q.t <= 0) q.fn();
    }
    this.queue = this.queue.filter(q => q.t > 0);

    if (this.spiral) {
      const sp = this.spiral;
      sp.time -= dt;
      sp.acc += dt;
      while (sp.acc >= sp.rate) {
        sp.acc -= sp.rate;
        sp.angle += 0.33 * sp.dir;
        for (let k = 0; k < sp.arms; k++) {
          const a = sp.angle + (k / sp.arms) * Math.PI * 2;
          game.enemyBullets.push(new Bullet(this.x, this.y, Math.cos(a) * sp.speed, Math.sin(a) * sp.speed, false));
        }
      }
      if (sp.time <= 0) this.spiral = null;
    }

    if (this.laser) {
      this.laser.t += dt;
      if (!this.laser.fired && this.laserActive) {
        this.laser.fired = true;
        Sound.sfx.laser();
        if (this.laser.bolt) game.flash = Math.max(game.flash, 0.3);
      }
      if (this.laser.t > this.laser.warn + this.laser.dur) this.laser = null;
    }

    this.attackTimer -= dt;
    if (this.attackTimer <= 0 && !this.busy) {
      const options = this.phase.patterns.filter(p => p !== this.lastPattern);
      const pattern = options[Math.floor(Math.random() * options.length)];
      this.lastPattern = pattern;
      this.attack(pattern, game);
      this.attackTimer = (this.phase.interval ?? (this.raging ? 1.1 : 1.8)) / this.speedMul * (this.berserk ? 0.55 : 1);
    }
  }

  attack(pattern, game) {
    const muzzle = () => this.y + this.h / 2 - 8;
    const rage = this.raging;
    switch (pattern) {
      case 'fan': {
        const aimed = Math.random() < 0.5;
        const n = rage ? randInt(7, 11) : randInt(5, 8);
        const gap = rand(0.12, 0.22);
        const speed = rand(160, 220);
        const volleys = rage ? 2 : 1;
        this.schedule(volleys, 0.35, () =>
          game.fan(this.x, muzzle(), aimed ? game.angleTo(this.x, muzzle()) : Math.PI / 2, n, gap, speed));
        break;
      }
      case 'aimed': {
        const shotgun = Math.random() < 0.4;
        const speed = rand(230, 290);
        this.schedule(rage ? 8 : 5, rand(0.08, 0.15), () => {
          if (shotgun) game.fan(this.x, muzzle(), game.angleTo(this.x, muzzle()), 3, 0.15, speed);
          else game.aimedShot(this.x, muzzle(), speed);
        });
        break;
      }
      case 'ring': {
        const n = (rage ? 22 : 14) + randInt(0, 4);
        const speed = rand(120, 170);
        this.schedule(rage ? 3 : 2, 0.3, () => game.ring(this.x, this.y, n, speed));
        break;
      }
      case 'spiral':
        this.spiral = { time: rage ? 3 : 2, acc: 0, rate: 0.05, angle: rand(0, Math.PI * 2),
          dir: Math.random() < 0.5 ? -1 : 1, arms: rage ? 3 : 2, speed: rand(150, 190) };
        break;
      case 'doubleSpiral':
        this.spiral = { time: 3, acc: 0, rate: 0.06, angle: rand(0, Math.PI * 2),
          dir: Math.random() < 0.5 ? -1 : 1, arms: 4, speed: 170 };
        break;
      case 'wave': {
        // Sweeping hose of bullets
        const phase = rand(0, Math.PI * 2);
        const width = rand(0.6, 1);
        this.schedule(rage ? 34 : 24, 0.06, i =>
          game.fan(this.x, muzzle(), Math.PI / 2 + Math.sin(phase + i * 0.35) * width, 1, 0, 230));
        break;
      }
      case 'rain': {
        // Lobbed shower: tossed up out of the boss, arcing over and falling across the screen
        const seeds = Theme.halloween && this.def.sprite === 'boss1' ? { color: '#f5e6a8' } // pumpkin seeds
          : this.def.sprite === 'boss5' ? { color: Theme.c.rockStroke, r: 6 } : {};          // masonry
        this.schedule(rage ? 24 : 16, 0.08, () => game.enemyBullets.push(new Bullet(
          this.x + rand(-this.w * 0.3, this.w * 0.3), this.y - this.h * 0.3,
          rand(-170, 170), rand(-300, -220), false, { gravity: 320, ...seeds })));
        break;
      }
      case 'cross': {
        const spin = (Math.random() < 0.5 ? -1 : 1) * 0.2;
        this.schedule(rage ? 10 : 7, 0.14, i => game.ring(this.x, this.y, 4, 210, i * spin));
        break;
      }
      case 'minions':
        for (const side of [-1, 1]) {
          game.enemies.push(new Enemy('swooper', clamp(this.x + side * 60, 90, W - 90), this.y, { amp: 60 }));
        }
        break;
      case 'summonDivers':
        for (const side of [-1, 0, 1]) {
          game.enemies.push(new Enemy('diver', clamp(this.x + side * 70, 30, W - 30), this.y, { stopY: rand(150, 250) }));
        }
        break;
      case 'summonPhantoms':
        for (let i = 0; i < 2; i++) {
          game.enemies.push(new Enemy('phantom', rand(60, W - 60), this.y, { stopY: rand(200, 300) }));
        }
        break;
      case 'laser':
        this.laser = { t: 0, warn: 0.9, dur: 1.1, xs: [this.x], fired: false };
        break;
      case 'twinLaser':
        this.laser = { t: 0, warn: 0.8, dur: 1.3, xs: [this.x - 50, this.x + 50], fired: false };
        break;
      case 'pounce':
        this.leap = { home: { x: this.x, y: this.y }, left: rage ? 2 : 1 };
        this.startLeap('crouch', this, 0.6);
        break;
      case 'howl':
        this.schedule(rage ? 3 : 2, 0.35, i => game.ring(this.x, this.y, 14, 150, i * 0.2));
        game.shake = Math.max(game.shake, 6);
        if (Theme.halloween) Sound.sfx.howl();
        break;
      case 'lightning': {
        // Bolts from the sky: one on the player, more either side when enraged
        const px = clamp(game.player.x, 20, W - 20);
        const xs = [px];
        if (rage) xs.push(clamp(px + rand(70, 130), 20, W - 20), clamp(px - rand(70, 130), 20, W - 20));
        this.laser = { t: 0, warn: 0.8, dur: 0.35, xs, fired: false, bolt: true };
        break;
      }
      case 'stomp':
        // Rows of rubble with one gap to slip through
        game.shake = Math.max(game.shake, 10);
        Sound.sfx.explode();
        this.schedule(rage ? 2 : 1, 0.7, () => {
          const gap = rand(60, W - 60);
          for (let x = 12; x < W; x += 24) {
            if (Math.abs(x - gap) > 34) game.enemyBullets.push(new Bullet(x, muzzle(), 0, 120, false, { color: Theme.c.rockStroke }));
          }
        });
        break;
    }
  }

  hitTest(px, py) {
    return Math.abs(px - this.x) < this.w * 0.42 && Math.abs(py - this.y) < this.h * 0.4;
  }

  draw(ctx) {
    if (this.laser) {
      const top = this.laser.bolt ? 0 : this.y + this.h * 0.3;
      for (const lx of this.laser.xs) {
        if (this.laser.bolt && this.laserActive) {
          // Lightning: a pale glow with a crackling zigzag down the column
          ctx.fillStyle = 'rgba(200, 220, 255, 0.35)';
          ctx.fillRect(lx - 14, 0, 28, H);
          ctx.strokeStyle = '#ffffcc';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(lx, 0);
          for (let y = 40; y <= H; y += 40) ctx.lineTo(lx + rand(-10, 10), y);
          ctx.stroke();
        } else if (!this.laserActive) {
          if (Math.floor(this.laser.t * 20) % 2) {
            ctx.fillStyle = 'rgba(255, 60, 60, 0.8)';
            ctx.fillRect(lx - 1, top, 2, H - top);
          }
        } else {
          const w = 14 + Math.sin(this.laser.t * 60) * 3;
          ctx.fillStyle = 'rgba(255, 80, 200, 0.5)';
          ctx.fillRect(lx - w, top, w * 2, H - top);
          ctx.fillStyle = '#ffccff';
          ctx.fillRect(lx - w / 3, top, (w * 2) / 3, H - top);
        }
      }
    }
    const s = Sprites.get(this.def.sprite);
    ctx.drawImage(this.flash > 0 ? s.flash : s.img,
      Math.round(this.x - this.w / 2), Math.round(this.y - this.h / 2));
  }
}
