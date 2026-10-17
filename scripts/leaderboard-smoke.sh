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
