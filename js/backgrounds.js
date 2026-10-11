// Per-level backdrops: six scenes per theme, drawn behind the starfield.
// Decor positions come from a seeded scatter so they stay put between frames,
// and scroll downward at different speeds for parallax.
const Backgrounds = (() => {
  const NAMES = {
    classic: ['DEEP SPACE', 'NEBULA', 'RINGED WORLD', 'RED GIANT', 'ICE NEBULA', 'ALIEN HIVE'],
    halloween: ['MOONLIT SKY', 'GRAVEYARD', 'HAUNTED FOREST', 'BLOOD MOON', 'HAUNTED CASTLE', "DRACULA'S LAIR"],
  };

  const cache = {};
  function vgrad(ctx, key, top, bottom) {
    if (!cache[key]) {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, top);
      g.addColorStop(1, bottom);
      cache[key] = g;
    }
    return cache[key];
  }
  // Soft blob: a radial gradient centred on the origin, translated into place when drawn
  function blob(ctx, key, r, color) {
    if (!cache[key]) {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      cache[key] = g;
    }
    return cache[key];
  }

  function fill(ctx, style) {
    ctx.fillStyle = style;
    ctx.fillRect(0, 0, W, H);
  }

  function circle(ctx, x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function scatter(n, seed) {
    let s = seed;
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    return Array.from({ length: n }, () => ({ x: r() * W, y: r() * H, k: r() }));
  }

  // Downward scroll with wraparound; `span` > H leaves gaps between repeats
  const scroll = (y, t, speed, span = H + 80) => ((y + t * speed) % span) - 40;

  const decor = {
    nebula: scatter(6, 7),
    belt: scatter(40, 11),
    crystals: scatter(24, 13),
    hex: scatter(10, 17),
    graves: scatter(14, 19),
    trees: scatter(10, 23),
    mist: scatter(5, 29),
    bats: scatter(10, 31),
  };

  function bats(ctx, t, n, color = '#000000') {
    ctx.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const b = decor.bats[i % decor.bats.length];
      const x = ((b.x + t * (20 + b.k * 40) + i * 37) % (W + 40)) - 20;
      const y = 60 + ((b.y + i * 53) % 300);
      const flap = Math.sin(t * 12 + i) * 4;
      ctx.beginPath();
      ctx.moveTo(x - 9, y - flap);
      ctx.lineTo(x - 3, y);
      ctx.lineTo(x, y - 2);
      ctx.lineTo(x + 3, y);
      ctx.lineTo(x + 9, y - flap);
      ctx.lineTo(x, y + 3);
      ctx.closePath();
      ctx.fill();
    }
  }

  function moon(ctx, x, y, r, face, crater, halo) {
    circle(ctx, x, y, r * 1.4, halo);
    circle(ctx, x, y, r, face);
    for (const [cx, cy, cr] of [[-0.36, -0.3, 0.18], [0.3, 0.3, 0.24], [0.4, -0.4, 0.1]]) {
      circle(ctx, x + cx * r, y + cy * r, cr * r, crater);
    }
  }

  function mist(ctx, t, color) {
    for (const [i, m] of decor.mist.entries()) {
      const x = ((m.x + t * (10 + m.k * 15)) % (W + 300)) - 150;
      ctx.save();
      ctx.translate(x, 200 + i * 90);
      ctx.scale(2.5, 0.6);
      ctx.fillStyle = blob(ctx, `mist-${color}`, 70, color);
      ctx.fillRect(-70, -70, 140, 140);
      ctx.restore();
    }
  }

  const CLASSIC = [
    // Deep space
    ctx => fill(ctx, '#000000'),
    // Nebula
    (ctx, t) => {
      fill(ctx, '#05030f');
      const colors = ['rgba(150, 60, 220, 0.35)', 'rgba(60, 90, 230, 0.3)', 'rgba(220, 60, 160, 0.25)'];
      decor.nebula.forEach((n, i) => {
        ctx.save();
        ctx.translate(n.x, scroll(n.y, t, 8, H + 300));
        ctx.fillStyle = blob(ctx, `neb${i % 3}`, 160, colors[i % 3]);
        ctx.fillRect(-160, -160, 320, 320);
        ctx.restore();
      });
    },
    // Ringed world
    (ctx, t) => {
      fill(ctx, '#02030a');
      const py = scroll(140, t, 5, H + 400);
      circle(ctx, 110, py, 70, '#aa7744');
      ctx.fillStyle = '#885533';
      ctx.fillRect(40, py - 18, 140, 10);
      ctx.fillRect(44, py + 12, 132, 8);
      ctx.strokeStyle = 'rgba(230, 200, 150, 0.6)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(110, py, 120, 26, -0.25, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#6a5a4a';
      for (const r of decor.belt) ctx.fillRect(r.x, scroll(r.y, t, 30), 2 + r.k * 3, 2 + r.k * 3);
    },
    // Red giant
    (ctx, t) => {
      fill(ctx, vgrad(ctx, 'redgiant', '#2a0806', '#000000'));
      const pulse = Math.sin(t * 1.5) * 6;
      circle(ctx, W / 2, -110, 260 + pulse, 'rgba(255, 80, 30, 0.12)');
      circle(ctx, W / 2, -110, 220 + pulse, 'rgba(255, 110, 40, 0.25)');
      circle(ctx, W / 2, -110, 190, '#cc3311');
      circle(ctx, W / 2 - 40, -60, 30, '#aa2208');
    },
    // Ice nebula
    (ctx, t) => {
      fill(ctx, vgrad(ctx, 'ice', '#03141e', '#000812'));
      ctx.strokeStyle = 'rgba(150, 230, 255, 0.5)';
      ctx.lineWidth = 1.5;
      for (const c of decor.crystals) {
        const y = scroll(c.y, t, 25 + c.k * 30);
        const s = 4 + c.k * 8;
        ctx.save();
        ctx.translate(c.x, y);
        ctx.rotate(t * (c.k - 0.5));
        ctx.beginPath();
        ctx.moveTo(0, -s);
        ctx.lineTo(s * 0.6, 0);
        ctx.lineTo(0, s);
        ctx.lineTo(-s * 0.6, 0);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }
    },
    // Alien hive: scrolling hex grid with pulsing nodes
    (ctx, t) => {
      fill(ctx, vgrad(ctx, 'hive', '#14000c', '#000000'));
      const size = 30;
      const hh = size * Math.sqrt(3);
      const off = (t * 25) % hh;
      ctx.strokeStyle = '#3a0c26';
      ctx.lineWidth = 1.5;
      for (let row = -1; row < H / hh + 1; row++) {
        for (let col = 0; col < W / (size * 1.5) + 1; col++) {
          const cx = col * size * 1.5;
          const cy = row * hh + (col % 2 ? hh / 2 : 0) + off;
          ctx.beginPath();
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * Math.PI * 2;
            ctx.lineTo(cx + Math.cos(a) * size * 0.95, cy + Math.sin(a) * size * 0.95);
          }
          ctx.closePath();
          ctx.stroke();
        }
      }
      for (const n of decor.hex) {
        circle(ctx, n.x, scroll(n.y, t, 25), 3 + Math.sin(t * 3 + n.k * 9) * 2, 'rgba(255, 50, 120, 0.6)');
      }
    },
  ];

  const HALLOWEEN = [
    // Moonlit sky
    (ctx, t) => {
      fill(ctx, vgrad(ctx, 'moonlit', '#12051f', '#240a2e'));
      moon(ctx, 370, 120, 50, '#f5e6a8', '#d9c88a', 'rgba(245, 230, 168, 0.12)');
      bats(ctx, t, 5);
    },
    // Graveyard: tombstones drifting past in the mist
    (ctx, t) => {
      fill(ctx, vgrad(ctx, 'graveyard', '#0a0a1a', '#1a1a26'));
      for (const g of decor.graves) {
        const y = scroll(g.y, t, 30);
        const w = 16 + g.k * 10;
        const h = 22 + g.k * 12;
        ctx.fillStyle = '#2c2c3a';
        ctx.beginPath();
        ctx.arc(g.x, y - h / 2 + w / 2, w / 2, Math.PI, 0);
        ctx.lineTo(g.x + w / 2, y + h / 2);
        ctx.lineTo(g.x - w / 2, y + h / 2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#1a1a24';
        ctx.fillRect(g.x - 1, y - h / 4, 2, 9);
        ctx.fillRect(g.x - 4, y - h / 4 + 2, 8, 2);
      }
      mist(ctx, t, 'rgba(180, 190, 220, 0.18)');
    },
    // Haunted forest: gnarled canopies seen from above, green fog
    (ctx, t) => {
      fill(ctx, vgrad(ctx, 'forest', '#050d07', '#0d1a0f'));
      ctx.strokeStyle = '#020603';
      ctx.fillStyle = '#030a05';
      for (const tr of decor.trees) {
        const y = scroll(tr.y, t, 35, H + 160);
        const r = 26 + tr.k * 22;
        circle(ctx, tr.x, y, r, '#030a05');
        ctx.lineWidth = 3;
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + tr.k * 3;
          ctx.beginPath();
          ctx.moveTo(tr.x, y);
          ctx.lineTo(tr.x + Math.cos(a) * r * 1.5, y + Math.sin(a) * r * 1.5);
          ctx.stroke();
        }
      }
      mist(ctx, t, 'rgba(90, 200, 90, 0.16)');
    },
    // Blood moon
    (ctx, t) => {
      fill(ctx, vgrad(ctx, 'bloodmoon', '#1a0206', '#3a0a0e'));
      moon(ctx, 120, 140, 70, '#cc2222', '#991515', 'rgba(255, 40, 40, 0.15)');
      bats(ctx, t, 7);
    },
    // Haunted castle with lightning
    (ctx, t) => {
      fill(ctx, vgrad(ctx, 'castle', '#0a0618', '#1a1030'));
      const bolt = (t % 7) < 0.15 || ((t % 7) > 0.3 && (t % 7) < 0.4);
      if (bolt) fill(ctx, 'rgba(220, 220, 255, 0.25)');
      const base = 170;
      ctx.fillStyle = '#05030a';
      ctx.fillRect(60, base - 60, 360, 60);
      for (const [x, w, h] of [[60, 50, 130], [180, 40, 100], [260, 40, 110], [370, 50, 140]]) {
        ctx.fillRect(x, base - h, w, h);
        for (let k = 0; k < w; k += 12) ctx.fillRect(x + k, base - h - 8, 7, 8);
      }
      ctx.fillStyle = '#ffcc55';
      for (const [x, y] of [[78, 70], [195, 95], [275, 85], [392, 60], [392, 100], [130, 135], [330, 135]]) {
        if (Math.sin(t * 2 + x) > -0.6) ctx.fillRect(x, y, 6, 9);
      }
      bats(ctx, t, 4);
    },
    // Dracula's lair: red mist and a swarm of bats
    (ctx, t) => {
      fill(ctx, vgrad(ctx, 'lair', '#000000', '#2a0008'));
      mist(ctx, t, 'rgba(200, 20, 40, 0.22)');
      bats(ctx, t, 10, '#100006');
    },
  ];

  return {
    draw(ctx, scene, t) {
      (Theme.halloween ? HALLOWEEN : CLASSIC)[scene % 6](ctx, t);
    },
    name: scene => NAMES[Theme.halloween ? 'halloween' : 'classic'][scene % 6],
  };
})();
