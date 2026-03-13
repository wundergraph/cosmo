# Router Integration Tests

## Directory Structure

Tests are organized into subdirectories by functional area. New test files added to any subdirectory are automatically included in CI — no matrix or config changes needed.

| Directory | Purpose |
|-----------|---------|
| `observability/` | Prometheus metrics, logging, metrics exporters |
| `security/` | Auth, TLS, mTLS, error handling, circuit breakers, rate limiting |
| `operations/` | Caching, persisted ops, normalization, query plans, introspection |
| `subscriptions/` | WebSocket, HTTP subscriptions |
| `protocol/` | GraphQL/HTTP protocol, headers, uploads, config, plugins |
| `events/` | NATS, Kafka, Redis event-driven subscriptions |
| `telemetry/` | OpenTelemetry tracing and metrics |
| `connectrpc/` | ConnectRPC/gRPC subgraph integration |
| `lifecycle/` | Router startup, shutdown, goroutine leaks |
| `modules/` | Custom router modules |
| `fuzzquery/` | Fuzz testing for query parsing |

Shared test helpers live in `testutils/` and `testenv/` (test environment setup). Subdirectories import shared helpers via `"github.com/wundergraph/cosmo/router-tests/testutils"`.

### Testdata Layout

Each subdirectory keeps its own `testdata/` for test fixtures specific to that area. Shared testdata (e.g., TLS certificates used by both `security/` and `events/`) lives in `testdata/` at the router-tests root.

Go tests run with CWD set to the package directory, so use simple relative paths: `testdata/...` for local fixtures, `../testdata/...` for shared fixtures, `../../router/...` for the router package.

| Location | Contents | Used By |
|----------|----------|---------|
| `operations/testdata/` | Query plan fixtures, introspection schemas, cache warmup fixtures | operations |
| `protocol/testdata/` | Router configs, query fixtures, MCP operations, tracing | protocol |
| `fuzzquery/testdata/` | Fuzz corpus | fuzzquery |
| `testdata/tls/` | TLS certificates (shared) | security, events |
| `testdata/connectrpc/` | Generated protobuf client stubs (Go package) | connectrpc |
| `testenv/testdata/` | Embedded router configs, CDN | all (via testenv) |

## Test Synchronization Architecture

Tests synchronize with the engine via `SyncReporter` (`testenv/sync_reporter.go`), a channel-based wrapper around `EngineStats` that is injected into the router at test setup. It emits typed `Event` values on a buffered channel whenever a Reporter method is called (subscription added, trigger fired, message sent, etc.).

**Two synchronization mechanisms:**
- **Predicate-based** (`Wait()` on inner `EngineStats`): Used by `WaitForSubscriptionCount`, `WaitForTriggerCount`, etc. Best for "wait until absolute count matches" conditions.
- **Channel-based** (`Events()` channel): Used by `NATSPublishUntilReceived` and `KafkaPublishUntilReceived`. Best for "wait until this specific event happens" patterns.

Tests access the `SyncReporter` through `e.syncReporter()` or via the existing `WaitFor*` helpers which delegate internally.

## Writing Reliable Tests

### 1. NATS/Kafka/Redis subscription tests: use warm-up before publishing

**Problem:** After `WaitForSubscriptionCount` and `WaitForTriggerCount`, the internal subscription pipeline may not be fully wired up. A direct `Publish()` can be silently lost, causing timeouts.

**Fix:** Use the `*PublishUntilReceived` methods for the first message. These helpers publish, wait for a `SubscriptionUpdateSent` event on the SyncReporter channel, and retry if the message was lost. All three event systems have a safe variant:
- `NATSPublishUntilReceived` / `NATSPublishUntilMinMessagesSent` (for fan-out)
- `KafkaPublishUntilReceived`
- `RedisPublishUntilReceived`

```go
// WRONG — message can be lost to race condition
xEnv.WaitForSubscriptionCount(1, timeout)
xEnv.WaitForTriggerCount(1, timeout)
err = conn.Publish(subject, data)
conn.Flush()
xEnv.WaitForMessagesSent(1, timeout)  // may timeout forever

// RIGHT — retries until delivery is confirmed via SyncReporter event
xEnv.WaitForSubscriptionCount(1, timeout)
xEnv.WaitForTriggerCount(1, timeout)
xEnv.NATSPublishUntilReceived(conn, subject, data, 1, timeout)
// or: xEnv.KafkaPublishUntilReceived(topic, message, 1, timeout)
// or: xEnv.RedisPublishUntilReceived(topic, message, timeout)
```

### 2. Error-testing with intentionally bad messages: warm up first, then single-send

**Problem:** `PublishUntilReceived` retries on failure. If the message is intentionally invalid, retries produce duplicates that pollute the subscription channel.

**Fix:** First confirm the pipeline is active with a valid warm-up message via `PublishUntilReceived`. Then use a single non-retrying publish for the bad message.

```go
// Warm-up: confirm pipeline is active
xEnv.NATSPublishUntilReceived(conn, subject, validMsg, 1, timeout)
// read and validate the warm-up response...

// Now send the intentionally bad message (single publish, no retry)
conn.Publish(subject, invalidMsg)
conn.Flush()
// read and validate the error response...
```

### 3. WebSocket reads: use `WSReadJSON` instead of `conn.ReadJSON`

**Problem:** `conn.ReadJSON()` blocks forever if the expected message never arrives (e.g., due to a lost publish). The test hangs until the 8-minute Go test timeout kills it.

**Fix:** Use `testenv.WSReadJSON` (or `testenv.WSWriteJSON` for writes) which has built-in retry with 2-second deadlines per attempt and exponential backoff (up to 10 retries).

```go
// WRONG — hangs indefinitely if no message arrives
err = conn.ReadJSON(&msg)

// RIGHT — retries with deadline, fails fast after ~20 seconds
err = testenv.WSReadJSON(t, conn, &msg)
```

Only use manual `SetReadDeadline` + `conn.ReadJSON` when you expect an error (e.g., websocket close after config hot reload):

```go
conn.SetReadDeadline(time.Now().Add(5 * time.Second))
err = conn.ReadJSON(&msg)  // may return websocket.CloseError
conn.SetReadDeadline(time.Time{})
```

### 4. Non-deterministic order: sort before asserting

**Problem:** Metrics, spans, or other collections may appear in non-deterministic order. Asserting on index positions (`metrics[0]`) fails intermittently.

**Fix:** Sort the collection by a stable key before making positional assertions.

```go
sort.Slice(metrics, func(i, j int) bool {
    return metrics[i].Labels["subgraph"] < metrics[j].Labels["subgraph"]
})
require.Equal(t, "employees", metrics[0].Labels["subgraph"])
```

### 5. Flaky test prefix convention

Tests known to be flaky use the `TestFlaky` prefix (e.g., `TestFlakyNatsEvents`). CI runs these with `test_retry_count=3` and a separate `-run '^TestFlaky'` pass. Once the root cause is fixed, move tests back to their non-flaky parent function.

### 6. Periodic exporters: wait for ALL expected items, not just one

**Problem:** When testing a periodic exporter (e.g., metrics log exporter with a 90ms interval), waiting for a single item to appear then asserting all items are present races — the exporter may not have exported everything in one cycle.

**Fix:** Use `require.Eventually` to wait for ALL expected items to appear, not just one sentinel value.

```go
// WRONG — only waits for one metric, then asserts all are present
require.Eventually(t, func() bool {
    return findMetricLog(logs, "router.http.requests") != nil
}, 5*time.Second, 100*time.Millisecond)
for _, m := range scopeMetric.Metrics {
    require.NotNil(t, findMetricLog(logs, m.Name)) // may fail for other metrics
}

// RIGHT — waits for every expected item
require.Eventually(t, func() bool {
    logs := observer.FilterMessage("Metric").All()
    for _, m := range scopeMetric.Metrics {
        if findMetricLog(logs, m.Name) == nil {
            return false
        }
    }
    return true
}, 5*time.Second, 100*time.Millisecond)
```

### 7. Async hook invocation: poll before asserting counts

**Problem:** Module hooks (e.g., `OnStartSubscription`) may fire asynchronously after `WaitForSubscriptionCount` returns. Asserting `HookCallCount` immediately can see `0` because the hook hasn't executed yet.

**Fix:** Use `require.Eventually` to poll for the expected hook count before asserting.

```go
// WRONG — hook may not have fired yet
xEnv.WaitForSubscriptionCount(1, timeout)
assert.Equal(t, int32(1), customModule.HookCallCount.Load()) // may be 0

// RIGHT — poll until hook fires
xEnv.WaitForSubscriptionCount(1, timeout)
require.Eventually(t, func() bool {
    return customModule.HookCallCount.Load() >= 1
}, time.Second*10, time.Millisecond*50)
```

### 8. Buffered channels in worker pools: prevent goroutine leaks on context cancellation

**Problem:** When a worker pool uses an unbuffered completion channel and the main goroutine exits early (e.g., via context cancellation), workers block forever on sends, leaking goroutines and potentially crashing the process.

**Fix:** Always buffer completion channels with capacity equal to the number of workers so sends never block when the receiver has stopped listening.

```go
// WRONG — workers block on send if main goroutine exits via <-done
itemCompleted := make(chan struct{})

// RIGHT — buffered, workers can always send and exit cleanly
itemCompleted := make(chan struct{}, workerCount)
```

## Key Test Helpers

| Helper | Location | Purpose |
|--------|----------|---------|
| `SyncReporter` | `testenv/sync_reporter.go` | Channel-based wrapper around EngineStats for test synchronization |
| `NATSPublishUntilReceived` | `testenv/testenv.go` | Publish NATS message with retry until `SubscriptionUpdateSent` event received |
| `KafkaPublishUntilReceived` | `testenv/testenv.go` | Same pattern for Kafka |
| `RedisPublishUntilReceived` | `testenv/testenv.go` | Same pattern for Redis |
| `WSReadJSON` / `WSWriteJSON` | `testenv/testenv.go` | WebSocket read/write with retry + read deadline (10 attempts, exponential backoff) |
| `WSReadMessage` / `WSWriteMessage` | `testenv/testenv.go` | WebSocket raw message read/write with retry + deadline |
| `WaitForSubscriptionCount` | `testenv/testenv.go` | Wait for subscription count to reach exact value (predicate-based) |
| `WaitForTriggerCount` | `testenv/testenv.go` | Wait for trigger count to reach at least N (predicate-based) |
| `WaitForMessagesSent` | `testenv/testenv.go` | Wait for MessagesSent to reach at least N (predicate-based) |
| `ConfigureAuth` | `testutils/utils.go` | Set up JWKS auth for tests |
| `ToPtr` | `testutils/utils.go` | Generic pointer helper |
| `EmployeesIDData` | `testutils/utils.go` | Standard expected response constant |

<!-- CI stability run: 10 of 10 -->
