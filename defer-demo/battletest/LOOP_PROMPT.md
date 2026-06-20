# DEFER BATTLE-TEST LOOP — controller prompt (paste this whole file as the /loop task)

You are the ORCHESTRATOR + VERIFIER of a continuous fuzzing campaign against the Cosmo router's
GraphQL `@defer` implementation. Codex is your stateless fuzz-generation fleet; you (opus) verify
every candidate yourself on the wire, dedupe, record, minimize, and harden. This is metamorphic +
differential + crash fuzzing: `@defer` is pure transport reformatting, so the canonical oracle is
"deferred stream reconstructs to the non-defer result", implemented in `oracle.mjs`.

Run **exactly ONE round** per invocation, then continue the loop (or stop if converged/expired).
All durable state lives in files so the campaign survives compaction/restart. Be terse in chat;
the artifacts are the output.

Absolute paths:
- WORK = `/Users/jens/.superset/worktrees/cosmo/dazed-geology/defer-demo/battletest`
- ROUTER = `http://localhost:3002/graphql`
- Oracle = `node $WORK/oracle.mjs` (`'<query>' ['<vars>']` or `--corpus <file.jsonl>`)
- Ledger = `$WORK/findings.jsonl` (machine) + `$WORK/FINDINGS.md` (human)
- State = `$WORK/state.json`; Seeds = `$WORK/corpus/seeds.jsonl`; Codex contract = `$WORK/AGENTS.md`

## Tunables
WORKERS=4 · CANDIDATES_PER_WORKER≈40 · K_DRY=3 (consecutive dry rounds ⇒ converged) ·
DEADLINE=12h from `state.startedAt` · RESAMPLE=3 (flaky guard) · MAX_ROUNDS=400 (backstop).

## Each round, do these steps in order

### 1. Bootstrap / load state
- If `state.json` missing, create it: `{"startedAt":"<ISO now>","round":0,"dryStreak":0,"knownSignatures":[],"interesting":[],"escalation":0}` (get ISO now via `date -u +%FT%TZ`). Ensure `findings.jsonl` and `FINDINGS.md` exist (create FINDINGS.md with a `# Defer battle-test findings` header).
- Read `state.json`. Compute `elapsed` since `startedAt`.

### 2. STOP CHECKS (before doing work)
- If `elapsed >= 12h` OR `round >= MAX_ROUNDS` OR (`dryStreak >= K_DRY` AND `escalation >= 3`): go to **FINALIZE** and end the loop (do NOT schedule another iteration).
- Else continue.

### 3. Health-check the stack (the router CAN die over 12h)
- `node $WORK/oracle.mjs '{ __typename }'` — if it returns a transport error / non-200, the stack is down. Restart it:
  - subgraphs: for sg in accounts content reviews recommendations metrics media billing: `PORT=41xx $WORK/../bin/$sg &` (rebuild a binary first with `cd $WORK/../subgraphs/$sg && go build -o ../../bin/$sg .` if missing). Ports 4101..4107 in that order.
  - router (RACE BUILD preferred — catches concurrency bugs): if `/tmp/cosmo-router-race` missing, `cd ../../router && go build -race -o /tmp/cosmo-router-race ./cmd/router`. Then `EXECUTION_CONFIG_FILE_PATH=$WORK/../config.json DEV_MODE=true LISTEN_ADDR=localhost:3002 /tmp/cosmo-router-race >/tmp/router-race.log 2>&1 &`
  - re-run the `{ __typename }` probe until green (max ~30s).
- After every round, also `grep -c 'DATA RACE\|panic' /tmp/router-race.log` — a NEW race/panic count increase is itself a finding (capture the trace).

### 4. Pick this round's worker strategies
Rotate by `round` and `dryStreak`/`escalation`:
- escalation 0 (dryStreak 0): `[generate-new, mutate, defer-placement-matrix, error-and-null]`
- escalation 1 (after 1 dry round): swap one worker to `directive-combinatorics`
- escalation 2: add `validation-abuse` and `concurrency`
- escalation 3: all workers `escalate` (maximally novel) + raise diversity
Each round also include at least one `concurrency` probe set if not already.

### 5. Build the AVOID-DIGEST (steer codex toward NEW territory)
A short text block: the list of `knownSignatures`, the `interesting` query shapes already in the corpus, and "known bugs B1–B7 — do not re-report, hunt around them". Keep < ~1500 tokens.

### 6. Dispatch the codex fleet (parallel)
For each worker, run (Bash, 5-min timeout, capture stdout):
```
codex exec "Read $WORK/AGENTS.md and follow it exactly. STRATEGY=<strategy>. Emit ~40 JSONL candidate ops to stdout per the contract — schema-valid unless STRATEGY=validation-abuse. AVOID-DIGEST:\n<digest>" \
  -C /Users/jens/.superset/worktrees/cosmo/dazed-geology -s read-only -c 'model_reasoning_effort="high"' --json < /dev/null 2>/dev/null \
  | <extract agent_message text>
```
Parse each worker's emitted JSONL lines (the `agent_message`); collect all candidate ops into `$WORK/rounds/round-<NNN>.jsonl` (dedupe identical query+vars). If a worker emits malformed lines, skip them.

### 7. Run the oracle on the whole batch (cheap, deterministic — NO LLM)
`ROUTER_URL=$ROUTER node $WORK/oracle.mjs --corpus $WORK/rounds/round-<NNN>.jsonl > $WORK/rounds/round-<NNN>.verdicts.jsonl`
Keep only verdicts with `ok:false`. (Also scan codex `### NOTES` for spec-expectation candidates the oracle can't catch — validation/transport-mode bugs like B1/B6/B7 — and turn them into explicit probes.)

### 8. Dedupe vs the ledger
Drop any failing verdict whose `signature` is already in `state.knownSignatures`. What remains = NEW candidate signatures this round.

### 9. VERIFY each new candidate yourself (the gate — never trust unverified)
For each new signature, pick its op and:
- Re-run `node oracle.mjs '<op>' '<vars>'` RESAMPLE=3 times. Confirmed only if it fails consistently (for `concurrency`/race candidates, "fails ≥1/3" still counts — flag as flaky/timing).
- If it does NOT reproduce, discard (false positive) and log nothing.
- If confirmed, **MINIMIZE**: iteratively delete fields/fragments/arguments from the op and re-run the oracle; keep a deletion only if the SAME `signature` persists. Stop at the smallest reproducer. (You may hand this to one `codex exec` minimizer worker.)

### 10. RECORD
For each confirmed, minimized finding append to `findings.jsonl`:
`{"id":"F<n>","round":<r>,"signature":"<sig>","oracles":[...],"severity":"high|med|low","minimalQuery":"...","variables":...,"observed":"<short>","expectedPerSpec":"<short>","raceOrPanicTrace":"<if any>","ts":"<ISO>"}`
and a readable section in `FINDINGS.md`. Add the signature to `state.knownSignatures`. Promote the minimal op (and any novel-but-passing interesting shapes) into `corpus/seeds.jsonl` and `state.interesting` so future rounds mutate them.

### 11. HARDEN (do NOT patch the router/engine; gate that behind the user)
For each NEW confirmed finding:
- Append a failing regression test to `$WORK/../tests/defer.bugs.test.ts` (create it if missing) that runs the minimal op through the same oracle logic and asserts the CORRECT behavior (so it fails today, passes once fixed). Keep tests deterministic.
- If the root cause is in-repo (`router/...`), append a concrete fix proposal (file:line + sketch) to `$WORK/FIXES_PROPOSED.md`. If it is engine-level (graphql-go-tools, outside this repo), note it as an upstream issue to file. Never edit router/engine source without explicit user approval.

### 12. UPDATE state + decide
- `round += 1`. If newConfirmed == 0 this round: `dryStreak += 1` and `escalation = min(3, escalation+1)`. Else `dryStreak = 0` and `escalation = 0`.
- Write `state.json`. Append a one-line round summary to `$WORK/ROUNDS.log`: `round, strategies, candidates, newConfirmed, dryStreak, escalation, elapsed`.
- Print to chat: `round <r>: <candidates> ops, <newConfirmed> new (total <N>), dryStreak <d>/<K_DRY>, <elapsed> elapsed`.
- If a STOP CHECK (step 2) now holds → **FINALIZE**. Otherwise the loop continues to the next round.

## FINALIZE (only when stopping)
- Write `$WORK/BATTLETEST_REPORT.md`: campaign duration, total rounds, total candidate ops, unique confirmed findings grouped by oracle+severity (each with minimal repro + the regression test name), the dry-round convergence evidence (last K_DRY rounds with 0 new), any race/panic traces, and which findings are NEW beyond B1–B7.
- Print a 5-line summary to chat and STOP (end the loop — do not schedule another round).

## Guaruntees / guardrails
- Never record a finding you did not personally reproduce via `oracle.mjs`.
- Dedupe by `signature`, not raw query, so one bug from many ops counts once.
- Respect oracle false-positive guards (order-independence, dedup, if:null defaults true, 4xx≠bug) — they are encoded in `oracle.mjs` and `AGENTS.md`; do not re-introduce them in ad-hoc checks.
- Keep load-bearing state in files only. If compacted mid-campaign, the next round reloads `state.json` and resumes.
- Hard stop at 12h regardless of progress.
