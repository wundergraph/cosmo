# Composition memory load test

Tooling to answer "does the composition library leak memory when many compositions run back to back, and where does
the memory go?". Everything runs against the built library, so run `pnpm build` first.

| Script                   | What it does                                                                                                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `load-test.mjs`          | Runs a scenario N times and reports the heap after a forced GC at regular intervals (a growing value is a leak). Optionally writes heap snapshots after warm-up and at the end.                 |
| `alloc-profile.mjs`      | Sampling allocation profile of a scenario: allocated bytes per composition and the frames that allocate the most.                                                                               |
| `heap-snapshot-diff.mjs` | Compares two heap snapshots by object class (count and self size).                                                                                                                              |
| `heap-retainers.mjs`     | Prints the retainer tree of a heap snapshot node or class, i.e. why an object is still alive.                                                                                                   |
| `parallel-pool.mjs`      | Simulates the controlplane worker pool in a memory-limited pod: N worker processes compose concurrently under a combined RSS budget (OOM when exceeded), optionally with a per-worker heap cap. |
| `scenarios.mjs`          | The workloads (see below).                                                                                                                                                                      |

```sh
pnpm build
# steady-state heap after GC, 300 back-to-back compositions with three contracts
pnpm test:memory contracts 300
# the same, but also write heap snapshots after the warm-up and after the last iteration
pnpm test:memory contracts 300 ./heap-snapshots
node --max-old-space-size=4096 scripts/memory-load-test/heap-snapshot-diff.mjs heap-snapshots/contracts-warm.heapsnapshot heap-snapshots/contracts-end.heapsnapshot
node --max-old-space-size=4096 scripts/memory-load-test/heap-retainers.mjs heap-snapshots/contracts-end.heapsnapshot object:FederationFactory
# peak heap without forced GC (what a process observes when V8 is not under memory pressure)
NOGC=1 pnpm test:memory big 20
# where is the memory allocated?
pnpm test:memory:alloc big-contracts 3
# A/B against another build, e.g. the published version or a branch
COMPOSITION_DIST=/path/to/other/composition/dist/index.js pnpm test:memory:alloc no-contracts 10
# a real graph: any directory of *.graphql subgraph files (one subgraph per file), kept outside the repository
COMPOSITION_SUBGRAPHS=/path/to/subgraphs pnpm test:memory custom 50
# 4 worker processes composing a feature-flag publish concurrently inside an "8 GB pod", each capped at 1.5 GB of heap
COMPOSITION_SUBGRAPHS=/path/to/subgraphs pnpm test:memory:pool --scenario custom-featureflags --workers 4 --tasks 1 --budget-mb 8192 --heap-cap-mb 1536
```

Resolvability validation is skipped by all scenarios (it dominates composition time); set `COMPOSITION_RESOLVABILITY=1` to
include it.

## Scenarios

| Scenario                               | Workload                                                                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `base`                                 | `federateSubgraphs` with the 8 demo subgraphs from `demo/pkg/subgraphs` (SDL re-parsed every iteration)                 |
| `base-locations`                       | Like `base`, but the documents keep their source locations, which is how the controlplane parses SDL                    |
| `contracts`                            | `federateSubgraphsWithContracts` with three contracts (the controlplane flow when a subgraph is published)              |
| `no-contracts`                         | `federateSubgraphsWithContracts` with an empty contract map (publishing to a federated graph without contracts)         |
| `contract`                             | `federateSubgraphsContract` (the controlplane flow when a contract is created)                                          |
| `errors`                               | A composition that fails with an `@override` conflict                                                                   |
| `normalize`                            | `normalizeSubgraphFromString` for each demo subgraph (the subgraph check flow)                                          |
| `unique`                               | A different synthetic graph on every iteration (type and subgraph names change), so nothing can be cached by name       |
| `custom`                               | `federateSubgraphs` with the `*.graphql` subgraph files in `COMPOSITION_SUBGRAPHS` (a real graph kept outside the repo) |
| `custom-*`                             | `custom-locations`, `custom-no-contracts`, `custom-contracts`: the variants above for that graph                        |
| `big`                                  | A synthetic graph with 12 subgraphs, 480 object types and ~5800 fields                                                  |
| `big-contracts`                        | The `big` graph with three contracts                                                                                    |
| Yahoo graph (52 subgraphs, 2.9 MB SDL) | 784 MB                                                                                                                  | live heap after GC 22 MB, flat over 60 compositions; ~2 s per composition |
| Yahoo graph, no contracts (before fix) | 1,634 MB                                                                                                                | 17.6 s for 4 compositions                                                 |
| Yahoo graph, no contracts (after fix)  | 778 MB                                                                                                                  | 7.0 s for 4 compositions                                                  |
| Yahoo graph, 3 contracts               | 3,575 MB                                                                                                                | 39% lodash `cloneDeep`; ~11 s per composition                             |

## How to read the output

- `load-test.mjs` forces a full GC before every measurement. Memory that survives a full GC is retained memory, so a
  steadily growing `heapUsed` is a leak, and a flat value means each composition is fully collectable.
- A growing `rss` with a flat `heapUsed` is not a leak: V8 lets the heap grow far beyond the live set when it is not
  under memory pressure, and the operating system rarely gets that memory back. Bound the worker process with
  `--max-old-space-size` (or worker `resourceLimits`) if that matters.
- In a heap snapshot diff, growth that only shows in `code:(code)` and `hidden:(hidden)` is JIT-compiled code and V8
  internals, not JavaScript objects.

## Findings (September 2026, composition 0.63.3, Node 22)

### Pod simulation: why the controlplane runs out of memory

`parallel-pool.mjs` with 4 worker processes (a 4 CPU pod), each composing one publish of the 52-subgraph Yahoo graph
with 3 feature flags and 3 contracts (4 x `federateSubgraphsWithContracts`), inside an 8 GB budget:

| Build      | Worker heap cap             | Outcome                                                                                                                        |
| ---------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| before fix | none (controlplane default) | OOM after 30 s, 0/4 tasks done: combined RSS 8.2 GB (about 2 GB per worker) while the live heap of each worker was about 20 MB |
| after fix  | none                        | OOM after 27 s, 0/4 tasks done: the library change alone does not stop V8 from hoarding garbage                                |
| before fix | 1536 MB                     | OK: 4/4 tasks in 73 s, peak combined RSS 6.1 GB                                                                                |
| after fix  | 1536 MB                     | OK: 4/4 tasks in 61 s, peak combined RSS 6.2 GB                                                                                |

The decisive fix is bounding each worker's heap (`COMPOSITION_WORKER_MAX_OLD_SPACE_SIZE_MB`, passed to the pool as
`--max-old-space-size`), sized so that `COMPOSITION_MAX_THREADS x cap` fits the container. The cap must stay above the
live peak of the largest composition (709 MB for the Yahoo graph with 3 contracts before the fix, 537 MB after), which
is what the library change buys: `federateSubgraphsWithContracts` now takes one pristine copy of the FederationFactory,
builds each contract on its own copy that is released as soon as its result exists (before, every copy stayed alive
until all contracts were built), and makes no copy at all when there are no contracts (which halves allocation and
time for the most common publish). Outputs are byte-identical to the previous implementation on the demo, synthetic,
Yahoo and MaintainX graphs.

### Steady state and allocation

The library does not retain memory across compositions. Every scenario above was run for 300 to 1000 back-to-back
compositions (60 for a real 52-subgraph customer graph); the heap after a full GC stayed flat (about 15 to 20 MB for the
demo graph, 22 MB for the customer graph, 69 MB for `big`, growth of 1 to 18 KB per iteration that the snapshot diff
attributes entirely to JIT code). No module-level container changes size
when compositions use unique subgraph, type, tag, and contract names.

What does grow is the amount of memory allocated (and immediately garbage) per composition, and therefore the V8 heap
high-water mark and RSS of a long-lived process:

| Scenario                    | Allocated per composition | Notes                                                     |
| --------------------------- | ------------------------: | --------------------------------------------------------- |
| `base` (8 demo subgraphs)   |                     13 MB | 28% `graphql` `visit`, 16% resolvability graph walker     |
| `no-contracts` (before fix) |                     25 MB | one needless `cloneDeep` of the whole `FederationFactory` |
| `no-contracts` (after fix)  |                     13 MB |                                                           |
| `contracts` (3 contracts)   |                     52 MB | 55% lodash `cloneDeep`                                    |
| `big`                       |                    218 MB | live heap after GC 69 MB, RSS settles around 450 MB       |
| `big-contracts`             |                  1,127 MB | 47% lodash `cloneDeep`; RSS 1 to 1.8 GB                   |

`federateSubgraphsWithContracts` deep-copies the entire `FederationFactory` once per contract. For the `big` graph one
copy retains 55 MB and takes about 1.5 s: 48% is `internalSubgraphBySubgraphName` (each subgraph's `DocumentNode` and
`GraphQLSchema`), 43% is `parentDefinitionDataByTypeName`. A cheaper copy is possible (the contract build never
mutates the subgraph documents or schemas), but AST nodes are shared by reference between the subgraph data and the
federated data, so a partial copy changes object identity semantics and needs its own change.

A `FederationResult` keeps the heavy state of the factory that produced it alive (`parentDefinitionDataByTypeName`,
`subgraphConfigBySubgraphName` with every subgraph's schema and AST). For `big-contracts` the base result plus three
contract results retain 235 MB. `Error` and `Warning` objects created inside factory methods additionally pin the whole
factory through V8's lazily formatted stack trace until `.stack` is read. Callers should therefore not hold on to
results or their errors longer than needed; the controlplane worker serializes them immediately, which is fine.
