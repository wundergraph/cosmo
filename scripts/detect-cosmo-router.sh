#!/usr/bin/env bash
# detect-cosmo-router.sh
#
# Black-box fingerprint check for a single host: is it (probably) a Cosmo Router?
#
# This is an *authorized footprint / exposure* tool. Only run it against hosts
# you own or are explicitly authorized to test. It makes a handful of benign
# HTTP requests (the same a browser/health-checker would) and scores the result.
#
# Usage:   ./detect-cosmo-router.sh https://playground.dev.kompass.gg
#          ./detect-cosmo-router.sh example.com           # defaults to https://
#
# Exit code 0 = looks like Cosmo Router (score >= 3), 1 = inconclusive/no.

set -uo pipefail

raw="${1:?usage: detect-cosmo-router.sh <host-or-url>}"
case "$raw" in
  http://*|https://*) base="$raw" ;;
  *) base="https://$raw" ;;
esac
base="${base%/}"

curl_opts=(-sS -m 12 --max-redirs 3)
score=0
hits=()

note() { hits+=("  [+] $1"); score=$((score + ${2:-1})); }

# 1) Health trio: /health, /health/live, /health/ready all 200 text/plain "OK"
ok=0
for p in health health/live health/ready; do
  IFS='|' read -r code ctype clen < <(curl "${curl_opts[@]}" -o /dev/null \
    -w '%{http_code}|%{content_type}|%{size_download}' "$base/$p" 2>/dev/null)
  [[ "$code" == "200" && "$ctype" == text/plain* && "$clen" == "2" ]] && ok=$((ok+1))
done
[[ $ok -eq 3 ]] && note "health trio /health{,/live,/ready} -> 200 text/plain (2 bytes)" 2

# 2) GET /graphql with empty body -> 400 {"errors":[{"message":"empty request body"}]}
body=$(curl "${curl_opts[@]}" "$base/graphql" 2>/dev/null)
hdrs=$(curl "${curl_opts[@]}" -D - -o /dev/null "$base/graphql" 2>/dev/null)
if grep -qi 'empty request body' <<<"$body"; then
  note 'GET /graphql -> "empty request body" error (Cosmo operation_processor)' 3
fi
grep -qiE 'cache-control:.*no-store, no-cache, must-revalidate' <<<"$hdrs" \
  && note "/graphql sets cache-control no-store,no-cache,must-revalidate" 1

# 3) POST {__typename} -> 200, and (if rate limiting on) extensions.rateLimit shape
post=$(curl "${curl_opts[@]}" -X POST "$base/graphql" \
  -H 'Content-Type: application/json' -d '{"query":"{__typename}"}' 2>/dev/null)
grep -q '"data":{"__typename":"Query"}' <<<"$post" \
  && note "POST {__typename} -> {\"data\":{\"__typename\":\"Query\"}}" 1
grep -qE '"rateLimit":\{.*"retryAfterMs".*"resetAfterMs"' <<<"$post" \
  && note "extensions.rateLimit shape (requestRate/remaining/retryAfterMs/resetAfterMs)" 2

# 4) Playground HTML at / -> "WunderGraph Playground" (needs browser-ish Accept)
home=$(curl "${curl_opts[@]}" -A 'Mozilla/5.0' -H 'Accept: text/html' "$base/" 2>/dev/null)
grep -qi '<title>WunderGraph Playground</title>' <<<"$home" \
  && note "playground served at / (<title>WunderGraph Playground</title>)" 2

# 5) Subscriptions: multipart/mixed; subscriptionSpec=1.0; boundary=graphql
subhdr=$(curl "${curl_opts[@]}" -D - -o /dev/null -X POST "$base/graphql?wg_sse" \
  -H 'Content-Type: application/json' -H 'Accept: multipart/mixed' \
  -d '{"query":"subscription{__typename}"}' 2>/dev/null)
grep -qiE 'subscriptionSpec=1\.0|boundary=graphql' <<<"$subhdr" \
  && note "multipart subscription header (subscriptionSpec=1.0/boundary=graphql)" 2

echo "Target: $base"
if [[ ${#hits[@]} -gt 0 ]]; then printf '%s\n' "${hits[@]}"; else echo "  (no signals)"; fi
echo "Score: $score"
if [[ $score -ge 3 ]]; then
  echo "Verdict: LIKELY Cosmo Router"; exit 0
else
  echo "Verdict: inconclusive / not detected"; exit 1
fi
