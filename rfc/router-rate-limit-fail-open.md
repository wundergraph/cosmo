---
title: "Router Rate Limit Fail Open"
author: Codex
---

# RFC: Router Rate Limit Fail Open

## Status

Draft.

## Summary

Cosmo Router currently treats rate limiting as a hard dependency on Redis. When rate limiting is enabled and Redis is unavailable, the router can fail during startup and rate-limited requests can fail at runtime. This RFC proposes an opt-in fail-open mode for rate limiting so operators can treat rate limiting as a best-effort safeguard instead of a router availability dependency.

The recommended design is:

- Add `rate_limit.fail_open.enabled`, defaulting to `false`.
- When enabled, allow router startup to continue if the configured Redis client can be created but the initial Redis health check fails.
- When enabled, allow individual requests to proceed if Redis rate-limit evaluation fails at runtime.
- Add a small degraded-state cooldown around rate-limit Redis calls to avoid paying the Redis timeout on every request during an outage.
- Add a fail-open Redis operation timeout so the first outage request and later probes are bounded.
- Keep configuration, key suffix expression, and invalid override errors fail-closed because those are configuration or request evaluation problems, not Redis availability problems.

## Motivation

The feature request in GitHub discussion [#2873](https://github.com/wundergraph/cosmo/discussions/2873) identifies two operational problems:

1. If Redis is unreachable at startup, the router fails to start.
2. If Redis becomes temporarily unavailable, requests that require rate-limit evaluation fail.

Issue [#1555](https://github.com/wundergraph/cosmo/issues/1555) reported the same runtime behavior earlier: rate-limited requests can turn into HTTP 500s when Redis is unavailable. PR [#1659](https://github.com/wundergraph/cosmo/pull/1659) added an initial `fail_open` option, but it was closed as stale and did not include tests or a strategy for avoiding per-request Redis timeout cost during outages.

For some operators, rate limiting is security-critical and should fail closed. For others, rate limiting is a best-effort overload or abuse control, and Redis unavailability should not take down the GraphQL gateway. The current router has only the fail-closed behavior.

## External Precedent

Popular gateways generally expose this as an operator-controlled failure mode rather than assuming one universal behavior.

| Gateway | Behavior | Notes for Cosmo |
| --- | --- | --- |
| Envoy | The HTTP rate limit filter has `failure_mode_deny`. If it is `true`, errors calling the rate-limit service return an error; otherwise failures are allowed through. Envoy also has `timeout`, `status_on_error`, and `failure_mode_deny_percent` for fractional fail-closed behavior. See [Envoy rate limit filter docs](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/rate_limit_filter.html) and [RateLimit proto docs](https://www.envoyproxy.io/docs/envoy/latest/api-v3/extensions/filters/http/ratelimit/v3/rate_limit.proto). | Strong precedent for explicit failure-mode configuration. Envoy defaults toward fail open unless `failure_mode_deny` is enabled. |
| Istio | Istio's global rate-limit task uses Envoy's filter and examples set `failure_mode_deny: true`. See [Istio rate limit task](https://istio.io/latest/docs/tasks/policy-enforcement/rate-limit/). | Mesh operators often choose fail closed for policy enforcement, reinforcing that Cosmo should keep the default fail closed. |
| Kong Gateway | The standard rate-limiting plugin has `fault_tolerant`, default `true`, which proxies requests even if Kong has trouble connecting to a third-party data store. See [Kong rate-limiting reference](https://developer.konghq.com/plugins/rate-limiting/reference/). | Strong precedent for default fail-open behavior in API gateway rate limiting, though changing Cosmo's default would be too risky. |
| Apache APISIX | The `limit-req` plugin has `allow_degradation`, default `false`. When enabled, APISIX continues handling requests without the plugin when the plugin or dependencies become unavailable. It also exposes Redis timeout settings. See [APISIX limit-req docs](https://apisix.apache.org/docs/apisix/3.13/plugins/limit-req/). | Strong precedent for an opt-in fail-open mode named as degradation, plus explicit timeout control. |
| NGINX / NGINX Gateway Fabric | Built-in rate limiting uses local shared memory zones. It does not depend on Redis for the common path; if a shared memory zone is exhausted, NGINX returns an error. It also supports dry-run mode. See [NGINX rate limiting docs](https://docs.nginx.com/nginx/admin-guide/security-controls/controlling-access-proxied-http/) and [NGINX Gateway Fabric RateLimitPolicy](https://docs.nginx.com/nginx-gateway-fabric/traffic-management/rate-limit/). | Avoiding an external dependency in the hot path is another valid resilience strategy, but it would not provide Cosmo's current distributed Redis semantics. |
| Tyk | Tyk documents multiple algorithms, including a default distributed limiter that does not use Redis in the request path and Redis-backed algorithms for stronger shared state. See [Tyk rate limiting docs](https://tyk.io/docs/api-management/rate-limit). | Local/distributed hybrid approaches can reduce dependency risk, but they are a larger feature than fail-open Redis handling. |
| Red Hat 3scale APIcast | Edge Limiting uses OpenResty shared dictionaries by default and can use Redis. It exposes error handling options such as `exit` or `log` for limiter errors. See [Red Hat 3scale APIcast policy docs](https://docs.redhat.com/en-us/documentation/red_hat_3scale_api_management/2.6/pdf/administering_the_api_gateway/). | Another precedent for choosing whether limiter failures stop request processing or are logged while processing continues. |

The common pattern is: gateways either keep rate-limit state local to avoid an external dependency, or they expose explicit fail-open/fail-closed configuration for external rate-limit dependencies.

## Current Cosmo Behavior

Relevant code paths:

- `router/core/router.go`: during startup, `bootstrap` creates `redisClient` when `rate_limit.enabled` is true.
- `router/internal/rediscloser/rediscloser.go`: `NewRedisCloser` creates the Redis client and calls `IsFunctioningClient`; if Redis does not respond with `PONG`, startup fails.
- `router/core/graph_server.go`: `buildGraphMux` creates `CosmoRateLimiter` when `redisClient` is present.
- `router/core/ratelimiter.go`: `RateLimitPreFetch` calls `redis_rate.Limiter.AllowN`; any error is returned to the resolver.
- `router/core/graphql_handler.go`: rate-limit exceeded errors are rendered as rate-limit responses, but Redis errors are ordinary internal errors.

This means Redis availability is required both at startup and during request execution.

## Goals

- Preserve current fail-closed behavior by default.
- Let operators opt into fail-open behavior for Redis availability failures.
- Cover both startup and runtime Redis outages.
- Avoid adding request latency on every request while Redis is known to be unavailable.
- Provide logs and metrics so fail-open operation is visible.
- Keep the implementation narrowly scoped to rate limiting, not all Redis usage.
- Keep invalid configuration and invalid key suffix expressions visible as errors.

## Non-Goals

- Do not replace Redis with a local rate limiter in this RFC.
- Do not change the rate-limit algorithm.
- Do not change default behavior for existing deployments.
- Do not make automatic persisted queries or other Redis-backed features fail open.
- Do not silently ignore invalid router configuration.

## Proposed Configuration

Add a nested fail-open configuration:

```yaml
rate_limit:
  enabled: true
  fail_open:
    enabled: false
    backend_unavailable_cooldown: 5s
    backend_operation_timeout: 100ms
```

Environment variables:

```bash
RATE_LIMIT_FAIL_OPEN_ENABLED=false
RATE_LIMIT_FAIL_OPEN_BACKEND_UNAVAILABLE_COOLDOWN=5s
RATE_LIMIT_FAIL_OPEN_BACKEND_OPERATION_TIMEOUT=100ms
```

JSON schema should document:

- `enabled`: when true, Redis availability failures allow requests to proceed without rate-limit enforcement.
- `backend_unavailable_cooldown`: how long to skip Redis rate-limit calls after a runtime Redis failure before probing Redis again.
- `backend_operation_timeout`: the maximum time a fail-open startup health check or runtime rate-limit Redis operation may spend before being treated as a Redis availability failure.

`backend_unavailable_cooldown` should default to `5s`. It should have a minimum of `1s` to avoid an accidental tight retry loop.

`backend_operation_timeout` should default to `100ms`. It should have a minimum of `1ms`. Operators can still tune Redis dial, read, write, and retry behavior through Redis URL options, but fail-open mode should provide a router-level upper bound so outage onset and probe requests do not inherit long Redis client defaults.

### Backend Naming

The current rate-limit implementation is Redis-only:

- `rate_limit.storage` is backed by `RedisConfiguration`.
- The router creates a Redis client during startup when rate limiting is enabled.
- `CosmoRateLimiter` uses `github.com/go-redis/redis_rate`.

Even so, new fail-open option names should describe the rate-limit backend rather than Redis specifically. The fail-open behavior is about dependency availability, not a Redis feature. Using `backend_unavailable_cooldown` and `backend_operation_timeout` keeps the new API usable if Cosmo later adds another distributed rate-limit backend or moves rate limiting to shared storage providers.

This RFC does not rename existing `RATE_LIMIT_REDIS_*` settings or change `rate_limit.storage`; those names are already part of the public Redis-specific configuration. A future backend abstraction should be handled in a separate RFC, for example by introducing an explicit storage backend type or provider reference.

### Why Nested Configuration?

PR #1659 proposed a top-level `rate_limit.fail_open: bool`. A boolean would be enough for the MVP, but a nested object gives us room for timeout/cooldown controls without later replacing a scalar field. APISIX and Envoy both expose more than a single boolean for failure behavior, and fail-open mode needs at least one timeout bound to avoid turning Redis outages into request-latency spikes.

## Runtime Semantics

When `rate_limit.fail_open.enabled` is false:

- Startup behavior is unchanged.
- Runtime Redis errors are returned as errors.

When `rate_limit.fail_open.enabled` is true:

- Startup:
  - Redis URL parsing and client construction errors still fail startup.
  - Redis health-check failures are classified before fail-open is applied.
  - Redis availability failures log a warning and startup continues with the Redis client.
  - Redis authentication, authorization, or configuration failures still fail startup.
  - The startup health check uses `backend_operation_timeout` when fail-open is enabled.
- Runtime:
  - If Redis is healthy, rate limiting works as it does today.
  - If `AllowN` returns a Redis availability error, the request is allowed and the limiter enters a degraded state.
  - While degraded, requests skip Redis rate-limit evaluation until `backend_unavailable_cooldown` has elapsed.
  - After the cooldown, one request probes Redis by attempting rate-limit evaluation. If it succeeds, normal enforcement resumes. If it fails, the request is allowed and the cooldown is extended.

This is deliberately a degraded-state cooldown, not a full circuit breaker with error-rate windows. The state should use compare-and-swap around a `probing` flag to ensure only one request attempts Redis after the cooldown. Other requests racing an in-flight probe fail open rather than piling onto Redis. The probing request must release the `probing` flag with `defer` so panics or early returns cannot leave the limiter permanently stuck.

## Error Classification

Fail open should apply to Redis dependency failures only.

Fail open should apply to errors returned by Redis operations such as:

- connection refused
- timeout
- context deadline exceeded from the limiter-owned `backend_operation_timeout`
- temporary network errors
- Redis availability errors such as `CLUSTERDOWN`, `LOADING`, or `TRYAGAIN`

Fail open should not apply to:

- invalid Redis URL configuration at startup
- missing Redis URLs
- invalid rate-limit override regex
- key suffix expression compile errors
- key suffix expression runtime errors
- missing request context
- request-context cancellation or deadline expiration
- Redis authentication or authorization errors such as `NOAUTH`, `WRONGPASS`, or `NOPERM`
- Redis script/configuration errors such as `NOSCRIPT` or `MOVED`

The implementation should add a small classifier for `AllowN` errors:

```go
func isRateLimitRedisAvailabilityError(err error, requestCtx context.Context, limiterCtx context.Context) bool {
    if err == nil {
        return false
    }
    if requestCtx.Err() != nil {
        return false
    }
    if errors.Is(err, context.Canceled) {
        return false
    }
    if errors.Is(err, context.DeadlineExceeded) && errors.Is(limiterCtx.Err(), context.DeadlineExceeded) {
        return true
    }
    var netErr net.Error
    if errors.As(err, &netErr) && netErr.Timeout() {
        return true
    }
    if errors.Is(err, syscall.ECONNREFUSED) || errors.Is(err, syscall.ECONNRESET) || errors.Is(err, syscall.ETIMEDOUT) {
        return true
    }
    msg := strings.ToUpper(err.Error())
    return strings.Contains(msg, "CLUSTERDOWN") || strings.Contains(msg, "LOADING") || strings.Contains(msg, "TRYAGAIN")
}
```

The exact implementation can be refined, but it must not fail open on client cancellation, authentication errors, or configuration errors. Startup should distinguish client construction/parsing errors from the health-check failure in `IsFunctioningClient`.

## Observability

Add logs:

- Warn when startup continues because Redis health check failed.
- Warn on the transition from healthy to fail-open degraded state.
- Info when Redis recovery is detected and enforcement resumes.
- Debug for skipped per-request rate-limit evaluation while degraded.

Add metrics:

- `router.rate_limit.fail_open`: counter, incremented when a request is allowed because fail-open mode bypassed Redis rate-limit enforcement.
- `router.rate_limit.backend_errors`: counter, incremented when Redis rate-limit evaluation fails.
- `router.rate_limit.degraded`: gauge, 1 while the limiter is degraded, 0 while healthy.

Metric labels should stay low cardinality. Good labels:

- `reason`: `redis_error`, `startup_health_check`
- `strategy`: `simple`

Do not label by rate-limit key.

## Response Extensions

When a request bypasses rate limiting because Redis is unavailable:

- Do not emit normal rate-limit remaining/reset stats, because no reliable decision was made.
- If response extensions are enabled, emit only a minimal degraded extension:

```json
{
  "rateLimit": {
    "degraded": true
  }
}
```

This requires extending the internal rate-limit stats state with a degraded flag. When degraded is true, `RenderResponseExtension` should return exactly the minimal degraded object above instead of the normal stats struct, so clients do not mistake zero-value `remaining`, `retryAfterMs`, or `resetAfterMs` values for an enforced rate-limit decision. It must not expose Redis errors to clients.

## Implementation Sketch

### Config

Modify `router/pkg/config/config.go`:

```go
type RateLimitConfiguration struct {
    Enabled             bool                        `yaml:"enabled" envDefault:"false" env:"RATE_LIMIT_ENABLED"`
    Strategy            string                      `yaml:"strategy" envDefault:"simple" env:"RATE_LIMIT_STRATEGY"`
    SimpleStrategy      RateLimitSimpleStrategy     `yaml:"simple_strategy"`
    Storage             RedisConfiguration          `yaml:"storage"`
    Debug               bool                        `yaml:"debug" envDefault:"false" env:"RATE_LIMIT_DEBUG"`
    KeySuffixExpression string                      `yaml:"key_suffix_expression,omitempty" env:"RATE_LIMIT_KEY_SUFFIX_EXPRESSION"`
    ErrorExtensionCode  RateLimitErrorExtensionCode `yaml:"error_extension_code"`
    FailOpen            RateLimitFailOpenConfiguration `yaml:"fail_open"`
}

type RateLimitFailOpenConfiguration struct {
    Enabled                  bool          `yaml:"enabled" envDefault:"false" env:"RATE_LIMIT_FAIL_OPEN_ENABLED"`
    BackendUnavailableCooldown time.Duration `yaml:"backend_unavailable_cooldown" envDefault:"5s" env:"RATE_LIMIT_FAIL_OPEN_BACKEND_UNAVAILABLE_COOLDOWN"`
    BackendOperationTimeout    time.Duration `yaml:"backend_operation_timeout" envDefault:"100ms" env:"RATE_LIMIT_FAIL_OPEN_BACKEND_OPERATION_TIMEOUT"`
}
```

Update:

- `router/pkg/config/config.schema.json`
- `router/pkg/config/testdata/config_defaults.json`
- `router/pkg/config/testdata/config_full.json`
- `router/pkg/config/fixtures/full.yaml`
- `docs-website/router/configuration.mdx`

Add validation so `backend_unavailable_cooldown >= 1s` and `backend_operation_timeout >= 1ms`.

### Redis Startup

Extend `router/internal/rediscloser.RedisCloserOptions`:

```go
type RedisCloserOptions struct {
    Logger         *zap.Logger
    URLs           []string
    ClusterEnabled bool
    Password       string
    FailOpen       bool
    PingTimeout    time.Duration
}
```

In `NewRedisCloser`, keep URL parsing errors fatal. If the client is created but `IsFunctioningClient` fails:

- return `(rdb, nil)` if `FailOpen` is true and the ping error is classified as Redis availability
- return an error if the ping error is classified as authentication, authorization, or configuration
- return the existing error otherwise

`IsFunctioningClient` should accept a context or timeout so fail-open startup can bound the initial ping. Other callers should continue to use the current fail-closed behavior. In this repository that means APQ Redis and Redis pubsub providers should either omit the new fields or pass `FailOpen: false`.

### Rate Limiter

Extend `CosmoRateLimiterOptions`:

```go
type CosmoRateLimiterOptions struct {
    RedisClient rd.RDCloser
    Debug       bool
    RejectStatusCode int
    KeySuffixExpression string
    ExprManager *expr.Manager
    Overrides []config.RateLimitOverride
    FailOpen config.RateLimitFailOpenConfiguration
    Logger *zap.Logger
}
```

Add a small internal state object:

```go
type rateLimitFailOpenState struct {
    enabled bool
    cooldown time.Duration
    operationTimeout time.Duration
    degraded atomic.Bool
    nextProbeUnixNano atomic.Int64
    probing atomic.Bool
}
```

`RateLimitPreFetch` flow:

1. Return normally for introspection, as today.
2. Generate the key and resolve overrides, as today. Do not fail open on these errors.
3. If fail-open degraded and cooldown has not elapsed, increment metrics and return `(nil, nil)`.
4. If cooldown elapsed, acquire the probe flag with compare-and-swap. If another request already owns the probe, increment metrics and return `(nil, nil)`.
5. Call `AllowN` with a limiter-owned timeout context derived from the request context.
6. On `AllowN` error:
   - If fail-open disabled, return the error.
   - If fail-open enabled and `isRateLimitRedisAvailabilityError` returns true, mark degraded, set next probe time, log the transition, increment metrics, mark the rate-limit stats as degraded, and return `(nil, nil)`.
   - Otherwise return the error.
7. On `AllowN` success:
   - If previously degraded, mark healthy and log recovery.
   - Continue normal allow/deny logic.

For WebSocket subscriptions, the same `RateLimitPreFetch` semantics should apply. Rate-limit decisions are made per fetch; an ongoing subscription that already started is not terminated only because Redis later enters degraded state. A Redis availability failure during subscription fetch rate-limit evaluation should fail open only when `rate_limit.fail_open.enabled` is true, using the same shared degraded state as HTTP requests.

## Alternatives Considered

### Alternative 1: Minimal Boolean Only

Add `rate_limit.fail_open: true` and allow startup/runtime failures directly. This is the smallest change and matches PR #1659.

Rejected as the recommended design because every request can pay Redis timeout latency during an outage.

### Alternative 2: Separate Startup and Runtime Flags

Use:

```yaml
rate_limit:
  fail_open:
    startup: true
    runtime: true
```

This gives precise control, but it likely adds configuration complexity before we have evidence that operators need separate behavior.
The current user request needs both startup and runtime behavior, and separate flags add configuration surface before there is evidence that operators need asymmetric behavior. This can be added later under the nested `fail_open` object if needed.

### Alternative 3: Local In-Memory Fallback

When Redis is unavailable, use a local per-router limiter. This gives some protection during Redis outages.

Rejected for this RFC because local fallback changes rate-limit semantics in multi-replica deployments and can mislead operators into thinking global limits still apply.

### Alternative 4: Change Default to Fail Open

Kong's standard plugin defaults to fault tolerant behavior, but Cosmo should not silently weaken existing deployments that may rely on fail-closed rate limiting for protection.

Rejected for backwards compatibility and security posture.

## Testing Plan

Unit tests:

- `router/internal/rediscloser/rediscloser_test.go`
  - startup fails when Redis is unreachable and fail-open is disabled
  - startup succeeds with a non-nil client when Redis is unreachable and fail-open is enabled
  - invalid Redis URL still fails even when fail-open is enabled
- `router/core/ratelimiter_test.go`
  - Redis `AllowN` error fails when fail-open is disabled
  - Redis `AllowN` error allows request when fail-open is enabled
  - request `context.Canceled` and request deadline errors do not enter fail-open degraded state
  - Redis auth/configuration errors do not enter fail-open degraded state
  - key suffix expression errors still fail when fail-open is enabled
  - degraded state skips Redis calls during cooldown
  - cooldown permits a single probe
  - probe flag is released after success and after failure
  - successful probe exits degraded state
  - degraded response extension emits only `{"degraded": true}`
  - metrics are incremented for Redis errors, fail-open bypasses, and degraded gauge transitions

Config tests:

- Update config default and full fixture snapshots.
- Validate JSON schema accepts `rate_limit.fail_open`.
- Validate duration parsing and minimum value behavior.
- Validate fail-open enabled with empty Redis URLs still fails.

Integration-style tests if practical:

- Start router with rate limiting enabled and Redis unavailable; verify startup succeeds only with fail-open enabled.
- Start router with rate limiting enabled, fail-open enabled, and Redis unavailable; verify initial requests bypass rate limiting, then start Redis, wait for the cooldown/probe path, and verify subsequent requests are enforced by Redis-backed rate limiting.
- Start with Redis available, stop Redis, verify request succeeds while fail-open enabled and fails when disabled.
- Restart Redis, verify rate limiting resumes after cooldown.

## Rollout

1. Add config and schema with default disabled.
2. Add startup fail-open behavior.
3. Add runtime fail-open behavior with degraded-state cooldown.
4. Add metrics and logs.
5. Update documentation.
6. Mention in release notes that the feature is opt-in and rate limits are not enforced while degraded.

## Security Considerations

Fail-open mode weakens rate limiting during Redis outages. The documentation must state that:

- Requests are allowed without rate-limit enforcement while Redis is unavailable.
- This mode is intended for deployments where availability is preferred over strict rate-limit enforcement.
- Operators who use rate limiting as a security boundary should keep the default fail-closed behavior.

## Open Questions

1. Should the degraded response extension be enabled under the existing `hide_stats_from_response_extension` flag, or should it have its own flag?
2. Should Redis availability error classification include additional Redis server states beyond `CLUSTERDOWN`, `LOADING`, and `TRYAGAIN`?
3. Should we later add separate startup/runtime flags if operators ask for asymmetric behavior?

## Resolved Decisions

- Startup and runtime fail-open remain coupled under one `enabled` flag for the first version.
- `backend_unavailable_cooldown` is configurable in the first version.
- Redis operations in fail-open mode are bounded by `backend_operation_timeout`.
- `AllowN` errors are classified before fail-open is applied.
- WebSocket subscription fetches use the same fail-open behavior as HTTP request fetches.
- Other Redis-backed features, including APQ and Redis pubsub providers, remain fail closed.

## Recommendation

Implement opt-in fail-open with degraded-state cooldown behavior, an explicit Redis operation timeout, narrow error classification, and deterministic degraded response extensions. This matches the operational need in discussion #2873, preserves current fail-closed defaults, follows patterns from Envoy/APISIX/Kong, and avoids turning Redis outages into either full request outages or repeated per-request timeout penalties.
