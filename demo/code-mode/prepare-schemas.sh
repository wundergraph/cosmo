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
  # imports inside @link(import: [...]) are quoted string literals, so the
  # @authenticated rule requires a non-quote, non-word predecessor (start of
  # line or whitespace) to leave those imports intact.
  #
  # POSIX-portable: avoid \b (BSD sed treats it as a literal `b`).
  sed -E '
    s/[[:space:]]*@requiresScopes\(scopes:[[:space:]]*\[(\[[^][]*\][, ]*)+\]\)//g
    s/(^|[[:space:]])@authenticated([^a-zA-Z0-9_]|$)/\1\2/g
  ' "$in" > "$out"
}

for sg in employees family availability mood hobbies products test1 countries products_fg; do
  strip_auth "$SRC_DIR/$sg/subgraph/schema.graphqls" "$OUT_DIR/$sg.graphqls"
done
