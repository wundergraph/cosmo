# Persisted Operations

Persisted operations are stored queries, which can be executed just by providing the sha256hash of the operation to the router. This is useful for multiple purposes, including:

- large/frequently requested queries, which can be stored to avoid sending them over the network multiple times
- for security purposes, where a consumer can specify the specific operations which can be run, and the router can verify that the operation is one of the allowed ones

Specifically for those purposes, we enable three different methods of storing persisted operations:

1. **Persisted Operation Files** - This operation, documented [here](https://cosmo-docs.wundergraph.com/router/persisted-queries/persisted-operations), allows users to store persisted operations in files in a CDN/S3 bucket, which are then loaded by the router individually per request. This is useful for storing large queries and for only allowing registered operations.
2. **PQL Manifest (Recommended)** - When enabled, the router loads a single JSON manifest (`manifest.json`) containing all persisted operations at startup. The manifest uses the same `storage` config as persisted operations (both features are exclusive). When a `storage.provider_id` is configured, the manifest is loaded from that provider (S3, CDN, or filesystem) at startup (the file is resolved as `<object_prefix>/manifest.json`). When no storage provider is configured, the router fetches from the Cosmo CDN and polls for updates periodically. Operations are resolved entirely in-memory with zero per-request network overhead. When the manifest is enabled, it is authoritative — no fallback occurs for individual operations. We suggest using the PQL Manifest as the preferred method for persisted operations. See the `pqlmanifest` subpackage.
3. **Automatic Persisted Queries** - This setting allows users to automatically cache queries that are sent, as long as they are sent together with their sha256hash. This is a useful performance optimizer, as it allows the router to cache queries that are frequently requested, without the need to manually store them in a file.

These methods can exist in concert — for example, users can enable the PQL manifest for zero-latency lookups and use APQ to cache ad-hoc queries.

## Lookup Order

When a persisted operation request arrives, the router resolves it in this order:

1. **APQ cache** — if APQ is enabled and the hash is cached, use it
2. **In-memory normalization cache** — if the operation was previously resolved and cached locally
3. **PQL manifest** — if a manifest is loaded, look up the hash in-memory. If found, return the body. If not found, the manifest is authoritative: the operation does not exist (no CDN fallback)
4. **CDN/S3/FS fallback** — only when the manifest is **not** enabled, fetch the individual operation file from CDN, S3, or the filesystem

## Flows

> **Hash validation prerequisite:** When a request includes both a query body and `extensions.persistedQuery.sha256Hash`, the router validates the body against the hash and rejects the request if they do not match — _before_ any APQ or persisted-operation lookup occurs. See `router/core/graphql_prehandler.go` (`handleOperation`).

1. **Persisted Operations (CDN), no APQ** → The router fetches individual operations from CDN/S3 on demand. If a query is not found, the router returns an error. After the query is planned, the router caches the normalized query in the local persisted operation cache.
1. **PQL Manifest, no APQ** → The router loads the manifest (`manifest.json`) at startup from the configured storage provider (S3, CDN, or filesystem). When no storage provider is configured, the router fetches from the Cosmo CDN and polls for updates. When a storage provider is configured, the manifest is loaded once at startup. All lookups are in-memory. Unknown hashes are rejected immediately without any network call.
1. **APQ, No Persisted Operations** → If a `persisted_operation` request is sent, the router checks the APQ cache first. If not found, it checks if a query body was sent with the request. If so, it validates the hash against the body, then executes and caches it. Otherwise, the router returns an error.
1. **No APQ, No Persisted Operations** → If a persisted operation is sent, the router returns an error, as there are no persisted operations stored. Even if a query is sent, the router will still error because APQ isn't enabled.
1. **APQ and Persisted Operations** → The router validates any included query body against the hash, then checks APQ first, then the PQL manifest or CDN (depending on config), then checks if a query body was attached. First match wins.

## Enforcement Modes

- **safelist** — when enabled, only operations found in persisted storage (manifest or CDN) are allowed. Ad-hoc queries are rejected with `PersistedQueryNotFound`.
- **log_unknown** — when enabled, ad-hoc queries that are not in persisted storage are logged but still allowed. Combined with safelist, unknown queries are both logged and rejected.
