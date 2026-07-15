#!/bin/bash
set -e

# Applies the local-only setup Entity Intelligence needs on top of the
# regular cosmo demo: a graphql-go-tools sibling checkout, the router's
# go.mod replace directive pointing at it, and the demo router config that
# turns on entity_caching / events_export / feature_flag_rollouts.
#
# None of this is committed to git. router/go.mod's replace directive is a
# machine-local dependency path that would break the build for anyone
# without this exact sibling folder. router/demo.config.yaml's EI block was
# committed once (4305a87ea) and reverted 15 minutes later with no recorded
# reason (c3f267d52) — re-adding it here, locally, avoids silently redoing
# that decision in shared history without knowing why it was pulled.
#
# Safe to run repeatedly: every step checks current state first and skips
# if already applied.

GGT_DIR="../graphql-go-tools"
GGT_BRANCH="milinda/entity-intelligence"
GGT_REPO="https://github.com/wundergraph/graphql-go-tools.git"

echo "==> graphql-go-tools sibling checkout"
if [ -d "$GGT_DIR" ] && [ ! -d "$GGT_DIR/.git" ]; then
  echo "ERROR: $GGT_DIR exists but isn't a git repository." >&2
  echo "       Remove it or point GGT_DIR elsewhere, then re-run." >&2
  exit 1
elif [ -d "$GGT_DIR" ]; then
  current_branch="$(git -C "$GGT_DIR" branch --show-current)"
  if [ "$current_branch" != "$GGT_BRANCH" ]; then
    echo "WARNING: $GGT_DIR exists but is on '$current_branch', not '$GGT_BRANCH'."
    echo "         Not switching it for you, check out '$GGT_BRANCH' yourself if needed."
  else
    echo "Already present on $GGT_BRANCH."
  fi
else
  echo "Cloning $GGT_REPO into $GGT_DIR ($GGT_BRANCH)..."
  git clone --branch "$GGT_BRANCH" "$GGT_REPO" "$GGT_DIR"
fi

echo "==> router/go.mod replace directive"
if grep -q '^// replace github.com/wundergraph/graphql-go-tools/v2' router/go.mod; then
  sed -i.bak 's#^// replace github.com/wundergraph/graphql-go-tools/v2#replace github.com/wundergraph/graphql-go-tools/v2#' router/go.mod
  rm -f router/go.mod.bak
  echo "Enabled the local replace directive."
elif grep -q '^replace github.com/wundergraph/graphql-go-tools/v2' router/go.mod; then
  echo "Already enabled."
else
  echo "WARNING: could not find the graphql-go-tools replace line in router/go.mod." >&2
  echo "         The file may have changed shape; check it manually." >&2
fi

echo "==> router/demo.config.yaml entity caching block"
# Checks all three required pieces, not just the top-level key: this file
# has already drifted once by hand (a block was added, reverted, then
# re-added slightly differently — see git log on this file), so a bare
# `entity_caching:` presence check could be fooled by a prior partial or
# differently-shaped edit into thinking the real block is already there.
if grep -q '^entity_caching:' router/demo.config.yaml \
  && grep -q 'events_export:' router/demo.config.yaml \
  && grep -q '^feature_flag_rollouts:' router/demo.config.yaml; then
  echo "Already present."
else
  cat >> router/demo.config.yaml <<'EOF'

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
    endpoint: http://localhost:4005
    # endpoint omitted → falls back to GRAPHQL_METRICS_COLLECTOR_ENDPOINT
    # (http://localhost:4005 in router/.env)

feature_flag_rollouts:
  enabled: true
EOF
  echo "Appended entity_caching / feature_flag_rollouts config."
fi

echo "==> Entity Intelligence demo setup complete."
echo "    router/go.mod and router/demo.config.yaml are intentionally left"
echo "    uncommitted — do not 'git add' them."
