// Pure rules for the leaderboard Edge Function: no I/O, so Node unit-tests them and
// the Deno function imports them unchanged. Limits are generous at launch; tighten
// them once real scores show what's normal.

export const LIMITS = {
  pointsPerLevel: 250000,
  pointsPerLevelSquared: 6000, // level bonuses (clear, perfect, boss) grow with the level, so totals grow ~L²
  pointsPerSecond: 5000,
  secondsPerLevel: 20,
  tokenMaxAgeMs: 3 * 60 * 60 * 1000,
  startsPerHour: 30,
  globalStartsPerHour: 3000, // ceiling for everyone combined: bounds table growth if per-IP limits are dodged
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
  return score <= LIMITS.pointsPerLevel * level + LIMITS.pointsPerLevelSquared * level * level
    && score <= LIMITS.pointsPerSecond * durationS
    && durationS >= LIMITS.secondsPerLevel * (level - 1);
}

// Cloudflare (in front of Supabase Edge Functions) sets cf-connecting-ip to the real client
// and rejects requests that try to supply it; X-Forwarded-For's last entry is an internal
// hop and its first entries are caller-controlled. Verified live (Task 4).
export function clientIp(headers) {
  const ip = (headers.get('cf-connecting-ip') || '').trim().toLowerCase();
  if (!ip) return null;
  return ip.includes(':') ? ipv6Prefix64(ip) : ip;
}

// One IPv6 customer usually holds a whole /64, so budgets are per /64, not per address
function ipv6Prefix64(ip) {
  const [head, tail] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return `${groups.slice(0, 4).map(g => (parseInt(g, 16) || 0).toString(16)).join(':')}::/64`;
}

export function startVerdict({ mine, everyone }, budget) {
  if (everyone >= LIMITS.globalStartsPerHour) return 'rate_limited';
  return mine >= LIMITS.startsPerHour * budget ? 'rate_limited' : 'ok';
}

export async function ipHash(ip, salt) {
  const bytes = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
