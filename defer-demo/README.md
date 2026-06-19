# Cosmo Router `@defer` Federation Demo

A self-contained federation demo that exercises the cosmo router's `@defer` implementation
across the full breadth of federation v2.
Seven gqlgen (Go) subgraphs with mock data, composed locally with `wgc`, served by the
branch router, and driven by a TypeScript test suite.

Nothing here is committed.

- `docs/DESIGN.md` — the build spec (topology, per-subgraph SDL, wire format, test matrix).
- `docs/FIXTURES.md` — the canonical mock dataset + expected normal-mode results.
- `docs/RESULTS.md` — the results (33/33 pass, observed defer semantics).
- `subgraphs/<name>/` — one self-contained Go module per subgraph.
- `tests/` — the vitest TypeScript suite.

## Topology

| Subgraph | Port | Role |
|----------|------|------|
| accounts | 4101 | users + organizations (home entities) |
| content | 4102 | articles + podcasts, unions/interfaces, provides |
| reviews | 4103 | reviews (slow), requires-computed reading time |
| recommendations | 4104 | related content + recommendations (slow), abstract types |
| metrics | 4105 | interface-object content stats (slow) |
| media | 4106 | media assets, entity interface, override |
| billing | 4107 | subscriptions/invoices (slow), composite + multiple keys |

Router: `localhost:3002`.

## Prerequisites

Go 1.25+, Node 24+, pnpm, and `wgc` on `PATH` (all present in this environment).

## Run it

From `defer-demo/`:

```bash
# 1. build subgraph binaries
mkdir -p bin
for sg in accounts content reviews recommendations metrics media billing; do
  (cd "subgraphs/$sg" && go build -o "../../bin/$sg" .)
done

# 2. start all 7 subgraphs
PORT=4101 ./bin/accounts        &
PORT=4102 ./bin/content         &
PORT=4103 ./bin/reviews         &
PORT=4104 ./bin/recommendations &
PORT=4105 ./bin/metrics         &
PORT=4106 ./bin/media           &
PORT=4107 ./bin/billing         &

# 3. compose the supergraph
wgc router compose -i graph.yaml -o config.json

# 4. run the BRANCH router (from the repo's router/ dir)
cd ../router
go build -o /tmp/cosmo-router cmd/router/main.go
EXECUTION_CONFIG_FILE_PATH="$PWD/../defer-demo/config.json" \
  DEV_MODE=true LISTEN_ADDR=localhost:3002 /tmp/cosmo-router

# 5. run the test suite (in another shell)
cd ../defer-demo/tests
pnpm install
ROUTER_URL=http://localhost:3002/graphql pnpm test
```

## Try a deferred query by hand

```bash
curl -N http://localhost:3002/graphql \
  -H 'content-type: application/json' \
  -H 'accept: multipart/mixed' \
  -d '{"query":"{ article(id:\"a1\"){ id title ... @defer { reviews { id rating } } } }"}'
```

You will see a `multipart/mixed; deferSpec=20220824` stream: an initial payload with
`pending`, followed by an `incremental` payload and a `completed` marker.
