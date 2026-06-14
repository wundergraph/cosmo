#!/usr/bin/env bash
# discover-cosmo-routers.sh
#
# Keyless, passive-first discovery of candidate Cosmo Router hosts.
#
# Stage 1 (passive, no API key): query public Certificate Transparency logs
#   via crt.sh to enumerate hostnames for a domain or wildcard pattern.
# Stage 2 (confirm): run the benign black-box detector against each host.
#
# This is an *authorized footprint / exposure* tool. Stage 1 is fully passive
# (only crt.sh is queried). Stage 2 sends a handful of benign HTTP requests to
# each discovered host -- only run it against domains you own or are authorized
# to test.
#
# Usage:
#   ./discover-cosmo-routers.sh kompass.gg                 # all *.kompass.gg
#   ./discover-cosmo-routers.sh 'playground.%'            # CT pattern (SQL LIKE)
#   ./discover-cosmo-routers.sh kompass.gg --list-only    # stage 1 only
#
# Requires: curl, jq. Uses ./detect-cosmo-router.sh from the same directory.

set -uo pipefail

domain="${1:?usage: discover-cosmo-routers.sh <domain|pattern> [--list-only]}"
list_only=0; [[ "${2:-}" == "--list-only" ]] && list_only=1

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
detector="$here/detect-cosmo-router.sh"

# A bare domain -> match the apex and all subdomains.
case "$domain" in
  *%*) query="$domain" ;;            # caller supplied a SQL LIKE pattern
  *)   query="%.$domain" ;;
esac

# apex domain for the certspotter fallback (which takes a domain, not a pattern)
apex="${domain#%.}"; apex="${apex#*.}"; [[ "$domain" == *%* ]] || apex="$domain"

normalise() {  # stdin: raw hostnames -> clean unique list
  tr '[:upper:]' '[:lower:]' | tr ' ' '\n' \
    | sed 's/^\*\.//' \
    | grep -E '^[a-z0-9.-]+\.[a-z]{2,}$' \
    | sort -u
}

echo "[*] Stage 1: querying Certificate Transparency logs (passive, keyless)..." >&2

# Source 1: crt.sh (name_value may hold newline-separated and wildcard entries).
hosts=$(curl -sS -m 60 \
    "https://crt.sh/?q=$(jq -rn --arg q "$query" '$q|@uri')&output=json" 2>/dev/null \
  | jq -r '.[].name_value' 2>/dev/null | normalise)

# Source 2: certspotter (keyless free tier, rate-limited) -- used as a fallback
# when crt.sh is down/empty (it is frequently overloaded -> HTTP 503).
if [[ -z "$hosts" ]]; then
  echo "[*]   crt.sh empty/unavailable, falling back to certspotter ($apex)..." >&2
  hosts=$(curl -sS -m 30 \
      "https://api.certspotter.com/v1/issuances?domain=$apex&include_subdomains=true&expand=dns_names" 2>/dev/null \
    | jq -r '.[].dns_names[]?' 2>/dev/null | normalise)
fi

if [[ -z "$hosts" ]]; then
  echo "[!] No hostnames found via crt.sh for '$query'." >&2
  exit 1
fi

count=$(wc -l <<<"$hosts" | tr -d ' ')
echo "[*] Found $count unique hostname(s):" >&2
echo "$hosts"

if [[ $list_only -eq 1 ]]; then exit 0; fi

if [[ ! -x "$detector" ]]; then
  echo "[!] Detector not found/executable at $detector" >&2
  exit 1
fi

echo >&2
echo "[*] Stage 2: probing each host with the detector..." >&2
found=()
while IFS= read -r h; do
  [[ -z "$h" ]] && continue
  if "$detector" "https://$h" >/dev/null 2>&1; then
    echo "  [HIT] $h -> LIKELY Cosmo Router"
    found+=("$h")
  fi
done <<<"$hosts"

echo >&2
if [[ ${#found[@]} -gt 0 ]]; then
  echo "[*] ${#found[@]} likely Cosmo Router host(s):" >&2
  printf '%s\n' "${found[@]}"
else
  echo "[*] No confirmed Cosmo Router hosts among $count candidate(s)." >&2
fi
