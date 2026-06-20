# Defer battle-test loop

A continuous, self-converging fuzzing campaign that hammers the Cosmo router's GraphQL `@defer`
implementation. **Codex** is the fuzz-generation fleet (structure-aware, spec-aware mutation);
**Claude/opus** is the orchestrator + verifier that reproduces every candidate, dedupes, records,
minimizes, and writes regression tests. The oracle is metamorphic + crash, not random:

> `@defer` is pure transport reformatting — so the deferred stream, reassembled, must equal the
> plain (non-defer) response. That single fact (plus a few protocol invariants and "no 5xx on a
> valid op, run under `-race`") is a strong, spec-free bug detector.

Grounded in LLM-fuzzing practice (Fuzz4All/TitanFuzz-style generation + corpus/novelty feedback),
the oracle-problem literature (metamorphic/differential/property/sanitizer), and long-campaign ops
(minimization, signature dedup, dry-round convergence, escalation ladder).

## Files
- `oracle.mjs` — the canonical oracle (6 checks + reconstruction + dedup signature). Run standalone:
  `ROUTER_URL=http://localhost:3002/graphql node oracle.mjs '{ article(id:"a1"){ id ... @defer { reviews{id} } } }'`
- `LOOP_PROMPT.md` — **the controller prompt you feed to `/loop`.**
- `AGENTS.md` — the codex worker contract (read automatically by the workers).
- `corpus/seeds.jsonl` — seed/parent queries + the B1–B7 known-bug templates.
- Created at runtime: `state.json`, `findings.jsonl`, `FINDINGS.md`, `ROUNDS.log`, `rounds/`, `FIXES_PROPOSED.md`, `BATTLETEST_REPORT.md`.

## Prerequisites (must be true before you start the loop)

1. **The stack is running** (the loop will also health-check + restart it, but start it once):
   ```bash
   cd /Users/jens/.superset/worktrees/cosmo/dazed-geology/defer-demo
   # subgraphs (ports 4101-4107)
   for sg in accounts content reviews recommendations metrics media billing; do
     (cd subgraphs/$sg && go build -o ../../bin/$sg .); done
   PORT=4101 ./bin/accounts & PORT=4102 ./bin/content & PORT=4103 ./bin/reviews & \
   PORT=4104 ./bin/recommendations & PORT=4105 ./bin/metrics & PORT=4106 ./bin/media & PORT=4107 ./bin/billing &
   # compose
   wgc router compose -i graph.yaml -o config.json
   # router — RACE build (catches concurrency bugs in parallel defer resolution)
   (cd ../router && go build -race -o /tmp/cosmo-router-race ./cmd/router)
   EXECUTION_CONFIG_FILE_PATH=$PWD/config.json DEV_MODE=true LISTEN_ADDR=localhost:3002 \
     /tmp/cosmo-router-race >/tmp/router-race.log 2>&1 &
   # smoke
   node battletest/oracle.mjs '{ __typename }'
   ```
2. **`codex` is installed and authenticated** (`codex --version`; `codex login` if needed).
3. **`node` 18+** (global `fetch`).

## How to start the loop

In Claude Code, run `/loop` with the controller prompt as its task. Easiest:

```
/loop follow the instructions in defer-demo/battletest/LOOP_PROMPT.md
```

`/loop` with no interval **self-paces** — it runs one round, then schedules the next itself, round
after round, until the loop's own stop condition fires. You do not pass `12h`; the 12-hour budget
is enforced inside the prompt (from `state.json.startedAt`).

If you prefer to paste the full prompt instead of referencing the file, open `LOOP_PROMPT.md` and
paste its contents after `/loop`.

## When does it stop?
- **Converged**: `K_DRY = 3` consecutive rounds with zero new confirmed findings, AND the escalation
  ladder (raise temperature/novelty, directive-combinatorics, validation-abuse, concurrency, fully-
  novel) has been exhausted. This is the "no more bugs for multiple consecutive rounds" criterion.
- **Time**: hard stop at 12 hours regardless.
- **Backstop**: `MAX_ROUNDS = 400`.

On stop it writes `BATTLETEST_REPORT.md`.

## Watch it / stop it early
- Live: `tail -f defer-demo/battletest/ROUNDS.log` and `defer-demo/battletest/FINDINGS.md`.
- Races/panics: `grep -nE 'DATA RACE|panic' /tmp/router-race.log`.
- Stop early: interrupt the loop in Claude Code (Esc), or just let the time/dry-round stop fire.
- Resume after a stop/restart: just run the `/loop` command again — it reloads `state.json` and continues (findings already recorded are deduped by signature).

## Tuning (edit `LOOP_PROMPT.md`)
`WORKERS`, `CANDIDATES_PER_WORKER`, `K_DRY`, `DEADLINE`, `RESAMPLE`, strategy rotation. For a faster
shake-out use `K_DRY=2` and `WORKERS=2`; for an exhaustive overnight run raise `WORKERS` and `K_DRY`.

## Note on "hardening"
The loop writes failing **regression tests** (`tests/defer.bugs.test.ts`) and **fix proposals**
(`FIXES_PROPOSED.md`) for each confirmed bug. It does **not** patch the router/engine automatically
(the defer resolver lives in the graphql-go-tools dependency, outside this repo). Approve fixes
yourself before any source change.
