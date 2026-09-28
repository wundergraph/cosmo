# PQL Manifest with Custom S3 Storage

This guide explains how to configure the Cosmo Router to load the PQL manifest from a custom S3-compatible storage provider (e.g. MinIO, DigitalOcean Spaces, Cloudflare R2) instead of the Cosmo CDN.

## Configuration

```yaml
version: "1"

persisted_operations:
  storage:
    # Path prefix inside the S3 bucket where the manifest file is stored.
    # The router resolves the manifest at: <object_prefix>/<file_name>
    # Example: with the prefix below and default file_name, the full object key is:
    #   operations/manifest.json
    object_prefix: "operations"
    # Must match the `id` of an entry in `storage_providers.s3`.
    provider_id: s3

  manifest:
    enabled: true
    # Name of the manifest file inside <object_prefix>/ (default: manifest.json).
    # Use a .gz or .zst extension to enable transparent decompression,
    # e.g. manifest.json.gz or manifest.json.zst.
    file_name: manifest.json
    # How often to poll S3 for manifest updates (default: 10s)
    poll_interval: 10s
    # Random jitter added to the poll interval (default: 5s)
    poll_jitter: 5s
    warmup:
      # Pre-plan all manifest operations so the first request is served from cache
      enabled: true
      # Concurrent workers for warmup (default: 4)
      workers: 4
      # Rate limit for warmup processing (default: 50)
      items_per_second: 50
      # Max time for warmup to complete (default: 30s)
      timeout: 30s

storage_providers:
  s3:
    - id: s3                # Referenced by persisted_operations.storage.provider_id
      bucket: ""            # S3 bucket name
      access_key: ""        # AWS access key or equivalent
      secret_key: ""        # AWS secret key or equivalent
      endpoint: ""          # S3-compatible endpoint *without* protocol (e.g. "s3.amazonaws.com" or "minio.internal:9000")
      region: ""            # Optional. AWS region (e.g. "us-east-1")
      secure: false         # Optional. Set to true to use HTTPS for the endpoint
```

## Behavior

- The manifest is loaded at startup and **polled periodically** for updates. The router uses `If-Modified-Since` conditional requests to avoid downloading an unchanged manifest, and compares the `revision` field to detect content changes.
- The manifest is **authoritative** for hash-only lookups against S3/CDN storage -- when enabled, individual per-request operation fetches from S3 are disabled. If an operation hash is not in the manifest, the request is rejected immediately. Exceptions: if **APQ** (Automatic Persisted Queries) is enabled, unmatched hashes are delegated to the APQ layer instead of being rejected; if `log_unknown` is enabled and the request includes a full query body, the unknown operation is logged and execution continues (hash-only requests without a body are still rejected).
- When warmup is enabled, new or changed operations are planned in the background after each manifest update, so that the first request for each operation is served from the plan cache.
- **Compression is supported**: if `manifest.file_name` ends with `.gz` or `.zst` (e.g. `manifest.json.gz`), the router decompresses the content transparently (gzip or Zstandard).
- **Filesystem providers are not supported** for the manifest. Only S3 and CDN providers can be used.

## Manifest Schema

The manifest file (configured via `manifest.file_name`, default `manifest.json`) is a JSON document with the following structure:

```json
{
  "version": 1,
  "revision": "rev-2024-01-15-abc123",
  "generatedAt": "2024-01-15T10:30:00Z",
  "operations": {
    "a1b2c3d4e5f6...": "query GetEmployees { employees { id name } }",
    "f6e5d4c3b2a1...": "mutation CreateUser($input: CreateUserInput!) { createUser(input: $input) { id } }"
  }
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `int` | Yes | Must be `1`. The router rejects manifests with any other version. |
| `revision` | `string` | Yes | An opaque revision identifier. Used to detect changes during polling. In CDN mode it doubles as an ETag. It can be any non-empty string (e.g. a git SHA, timestamp, or UUID). **You must change this value whenever you update the operations**, otherwise the router will not pick up the changes. |
| `generatedAt` | `string` | No | ISO 8601 timestamp of when the manifest was generated. Informational only; not used by the router. |
| `operations` | `map<string, string>` | Yes | A map of SHA256 hashes to GraphQL operation bodies. Keys are the SHA256 hash of the operation text. Values are the full GraphQL operation string. The field must be present (can be an empty `{}`). |

### Operation lookup

When a client sends a persisted query request with `extensions.persistedQuery.sha256Hash`, the router looks up the hash directly in the `operations` map. This is an O(1) in-memory lookup with no network overhead.
