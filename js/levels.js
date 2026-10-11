// Level scripts: each row is [time, formation, ...args]. Six levels make a campaign
// ending in the final boss; after that the campaign loops, tougher each time round.
const LEVEL_SCRIPTS = [
  [
    [1, 'line', 'grunt', 5],
    [4, 'column', 'swooper', 6, 0.3],
    [6.5, 'column', 'swooper', 6, 0.7],
    [9.5, 'rocks', 4, 4],
    [12, 'v', 'grunt', 7],
    [15, 'line', 'shooter', 2],
    [18, 'line', 'grunt', 6],
    [20, 'column', 'swooper', 6, 0.5],
    [23, 'rocks', 5, 4],
    [26, 'line', 'tank', 1],
    [27, 'line', 'grunt', 4],
    [30, 'v', 'swooper', 5],
  ],
  [
    [1, 'v', 'grunt', 7],
    [3.5, 'line', 'shooter', 3],
    [6, 'column', 'swooper', 8, 0.25],
    [7, 'column', 'swooper', 8, 0.75],
    [10, 'rocks', 7, 5],
    [13, 'line', 'tank', 2],
    [15, 'line', 'grunt', 7],
    [18, 'v', 'swooper', 7],
    [21, 'line', 'shooter', 4],
    [24, 'rocks', 6, 4],
    [27, 'column', 'swooper', 8, 0.5],
    [29, 'line', 'grunt', 8],
    [32, 'line', 'tank', 3],
  ],
  [
    [1, 'line', 'shooter', 3],
    [2, 'column', 'swooper', 10, 0.3],
    [4, 'column', 'swooper', 10, 0.7],
    [7, 'rocks', 10, 6],
    [9, 'line', 'tank', 2],
    [12, 'v', 'grunt', 9],
    [14, 'line', 'shooter', 4],
    [17, 'column', 'swooper', 10, 0.5],
    [20, 'line', 'tank', 3],
    [22, 'rocks', 8, 5],
    [24, 'line', 'werewolf', 2],
    [26, 'v', 'swooper', 7],
    [27, 'line', 'shooter', 5],
    [30, 'line', 'grunt', 9],
    [33, 'line', 'tank', 2],
  ],
  // Level 4: divers and splitters
  [
    [1, 'line', 'diver', 3],
    [3, 'line', 'splitter', 2],
    [5, 'line', 'werewolf', 2],
    [6, 'scatter', 'diver', 6, 4],
    [9, 'v', 'grunt', 7],
    [11, 'line', 'splitter', 3],
    [14, 'column', 'swooper', 8, 0.3],
    [15, 'column', 'swooper', 8, 0.7],
    [18, 'line', 'shooter', 3],
    [19, 'scatter', 'diver', 6, 3],
    [21, 'scatter', 'werewolf', 3, 3],
    [23, 'rocks', 6, 4],
    [26, 'line', 'tank', 2],
    [27, 'line', 'splitter', 4],
    [29, 'line', 'werewolf', 3],
    [31, 'scatter', 'diver', 8, 3],
  ],
  // Level 5: minelayers and phantoms
  [
    [1, 'sweep', -1],
    [3, 'line', 'phantom', 2],
    [6, 'sweep', 1],
    [8, 'v', 'swooper', 7],
    [9, 'line', 'necromancer', 1],
    [11, 'line', 'splitter', 3],
    [13, 'line', 'phantom', 3],
    [16, 'sweep', -1],
    [17, 'sweep', 1],
    [19, 'line', 'werewolf', 3],
    [20, 'scatter', 'diver', 8, 4],
    [23, 'line', 'tank', 2],
    [24, 'line', 'necromancer', 1],
    [25, 'rocks', 6, 4],
    [28, 'line', 'phantom', 4],
    [31, 'line', 'shooter', 4],
  ],
  // Level 6: the gauntlet before the final boss
  [
    [1, 'line', 'phantom', 3],
    [2, 'sweep', -1],
    [3, 'line', 'necromancer', 1],
    [4, 'scatter', 'diver', 8, 4],
    [7, 'line', 'tank', 3],
    [9, 'column', 'swooper', 10, 0.25],
    [9.5, 'column', 'swooper', 10, 0.75],
    [11, 'line', 'werewolf', 3],
    [13, 'line', 'splitter', 4],
    [15, 'sweep', 1],
    [16, 'line', 'shooter', 5],
    [19, 'rocks', 8, 4],
    [20, 'line', 'necromancer', 2],
    [22, 'scatter', 'diver', 10, 4],
    [25, 'line', 'phantom', 4],
    [27, 'sweep', -1],
    [28, 'sweep', 1],
    [30, 'scatter', 'werewolf', 4, 3],
    [31, 'v', 'grunt', 9],
    [33, 'line', 'tank', 3],
  ],
];
const CAMPAIGN_LENGTH = LEVEL_SCRIPTS.length;
const isFinalLevel = n => n % CAMPAIGN_LENGTH === 0;
const loopOf = n => Math.floor((n - 1) / CAMPAIGN_LENGTH);

const FORMATIONS = {
  // Evenly spaced across the screen, all at once
  line(events, at, mods, type, count) {
    for (let i = 0; i < count; i++) {
      events.push({ at, kind: 'enemy', type, x: (W * (i + 1)) / (count + 1), opts: { ...mods } });
    }
  },
  // Single file from one horizontal position (fraction of screen width)
  column(events, at, mods, type, count, fx, gap = 0.35) {
    const x = clamp(fx * W, 90, W - 90);
    for (let i = 0; i < count; i++) {
      events.push({ at: at + i * gap, kind: 'enemy', type, x, opts: { ...mods } });
    }
  },
  // Arrow shape: leader in the middle, wings trailing behind
  v(events, at, mods, type, count) {
    for (let i = 0; i < count; i++) {
      const off = i - (count - 1) / 2;
      events.push({
        at: at + Math.abs(off) * 0.25, kind: 'enemy', type,
        x: W / 2 + off * 50, opts: { ...mods, amp: 40 },
      });
    }
  },
  // Random positions spread over `dur` seconds
  scatter(events, at, mods, type, count, dur) {
    for (let i = 0; i < count; i++) {
      events.push({ at: at + rand(0, dur), kind: 'enemy', type, x: rand(40, W - 40), opts: { ...mods } });
    }
  },
  // A minelayer crossing from one side (-1 = left, 1 = right)
  sweep(events, at, mods, side) {
    events.push({ at, kind: 'enemy', type: 'minelayer', x: 0, opts: { ...mods, side, y: rand(70, 140) } });
  },
  // Random asteroid shower over `dur` seconds
  rocks(events, at, mods, count, dur) {
    for (let i = 0; i < count; i++) {
      events.push({
        at: at + rand(0, dur), kind: 'asteroid',
        size: Math.random() < 0.5 ? 3 : 2, x: rand(40, W - 40),
        vx: rand(-40, 40), vy: rand(50, 100) * mods.speedMul,
      });
    }
  },
};

function buildLevel(n) {
  const script = LEVEL_SCRIPTS[(n - 1) % CAMPAIGN_LENGTH];
  const loop = loopOf(n);
  // Later scripts are hard by design, so per-level scaling is gentle
  const mods = {
    speedMul: 1 + 0.06 * (n - 1),
    fireMul: 1 + 0.1 * (n - 1),
    hpBonus: loop,
  };
  const timeScale = Math.max(0.6, 1 - 0.04 * (n - 1));
  const events = [];
  for (const [at, form, ...args] of script) {
    FORMATIONS[form](events, at * timeScale, mods, ...args);
  }
  return events.sort((a, b) => a.at - b.at);
}
