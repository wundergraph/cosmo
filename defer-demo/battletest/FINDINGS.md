# Defer battle-test findings (campaign 2026-06-20T09:11:35Z, 6h budget)

## BT-1 [high] — `@defer` on a __typename-only fragment combined with a nested in-list defer nulls the parent + drops the terminal frame
- Round 1. Signature `error-parity+reconstruction+terminal-frame:e2fa8f36` (x2).
- Repro: `{ article(id:"a1"){ id title ... @defer { __typename } reviews{ id ... @defer { __typename author{ __typename id displayName } } } } }`
- Normal mode: HTTP 200, full `article` with reviews+authors, 0 errors.
- Defer mode: a SINGLE multipart frame `{"data":{"article":null}}` with NO `hasNext:false` terminal — wrong data AND the client hangs waiting for a terminal that never comes.
- A bare `... @defer { __typename }` at the root object is CLEAN (verified x3); the defect needs the nested in-list `reviews{ ... @defer { __typename author } }` combination. Minimal trigger still to pin.
- New beyond B1–B7.

### Oracle note (round 1 hardening)
- Gated terminal-frame / pending-closure / path-validity oracles on a valid normal-mode baseline — invalid (syntax/validation-error) queries returned a lone error frame and were false-positiving these invariants.
- The reconstruction oracle is UNSOUND when an error null-propagates across the defer boundary: defer cannot retroactively null already-sent parent data, so defer-vs-normal data legitimately differs. Sigs `7d028785`, `a8ccef14`, `e4b1bb29` are this B5-family error-blast-radius effect, recorded as known (not counted as new bugs). Proposed refinement: only treat a reconstruction mismatch as a clean finding when normal mode has zero errors.

## BT-2 [high] — data race in concurrent @defer resolution (engine loader + astjson)
- Round 3, oracle = Go race detector (`-race` router build). 3 distinct DATA RACE reports; full traces in `race-traces.txt`.
- Mechanism: the defer dispatch (`router/core/graphql_handler.go:354`) → `resolve.go:639` spawns an errgroup of parallel fetches. Two goroutines concurrently access the SAME `astjson` value address with no synchronization: one WRITES (merging a fetch result, `astjson/mergevalues.go` ← `resolve/loader.go:657`), the other READS (rendering fetch input variables, `astjson/parser.go` ← `resolve/resolvable.go:906` ← `inputtemplate.go` ← `loader.go:371/1412`).
- Racing line-pairs in `resolve/loader.go`: 657/376, 657/353, 683/365.
- Root cause is in the engine dependency (`graphql-go-tools/v2 .../pkg/engine/resolve/loader.go` + `astjson`), NOT in this repo. Manifests specifically under parallel deferred fetches — invisible to sequential happy-path tests.
- New beyond B1–B7. Severity high: concurrent defer load can corrupt the shared response document / crash.

### Root-cause note (round 4): nested/sibling/abstract defer delivery is systemically broken
- B4, BT-1, BT-3, and round-4 sig `178b1b1c` are manifestations of ONE underlying defect: the router does not correctly deliver multiple / nested / type-conditional deferred fragments. Symptoms vary by shape — dangling `pending` ids, premature `hasNext:false`, deferred payloads never sent (client hang), or a nulled parent.
- `178b1b1c` repro (valid query, 200/0-errors): `{ search(term:"x"){ ... on Article { stats{views} ...@defer{ stats{...} ...@defer{ reviews{...} } } } ... on Podcast { ... } } }` → announces pending ids 1,2,3,4; completes only 1,2; sends hasNext:false with 3,4 still pending.
- Deduped under this root cause (not counted as a new bug) for convergence honesty.
