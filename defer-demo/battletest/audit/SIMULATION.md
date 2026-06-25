# Defer-audit simulation — making the auth/fetch/renderer findings live RED

The audit's termination-cluster findings F03/F04/F05 fire only when an **authorizer**,
**rate-limiter**, or **custom field-renderer** errors during a deferred fetch/render.
The demo wires none of those, so those tests were skipped placeholders. This wires a
**test-only, header-gated** simulation so they become live, runnable RED tests.

Nothing here changes the `@defer` engine — it only triggers the existing (buggy) engine
code paths. Without the `x-defer-sim` header, behaviour is identical to before.

## The one button

```bash
# 1. compose (the schemas now carry @requiresScopes on the sim trigger fields)
cd defer-demo && wgc router compose -i graph.yaml -o config.json

# 2. run the router built FROM THIS BRANCH (it contains router/core/defer_sim.go),
#    with a low concurrency limit so F06 is also meaningful:
cd ../router && go build -o /tmp/cosmo-router cmd/router/main.go
ENGINE_MAX_CONCURRENT_RESOLVERS=2 EXECUTION_CONFIG_FILE_PATH="$PWD/../defer-demo/config.json" \
  DEV_MODE=true LISTEN_ADDR=localhost:3002 /tmp/cosmo-router &

# 3. hit the button — everything still-broken is RED:
cd ../defer-demo/tests
ROUTER_URL=http://127.0.0.1:3002/graphql EXPECTED_MAX_CONCURRENCY=2 npx vitest run audit
```

## How the simulation works

- `router/core/defer_sim.go` (TEST-ONLY): a header-gated authorizer + field renderer.
  Activated only by the `x-defer-sim` request header; otherwise it ALLOWS the single
  auth-ruled demo field so normal traffic is unaffected.
- The demo schemas add `@requiresScopes` to `User.reviews` (entity field) and
  `Query.firstArticle` (root field) ONLY so the authorizer fires on them. They are
  allowed by default (no JWT needed).

| `x-defer-sim:` | effect | audit finding |
|----------------|--------|---------------|
| `authz-objectfield` | `AuthorizeObjectField` returns a hard error on a deferred field | **F04** — LIVE RED |
| `render-error` | a custom `FieldValueRenderer` errors on `Review.body` in the deferred render | **F05** — LIVE RED |
| `authz-prefetch` | `AuthorizePreFetch` returns a hard error | F03 — NOT reachable here (see below) |
| `authz-deny-ancestor` | `AuthorizeObjectField` returns a deny on a pass-through ancestor | F15 — wired but does NOT reproduce |

F04/F05 both reproduce the same symptom: the deferred `pending` id is **announced but
never `completed`**, and **no `hasNext:false`** terminal is emitted → the multipart
client hangs. The tests assert the spec-correct behaviour (every pending completed +
exactly one terminal), so they fail today and will pass once the engine routes every
deferred error through a terminal-frame writer.

## Why F03/F15/F08 stay skipped (honest, not lazy)

- **F03** (pre-fetch group-fetch error): `AuthorizePreFetch` only fires for fetches whose
  RootFields carry `HasAuthorizationRule`, which the demo's entity/root fetches never set
  (verified: `x-defer-sim:authz-prefetch` does nothing) — auth here enforces at
  `AuthorizeObjectField`. The rate-limiter alternative needs a live Redis. **F04 reproduces
  the identical termination bug** via the render-phase auth error, so the cluster is covered.
- **F15** (two-pass duplicate error): wired via `authz-deny-ancestor`; the deferred error
  appeared **exactly once**, not duplicated. Mechanism is in the source but the duplication
  does not manifest on this demo's shapes — no live RED, not claimed.
- **F08** (assignDefer panic): **not a live bug** — `Planner.Plan` rejects the undefined
  field first, so the router returns a clean validation error with no panic. Reachable only
  by driving the planning Visitor directly (an embedder), which no HTTP request can do.

## Hammer-button result against the rebased v2.5.1 engine (2026-06-25)

`12 passed · 4 failed · 3 skipped` (F06 is neutered by a maintainer NOTE; F07 needs a
`-race` build to be RED):

- **Still RED (open):** F04 (deferred-render auth error), F05 (render-phase printErr),
  F01 (recoverable-error-drops-defers), F16 (eager nested pending).
- **Now GREEN (his stacked-PR fixes landed):** F02 (initial-error termination), F09
  (`@defer(if:$var)` timing), F10 (label validation), F12/F14 (`@stream` accepted),
  F17/F18 (list-defer wire-shape).
- **Skipped (not live-reachable):** F03, F15, F08 — see above.

So the suite now doubles as a fix-tracker: as more of the stacked defer PR lands, more of
these flip from RED to GREEN.
