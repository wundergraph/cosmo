# Translate fields on execution-config reload

Run `./run.sh` from this directory with Docker Compose available. The script builds wgc and a router containing the `translator` module, starts a stub subgraph, sends GraphQL requests, and removes the containers and config volume on exit.

The subgraph returns `hello world` for greetings and `goodbye` for a farewell. On the first request for a graph, the module scans its composed schema for `@translate(language:)` on field definitions. It indexes rules by parent type and field name and caches them by the request's execution config. The cache holds up to eight graphs. Its translator accepts `hello world` and a supported language code. Other strings and unknown languages produce an error.

The test checks the response body as well as the schema hashes and effective subgraph URL. It exercises:

- Annotated root and nested fields and an unannotated field with the same name on another type.
- German and French feature flags, an unknown flag, and fallback after flag removal.
- A reload that removes an annotation from a root field and renames an annotated nested field.
- Same-version directive changes, routing-only changes, local URL overrides, and recovery after rejecting an invalid config.
- A separate client schema, the client-schema fallback, and removal of the composition opt-in.

`generate.mjs` creates the test configurations with `wgc router compose` from the checkout. To run the stack manually:

```sh
docker compose up --build --wait router
docker compose run --rm --no-deps test
docker compose down --volumes
```
