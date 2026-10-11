// Top-10 leaderboard persisted in localStorage, with an in-memory fallback
// for private windows or blocked storage.
const Leaderboard = (() => {
  const KEY = 'starblaster.leaderboard.v1';
  const MAX = 10;
  const SEED = [
    { name: 'ACE', score: 30000, level: 4 },
    { name: 'ZAP', score: 20000, level: 3 },
    { name: 'REX', score: 12000, level: 2 },
    { name: 'KIM', score: 6000, level: 2 },
    { name: 'BOB', score: 2500, level: 1 },
  ];
  let entries = null;

  const valid = e => e && typeof e.name === 'string' && Number.isFinite(e.score);

  function load() {
    if (entries) return entries;
    try {
      const raw = localStorage.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      entries = Array.isArray(parsed) ? parsed.filter(valid) : SEED.map(e => ({ ...e }));
    } catch (e) {
      entries = SEED.map(e => ({ ...e }));
    }
    return entries;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(entries));
    } catch (e) {
      // Storage unavailable - scores stay for this session only
    }
  }

  function qualifies(score) {
    const list = load();
    return score > 0 && (list.length < MAX || score > list[list.length - 1].score);
  }

  // Returns the 0-based rank of the new entry
  function add(name, score, level) {
    const list = load();
    const entry = { name, score, level };
    let idx = list.findIndex(e => score > e.score);
    if (idx === -1) idx = list.length;
    list.splice(idx, 0, entry);
    list.length = Math.min(list.length, MAX);
    save();
    return idx;
  }

  return {
    all: load,
    qualifies,
    add,
    hiScore: () => (load()[0] ? load()[0].score : 0),
  };
})();
