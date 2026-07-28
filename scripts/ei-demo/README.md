# The Entity Intelligence demo

`make ei-demo` takes a clone of this repo and produces a running Entity
Intelligence demo: hub on <http://localhost:3301> showing a `cosmo-demo` graph
whose schema came from cosmo, with the Entity Intelligence panel populated by
real traffic.

Three documents, three jobs. This one says what happens. `RUNBOOK.md` says why
the awkward parts are the way they are, one section per problem that cost
someone a day. `TESTING.md` is for running the demo on a machine you already
develop on, including backup and restore.

## What you need

A clone of cosmo on the demo branch, a GitHub SSH key (hub is private and gets
cloned for you), Docker, and a liveblocks.io secret key, which hub's backend
will not boot without and nothing can generate for you. `k6` is optional but
without it the Entity Intelligence panel has no traffic to describe.

```bash
make ei-demo HUB_LIVEBLOCKS_SECRET_KEY=sk_...
```

Roughly 30 to 45 minutes on a fresh clone, most of it install and build.

## The three repositories

The demo spans cosmo, hub, and graphql-go-tools. Only cosmo is yours to clone:
the other two are cloned as siblings if missing, and switched to their demo
branch if they are on another one and clean. A checkout with uncommitted work
is never touched, the run stops instead.

```
<parent>/cosmo                 milinda/entity-caching-3-feature-flag-rollout-router
<parent>/hub                   milinda/entity-intelligence-1          # HUB_DIR
<parent>/graphql-go-tools      milinda/entity-intelligence            # GGT_DIR
```

## What the bootstrap does, in order

`bootstrap-entity-intelligence-demo.sh` is one long idempotent script. Every
step checks its own state first, so re-running after a failure resumes rather
than starting over.

1. **Prerequisites, install, build, infra.** Cosmo's own toolchain, then its
   docker services. Cosmo's Keycloak is deliberately scaled to zero, see
   "one Keycloak" below.
2. **`.env` files** for controlplane, graphqlmetrics, router and cli, copied
   from their examples if absent.
3. **Hub.** Cloned or branch-switched, then `make all` brings up its infra,
   migrates, seeds, and links its users to the Cosmo identity provider. The
   Entity Intelligence frontend flag is written *before* hub's dev servers
   start, because a `NEXT_PUBLIC_*` value is compiled in at startup.
4. **Migrate and seed** the control plane, then verify no migration was
   silently skipped by a stale volume.
5. **Align the demo identity** and verify the whole login chain resolves to the
   `wundergraph` organisation. This gate is the difference between a clear
   failure here and an unexplained browser timeout twenty minutes later.
6. **Provision the demo graph**: create `mygraph`, publish the seven demo
   subgraphs, mint a router token.
7. **Entity Intelligence config**: wire the graphql-go-tools sibling in through
   `router/go.work` and layer an EI-only router config in through
   `CONFIG_PATH`. Both files are gitignored; `router/go.mod` and
   `router/demo.config.yaml` are never edited.
8. **Import the schema into hub** by driving hub's own "Create Graph → Cosmo"
   wizard in a headless browser, since hub has no password-login API.

`start.sh` then runs the demo itself: control plane, graphqlmetrics, the demo
subgraphs, the router, and a k6 traffic burst that gives Entity Intelligence
something to analyse. It stays in the foreground holding the stack up.
`make ei-demo-down` stops everything it started.

## One Keycloak

Hub brokers every login through its own Keycloak on 8090, and the control plane
validates tokens against it, so the demo seeds its identity there too and never
starts cosmo's. An earlier version seeded into cosmo's Keycloak on 8080 while
the runtime used hub's, which meant the identity was created in a server
nothing consulted, and a large repair mechanism existed purely to reconcile the
two. Deleting that split removed the single largest source of demo failures.

The one instance still hosts two realms, `hub` and `cosmo`, with a broker
between them. That is hub's own auth design, not demo scaffolding.

## When something breaks

Failures are meant to name themselves: the error says which link broke and the
command that repairs it. If you get one that does not, that is a bug worth
reporting, because the whole point of the identity gate and the import
diagnostics is that nobody should have to read a stack trace to find out that a
local `.env` drifted.

`RUNBOOK.md` has the long form for each guard, including the ones that refuse
to act rather than risk destroying local state that is not the demo's.
