// Top-10 leaderboard persisted in localStorage, with an in-memory fallback
// for private windows or blocked storage. `Leaderboard.world` adds the shared
// world top 10 from the Supabase Edge Function.
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

  // ---------- world leaderboard (Supabase Edge Function) ----------
  // Public by design: the publishable key only identifies the game; the server enforces the rules.
  const WORLD_URL = 'https://vmqppvmrjyntfiixhhim.supabase.co/functions/v1/leaderboard';
  const WORLD_KEY = 'sb_publishable_32BInGi9HS81h-giD7v1SA_PVceH9D9';
  const TIMEOUT_MS = 5000;
  const REFRESH_MS = 60000;

  // Every call resolves to parsed JSON, or null on any failure, so the game never waits on or breaks from the network
  async function call(action, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${WORLD_URL}/${action}`, {
        method: body ? 'POST' : 'GET',
        headers: body ? { apikey: WORLD_KEY, 'content-type': 'application/json' } : { apikey: WORLD_KEY },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store', // our own throttle limits load; a cached top 10 would hide a fresh score
        signal: ctrl.signal,
      });
      return res.ok ? await res.json() : null;
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  const validWorld = e => valid(e) && e.name.length <= 3 && Number.isInteger(e.level);

  const world = (() => {
    let top = null;
    let fetchedAt = -Infinity;
    return {
      get top() { return top; },
      async refresh(force = false) {
        if (!force && Date.now() - fetchedAt < REFRESH_MS) return top;
        fetchedAt = Date.now();
        const data = await call('top');
        if (Array.isArray(data)) {
          top = data.filter(validWorld).slice(0, MAX).map(({ name, score, level }) => ({ name, score, level }));
        }
        return top;
      },
      qualifies: score => !!top && score > 0 && (top.length < MAX || score > top[top.length - 1].score),
      async startRun() {
        const data = await call('start', {});
        return data && typeof data.token === 'string' ? data.token : null;
      },
      async submit(token, name, score, level) {
        const data = await call('submit', { token, name, score, level });
        return data && Number.isInteger(data.rank) ? data.rank : null;
      },
    };
  })();

  return {
    all: load,
    qualifies,
    add,
    hiScore: () => Math.max(load()[0] ? load()[0].score : 0, world.top && world.top[0] ? world.top[0].score : 0),
    world,
  };
})();
