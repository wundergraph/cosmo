# Cosmo threat model

## What this project does and where untrusted input enters

Cosmo is a GraphQL federation platform. The router accepts HTTP and WebSocket requests and calls configured subgraphs. The control plane manages organizations, graph configurations, and credentials. Studio and the CLI call the control plane. Other services distribute configurations, validate deployments, and collect metrics.

Treat GraphQL requests, headers, schemas, operation documents, subgraph responses, webhooks, and uploaded files as untrusted input. A tenant can control some of these inputs. External services can control others. Keep each organization's data and credentials separate. Review outbound requests when a user can influence a URL or a request header.

The control plane uses user sessions and API keys. Its access rules limit users to their organizations and roles. The router supports configured client authentication. Some deployments allow public GraphQL requests by design. A report about missing router authentication must show that the deployment requires it.

## Components that matter most and least

Prioritize the router, control plane, composition logic, CDN server, admission server, and shared authentication code. Review Studio and the CLI where they handle credentials or authorize changes. Review Go plugins and other services where they process untrusted input.

The `docs-website` package has lower priority. A flaw in a test fixture matters only when the same flaw reaches a supported deployment.

## How to exercise it

The scanner image contains the source, installed dependencies, and a built router at `/usr/local/bin/cosmo-router`. Run these commands inside the image without a network:

```sh
timeout 10 cosmo-router -help
cd /src
timeout 20 cosmo-router -config .oss-scanner/router-offline.yaml > /tmp/cosmo-router.log 2>&1 &
router_pid=$!
sleep 2
curl -fsS -H 'Content-Type: application/json' --data '{"query":"{ __typename }"}' http://127.0.0.1:3002/graphql
kill "$router_pid"
wait "$router_pid" 2>/dev/null || true
cd /src/router && GOPROXY=off timeout 180 go test ./pkg/authentication ./pkg/health
cd /src/composition && timeout 180 pnpm exec vitest run tests/v1/regexp.test.ts tests/v1/normalization-utils.test.ts
cd /src/controlplane && timeout -k 5 180 pnpm exec vitest run --config /src/.oss-scanner/vitest.controlplane.config.ts src/core/util.test.ts test/rbac-evaluator.test.ts test/timers.test.ts test/dual-blob-storage.test.ts
```

The smoke request returns `{"data":{"__typename":"Query"}}` without a subgraph. Other graph fields need running subgraphs. The offline Vitest configuration skips the Keycloak global setup for the selected control plane unit tests. Many other tests under `controlplane/test` start a database in their setup. The full integration tests need services such as Postgres, Redis, NATS, or ClickHouse. Those services do not run in this image.

## How you rate severity

Use [CVSS v3.1](https://www.first.org/cvss/v3.1/specification-document) because its Scope metric covers the trust boundaries in this model. Include the numeric Base Score and full Base vector in each report, for example 9.8 and `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H`.

Use the official score bands: None 0.0, Low 0.1-3.9, Medium 4.0-6.9, High 7.0-8.9, Critical 9.0-10.0.

- Privileges Required: An unauthenticated router request is PR:N. If exploitation needs a valid token, use PR:L or PR:H according to the token's permissions.
- Scope: Use S:C only when exploitation affects resources managed by a different security authority. Cross-organization access inside one deployment normally stays S:U. Score data disclosure or modification with C and I. Reaching a private service alone does not establish S:C.
- Attack Vector: Use AV:N for network-accessible HTTP or WebSocket requests. Use AV:L for an exploit that requires local access to the host.

State the entry point, required privileges, and deployment configuration in each report. Include a local reproducer and the expected result. Do not send test traffic to production services or include live credentials in reports.

## Anything to leave alone

Trace a problem in generated protobuf code to its source definition. Do not report the generated copy separately. Do not report a flaw in an external service unless Cosmo makes it exploitable. Treat example credentials and test data as fixtures unless they also appear in a supported deployment.
