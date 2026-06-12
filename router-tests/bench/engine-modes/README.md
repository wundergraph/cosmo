# Engine-modes benchmark suite

Measures the router's three engine execution modes against each other from ONE
binary, selected by env flags:

| label | `ENGINE_ENABLE_DATAFLOW` | `ENGINE_ENABLE_SCHEDULE_TREE` |
|---|---|---|
| cosmo-baseline | false | false |
| cosmo-dataflow | true | false |
| cosmo-scheduler | false | true |

The suite is self-contained and cosmo-only.
It exists to prove two properties on every change to the engine execution path:

1. The flags cost NOTHING when latency is uniform (regression gate).
2. Under skewed subgraph latency the dataflow executor and the schedule-tree
   scheduler collapse the median to the dependency-graph critical path
   (capability gate; reference: −37% vs baseline on the workload below).

## Provisioning

1. Router image (from this repo):

```bash
cd router && CGO_ENABLED=0 GOOS=linux GOARCH=$(go env GOARCH) go build -ldflags '-s -w' -o /tmp/bench-router/cosmo ./cmd/router
printf 'FROM alpine:3.20\nRUN apk add --no-cache ca-certificates\nWORKDIR /app\nCOPY cosmo /app/cosmo\nENTRYPOINT ["/app/cosmo"]\n' > /tmp/bench-router/Dockerfile
docker build -t bench-cosmo:local /tmp/bench-router
```

2. Subgraphs image: any implementation of the standard federation example
   subgraphs (accounts/products/reviews/inventory on one port, 4200), built as
   `bench-subgraphs:latest`. The reference dataset used for the acceptance
   numbers is the one from the graphql-hive/gateways-benchmark repository
   (workload source only — this suite benchmarks no other gateways).
   The canonical federated query (`QUERY_FILE`) is the benchmark's `MyQuery`;
   against this dataset the full response is exactly 87,599 bytes
   (`EXPECTED_BYTES`).

3. lat-proxy (skew scenario only):

```bash
docker build -t lat-proxy:local lat-proxy/
```

4. Router config dirs (execution config + minimal yaml), one per topology:
   `COSMO_CFG_DIR` for the uniform scenario routes subgraphs to
   `http://bench-sg:4200/<name>`, the skew variant to
   `http://lat-proxy:8080/<name>`.

## Run

```bash
export QUERY_FILE=/path/to/query.json EXPECTED_BYTES=87599
export COSMO_CFG_DIR=/path/to/cfg ROUTER_IMAGE=bench-cosmo:local

# Gate first — abort on any divergence:
bash byteid.sh

# Then the matrices (macOS: under caffeinate -dimsu):
RES=/tmp/results/uniform.jsonl bash uniform_matrix.sh
COSMO_CFG_DIR=/path/to/cfg-proxy RES=/tmp/results/skew.jsonl bash skew_matrix.sh
```

Each run appends one JSON line: rps, success, min/med/p90/p95/p99.9, cpu
avg/max, mem max, valid_bytes, label, flags. Aggregate as median-of-3 per
(scenario, label) cell; a cell whose rep RPS spread exceeds 1.1x is re-run.

## Acceptance thresholds

Reference machine: Apple M4 Max, OrbStack, gateway pinned to 4 CPUs / 2 GB.

- Byte identity: `BYTEID GATE: PASS` — one sha256 across all 4 modes
  (baseline/dataflow/scheduler/both), 50 requests each, exact `EXPECTED_BYTES`.
- Skew (`accounts=20,products=20,reviews=20,inventory=150`; critical path
  210 ms): dataflow AND scheduler median ≤ 225 ms at 1 VU and 64 VU, RPS ≥ 265
  at 64 VU (reference floors: 218–219 ms / 274–275 RPS); baseline median in the
  340–360 ms band (the barrier anchor). Both new modes ≈ −37% vs baseline.
- Uniform ({0,10,50,100} ms, 64 VU): all three modes within 3% of each other on
  median latency AND RPS at every delay; at 0 ms ≥ 19k RPS under conditions
  that reproduce the reference anchors (absolute RPS is machine-sensitive —
  when anchors don't reproduce, only the within-3% relative gate applies).
- `cosmo-both-SMOKE` rows ≈ the scheduler row (safe-degradation proof).

## Methodology notes (encoded in the scripts)

- netem on the SUBGRAPH container's egress with `limit 100000`, qdisc verified
  present after adding; gateway CPU-pinned via `--cpuset-cpus` with
  `GOMAXPROCS`/`GOMEMLIMIT`; subgraphs unpinned; k6 on the same docker network
  (no host NAT); closed-loop constant VUs.
- A run starts only after a real federated response of the expected size is
  observed; `valid_bytes` is recorded per row.
- k6 `setup()` warmup is capped at 8 requests (`vus*2` sequential warmup
  poisons `http_reqs.rate` windowing at high latency).
- Tail latencies ≥ 10x the injected delay are the macOS host-sleep signature —
  invalidate the rep.
