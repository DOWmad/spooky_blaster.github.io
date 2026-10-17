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
  assert.equal(plausible({ score: 256001, level: 1 }, 10000), false, 'too many points for the level (250000·L + 6000·L²)');
  assert.equal(plausible({ score: 256000, level: 1 }, 10000), true);
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

test('client IP comes from cf-connecting-ip, never from caller-controlled X-Forwarded-For', async () => {
  const { clientIp } = await load();
  // Verified live: Cloudflare sets cf-connecting-ip and rejects requests that try to supply it;
  // X-Forwarded-For's right-most entry is a per-request internal hop.
  assert.equal(clientIp(new Headers({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.7, 10.0.0.1' })), '203.0.113.9');
  assert.equal(clientIp(new Headers({ 'cf-connecting-ip': ' 203.0.113.9 ' })), '203.0.113.9');
  assert.equal(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.9' })), null, 'no platform header: shared budget');
  assert.equal(clientIp(new Headers()), null);
  assert.equal(clientIp(new Headers({ 'cf-connecting-ip': '  ' })), null);
});

test('IP hashes are salted SHA-256 hex', async () => {
  const { ipHash } = await load();
  const a = await ipHash('203.0.113.9', 'salt1');
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(await ipHash('203.0.113.9', 'salt1'), a);
  assert.notEqual(await ipHash('203.0.113.9', 'salt2'), a);
  assert.notEqual(await ipHash('203.0.113.8', 'salt1'), a);
});

test('IPv6 clients are grouped by their /64, so rotating addresses inside it share one budget', async () => {
  const { clientIp } = await load();
  const a = clientIp(new Headers({ 'cf-connecting-ip': '2001:db8:abcd:12:1:2:3:4' }));
  const b = clientIp(new Headers({ 'cf-connecting-ip': '2001:DB8:ABCD:0012:ffff::9' }));
  assert.equal(a, '2001:db8:abcd:12::/64');
  assert.equal(b, a);
  assert.equal(clientIp(new Headers({ 'cf-connecting-ip': '2001:db8::1' })), '2001:db8:0:0::/64');
  assert.notEqual(clientIp(new Headers({ 'cf-connecting-ip': '2001:db8:abcd:13::1' })), a);
  assert.equal(clientIp(new Headers({ 'cf-connecting-ip': '203.0.113.9' })), '203.0.113.9', 'IPv4 unchanged');
});

test('starts are refused past a global hourly ceiling, whatever the per-IP count', async () => {
  const { startVerdict, LIMITS } = await load();
  assert.equal(startVerdict({ mine: 0, everyone: 0 }, 1), 'ok');
  assert.equal(startVerdict({ mine: LIMITS.startsPerHour, everyone: 10 }, 1), 'rate_limited');
  assert.equal(startVerdict({ mine: LIMITS.startsPerHour, everyone: 10 }, LIMITS.unknownIpFactor), 'ok');
  assert.equal(startVerdict({ mine: 0, everyone: LIMITS.globalStartsPerHour }, 1), 'rate_limited');
});

test('the score cap keeps up with the game, whose bonuses grow with the square of the level', async () => {
  const { plausible } = await load();
  // Level 30 (loop 5): per-level clear/perfect/boss bonuses alone are ~11000*L, so ~5M cumulative
  assert.equal(plausible({ score: 8000000, level: 30 }, 3000), true, 'a strong level-30 run is accepted');
  assert.equal(plausible({ score: 30000000, level: 30 }, 100000), false, 'far beyond anything reachable at level 30');
});
