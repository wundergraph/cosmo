# Apollo Client 4 deferred response reproduction

The standalone `compose.yaml` starts a federation subgraph, composes its schema,
runs Cosmo Router, and executes a deferred query through Apollo Client 4.3.5.
All scripts and schemas are embedded in the file, so a downloaded copy works
without cloning this repository. It needs Docker Compose with `configs.content`
support and network access to pull images and install the pinned npm packages.
It publishes no host ports and needs no Cosmo account.

Run it from this directory, or pass `-f /path/to/downloaded/compose.yaml`:

```sh
docker compose run --rm client
```

The default router image, `ghcr.io/wundergraph/cosmo/router:0.364.1`, reproduces
the bug. Apollo first delivers the product ID, then its deferred name, then
reports `ServerParseError: Unexpected end of JSON input`. The command exits 1.
The router has appended an empty MIME part after its final JSON payload.

To verify the fix, build the router image from the repository root:

```sh
docker build -t cosmo-router:defer-multipart-fix router
ROUTER_IMAGE=cosmo-router:defer-multipart-fix \
  docker compose -f client-tests/apollo-client-4-defer/compose.yaml run --rm client
```

The fixed router delivers both results without the trailing error. The client
prints `PASS: Apollo received all deferred data without a trailing parse error`
and exits 0. The check waits for the HTTP response to end and for Apollo to
deliver any resulting error; stopping at the first complete result would hide
the bug.

Remove the reproduction's containers and generated graph when finished:

```sh
docker compose -f client-tests/apollo-client-4-defer/compose.yaml down --volumes
```
