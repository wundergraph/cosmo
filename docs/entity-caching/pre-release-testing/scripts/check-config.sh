#!/usr/bin/env bash
set -euo pipefail

CONFIG="${1:-generated/config.json}"

if [[ ! -f "$CONFIG" ]]; then
  printf 'Missing router config: %s\nRun: make compose\n' "$CONFIG" >&2
  exit 1
fi

if command -v jq >/dev/null 2>&1; then
  count="$(
    jq '[.. | objects | select(
      has("entityCacheConfigurations") or
      has("rootFieldCacheConfigurations") or
      has("cachePopulateConfigurations") or
      has("cacheInvalidateConfigurations") or
      has("requestScopedFields")
    )] | length' "$CONFIG"
  )"
else
  count="$(grep -Eo 'entityCacheConfigurations|rootFieldCacheConfigurations|cachePopulateConfigurations|cacheInvalidateConfigurations|requestScopedFields' "$CONFIG" | wc -l | tr -d ' ')"
fi

if [[ "$count" == "0" ]]; then
  printf 'No entity caching metadata found in %s\n' "$CONFIG" >&2
  exit 1
fi

printf 'Found entity caching metadata in %s (%s matching object(s)).\n' "$CONFIG" "$count"
