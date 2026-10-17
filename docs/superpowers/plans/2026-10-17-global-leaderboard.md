# Global Leaderboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public WORLD TOP 10 for Spooky Blaster, backed by Supabase, with casual anti-cheat, while the local leaderboard keeps working offline.

**Architecture:** The browser calls one Supabase Edge Function (`leaderboard`) with the publishable key. The function validates, rate-limits and writes to two tables using the secret key server-side. The tables have RLS on and no grants for `anon`/`authenticated`, so the function is the only way in. The validation rules are a dependency-free ES module (`rules.mjs`), unit-tested under Node and imported by the Deno function.

**Tech Stack:** vanilla JS game (no build), Node 20 `node --test`, Supabase (Postgres 17, Edge Functions on Deno), `npm:@supabase/server@1.9.2`, `npm:@supabase/supabase-js@2.120.0`, Supabase MCP tools.

**Spec:** `docs/superpowers/specs/2026-10-17-global-leaderboard-design.md`

## Global Constraints

- The browser uses only the **publishable key** (`sb_publishable_...`), sent only in the `apikey` header. Never `Authorization: Bearer`, never the legacy `anon` key, never a secret key.
- The secret key exists only in the Edge Function environment (`SUPABASE_SECRET_KEYS`, auto-provisioned). It is never written to the repo, logs or chat.
- No database function is callable by `anon` or `authenticated`. No `SECURITY DEFINER`.
- Every table has RLS enabled. `anon`, `authenticated` and `public` have no privileges on them.
- The Edge Function is deployed with `verify_jwt = false` and authorizes callers with `withSupabase({ auth: 'publishable' })`.
- Allowed CORS origins: `https://dowmad.github.io`, plus `http://127.0.0.1[:port]` and `http://localhost[:port]`.
- Limits (in `rules.mjs` `LIMITS`, generous at launch):
  - points per level 250000
  - points per second 5000
  - at least 20 seconds per completed level
  - a run token lasts 3 hours
  - 30 starts and 10 accepted submissions per IP hash per hour
  - request bodies up to 1024 bytes
- Names match `^[A-Z0-9 ?]{1,3}$` and are not all spaces. **Spec amendment:** `?` is allowed because the game saves blank initials as `???`.
- Play time is measured server-side: Edge Function time now minus the database's `runs.started_at`. The client never sends a duration. **Spec clarification:** "database clock" in the spec means it is server-measured; mixing the function and database clocks is accepted.
- Raw IPs are never stored or logged. Only `SHA-256(salt + ip)` hex is stored, with the salt in the function secret `LEADERBOARD_IP_SALT`.
- Network failures never block or crash the game. Every client call resolves to `null` on failure.
- Pinned versions: `@supabase/server` 1.9.2 and `@supabase/supabase-js` 2.120.0 (via `deno.json` imports).

## Review Focus

1. **Offline at game start, online at the end.** No run token, so saving initials must not call submit. It shows NOT SUBMITTED and the local save still works. Pinned in Task 6.
2. **The connection drops between start and submit.** Submit resolves `null`, so it shows NOT SUBMITTED and the local entry is saved. Pinned in Task 6.
3. **A late response after a new game has started.** An old game's submit must not set the new game's world rank. Pinned in Task 6 (run id guard).
4. **Malformed server data** (a non-array `top`, entries with wrong types, 50-character names). It must be filtered and must never crash rendering. Pinned in Task 5.
5. **A saved run token reused** (a second tab, or a scripted replay). The server rejects the second submit. Pinned in Task 4 (smoke script).

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261017140000_leaderboard.sql` | Create: tables, indexes, RLS, grants |
| `supabase/functions/leaderboard/rules.mjs` | Create: pure rules (limits, parsing, plausibility, CORS, routing, IP pick, hashing). No I/O. |
| `supabase/functions/leaderboard/index.ts` | Create: HTTP handler that wires the rules to the database |
| `supabase/functions/leaderboard/deno.json` | Create: pinned imports |
| `scripts/leaderboard-smoke.sh` | Create: live checks against the deployed function |
| `tests/leaderboard-rules.test.js` | Create: unit tests for `rules.mjs` |
| `js/leaderboard.js` | Modify: add `Leaderboard.world` (network client); `hiScore` includes the world best |
| `js/game.js` | Modify: run tokens, submit on save, world/offline tables, status line |
| `tests/game.test.js` | Modify: harness gets a stubbed `fetch`; client and game integration tests |

---

### Task 0: Prerequisites (needs the owner)

**Files:** none

- [ ] **Step 1: Settle the uncommitted work.** `main` currently has uncommitted boss, touch-control and Holy Water changes. Ask the owner whether to commit them (and push) first. Do not start leaderboard work on top of uncommitted changes. Then create a branch:

```bash
git switch -c feat/global-leaderboard
```

- [ ] **Step 2: Free a free-plan project slot.** The org `fresh-beige-pike` has 2 active projects (HashtagWild, scrabble), which is the free-plan limit. Ask the owner to name one to pause (or confirm they upgraded). Pause only the project they name, using `mcp__plugin_supabase_supabase__pause_project`.

- [ ] **Step 3: Create the project.** With the owner's explicit approval, call `mcp__plugin_supabase_supabase__create_project` with name `spooky-blaster`, region `eu-west-2` and organization `fresh-beige-pike`. If the tool asks for a cost confirmation, show the owner the cost and confirm only with their yes. Poll `get_project` until the status is `ACTIVE_HEALTHY`. Record the project ref.

- [ ] **Step 4: Get the URL and publishable key.** Call `get_project_url` and `get_publishable_keys`. Record the URL (`https://<ref>.supabase.co`) and the key that starts with `sb_publishable_`. If there is no `sb_publishable_` key, ask the owner to click **Create new API keys** in Settings → API Keys, then call again. These two values are public and go into `js/leaderboard.js` in Task 5.

- [ ] **Step 5: Set the IP hash salt.** Generate a salt without echoing it:

```bash
openssl rand -hex 32 > /tmp/ip_salt && wc -c /tmp/ip_salt
```

Expected: `65 /tmp/ip_salt`. With the owner's permission, set it with `mcp__plugin_supabase_supabase__create_edge_function_secret` (name `LEADERBOARD_IP_SALT`, value = the file's contents), then `rm /tmp/ip_salt`. If the owner prefers, they paste it into Dashboard → Edge Functions → Secrets themselves.

---

### Task 1: Database schema

**Files:**
- Create: `supabase/migrations/20261017140000_leaderboard.sql`

**Interfaces:**
- Produces: `public.leaderboard_runs(token uuid pk, ip_hash text, started_at timestamptz, used_at timestamptz)` and `public.leaderboard_scores(id bigint pk, name text, score int, level int, duration_s int, ip_hash text, created_at timestamptz)`, both readable and writable only by `service_role`.

- [ ] **Step 1: Write the migration**

```sql
-- Spooky Blaster world leaderboard. Only the `leaderboard` Edge Function (service_role)
-- touches these tables; anon/authenticated have no privileges and RLS denies by default.

create table public.leaderboard_runs (
  token      uuid primary key default gen_random_uuid(), -- unguessable one-time run token
  ip_hash    text not null,                               -- salted SHA-256, never the raw IP
  started_at timestamptz not null default now(),
  used_at    timestamptz                                  -- set once, when the score is submitted
);
create index leaderboard_runs_ip_hash_started_at_idx on public.leaderboard_runs (ip_hash, started_at);
create index leaderboard_runs_started_at_idx on public.leaderboard_runs (started_at);

create table public.leaderboard_scores (
  id         bigint generated always as identity primary key,
  name       text not null check (name ~ '^[A-Z0-9 ?]{1,3}$' and btrim(name) <> ''),
  score      integer not null check (score between 1 and 100000000),
  level      integer not null check (level between 1 and 1000),
  duration_s integer not null check (duration_s >= 0),
  ip_hash    text not null,
  created_at timestamptz not null default now()
);
create index leaderboard_scores_score_created_at_idx on public.leaderboard_scores (score desc, created_at);
create index leaderboard_scores_ip_hash_created_at_idx on public.leaderboard_scores (ip_hash, created_at);

alter table public.leaderboard_runs enable row level security;
alter table public.leaderboard_scores enable row level security;
-- Intentionally no policies: deny-all for anon/authenticated.

revoke all on public.leaderboard_runs, public.leaderboard_scores from anon, authenticated, public;
grant select, insert, update, delete on public.leaderboard_runs to service_role;
grant select, insert, delete on public.leaderboard_scores to service_role;
grant usage on sequence public.leaderboard_scores_id_seq to service_role;
```

- [ ] **Step 2: Apply it to the new project.** Call `mcp__plugin_supabase_supabase__apply_migration` with name `leaderboard`, the project ref from Task 0, and the file contents. This is a fresh remote project, so a single recorded migration is correct.

- [ ] **Step 3: Verify the public roles are locked out.** Run with `execute_sql`:

```sql
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name in ('leaderboard_runs', 'leaderboard_scores')
order by grantee, table_name;
```

Expected: rows only for `postgres` and `service_role`. **No** `anon`, `authenticated` or `PUBLIC` rows.

```sql
select relname, relrowsecurity from pg_class where relname in ('leaderboard_runs', 'leaderboard_scores');
```

Expected: both `relrowsecurity = true`.

- [ ] **Step 4: Verify the constraints reject bad rows** (each in its own call; each must error):

```sql
insert into public.leaderboard_scores (name, score, level, duration_s, ip_hash) values ('abc', 10, 1, 5, 'x');
```
Expected: `violates check constraint "leaderboard_scores_name_check"`.
```sql
insert into public.leaderboard_scores (name, score, level, duration_s, ip_hash) values ('   ', 10, 1, 5, 'x');
```
Expected: `leaderboard_scores_name_check` violation.
```sql
insert into public.leaderboard_scores (name, score, level, duration_s, ip_hash) values ('ABC', 0, 1, 5, 'x');
```
Expected: `leaderboard_scores_score_check` violation.

- [ ] **Step 5: Verify the REST API refuses the publishable key.**

```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://<ref>.supabase.co/rest/v1/scores?select=*" -H "apikey: <sb_publishable_key>"
curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://<ref>.supabase.co/rest/v1/scores" -H "apikey: <sb_publishable_key>" -H "content-type: application/json" -d '{"name":"HAX","score":1,"level":1,"duration_s":0,"ip_hash":"x"}'
```

Expected: both are non-2xx (401, 403 or 404). A `200`/`201` is a failure: stop and fix the grants.

- [ ] **Step 6: Run the advisors.** Call `get_advisors` with type `security`, then type `performance`. The only accepted finding is the INFO "RLS enabled, no policy" for `runs` and `scores` (intentional deny-all). Fix anything else.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261017140000_leaderboard.sql
git commit -m "feat(leaderboard): add locked-down runs and scores tables"
```

---

### Task 2: Pure rules module

**Files:**
- Create: `supabase/functions/leaderboard/rules.mjs`
- Test: `tests/leaderboard-rules.test.js`

**Interfaces:**
- Produces (named exports of `rules.mjs`):
  - `LIMITS`: `{ pointsPerLevel, pointsPerSecond, secondsPerLevel, tokenMaxAgeMs, startsPerHour, submitsPerHour, unknownIpFactor, maxBodyBytes }`
  - `corsHeaders(origin: string|null): Record<string,string>` (`{}` when the origin isn't allowed)
  - `route(method: string, pathname: string): 'top'|'start'|'submit'|'preflight'|'bad_method'|'not_found'`
  - `parseSubmission(body: unknown): { token, name, score, level } | null`
  - `parseStart(body: unknown): boolean` (true only for `{}`)
  - `plausible({ score, level }, durationS: number): boolean`
  - `clientIp(headers: Headers): string|null`
  - `ipHash(ip: string, salt: string): Promise<string>` (64 lowercase hex characters)

- [ ] **Step 1: Write the failing tests**

```js
// Unit tests for the leaderboard Edge Function's pure rules (supabase/functions/leaderboard/rules.mjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'supabase', 'functions', 'leaderboard', 'rules.mjs')));
const TOKEN = '3f2b8c1e-9a4d-4c7e-8f10-2b6d9e4a7c55';
const ok = { token: TOKEN, name: 'ABC', score: 1200, level: 2 };

test('a well-formed submission parses', async () => {
  const { parseSubmission } = await load();
  assert.deepEqual(parseSubmission(ok), ok);
  assert.deepEqual(parseSubmission({ ...ok, name: 'B A' }), { ...ok, name: 'B A' });
  assert.deepEqual(parseSubmission({ ...ok, name: '???' }), { ...ok, name: '???' });
  assert.deepEqual(parseSubmission({ ...ok, token: TOKEN.toUpperCase() }), ok, 'token is normalised to lower case');
});

test('malformed submissions are rejected', async () => {
  const { parseSubmission } = await load();
  const bad = [
    null, [], 'x', {},
    { ...ok, extra: 1 },
    { token: TOKEN, name: 'ABC', score: 1200 },
    { ...ok, token: 'not-a-uuid' },
    { ...ok, name: 'abc' }, { ...ok, name: 'ABCD' }, { ...ok, name: '   ' }, { ...ok, name: '' }, { ...ok, name: '<b>' },
    { ...ok, score: 1.5 }, { ...ok, score: 0 }, { ...ok, score: 100000001 }, { ...ok, score: '1200' },
    { ...ok, level: 0 }, { ...ok, level: 1001 }, { ...ok, level: 2.5 },
  ];
  for (const b of bad) assert.equal(parseSubmission(b), null, JSON.stringify(b));
});

test('start accepts only an empty object', async () => {
  const { parseStart } = await load();
  assert.equal(parseStart({}), true);
  for (const b of [null, [], { a: 1 }, 'x']) assert.equal(parseStart(b), false);
});

test('plausibility limits', async () => {
  const { plausible } = await load();
  assert.equal(plausible({ score: 1000, level: 1 }, 10), true);
  assert.equal(plausible({ score: 250001, level: 1 }, 10000), false, 'too many points for the level');
  assert.equal(plausible({ score: 50001, level: 1 }, 10), false, 'too many points per second');
  assert.equal(plausible({ score: 1000, level: 5 }, 79), false, 'cleared 4 levels in under 80 s');
  assert.equal(plausible({ score: 1000, level: 5 }, 80), true);
});

test('CORS is granted only to the game site and local testing', async () => {
  const { corsHeaders } = await load();
  assert.equal(corsHeaders('https://dowmad.github.io')['Access-Control-Allow-Origin'], 'https://dowmad.github.io');
  assert.equal(corsHeaders('http://127.0.0.1:8765')['Access-Control-Allow-Origin'], 'http://127.0.0.1:8765');
  assert.equal(corsHeaders('http://localhost')['Access-Control-Allow-Origin'], 'http://localhost');
  for (const o of [null, '', 'https://evil.example', 'http://localhost.evil.example', 'https://dowmad.github.io.evil.example', 'http://dowmad.github.io']) {
    assert.deepEqual(corsHeaders(o), {}, String(o));
  }
  assert.match(corsHeaders('https://dowmad.github.io')['Access-Control-Allow-Headers'], /apikey/);
});

test('routing', async () => {
  const { route } = await load();
  assert.equal(route('GET', '/leaderboard/top'), 'top');
  assert.equal(route('POST', '/leaderboard/start'), 'start');
  assert.equal(route('POST', '/leaderboard/submit'), 'submit');
  assert.equal(route('OPTIONS', '/leaderboard/submit'), 'preflight');
  assert.equal(route('GET', '/leaderboard/submit'), 'bad_method');
  assert.equal(route('DELETE', '/leaderboard/top'), 'bad_method');
  assert.equal(route('GET', '/leaderboard'), 'not_found');
  assert.equal(route('GET', '/leaderboard/admin'), 'not_found');
});

test('client IP is the right-most forwarded address', async () => {
  const { clientIp } = await load();
  assert.equal(clientIp(new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1 , 203.0.113.9' })), '203.0.113.9');
  assert.equal(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.9' })), '203.0.113.9');
  assert.equal(clientIp(new Headers()), null);
  assert.equal(clientIp(new Headers({ 'x-forwarded-for': ' , ' })), null);
});

test('IP hashes are salted SHA-256 hex', async () => {
  const { ipHash } = await load();
  const a = await ipHash('203.0.113.9', 'salt1');
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(await ipHash('203.0.113.9', 'salt1'), a);
  assert.notEqual(await ipHash('203.0.113.9', 'salt2'), a);
  assert.notEqual(await ipHash('203.0.113.8', 'salt1'), a);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/leaderboard-rules.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` (rules.mjs doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```js
// Pure rules for the leaderboard Edge Function: no I/O, so Node unit-tests them and
// the Deno function imports them unchanged. Limits are generous at launch; tighten
// them once real scores show what's normal.

export const LIMITS = {
  pointsPerLevel: 250000,
  pointsPerSecond: 5000,
  secondsPerLevel: 20,
  tokenMaxAgeMs: 3 * 60 * 60 * 1000,
  startsPerHour: 30,
  submitsPerHour: 10,
  unknownIpFactor: 10, // shared budget multiplier when no client IP is available
  maxBodyBytes: 1024,
};

const NAME_RE = /^[A-Z0-9 ?]{1,3}$/; // '?' because the game saves blank initials as '???'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SITE_ORIGINS = ['https://dowmad.github.io'];
const LOCAL_ORIGIN_RE = /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?$/;

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

export function corsHeaders(origin) {
  if (!origin || !(SITE_ORIGINS.includes(origin) || LOCAL_ORIGIN_RE.test(origin))) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const ROUTES = { 'GET top': 'top', 'POST start': 'start', 'POST submit': 'submit' };

export function route(method, pathname) {
  if (method === 'OPTIONS') return 'preflight';
  const parts = pathname.split('/').filter(Boolean);
  const action = parts.length >= 2 ? parts[parts.length - 1] : '';
  if (ROUTES[`${method} ${action}`]) return ROUTES[`${method} ${action}`];
  return ['top', 'start', 'submit'].includes(action) ? 'bad_method' : 'not_found';
}

export function parseStart(body) {
  return isPlainObject(body) && Object.keys(body).length === 0;
}

export function parseSubmission(body) {
  if (!isPlainObject(body)) return null;
  if (Object.keys(body).sort().join(',') !== 'level,name,score,token') return null;
  const { token, name, score, level } = body;
  if (typeof token !== 'string' || !UUID_RE.test(token)) return null;
  if (typeof name !== 'string' || !NAME_RE.test(name) || name.trim() === '') return null;
  if (!Number.isInteger(score) || score < 1 || score > 100000000) return null;
  if (!Number.isInteger(level) || level < 1 || level > 1000) return null;
  return { token: token.toLowerCase(), name, score, level };
}

export function plausible({ score, level }, durationS) {
  return score <= LIMITS.pointsPerLevel * level
    && score <= LIMITS.pointsPerSecond * durationS
    && durationS >= LIMITS.secondsPerLevel * (level - 1);
}

// The right-most X-Forwarded-For entry is the one added by the platform's edge;
// anything to its left can be supplied by the caller. (Verified live in Task 4.)
export function clientIp(headers) {
  const entries = (headers.get('x-forwarded-for') || '').split(',').map(s => s.trim()).filter(Boolean);
  return entries.length ? entries[entries.length - 1] : null;
}

export async function ipHash(ip, salt) {
  const bytes = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/leaderboard-rules.test.js`
Expected: PASS, 8 tests. Then run `node --test` to confirm the whole suite still passes.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/leaderboard/rules.mjs tests/leaderboard-rules.test.js
git commit -m "feat(leaderboard): add pure validation, CORS and rate-limit rules"
```

---

### Task 3: Edge Function handler and deploy

**Files:**
- Create: `supabase/functions/leaderboard/index.ts`
- Create: `supabase/functions/leaderboard/deno.json`

**Interfaces:**
- Consumes: everything exported by `rules.mjs` (Task 2), and the tables from Task 1.
- Produces:
  - `GET {URL}/functions/v1/leaderboard/top` returns `200 [{name, score, level, at}]` (at most 10, best first).
  - `POST .../start` with body `{}` returns `200 {token}`.
  - `POST .../submit` with body `{token,name,score,level}` returns `200 {rank}`.
  - Errors: `400 {"error":"rejected"}`, `401` (bad or missing apikey, from withSupabase), `404`, `405`, `413`, `429 {"error":"rate_limited"}`, `500 {"error":"server_error"}`.

- [ ] **Step 1: Write `deno.json`**

```json
{
  "imports": {
    "@supabase/server": "npm:@supabase/server@1.9.2",
    "@supabase/supabase-js": "npm:@supabase/supabase-js@2.120.0"
  }
}
```

- [ ] **Step 2: Write `index.ts`**

```ts
// Spooky Blaster world leaderboard API.
// Deploy with verify_jwt = false: callers send the publishable key in the `apikey`
// header (not a JWT), and withSupabase({ auth: 'publishable' }) validates it.
// All database access uses ctx.supabaseAdmin (secret key, server-side only).
import { withSupabase } from '@supabase/server';
import {
  LIMITS, clientIp, corsHeaders, ipHash, parseStart, parseSubmission, plausible, route,
} from './rules.mjs';

const SALT = Deno.env.get('LEADERBOARD_IP_SALT') ?? '';
const TOO_BIG = Symbol('too big');

const json = (status: number, data: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...extra } });
const rejected = () => json(400, { error: 'rejected' });
const since = (ms: number) => new Date(Date.now() - ms).toISOString();

async function readJson(req: Request): Promise<unknown> {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > LIMITS.maxBodyBytes) return TOO_BIG;
  const text = await req.text();
  if (new TextEncoder().encode(text).length > LIMITS.maxBodyBytes) return TOO_BIG;
  if (text === '') return {};
  try { return JSON.parse(text); } catch { return null; }
}

const api = withSupabase({ auth: 'publishable', cors: 'disabled' }, async (req, ctx) => {
  if (!SALT) return json(500, { error: 'server_error' }); // refuse to run with an unsalted hash
  const db = ctx.supabaseAdmin;
  const action = route(req.method, new URL(req.url).pathname);
  if (action === 'not_found') return json(404, { error: 'not_found' });
  if (action === 'bad_method') return json(405, { error: 'method_not_allowed' });

  if (action === 'top') {
    const { data, error } = await db.from('leaderboard_scores')
      .select('name, score, level, created_at')
      .order('score', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(10);
    if (error) throw error;
    return json(200, data.map(r => ({ name: r.name, score: r.score, level: r.level, at: r.created_at })),
      { 'cache-control': 'public, max-age=30' });
  }

  const body = await readJson(req);
  if (body === TOO_BIG) return json(413, { error: 'too_large' });
  const ip = clientIp(req.headers);
  const budget = ip ? 1 : LIMITS.unknownIpFactor;
  const hash = await ipHash(ip ?? 'unknown', SALT);

  if (action === 'start') {
    if (!parseStart(body)) return rejected();
    const { count, error: countError } = await db.from('leaderboard_runs')
      .select('token', { count: 'exact', head: true })
      .eq('ip_hash', hash).gte('started_at', since(60 * 60 * 1000));
    if (countError) throw countError;
    if ((count ?? 0) >= LIMITS.startsPerHour * budget) return json(429, { error: 'rate_limited' });
    const { error: purgeError } = await db.from('leaderboard_runs').delete().lt('started_at', since(24 * 60 * 60 * 1000));
    if (purgeError) throw purgeError;
    const { data, error } = await db.from('leaderboard_runs').insert({ ip_hash: hash }).select('token').single();
    if (error) throw error;
    return json(200, { token: data.token });
  }

  // submit
  const sub = parseSubmission(body);
  if (!sub) return rejected();
  const { count, error: countError } = await db.from('leaderboard_scores')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', hash).gte('created_at', since(60 * 60 * 1000));
  if (countError) throw countError;
  if ((count ?? 0) >= LIMITS.submitsPerHour * budget) return json(429, { error: 'rate_limited' });

  // Consume the token atomically: only an unused, unexpired token matches.
  const { data: run, error: runError } = await db.from('leaderboard_runs')
    .update({ used_at: new Date().toISOString() })
    .eq('token', sub.token).is('used_at', null).gte('started_at', since(LIMITS.tokenMaxAgeMs))
    .select('started_at').maybeSingle();
  if (runError) throw runError;
  if (!run) return rejected();

  const durationS = Math.floor((Date.now() - Date.parse(run.started_at)) / 1000);
  if (!plausible(sub, durationS)) {
    console.warn('implausible score', { score: sub.score, level: sub.level, durationS });
    return rejected();
  }

  const { error: insertError } = await db.from('leaderboard_scores').insert({
    name: sub.name, score: sub.score, level: sub.level, duration_s: durationS, ip_hash: hash,
  });
  if (insertError) throw insertError;
  const { count: better, error: rankError } = await db.from('leaderboard_scores')
    .select('id', { count: 'exact', head: true }).gt('score', sub.score);
  if (rankError) throw rankError;
  return json(200, { rank: (better ?? 0) + 1 });
});

export default {
  async fetch(req: Request): Promise<Response> {
    const cors = corsHeaders(req.headers.get('origin'));
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let res: Response;
    try {
      res = await api(req);
    } catch (err) {
      console.error('leaderboard error', (err as Error)?.message ?? String(err));
      res = json(500, { error: 'server_error' });
    }
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  },
};
```

- [ ] **Step 3: Deploy.** Call `mcp__plugin_supabase_supabase__deploy_edge_function` with name `leaderboard`, entrypoint `index.ts`, `verify_jwt: false`, and the three files `index.ts`, `rules.mjs` and `deno.json` (with `deno.json` as the import map if the tool takes one). Expected: the deploy succeeds, and `get_edge_function` shows `verify_jwt: false`.

- [ ] **Step 4: Quick live check**

```bash
URL=https://<ref>.supabase.co/functions/v1/leaderboard KEY=<sb_publishable_key>
curl -s -w "\n%{http_code}\n" "$URL/top" -H "apikey: $KEY"
curl -s -o /dev/null -w "%{http_code}\n" "$URL/top"
```

Expected: `[]` then `200`, and `401` for the request without a key. If the first call returns 500, check `get_logs` (service `edge-function`) and fix the cause before going on.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/leaderboard/index.ts supabase/functions/leaderboard/deno.json
git commit -m "feat(leaderboard): add Edge Function for top, start and submit"
```

---

### Task 4: Live checks, IP-header verification and advisors

**Files:**
- Create: `scripts/leaderboard-smoke.sh`

**Interfaces:**
- Consumes: the deployed function (Task 3).

- [ ] **Step 1: Write the smoke script**

```bash
#!/usr/bin/env bash
# Live checks for the deployed leaderboard function. Writes test rows named 'ZZT';
# clean up afterwards with: delete from public.leaderboard_scores where name = 'ZZT';
# Usage: URL=https://<ref>.supabase.co/functions/v1/leaderboard KEY=sb_publishable_... scripts/leaderboard-smoke.sh
set -u
: "${URL:?set URL}" "${KEY:?set KEY}"
fails=0
expect() { # expect <label> <wanted-status> <curl args...>
  local label=$1 want=$2; shift 2
  local got; got=$(curl -s -o /tmp/lb_body -w "%{http_code}" "$@")
  if [ "$got" = "$want" ]; then echo "ok   $label ($got)"; else echo "FAIL $label: wanted $want, got $got: $(cat /tmp/lb_body)"; fails=$((fails+1)); fi
}
post() { curl -s "$URL/$1" -H "apikey: $KEY" -H "content-type: application/json" -d "$2"; }
token() { post start '{}' | sed -n 's/.*"token":"\([^"]*\)".*/\1/p'; }

expect "top without key"            401 "$URL/top"
expect "top"                        200 "$URL/top" -H "apikey: $KEY"
expect "unknown route"              404 "$URL/admin" -H "apikey: $KEY"
expect "wrong method"               405 -X DELETE "$URL/top" -H "apikey: $KEY"
expect "start with junk body"       400 "$URL/start" -H "apikey: $KEY" -H "content-type: application/json" -d '{"a":1}'
expect "oversized body"             413 "$URL/submit" -H "apikey: $KEY" -H "content-type: application/json" -d "$(head -c 2000 /dev/zero | tr '\0' 'x')"

T=$(token); sleep 2
expect "valid submit"               200 "$URL/submit" -H "apikey: $KEY" -H "content-type: application/json" -d "{\"token\":\"$T\",\"name\":\"ZZT\",\"score\":100,\"level\":1}"
expect "reused token"               400 "$URL/submit" -H "apikey: $KEY" -H "content-type: application/json" -d "{\"token\":\"$T\",\"name\":\"ZZT\",\"score\":100,\"level\":1}"
expect "unknown token"              400 "$URL/submit" -H "apikey: $KEY" -H "content-type: application/json" -d '{"token":"00000000-0000-4000-8000-000000000000","name":"ZZT","score":100,"level":1}'
T=$(token)
expect "too fast for level 5"       400 "$URL/submit" -H "apikey: $KEY" -H "content-type: application/json" -d "{\"token\":\"$T\",\"name\":\"ZZT\",\"score\":100,\"level\":5}"
T=$(token); sleep 2
expect "too many points per second" 400 "$URL/submit" -H "apikey: $KEY" -H "content-type: application/json" -d "{\"token\":\"$T\",\"name\":\"ZZT\",\"score\":99999,\"level\":1}"
T=$(token)
expect "bad name"                   400 "$URL/submit" -H "apikey: $KEY" -H "content-type: application/json" -d "{\"token\":\"$T\",\"name\":\"zz\",\"score\":100,\"level\":1}"
expect "extra field"                400 "$URL/submit" -H "apikey: $KEY" -H "content-type: application/json" -d "{\"token\":\"$T\",\"name\":\"ZZT\",\"score\":100,\"level\":1,\"x\":1}"

cors=$(curl -s -o /dev/null -D - -X OPTIONS "$URL/submit" -H "Origin: https://dowmad.github.io" | tr -d '\r' | grep -i '^access-control-allow-origin:')
[ "$cors" = "access-control-allow-origin: https://dowmad.github.io" ] && echo "ok   CORS for the game site" || { echo "FAIL CORS for the game site: '$cors'"; fails=$((fails+1)); }
cors=$(curl -s -o /dev/null -D - -X OPTIONS "$URL/submit" -H "Origin: https://evil.example" | tr -d '\r' | grep -ci '^access-control-allow-origin:')
[ "$cors" = "0" ] && echo "ok   no CORS for other sites" || { echo "FAIL CORS leaked to another origin"; fails=$((fails+1)); }

# Last, because it uses up this machine's hourly start budget
got=200; for i in $(seq 1 35); do got=$(curl -s -o /dev/null -w "%{http_code}" "$URL/start" -H "apikey: $KEY" -H "content-type: application/json" -d '{}'); [ "$got" = 429 ] && break; done
[ "$got" = 429 ] && echo "ok   start rate limit (429)" || { echo "FAIL start was never rate limited"; fails=$((fails+1)); }

echo "$fails failure(s)"; exit $fails
```

- [ ] **Step 2: Run it**

Run: `chmod +x scripts/leaderboard-smoke.sh && URL=... KEY=... scripts/leaderboard-smoke.sh`
Expected: every line `ok`, ending `0 failure(s)`.

- [ ] **Step 3: Verify the client IP can't be spoofed.** Note the newest `ip_hash` in `runs` after the smoke run (`select ip_hash from public.leaderboard_runs order by started_at desc limit 1;` with `execute_sql`). Wait for the hourly window to clear (or clear the test runs with `delete from public.leaderboard_runs where started_at > now() - interval '1 hour';`), then:

```bash
curl -s "$URL/start" -H "apikey: $KEY" -H "content-type: application/json" -H "x-forwarded-for: 198.51.100.7" -d '{}'
curl -s "$URL/start" -H "apikey: $KEY" -H "content-type: application/json" -H "x-forwarded-for: 198.51.100.8" -d '{}'
```

Then run `select ip_hash from public.leaderboard_runs order by started_at desc limit 3;`.
Expected: all three hashes are **identical** (the spoofed values were ignored). If they differ, `clientIp` is reading a caller-controlled entry. Then:
  - Look for a platform-set header instead: repeat with `-H "cf-connecting-ip: 198.51.100.7"`. If that one is not overridable either, change `clientIp` to read it (test first in `tests/leaderboard-rules.test.js`).
  - If neither header is trustworthy, make `clientIp` return `null`. Every caller then shares the `unknownIpFactor` budget, which is the spec's fallback.
  - Redeploy, and re-run this step.

- [ ] **Step 4: Run the advisors.** `get_advisors` type `security`, then `performance`. Accept only the INFO "RLS enabled, no policy" items for `runs` and `scores`; fix anything else.

- [ ] **Step 5: Clean up the test rows**

```sql
delete from public.leaderboard_scores where name = 'ZZT';
delete from public.leaderboard_runs where started_at > now() - interval '1 day';
```

- [ ] **Step 6: Commit**

```bash
git add scripts/leaderboard-smoke.sh supabase/functions/leaderboard
git commit -m "test(leaderboard): add live smoke checks; verify client IP handling"
```

---

### Task 5: Client network module (`Leaderboard.world`)

**Files:**
- Modify: `js/leaderboard.js` (the whole file is shown below)
- Modify: `tests/game.test.js` (harness: `fetch` option, `flush` helper; new tests)

**Interfaces:**
- Consumes: the endpoints from Task 3.
- Produces:
  - `Leaderboard.world.top`: `null | Array<{name, score, level}>` (last good fetch, at most 10)
  - `Leaderboard.world.refresh(force?: boolean): Promise<top>` (throttled to once a minute unless `force`)
  - `Leaderboard.world.qualifies(score: number): boolean`
  - `Leaderboard.world.startRun(): Promise<string|null>`
  - `Leaderboard.world.submit(token, name, score, level): Promise<number|null>` (rank, or null)
  - `Leaderboard.hiScore()` now returns `max(local best, world best)`.

- [ ] **Step 1: Extend the harness.** In `tests/game.test.js`, change `boot` to accept a fetch stub and expose a `flush` helper:

```js
// Boots a fresh Halloween game sitting on the title screen. `phone` fakes a touchscreen;
// `fetch` stands in for the network (default: offline).
async function boot({ phone = false, fetch = () => Promise.reject(new Error('offline')) } = {}) {
```

Add to the `sandbox` object:

```js
    fetch, AbortController, clearTimeout,
```

Add `flush` next to the other helpers in `boot` and return it:

```js
  // Let pending network promises settle
  const flush = () => new Promise(r => setImmediate(r));
```

```js
  return { ...game, Input, key, finger, tap, run, play, catUnderShip, errors, flush, context: sandbox };
```

Add a fake-server helper at the top level of the file:

```js
// A fake leaderboard server: routes by the last path segment and records each request
function fakeServer(routes) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    const action = url.split('/').pop();
    calls.push({ action, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : undefined });
    const reply = routes[action];
    if (!reply) return { ok: false, status: 404, json: async () => ({}) };
    const [status, data] = typeof reply === 'function' ? reply(calls[calls.length - 1]) : reply;
    return { ok: status >= 200 && status < 300, status, json: async () => data };
  };
  return { fetch, calls };
}
```

- [ ] **Step 2: Write the failing tests** (append to `tests/game.test.js`)

```js
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test tests/game.test.js`
Expected: the six new tests FAIL with `Cannot read properties of undefined (reading 'refresh')` or similar. The older tests still pass.

- [ ] **Step 4: Implement.** Replace `js/leaderboard.js` with the following. The local part is unchanged apart from `hiScore`. Fill in `WORLD_URL` and `WORLD_KEY` from Task 0 Step 4 (both are public by design).

```js
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
  const WORLD_URL = 'https://<ref>.supabase.co/functions/v1/leaderboard';
  const WORLD_KEY = 'sb_publishable_<from Task 0 Step 4>';
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test`
Expected: all pass, including the 6 new tests.

- [ ] **Step 6: Commit**

```bash
git add js/leaderboard.js tests/game.test.js
git commit -m "feat(leaderboard): add world leaderboard network client"
```

---

### Task 6: Game integration

**Files:**
- Modify: `js/game.js`: `newGame` (~line 286), `updateTitle`, `updateGameOver` (~line 961), `updateEnterName` save (~line 1002), `updateLeaderboard`, `drawTitle` table page (~line 1320), `drawLeaderboardTable` (~line 1378), the `leaderboard` render case (~line 1484)
- Modify: `tests/game.test.js`

**Interfaces:**
- Consumes: `Leaderboard.world.{top, refresh, qualifies, startRun, submit}` (Task 5).
- Produces: game state `G.runId: number`, `G.runToken: string|null`, `G.worldRank: null | 'pending' | 'failed' | number`.

- [ ] **Step 1: Write the failing tests** (append to `tests/game.test.js`)

```js
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
  const t = await boot();
  reachInitials(t);
  t.key('keydown', 'Enter');
  t.run(1 / 60);
  await t.flush();
  assert.equal(t.G.worldRank, 'failed');
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/game.test.js`
Expected: the new tests FAIL (for example, `worldRank` is `undefined`, or the state is `leaderboard` instead of `entername`).

- [ ] **Step 3: Implement.** In `js/game.js`:

`G` initial state: add `runId: 0, runToken: null, worldRank: null,` to the object literal (next to `cat: null, ...`).

`newGame()`: after `G.ultCharge = 0;` add:

```js
    // Ask the world leaderboard for a run token in the background; a late reply is
    // ignored if another game has started since
    const run = ++G.runId;
    G.runToken = null;
    G.worldRank = null;
    Leaderboard.world.startRun().then(token => { if (G.runId === run) G.runToken = token; });
```

`updateTitle()`: add `Leaderboard.world.refresh();` as the first line (throttled internally to once a minute).

`updateGameOver()`: change `if (Leaderboard.qualifies(G.score)) {` to:

```js
      if (Leaderboard.qualifies(G.score) || Leaderboard.world.qualifies(G.score)) {
```

`updateEnterName()`: replace the save block

```js
      G.lastRank = Leaderboard.add(name, G.score, G.level);
```

with

```js
      G.lastRank = Leaderboard.add(name, G.score, G.level);
      submitWorld(name);
```

and add this function next to `updateEnterName`:

```js
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
      if (rank) Leaderboard.world.refresh(true);
    });
  }
```

`drawLeaderboardTable`: change it to take the list and highlighted row:

```js
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
```

(The rest of the loop body is unchanged.) Add a helper above it that picks world or local:

```js
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
```

`drawTitle()` table page: replace `drawLeaderboardTable('HIGH SCORES');` with `drawBestTable(false);`.

The `leaderboard` render case: replace `drawLeaderboardTable('HIGH SCORES');` with:

```js
        drawBestTable(true);
        if (G.worldRank === 'pending') text('SUBMITTING...', W / 2, H - 90, 10, '#aaaaaa');
        else if (G.worldRank === 'failed') text('NOT SUBMITTED - SAVED ON THIS DEVICE', W / 2, H - 90, 8, '#ff9933');
        else if (typeof G.worldRank === 'number') text(`WORLD RANK #${G.worldRank}`, W / 2, H - 90, 12, '#ffee33');
```

`updateLeaderboard()`: add `Leaderboard.world.refresh();` as the first line.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test`
Expected: all tests pass. Run it 3 times to check for flakiness.

- [ ] **Step 5: Commit**

```bash
git add js/game.js tests/game.test.js
git commit -m "feat(leaderboard): show world top 10 and submit runs from the game"
```

---

### Task 7: End-to-end check in a real browser

**Files:** none (verification only)

- [ ] **Step 1: Serve locally and play a short game against the live function.** Start a server with `python3 -m http.server 8765 --bind 127.0.0.1` (allowed by the CORS rules). Open `http://127.0.0.1:8765/index.html` with the Playwright tools.
  - Wait 10 seconds on the title screen and screenshot the table page. It must say **WORLD TOP 10** (empty rows are fine).
  - Start a game and wait at least 3 seconds (so play time is plausible for level 1).
  - Force a game over with a small score via `browser_evaluate`: set `G.score = 500` and `G.lives = 1`, push an enemy bullet onto the player, and set `G.player.invuln = 0`.
  - Enter initials `ZZT` and save.
  - Expected: the leaderboard screen shows `WORLD RANK #n`, and the world table lists `ZZT 000500`. The console shows no errors apart from the favicon 404.

- [ ] **Step 2: Offline check.** Use Playwright to block `*.supabase.co`, reload, and wait 10 seconds. The title table must say **HIGH SCORES (OFFLINE)**, and a full game plus initials save must work, ending with `NOT SUBMITTED - SAVED ON THIS DEVICE`.

- [ ] **Step 3: Clean up.** Run `delete from public.leaderboard_scores where name = 'ZZT';` with `execute_sql`, stop the server, close the browser, and remove `.playwright-mcp/`.

- [ ] **Step 4: Final checks.** Run `node --test` (all pass), then `get_advisors` security and performance (only the documented INFO items). Then hand off with superpowers:finishing-a-development-branch.
