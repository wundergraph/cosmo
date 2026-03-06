# Entity Caching — Implementation Tasks

## Source Documents

- [ENTITY_CACHING_DIRECTIVES.md](../router/ENTITY_CACHING_DIRECTIVES.md) — 5 directives, 20 validation rules, composition behavior
- [ENTITY_CACHING_CONFIGURATION.md](../router/ENTITY_CACHING_CONFIGURATION.md) — Router YAML config, L1/L2 cache, Redis, custom modules, extension invalidation, analytics
- [ENTITY_CACHING_TODO.md](../router/ENTITY_CACHING_TODO.md) — Full integration plan: proto, composition, router, tests, observability

---

## Dependency Graph

```
Group 0 (Prerequisite — must be first):
                 ┌─────────┐
                 │ Task 00 │
                 │ Upgrade  │
                 │ go-tools │
                 └────┬────┘
                      │
Group 1 (Foundation — parallel, after Task 00):
  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐
  │ Task 01 │  │ Task 02 │  │ Task 03 │  │ Task 04 │
  │  Proto  │  │ Comp.   │  │ Cache   │  │ Router  │
  │ Schema  │  │ Dir.Reg │  │ Backend │  │  YAML   │
  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘
       │            │            │             │
Group 2 (depends on Group 1):
       │       ┌────┴────┐      │        ┌────┴────┐
       │       │ Task 05 │      │        │ Task 07 │
       ├──────►│ Comp.   │      │        │ Module  │
       │       │ Valid.  │      │        │ +Wiring │
       │       └────┬────┘      │        └────┬────┘
       │  ┌─────────┘           │             │
       │  │  ┌─────────┐       │             │
       ├──┤  │ Task 06 │       │             │
       │  └─►│ Config  │       │             │
       │     │ Builder │       │             │
       │     └────┬────┘       │             │
       │          │            │             │
Group 3 (depends on Group 2):
       │          │       ┌────┴────┐        │
       └──────────┼──────►│ Task 08 │◄───────┘
                  │       │ Factory │
                  │       │+Executor│
                  │       └────┬────┘
                  │            │
                  │       ┌────┴────┐
                  │       │ Task 09 │
                  │       │ Handler │
                  │       │+GraphSrv│
                  │       └────┬────┘
                  │            │
Group 4 (depends on Group 3):
                  │  ┌─────────┼─────────┐
                  │  │    ┌────┴────┐    │
                  │  │    │ Task 10 │    │
                  │  │    │ Metrics │    │
                  │  │    └─────────┘    │
                  │  │                   │
             ┌────┴──┴────┐              │
             │  Task 11   │◄─────────────┘
             │   Tests    │
             └────┬───────┘
                  │
Group 5 (depends on Group 4):
             ┌────┴────┐
             │ Task 12 │
             │ Ext.Inv │
             │+Sub.Cache│
             └─────────┘
```

---

## Tasks

### Group 0 — Prerequisite

- [ ] **Task 00**: Upgrade graphql-go-tools Dependency — **must be completed first**

### Group 1 — Foundation (all parallel, after Task 00)

- [ ] **Task 01**: Proto Schema Changes + Codegen
- [ ] **Task 02**: Composition Directive Registration
- [ ] **Task 03**: Cache Backend Implementation (Redis + Memory) — depends: 00
- [ ] **Task 04**: Router YAML Config Structs

### Group 2 — Composition + Router Wiring (depends on Group 1)

- [ ] **Task 05**: Composition Validation + Extraction Logic — depends: 02
- [ ] **Task 06**: Router Config Builder — Proto Serialization — depends: 01, 02
- [ ] **Task 07**: Router Module Interface + Config Wiring — depends: 00, 01, 04

### Group 3 — Router Core Integration (depends on Group 2)

- [ ] **Task 08**: Router FactoryResolver + Executor Integration — depends: 00, 01, 03, 07
- [ ] **Task 09**: Router GraphQL Handler + Graph Server Per-Request Wiring — depends: 00, 03, 07, 08

### Group 4 — Observability + Tests (depends on Group 3)

- [ ] **Task 10**: Entity Cache Metrics / Observability — depends: 00, 09
- [ ] **Task 11**: Integration Tests — depends: 05, 06, 08, 09

### Group 5 — Advanced Features (depends on Group 4)

- [ ] **Task 12**: Extension-Based Invalidation + Subscription Cache — depends: 09, 11

---

## Task Details

_Individual task descriptions are in separate files linked below. Each contains: objective, files to modify, implementation steps, code snippets, dependencies, and verification criteria._

| Task | Description | File |
|------|-------------|------|
| 00 | Upgrade graphql-go-tools Dependency | [00-upgrade-graphql-go-tools.md](./00-upgrade-graphql-go-tools.md) |
| 01 | Proto Schema Changes + Codegen | [01-proto-schema-changes.md](./01-proto-schema-changes.md) |
| 02 | Composition Directive Registration | [02-composition-directive-registration.md](./02-composition-directive-registration.md) |
| 03 | Cache Backend Implementation (Redis + Memory) | [03-cache-backend-implementation.md](./03-cache-backend-implementation.md) |
| 04 | Router YAML Config Structs | [04-router-yaml-config.md](./04-router-yaml-config.md) |
| 05 | Composition Validation + Extraction Logic | [05-composition-validation-extraction.md](./05-composition-validation-extraction.md) |
| 06 | Router Config Builder — Proto Serialization | [06-router-config-builder.md](./06-router-config-builder.md) |
| 07 | Router Module Interface + Config Wiring | [07-router-module-config-wiring.md](./07-router-module-config-wiring.md) |
| 08 | Router FactoryResolver + Executor Integration | [08-factory-resolver-executor.md](./08-factory-resolver-executor.md) |
| 09 | Router GraphQL Handler + Graph Server Per-Request Wiring | [09-handler-graph-server.md](./09-handler-graph-server.md) |
| 10 | Entity Cache Metrics / Observability | [10-entity-cache-metrics.md](./10-entity-cache-metrics.md) |
| 11 | Integration Tests | [11-integration-tests.md](./11-integration-tests.md) |
| 12 | Extension-Based Invalidation + Subscription Cache | [12-extension-invalidation.md](./12-extension-invalidation.md) |
