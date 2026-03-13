---
name: cosmo-dev-commands
description: Use when running lint, format, build, or test commands in the wundergraph/cosmo monorepo. Triggers when user asks to lint, format, check, build, test, or verify any workspace or file in the cosmo repo. Always use this skill before suggesting any dev command in cosmo — picking the wrong filter or tool wastes time.
---

# Cosmo Dev Commands

The cosmo monorepo mixes TypeScript workspaces (pnpm) and Go workspaces (make/go). Always pick the right tool based on which workspace is involved.

## TypeScript Workspaces

Use `pnpm --filter <package-name> <script>`.

| Directory           | Package name                 | lint | lint:fix | format | build | test |
| ------------------- | ---------------------------- | ---- | -------- | ------ | ----- | ---- |
| `controlplane/`     | `controlplane`               | ✓    | ✓        | ✓      | ✓     | ✓    |
| `studio/`           | `studio`                     | ✓    | ✓        | ✓      | ✓     | ✓    |
| `cli/`              | `wgc`                        | ✓    | ✓        | ✓      | ✓     | ✓    |
| `composition/`      | `@wundergraph/composition`   | ✓    | ✓        | ✓      | ✓     | ✓    |
| `shared/`           | `@wundergraph/cosmo-shared`  | ✓    | ✓        | ✓      | ✓     | ✓    |
| `connect/`          | `@wundergraph/cosmo-connect` | —    | —        | —      | ✓     | —    |
| `playground/`       | `@wundergraph/playground`    | —    | —        | ✓      | ✓     | —    |
| `cdn-server/`       | `cdn`                        | ✓    | —        | ✓      | ✓     | —    |
| `admission-server/` | `admission-server`           | —    | —        | ✓      | ✓     | —    |

**Examples:**

```bash
# lint
pnpm --filter controlplane lint
pnpm --filter studio lint
pnpm --filter @wundergraph/composition lint
pnpm --filter wgc lint

# format (Prettier)
pnpm --filter controlplane format
pnpm --filter studio format
pnpm --filter @wundergraph/composition format

# build
pnpm --filter controlplane build
pnpm --filter studio build

# test
pnpm --filter controlplane test
pnpm --filter @wundergraph/composition test
```

Use `lint:fix` to auto-fix lint errors. Use `test:coverage` where available.

## Go Workspaces

Run commands from inside the workspace directory.

| Directory            | lint           | format         | build            | test                                                                  |
| -------------------- | -------------- | -------------- | ---------------- | --------------------------------------------------------------------- |
| `router/`            | `make lint`    | `go fmt ./...` | `make build`     | `make test` / `make test-fresh` (clears cache) / `make test-coverage` |
| `graphqlmetrics/`    | `go vet ./...` | `go fmt ./...` | `go build ./...` | `go test ./...`                                                       |
| `aws-lambda-router/` | `go vet ./...` | `go fmt ./...` | `go build ./...` | `go test ./...`                                                       |
| `router-plugin/`     | `go vet ./...` | `go fmt ./...` | `go build ./...` | `go test ./...`                                                       |

## Root-level (all workspaces at once)

```bash
pnpm run build                      # build all TS workspaces
pnpm run -r --parallel test         # test all TS workspaces
pnpm run -r --parallel lint:fix     # lint:fix all TS workspaces
pnpm run -r --parallel format       # format all TS workspaces
```

Prefer `--filter` over root-level commands when working on a single workspace — it's faster and avoids noise.
