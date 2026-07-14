# Defer Advisor Demo

Three subgraphs with per-field artificial latency
(see `demo/pkg/subgraphs/deferdemo/latency.go`):

| Field | Subgraph | Latency |
|---|---|---|
| `Query.storefront` | catalog | 10ms |
| `Product.price` | pricing | 30ms |
| `Product.priceHistory` | pricing | 700ms |
| `Product.reviews` | reviews | 250ms |
| `Product.ratingSummary` | reviews | 40ms |

Note that `price`/`priceHistory` and `reviews`/`ratingSummary` each arrive in a
single entity fetch. Fetch-level tracing alone cannot tell which field is slow.
The advisor attributes latency to individual fields by splitting each candidate
field into its own labeled `@defer` fragment (a deferred fragment becomes its own
subgraph fetch) and timing the multipart parts.

## Prerequisites

- Go 1.25 or newer
- Node.js 22 and pnpm 9 (the first compose downloads the pinned `wgc` package)
- `curl`; `jq` is optional but makes the advisor response easier to read

## Run it locally

Compose the local execution config before starting the router. This command
reads the three schema files from `demo/pkg/subgraphs` and writes
`demo/defer-demo/config.json`:

```bash
DO_NOT_TRACK=1 pnpm dlx wgc@0.129.0 router compose \
  -i demo/graph-defer-demo.yaml \
  -o demo/defer-demo/config.json
```

Terminal 1 — subgraphs:

```bash
cd demo && go run ./cmd/deferdemo
```

The demo subgraphs listen only on localhost ports 4012–4014.

Terminal 2 — router (playground at http://localhost:3011):

```bash
cd router && go build -o /tmp/cosmo-router ./cmd/router
cd ../demo/defer-demo && CONFIG_PATH=router.yaml /tmp/cosmo-router
```

## Ask the advisor

```bash
curl -s http://localhost:3011/graphql \
  -H 'Content-Type: application/json' \
  -H 'X-WG-Defer-Advisor: enable' \
  -d '{"query":"query Storefront { storefront { id name price priceHistory { date value } reviews { id body stars } ratingSummary { average count } } }"}' \
  | jq .extensions.deferAdvisor
```

If `jq` is not installed, omit the final pipe to print the complete JSON
response.

Optional: `-H 'X-WG-Defer-Advisor-Runs: 5'` (default 3, max 10).

## Or use the playground (recommended)

Open http://localhost:3011, paste the query, and pick **Defer Advisor** from the
view dropdown (top right, next to the status badge).
Click **Analyze operation**: you get before/after time-to-first-result values,
per-field latency bars, and suggestion cards.
Click **Apply** on a suggestion (or **Apply all**) to rewrite the query in the
editor with the advised `@defer` fragments, then hit run —
the deferred response streams into the response pane.
(The embedded playground is rebuilt via `cd playground && pnpm build:router`,
then rebuild the router binary.)

The advisor returns per-fetch stats, per-field latency, ranked suggestions with
estimated marginal savings, an `optimizedQuery` with suggested `@defer`
placements, and a `validation` section containing the part-arrival times
measured during that analysis run. With the default artificial delays, a typical
idle local run attributes roughly 700ms to `priceHistory` and 30ms to `price`,
even though those fields begin in one entity fetch. Exact end-to-end timings vary
with the machine, build mode, and scheduler load.

## Feel the difference

The original query produces one JSON result, so its time to first result is
typically about 760ms on an otherwise idle local machine:

```bash
curl -s -N http://localhost:3011/graphql -H 'Content-Type: application/json' \
  -d '{"query":"query { storefront { id name price priceHistory { date value } reviews { id body stars } ratingSummary { average count } } }"}'
```

For the example optimized query below, typical local runs deliver the first
multipart part in roughly 57ms, the reviews part around 310ms, and the
`priceHistory` part around 760ms. Treat these as illustrative measurements, not
latency guarantees:

```bash
curl -s -N http://localhost:3011/graphql \
  -H 'Content-Type: application/json' -H 'Accept: multipart/mixed' \
  -d '{"query":"query Storefront { storefront { id name price ratingSummary { average count } ... @defer(label: \"pricing_priceHistory\") { priceHistory { date value } } ... @defer(label: \"reviews_reviews\") { reviews { id body stars } } } }"}'
```
