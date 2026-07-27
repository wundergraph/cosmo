#!/bin/bash
set -e

SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/lib.sh"

# Local-only Entity Intelligence setup on top of the regular cosmo demo.
# router/go.mod and router/demo.config.yaml stay untouched, see RUNBOOK.md.
# Safe to run repeatedly: every step checks current state first.

# Overridable the same way HUB_DIR is (see Makefile): GGT_BRANCH will need
# bumping once entity-intelligence lands on a stable branch upstream.
GGT_DIR="${GGT_DIR:-../graphql-go-tools}"
GGT_BRANCH="${GGT_BRANCH:-milinda/entity-intelligence}"
GGT_REPO="https://github.com/wundergraph/graphql-go-tools.git"

echo "==> graphql-go-tools sibling checkout"
ensure_sibling_on_branch "$GGT_DIR" "$GGT_REPO" "$GGT_BRANCH" graphql-go-tools

echo "==> graphql-go-tools sibling override (go.work)"
# go.work is explicitly sanctioned for local overrides instead of editing
# go.mod (see CONTRIBUTING.md) and is itself gitignored. Lives inside
# router/, not the repo root: Go auto-discovers go.work by walking up from
# the working directory, so a root-level file pulls every other Go module
# in this monorepo (demo, graphqlmetrics, ...) into workspace mode too and
# breaks their builds, see RUNBOOK.md. router/go.mod's own replace line
# stays untouched as the documented manual fallback. `go work use` is
# idempotent, so this is safe to run every time.
GGT_ABS_DIR="$(cd "$GGT_DIR" && pwd)"
if [ ! -f router/go.work ]; then
  echo "Creating router/go.work..."
  (cd router && go work init)
fi
(cd router && go work use "$GGT_ABS_DIR/v2" .)
echo "graphql-go-tools sibling wired via router/go.work (router/go.mod untouched)."

echo "==> router/demo.ei-demo.config.yaml (layered in via CONFIG_PATH)"
# Kept out of the tracked demo.config.yaml (its own EI block was committed
# once and reverted 15 minutes later with no recorded reason, 4305a87ea /
# c3f267d52) by using the router's own multi-file CONFIG_PATH merge
# instead (router/cmd/main.go: a comma-separated CONFIG_PATH is merged).
EI_CONFIG_FILE="router/demo.ei-demo.config.yaml"
if grep -q '^entity_caching:' router/demo.config.yaml 2>/dev/null; then
  echo "WARNING: router/demo.config.yaml still has an entity_caching block from an" >&2
  echo "         older version of this script. Remove it by hand (or 'git checkout"  >&2
  echo "         -- router/demo.config.yaml' if it's your only local change there)," >&2
  echo "         since leaving it means the router would see entity_caching defined" >&2
  echo "         twice once merged with $EI_CONFIG_FILE." >&2
fi

if [ -f "$EI_CONFIG_FILE" ] \
  && grep -q '^entity_caching:' "$EI_CONFIG_FILE" \
  && grep -q 'events_export:' "$EI_CONFIG_FILE" \
  && grep -q '^feature_flag_rollouts:' "$EI_CONFIG_FILE"; then
  echo "Already present."
  # Key presence alone doesn't prove the values are current: fix the one
  # value known to have changed, targeted so it doesn't clobber hand edits.
  if grep -q 'endpoint: http://localhost:4005' "$EI_CONFIG_FILE"; then
    echo "Correcting stale events_export endpoint (localhost to 127.0.0.1)..."
    sed -i.bak 's#endpoint: http://localhost:4005#endpoint: http://127.0.0.1:4005#' "$EI_CONFIG_FILE"
    rm -f "$EI_CONFIG_FILE.bak"
  fi
elif [ -f "$EI_CONFIG_FILE" ]; then
  # Likely a hand edit, not corruption: overwriting would destroy it.
  echo "WARNING: $EI_CONFIG_FILE exists but is missing one of entity_caching/" >&2
  echo "         events_export/feature_flag_rollouts. Not overwriting possible" >&2
  echo "         manual edits, fix it by hand, or remove the file and re-run" >&2
  echo "         to regenerate it from scratch." >&2
else
  cat > "$EI_CONFIG_FILE" <<'EOF'
storage_providers:
  redis:
    - id: "default"
      urls:
        - "redis://localhost:6379/2"
      cluster_enabled: false

entity_caching:
  enabled: true
  l1:
    enabled: true
    max_size: "100MB"
  l2:
    enabled: true
    storage:
      provider_id: "default"
      key_prefix: "cosmo_entity_cache"
    circuit_breaker:
      enabled: false
  events_export:
    enabled: true
    endpoint: http://127.0.0.1:4005

feature_flag_rollouts:
  enabled: true
EOF
  echo "Wrote $EI_CONFIG_FILE."
fi

echo "==> router/.env CONFIG_PATH"
if [ ! -f router/.env ]; then
  echo "ERROR: router/.env does not exist." >&2
  echo "       Run bootstrap-entity-intelligence-demo.sh first, or 'cp router/.env.example router/.env'." >&2
  exit 1
elif grep -q 'demo\.ei-demo\.config\.yaml' router/.env; then
  echo "Already layered in."
elif grep -q '^CONFIG_PATH=' router/.env; then
  sed -i.bak "s#^CONFIG_PATH=\(.*\)#CONFIG_PATH=\1,demo.ei-demo.config.yaml#" router/.env
  rm -f router/.env.bak
  echo "Appended demo.ei-demo.config.yaml to CONFIG_PATH."
else
  echo "WARNING: router/.env has no CONFIG_PATH= line to layer onto; not adding one." >&2
  echo "         The router will not pick up $EI_CONFIG_FILE until CONFIG_PATH includes it." >&2
fi

echo "==> hub's Entity Intelligence feature flag"
# Force it on here rather than change hub's shared .env.example default (off
# for everyone else's local dev). The bootstrap already sets this before it
# starts hub's next dev (the only point it takes effect, see the helper); this
# call covers running setup-router-config.sh standalone. If hub's frontend is
# already running, restart it so next dev recompiles with the flag.
# Overridable the same way as everywhere else (see Makefile's HUB_DIR ?=).
HUB_DIR="${HUB_DIR:-../hub}"
if [ ! -d "$HUB_DIR" ]; then
  echo "ERROR: HUB_DIR '$HUB_DIR' does not exist." >&2
  echo "       Clone hub there, or pass HUB_DIR=/path/to/hub." >&2
  exit 1
fi
enable_hub_ei_frontend_flag "$HUB_DIR" || true

echo "==> Entity Intelligence demo setup complete."
echo "    Local-only state lives in router/go.work and"
echo "    router/demo.ei-demo.config.yaml (both gitignored), router/go.mod"
echo "    and router/demo.config.yaml are untouched."
