# Cache Demo Benchmark Suite

Local benchmark harness for the cache demo on `localhost:3002`, using:

- the existing `cache-demo` subgraphs
- a dedicated Redis Docker container for L2 cache storage on `localhost:6399`
- k6 for request load
- router Prometheus and pprof for runtime capture

## Prerequisites

- `go` with the repo’s expected toolchain
- `pnpm`
- `k6`
- `docker`
- free local ports:
  - `3002`
  - `4012`
  - `4013`
  - `4014`
  - `6060`
  - `8088`
  - `6399`

## Key Files

- `benchmark/router-cache.redis.yaml`: Redis-backed router config for the benchmark
- `benchmark/scenarios/cache-demo.json`: scenario manifest
- `benchmark/queries/*.graphql`: canonical benchmark operations
- `benchmark/fixtures/*.response.json`: uncached router response fixtures
- `benchmark/k6/cache_demo.js`: k6 runner with exact response assertion

## Scenarios

- `article_simple`
- `articles_by_ids_batch`
- `listing_composite_key`
- `venue_nested_key`
- `user_profile_header_sensitive`
- `catalogs_partial_load`
- `request_scoped_viewer_articles`
- `viewer_articles_deep_nested`

## Auth Profiles

The demo uses fake bearer tokens:

- `alice` -> `Bearer token-alice`
- `bob` -> `Bearer token-bob`
- `charlie` -> `Bearer token-charlie`

Auth-sensitive scenarios must not fall back to anonymous requests.

## Commands

Validate the manifest and checked-in fixtures:

```bash
make benchmark-cache-demo-validate
```

Run the full suite with default load settings:

```bash
make benchmark-cache-demo
```

Run one scenario with default load settings:

```bash
make benchmark-cache-demo-scenario SCENARIO=article_simple
```

Run one scenario with direct control over k6 stages:

```bash
pnpm dlx tsx benchmark/scripts/run_suite.ts \
  --scenario article_simple \
  --vus 10 \
  --duration 30s \
  --ramp-up 5s \
  --ramp-down 5s
```

## Output Layout

Result bundles are written under:

```text
benchmark/results/<timestamp>/<scenario>/<mode>/
```

Each mode directory contains:

- `summary.json`
- `k6-summary.json`
- `metrics-before.prom`
- `metrics-after.prom`
- `metrics-delta.json`
- `redis-info-before.txt`
- `redis-info-after.txt`
- `redis-docker-stats-before.json`
- `redis-docker-stats-after.json`
- `equivalence.json`
- `pprof/router_cpu.pb.gz`
- `pprof/router_heap.pb.gz`

`summary.json` also records the warmup request count, k6 stage config, parsed k6 summary, and selected Redis INFO and Docker stats values so downstream interpretation does not need to scrape raw artifacts first.

## Notes

- The harness owns the stack. If the required ports are already in use, startup fails rather than benchmarking against a dirty environment.
- L2 cache storage is intentionally externalized to Redis so router memory measurements do not include the full L2 object footprint.
- The suite always performs deterministic uncached equivalence checks before load generation and serial warmup requests before each mode run.
