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
