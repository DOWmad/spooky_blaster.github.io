# Global Leaderboard Design

Date: 2026-10-17
Status: draft, awaiting review

## Goal

Add a public world top-10 leaderboard to Spooky Blaster (served from GitHub Pages), while keeping the existing local leaderboard working offline. The audience is **public but casual**: fake scores should take real effort, impossible scores should be rejected, and moderation should be easy. Perfect cheat-proofing is out of scope.

## Decisions made during brainstorming

| Decision | Choice |
|---|---|
| Audience | Public, casual: plausibility checks plus easy moderation |
| Backend | Supabase |
| Project | A **new dedicated Supabase project**. The org is on the free plan with both active slots in use (HashtagWild, scrabble), so before setup the owner must either pause one of those or upgrade. Nothing is paused without the owner naming which. |
| Write path | **Edge Function**, not an anonymous `SECURITY DEFINER` RPC. Changed from the first proposal after checking Supabase guidance (see Security). |

## Architecture

```
Browser (GitHub Pages)                    Supabase project
------------------------                  -----------------------------------------
js/leaderboard.js  --fetch, apikey: sb_publishable_...-->  Edge Function `leaderboard`
                                                             | verify_jwt = false
                                                             | withSupabase({ auth: 'publishable' })
                                                             | validates, rate-limits
                                                             v  (secret key, server-side only)
                                                           public.runs, public.scores
                                                             RLS on, no anon/authenticated grants
```

- The browser never talks to the tables. Its only door is the Edge Function.
- The Edge Function uses the project's **secret key** (auto-provisioned in the function environment as `SUPABASE_SECRET_KEYS`) through `ctx.supabaseAdmin`. That key never appears in the repo or the browser.
- The browser uses the **publishable key** (`sb_publishable_...`), sent only in the `apikey` header (never as `Authorization: Bearer`, which the platform rejects for the new keys). The publishable key is public by design; it identifies the app, it does not protect data.

### Edge Function endpoints (one function, `leaderboard`)

| Method and path | Purpose | Request | Response |
|---|---|---|---|
| `GET /leaderboard/top` | World top 10 | none | `[{ name, score, level, at }]`, 10 rows max |
| `POST /leaderboard/start` | Begin a run, get a one-time token | `{}` | `{ token }` |
| `POST /leaderboard/submit` | Submit a finished run | `{ token, name, score, level }` | `{ rank }` (1-based world rank) or an error |

- Only `GET`, `POST` and `OPTIONS` are allowed; anything else gets 405.
- Request bodies over 1 KB are rejected (413). Unknown fields are rejected (400).
- Responses never include internal IDs, IP hashes or timestamps beyond `at` (the score's date).
- CORS: `Access-Control-Allow-Origin` is the GitHub Pages origin (`https://dowmad.github.io`), plus `http://127.0.0.1:*` / `http://localhost:*` origins for local testing. Other origins get no CORS headers. This doesn't stop scripted abuse (the server-side checks do); it stops other websites from using the endpoint from their visitors' browsers.

## Data model

Both tables live in `public` but are **not exposed to the Data API**: since the 2026-04-28 platform change, new tables aren't exposed by default, and this design additionally revokes all privileges from `anon` and `authenticated` explicitly and grants only what the Edge Function's `service_role` needs.

```sql
create table public.runs (
  token      uuid primary key default gen_random_uuid(), -- unguessable one-time token
  ip_hash    text not null,                               -- salted SHA-256, never the raw IP
  started_at timestamptz not null default now(),
  used_at    timestamptz                                  -- set once, when the score is submitted
);
create index runs_ip_hash_started_at_idx on public.runs (ip_hash, started_at);
create index runs_started_at_idx on public.runs (started_at);

create table public.scores (
  id         bigint generated always as identity primary key,
  name       text not null check (name ~ '^[A-Z0-9 ]{1,3}$' and btrim(name) <> ''),
  score      integer not null check (score between 1 and 100000000),
  level      integer not null check (level between 1 and 1000),
  duration_s integer not null check (duration_s >= 0),   -- server-measured play time
  ip_hash    text not null,
  created_at timestamptz not null default now()
);
create index scores_score_created_at_idx on public.scores (score desc, created_at);
create index scores_ip_hash_created_at_idx on public.scores (ip_hash, created_at);

alter table public.runs enable row level security;
alter table public.scores enable row level security;
-- No policies: deny-all for anon/authenticated (defense in depth on top of the revokes).

revoke all on public.runs, public.scores from anon, authenticated, public;
grant select, insert, update, delete on public.runs to service_role;
grant select, insert, delete on public.scores to service_role;
```

Notes:
- `uuid` v4 for the token is deliberate: it must be unguessable, and the table stays tiny because old runs are purged, so index fragmentation doesn't matter.
- The `check` constraints repeat the Edge Function's input rules so bad data can't get in even if the function has a bug.
- The advisor will report "RLS enabled, no policy" (INFO) for both tables. That is intentional (deny-all) and will be noted, not "fixed" with a permissive policy.

## Anti-cheat and abuse rules (enforced in the Edge Function)

1. **One-time run tokens.** `start` creates a run and returns its token. `submit` consumes it atomically: `update runs set used_at = now() where token = $1 and used_at is null and started_at > now() - interval '3 hours' returning started_at`. No row means the token is unknown, already used or expired, and the request is rejected.
2. **Server-measured play time.** `duration_s = now() - started_at`, from the database clock. The client never sends a duration.
3. **Plausibility limits.** All limits live in one constants block in the function, deliberately generous at launch and tightened once real scores exist:
   - `score <= 250000 * level` (most points a level can realistically yield, with headroom)
   - `score <= 5000 * duration_s` (points per second)
   - `duration_s >= 20 * (level - 1)` (no level clears faster than about 20 s)
4. **Input validation.** `name` is 1 to 3 characters from `A-Z`, `0-9` and space, not all spaces. `score` and `level` are integers within the table limits. Anything else gets 400.
5. **Rate limits, per salted IP hash.** Up to 30 `start` calls and 10 accepted submissions per hour. Over the limit gets 429. The hash uses SHA-256 with a secret salt stored as the Edge Function secret `IP_HASH_SALT`. Raw IPs are never stored or logged. Which request header carries the real client IP on Supabase Edge Functions will be confirmed against current docs during implementation; if no trustworthy header exists, the rate limit falls back to a global per-minute cap.
6. **Housekeeping.** `start` also deletes runs older than 24 hours (an indexed range delete), so no cron extension is needed.
7. **Moderation.** The owner deletes bad rows in the Supabase dashboard's Table Editor (`scores`). No admin endpoint.

Error responses are short and generic (`{"error":"rejected"}`, `{"error":"rate_limited"}`). Validation details are logged server-side without IP or key material, so the response doesn't teach a cheater which limit they hit.

## Security checklist (from the Supabase skill)

- **No anonymous `SECURITY DEFINER` functions.** Advisor lint `0028_anon_security_definer_function_executable` flags these; this design has no database functions callable by `anon`.
- **Secret key stays server-side.** It is only in the Edge Function environment, never in the repo, browser code or logs.
- **Publishable key, not the legacy `anon` key**, in client code. Legacy keys stop working at the end of 2026.
- **RLS enabled on every table**, explicit revokes from `anon`/`authenticated`/`public`, and least-privilege grants to `service_role`.
- **`verify_jwt = false`** is required for publishable-key callers; the function authorizes callers itself via `withSupabase({ auth: 'publishable' })`.
- **Pinned dependencies.** `npm:@supabase/server@<exact version>` (the supabase-js version it uses is pinned too). Versions are chosen at implementation time from the current release.
- **Advisors.** Run the security and performance advisors after the schema is applied and after the function is deployed. Fix every finding except the documented intentional ones.
- **XSS.** Names are drawn on the canvas with `fillText`, never inserted into HTML, so a malicious name can't inject markup. The name regex blocks odd characters regardless.
- **Privacy.** Only salted IP hashes are stored; runs and their hashes are purged after 24 hours. Score rows keep the hash for rate limiting.

## Game integration (client)

All network code lives in `js/leaderboard.js`, next to the existing local leaderboard.

- **Config:** the project URL and publishable key are constants at the top of `js/leaderboard.js`.
- **`Leaderboard.world`:** `fetchTop()`, `startRun()` and `submit(name, score, level)`. Each uses `fetch` with a 5-second timeout (`AbortController`) and resolves to `null` on any failure. It never throws into the game loop.
- **Flow:**
  - On the title screen, fetch the world top 10, and refresh it whenever the title screen is shown, at most once a minute.
  - When a game starts, call `startRun()` in the background and keep the token. If it fails, the run simply can't be submitted to the world board.
  - At game over, initials entry appears if the score makes the **world or local** top 10. Saving writes locally right away and submits to the world board in the background.
  - When the submit result arrives, the leaderboard screen shows the world rank, or a small "NOT SUBMITTED" note if it was rejected or offline.
- **Display:** the title-screen score table shows **WORLD TOP 10**. With no network data it shows the local table titled **HIGH SCORES (OFFLINE)**. The in-game HI score shows the higher of the local and world best.
- **No blocking:** gameplay never waits on the network, and the local leaderboard behaves exactly as today.

## Testing

- **Client (headless `node --test` harness):** a stubbed `fetch` covers the online top 10, the offline fallback, a timeout, rejected and accepted submits, and initials entry being offered for a world-only qualifying score.
- **Edge Function:** run locally if the Supabase CLI is available, otherwise against the deployed function with `curl`. Cases:
  - a valid run is accepted
  - a reused token, unknown token or expired token is rejected
  - a too-fast run, too many points per second or too many points per level is rejected
  - a bad name, extra fields or an oversized body is rejected
  - the rate limit returns 429
  - a disallowed method returns 405
  - the CORS headers are present for the Pages origin and absent for others
- **Database:** confirm with SQL that `anon`/`authenticated` can't select from or insert into either table (a direct REST request with the publishable key must fail), and that the check constraints reject bad rows.
- **Advisors:** they must come back clean apart from the documented intentional INFO items.

## Setup steps that need the owner

1. Free a free-plan slot (pause a named project) or upgrade, then approve creating the `spooky-blaster` project, in a region near the owner (e.g. eu-west-2).
2. Confirm the project's new publishable/secret API keys exist (create the default pair if the dashboard offers it).
3. Set the `IP_HASH_SALT` function secret (Claude can generate a random value; the owner pastes it into the dashboard or allows Claude to set it).

## Out of scope

- Player accounts and sign-in
- Per-country or per-period (daily/weekly) boards
- Replay or input verification (cheat-proof scoring)
- Showing ranks beyond the top 10 (beyond the rank returned on submit)
- An in-game admin or moderation UI
