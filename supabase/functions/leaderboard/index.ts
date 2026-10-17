// Spooky Blaster world leaderboard API.
// Deploy with verify_jwt = false: callers send the publishable key in the `apikey`
// header (not a JWT), and withSupabase({ auth: 'publishable' }) validates it.
// All database access uses ctx.supabaseAdmin (secret key, server-side only).
import { withSupabase } from '@supabase/server';
import {
  LIMITS, clientIp, corsHeaders, ipHash, parseStart, parseSubmission, plausible, route, startVerdict,
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
    const hourAgo = since(60 * 60 * 1000);
    const [mine, everyone] = await Promise.all([
      db.from('leaderboard_runs').select('token', { count: 'exact', head: true }).eq('ip_hash', hash).gte('started_at', hourAgo),
      db.from('leaderboard_runs').select('token', { count: 'exact', head: true }).gte('started_at', hourAgo),
    ]);
    if (mine.error) throw mine.error;
    if (everyone.error) throw everyone.error;
    if (startVerdict({ mine: mine.count ?? 0, everyone: everyone.count ?? 0 }, budget) !== 'ok') {
      return json(429, { error: 'rate_limited' });
    }
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
