# Execution-config notifications for custom modules

Run the complete test from this directory:

```sh
./run.sh
```

Docker Compose builds the current checkout's wgc and a router containing the example module. No local Node or Go installation, Cosmo account, or published graph is required. The script removes its containers and generated-config volume on exit.

`composition.yaml` and `schema.graphql` are the wgc composition input. The generator invokes the actual `wgc router compose` command for every valid fixture. `compose.yaml` starts the generator, a GraphQL stub subgraph, the custom router, and the test client.

The module implements `OnExecutionConfigChange(context.Context, routerconfig.ExecutionConfig)` and parses `Query.hello`'s `@modulePolicy(role: ...)` argument from `cfg.Schema()`. It publishes an immutable metadata snapshot through an atomic pointer. Response headers expose the role, router and client SDL hashes, execution-config version, subgraph ID, name, effective routing URL, and notification count for assertions.

The test verifies:

1. Initial load delivers the exact router SDL, including the custom directive.
2. The module receives both the router schema and the separate client schema. The fixture uses `@tag` to force a separate client schema that filters the directive. Both accessors return the exact expected SDL text.
3. Changing the directive from `reader` to `writer` updates module metadata without restarting the router. Both configs have wgc's constant local version.
4. Changing only the subgraph URL delivers the new endpoint to the module with identical SDL.
5. A syntactically invalid candidate is explicitly rejected in the router log. Requests continue using the prior graph and module metadata; no notification occurs.
6. A subsequent valid config is accepted and updates the module again.
7. If composition omits the client schema, `ClientSchema()` falls back to `Schema()`. The test verifies that this matches the schema used by introspection.
8. A config with an unreachable composed URL serves queries through the local routing override. The module receives the effective URL.

The generator also asserts that removing `@composeDirective` removes the custom directive from the federated schema. The hook exposes existing composition output; it does not change directive-preservation rules or provide feature-graph SDLs.

Before the hook implementation, the first request has no `X-Schema-Role` header and the test fails with `module did not receive the directive-bearing SDL`.

To inspect the stack manually:

```sh
docker compose up --build --wait router
docker compose run --rm --no-deps test
docker compose logs router
docker compose down --volumes
```
