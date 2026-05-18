# Enable Proposals via the DB (local cosmo registry)

The Hub's "Create on registry" button on a proposal calls cosmo's
`CreateProposal` RPC, which is gated by three pieces of state in the
controlplane postgres DB. The local seed does **not** grant the
`proposals` feature flag, so the gate fails with `ERR_UPGRADE_PLAN`
even though the rest of the wiring is healthy. To unlock the flow
without going through billing, write the three rows directly.

## What the API checks

`controlplane/src/core/bufservices/proposal/enableProposalsForNamespace.ts`:

1. **Org feature gate** (lines 37-48) — reads `organization_features` for
   `feature='proposals'`. Missing/disabled → `ERR_UPGRADE_PLAN`.
2. **Namespace flag** (line 64) — flips `namespace_config.enable_proposals`
   to `true`.
3. **Severity config** (lines 65-70) — inserts a `namespace_proposal_config`
   row with `check_severity_level` / `publish_severity_level` (defaults:
   `error` / `error`).

All three are required. The feature gate alone unhides the menu item;
without the namespace flag and severity config the proposal endpoints
fail downstream checks (`createProposal`, `getNamespaceProposalConfig`,
etc.).

## Script

Self-contained — discovers org and namespace IDs, then upserts the
three rows in a single transaction. Idempotent.

```bash
#!/usr/bin/env bash
# enable-proposals.sh — unlock proposals on a local cosmo controlplane.
set -euo pipefail

PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5432}"
PG_USER="${PG_USER:-postgres}"
PG_PASS="${PG_PASS:-changeme}"
PG_DB="${PG_DB:-controlplane}"
ORG_SLUG="${ORG_SLUG:-wundergraph}"
NAMESPACE="${NAMESPACE:-default}"
CHECK_SEVERITY="${CHECK_SEVERITY:-error}"     # error | warn
PUBLISH_SEVERITY="${PUBLISH_SEVERITY:-error}"

run_sql() {
  PGPASSWORD="$PG_PASS" psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" \
    -d "$PG_DB" -v ON_ERROR_STOP=1 -t -A "$@"
}

ORG_ID="$(run_sql -c "SELECT id FROM organizations WHERE slug='$ORG_SLUG';")"
[ -n "$ORG_ID" ] || { echo "org '$ORG_SLUG' not found" >&2; exit 1; }

NS_ID="$(run_sql -c "SELECT id FROM namespaces \
  WHERE organization_id='$ORG_ID' AND name='$NAMESPACE';")"
[ -n "$NS_ID" ] || { echo "namespace '$NAMESPACE' not found in '$ORG_SLUG'" >&2; exit 1; }

echo "org=$ORG_SLUG ($ORG_ID)  namespace=$NAMESPACE ($NS_ID)"

run_sql <<SQL
BEGIN;

INSERT INTO organization_features (organization_id, feature, enabled)
VALUES ('$ORG_ID', 'proposals', true)
ON CONFLICT (organization_id, feature) DO UPDATE SET enabled = EXCLUDED.enabled;

UPDATE namespace_config
SET enable_proposals = true
WHERE namespace_id = '$NS_ID';

INSERT INTO namespace_proposal_config
  (namespace_id, check_severity_level, publish_severity_level)
VALUES ('$NS_ID', '$CHECK_SEVERITY', '$PUBLISH_SEVERITY')
ON CONFLICT (namespace_id) DO UPDATE
  SET check_severity_level = EXCLUDED.check_severity_level,
      publish_severity_level = EXCLUDED.publish_severity_level;

COMMIT;
SQL

echo "proposals enabled."
```

Save as `enable-proposals.sh`, `chmod +x`, run. Override defaults via env:

```bash
ORG_SLUG=wundergraph NAMESPACE=default ./enable-proposals.sh
```

## Verification

Either query the DB directly:

```sql
SELECT feature, enabled FROM organization_features
WHERE organization_id = (SELECT id FROM organizations WHERE slug='wundergraph')
  AND feature='proposals';

SELECT enable_proposals FROM namespace_config nc
JOIN namespaces n ON n.id = nc.namespace_id
WHERE n.name='default';

SELECT check_severity_level, publish_severity_level
FROM namespace_proposal_config npc
JOIN namespaces n ON n.id = npc.namespace_id
WHERE n.name='default';
```

…or hit the cosmo RPC with any org API key:

```bash
curl -sS -X POST \
  http://localhost:3001/wg.cosmo.platform.v1.PlatformService/GetNamespaceProposalConfig \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $COSMO_API_KEY" \
  -d '{"namespace":"default"}'
# → {"response":{"code":"OK"},"enabled":true,"checkSeverityLevel":"error","publishSeverityLevel":"error"}
```

## Studio / Hub side

- No controlplane restart needed — the gate is checked per request.
- Hard refresh whatever frontend is hitting it (Studio on its standard port,
  or the Hub frontend on `:3301`) so the org context picks up the new flag.
- In Hub, the proposal detail page (`/<org>/graph/<graph>?view=<view>&tab=proposal`)
  shows a "Create on registry" button when the proposal has no
  `integration_proposal_url`. Clicking it calls
  `proposal.createOnRegistry` →
  `proposalService.createIntegrationProposal` →
  `cosmoService.createProposal`, which now passes the three gates.
- Verified end-to-end on 2026-05-11: clicking the button populates
  `proposals.integration_proposal_id` and `integration_proposal_url`
  in the hub DB, and a proposal row appears under the federated graph
  in cosmo.

## Tearing it back down

To match `enableProposalsForNamespace` with `enableProposals=false`:

```bash
PGPASSWORD=changeme psql -h localhost -p 5432 -U postgres -d controlplane <<'SQL'
BEGIN;
UPDATE namespace_config nc
SET enable_proposals = false
FROM namespaces n
WHERE n.id = nc.namespace_id AND n.name='default';

DELETE FROM namespace_proposal_config npc
USING namespaces n
WHERE n.id = npc.namespace_id AND n.name='default';
-- Leave organization_features.proposals as-is unless you want to re-test the gate.
COMMIT;
SQL
```

## Related tables

- `proposals` — one row per proposal (federated graph scoped); created
  when `CreateProposal` succeeds.
- `proposal_subgraphs` — per-subgraph schema diffs in a proposal.
- `audit_logs` — the RPC writes `proposal.enabled` / `proposal.disabled`
  entries; direct DB writes skip these (fine for local dev, but audit
  history won't reflect the change).

## Caveats

- The script grants the `proposals` feature unconditionally. In a real
  environment this is normally driven by the billing/plans flow — only
  use this for local dev.
- If you also want lint / graph-pruning gates, the same pattern applies
  (different feature names + `namespace_config.enable_linting` etc.).
