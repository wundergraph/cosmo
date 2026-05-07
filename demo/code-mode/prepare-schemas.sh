#!/usr/bin/env bash
# Generate code-mode-local copies of the demo subgraph schemas with the
# federation auth directives (@authenticated, @requiresScopes) stripped.
#
# The shared schemas under demo/pkg/subgraphs are used by router-tests and
# other demos that intentionally exercise authorization, so we don't touch
# them. The code-mode demo runs without authentication, and the router's
# CosmoAuthorizer always rejects unauthenticated requests on a scoped field;
# composing from these stripped copies keeps the demo working out of the box.

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$SCRIPT_DIR/../pkg/subgraphs"
OUT_DIR="$SCRIPT_DIR/schemas"

mkdir -p "$OUT_DIR"

strip_auth() {
  local in="$1"
  local out="$2"
  # Remove @requiresScopes(scopes: [[...], [...]]) — match the doubly-nested
  # bracket payload, then drop @authenticated standalone uses. The directive
  # imports inside @link(import: [...]) stay (they're string literals, not
  # directive applications, so they don't trigger enforcement).
  sed -E '
    s/[[:space:]]*@requiresScopes\(scopes:[[:space:]]*\[(\[[^][]*\][, ]*)+\]\)//g
    s/[[:space:]]*@authenticated\b//g
  ' "$in" > "$out"
}

for sg in employees family availability mood; do
  strip_auth "$SRC_DIR/$sg/subgraph/schema.graphqls" "$OUT_DIR/$sg.graphqls"
done
