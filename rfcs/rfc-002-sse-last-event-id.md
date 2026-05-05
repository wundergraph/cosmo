# RFC-002: SSE Transport with Last-Event-ID Replay

**Date:** 2026-05-05  
**Status:** Draft  
**Author:** TBD  
**Related:** [at-least-once-research.md](./at-least-once-research.md)

---

## Abstract

Add a Server-Sent Events (SSE) subscription transport to Cosmo that uses the browser's native `Last-Event-ID` reconnection mechanism for at-least-once delivery. Each event is assigned a sequential ID derived from the underlying broker's sequence number. On reconnect, the browser automatically sends `Last-Event-ID` and the router replays all events after that position from the broker's durable log. No client library changes are required beyond switching from WebSocket to `EventSource`.

---

## Motivation

The `graphql-transport-ws` protocol has no built-in replay mechanism. Any at-least-once guarantee over WebSockets requires application-level session tracking, which either requires shared router state (complex, stateful) or cursor management in the client (requires client library changes).

SSE solves this at the HTTP level. The HTML living standard defines `Last-Event-ID` as a first-class mechanism for exactly this use case: the browser automatically retains the last received event ID across reconnects and sends it in the `Last-Event-ID` request header. The server does not need to track per-client session state — it only needs to replay events from the log.

This RFC proposes implementing a new `graphql-sse`-compatible endpoint that:
- Uses `text/event-stream` as the content type.
- Sets the SSE `id:` field on every event from its broker sequence number.
- Replays events from JetStream or Kafka on reconnect based on `Last-Event-ID`.
- Works natively with `EventSource` (no custom client library required for basic use).

---

## Scope

**In scope**:
- New SSE subscription endpoint alongside the existing WebSocket endpoint.
- At-least-once delivery for JetStream-backed and Kafka-backed subscriptions.
- Native `EventSource` API compatibility (no required client library).
- `graphql-sse` protocol compatibility (enables existing `graphql-sse` clients to benefit).

**Out of scope**:
- Bidirectional acks (SSE is server-to-client only).
- Exactly-once semantics.
- Mutations or queries over SSE.
- Redis-backed subscriptions (no durable log).

---

## Background: SSE Reconnection Semantics

```
id: 42
event: next
data: {"id":"sub-1","payload":{"data":{"employeeUpdates":{"id":1}}}}
retry: 3000
```

When the EventSource connection drops:
1. The browser retains `lastEventId = 42`.
2. After `retry` milliseconds, the browser reconnects to the same URL.
3. The reconnect request includes `Last-Event-ID: 42`.
4. The server sees this header and replays events with id > 42 before resuming live delivery.

This is entirely automatic — the browser handles step 1–3 with zero client code. The server only needs to implement step 4.

---

## Design

### 1. Endpoint

New endpoint added to the Cosmo router:

```
GET /graphql/stream
```

Or alternatively, the existing `/graphql` endpoint is extended to return `text/event-stream` when:
- The request carries `Accept: text/event-stream`, or
- A `?stream=true` query parameter is present.

The subscription query, variables, and operation name are passed as query parameters:

```
GET /graphql/stream?query=subscription%7BemployeeUpdates%7Bid%7D%7D
```

Or via a prior `POST` that returns a subscription ID (Single Connection Mode as defined by `graphql-sse`):

```
POST /graphql/stream        → { "id": "sub-abc" }
GET  /graphql/stream/sub-abc
```

For simplicity, this RFC focuses on the single-subscription distinct-connections mode. Multi-subscription single-connection mode can be added later.

### 2. Event Format

Events follow the `graphql-sse` protocol format:

```
id: <broker-sequence>
event: next
data: <json-encoded-ExecutionResult>

```

```
id: <broker-sequence>
event: complete
data:

```

```
id: 0
event: error
data: <json-encoded-errors-array>

```

The `id` field is the broker sequence number:
- JetStream: `meta.Sequence.Stream`
- Kafka: `<partition>:<offset>` (e.g., `0:1042`)

Heartbeat (keep-alive) events keep the connection open and update `lastEventId`:

```
id: <last-seq>
: keep-alive

```

(A comment-only event — `:`-prefixed — is ignored by the EventSource parser but resets the connection timer and keeps `lastEventId` current.)

### 3. Reconnection and Replay

On an incoming request with `Last-Event-ID: <cursor>`:

**JetStream**:
1. Parse cursor as a stream sequence number.
2. Create an ephemeral pull consumer with `DeliverByStartSequence: cursor + 1`.
3. Drain buffered events (those with seq ≤ cursor) through the normal hook pipeline.
4. Once caught up (pending = 0), transition to live delivery.

**Kafka**:
1. Parse cursor as `<partition>:<offset>`.
2. Create a Kafka consumer for the topic, calling `consumer.Seek(partition, offset + 1)`.
3. Drain and transition to live delivery as above.

During the replay phase, the router marks the stream as "catch-up mode". The `StreamReceiveEventHandler` hook fires for replayed events just as it does for live events — so filtering, transformation, and authorization all apply consistently.

### 4. Cursor Encoding

For JetStream, the SSE `id` is the raw uint64 stream sequence number (decimal string): `"42"`.

For Kafka, where messages are identified by partition + offset, the cursor is `"<partition>:<offset>"`: `"0:1042"`. If the subscription covers multiple partitions, a cursor encodes the minimum offset per partition that the client has confirmed: `"0:100,1:55,2:220"`.

### 5. Router Changes

#### 5.1 New SSE Handler

`router/core/sse.go` (new file) — implements `http.Handler`:

```go
func (h *SSEHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "text/event-stream")
    w.Header().Set("Cache-Control", "no-cache")
    w.Header().Set("X-Accel-Buffering", "no") // disable nginx buffering
    flusher := w.(http.Flusher)

    lastEventID := r.Header.Get("Last-Event-ID")
    // ... parse query, plan subscription, create consumer at lastEventID+1
    // ... stream events as SSE frames
}
```

#### 5.2 NATS Adapter: Replay Mode

`router/pkg/pubsub/nats/adapter.go` — new `SubscribeFromSequence(ctx, seq, handler)` method that creates an ephemeral consumer at the given sequence.

#### 5.3 Kafka Adapter: Seek Support

`router/pkg/pubsub/kafka/adapter.go` — new `SubscribeFromOffset(ctx, partition, offset, handler)` method that creates a consumer group client and seeks to the specified offset.

#### 5.4 Flush Strategy

SSE requires immediate flushing after each event for low-latency delivery. The SSE handler calls `flusher.Flush()` after every event write. Batching multiple events (when the JetStream consumer returns multiple messages in one `Fetch()` call) can be done by writing all events first, then calling `Flush()` once per batch.

### 6. No Client Acks Required

SSE is unidirectional: the `Last-Event-ID` mechanism is the only feedback channel. This means:
- The server cannot distinguish "client received and processed" from "client received".
- The server acks the JetStream/Kafka message after writing the event to the SSE stream (after `Flush()` succeeds), not after client application processing.
- This is still a substantial improvement over the current behavior (no ack at all, events lost on disconnect).

For applications that require application-level acknowledgment, clients should send a `POST /graphql` mutation with the event ID (see RFC-004 for a schema-level approach).

### 7. HTTP/2 and Multiplexing

Under HTTP/1.1, browsers allow only 6 connections per origin. Each `EventSource` consumes one connection. For applications with multiple subscriptions from a single page, HTTP/2 is strongly recommended — it allows up to 100 concurrent streams (configurable) over a single TCP connection.

The router should explicitly document this constraint and recommend HTTP/2 in production.

### 8. CORS and Proxy Considerations

SSE with `Last-Event-ID` requires CORS pre-flight if the request is cross-origin. The router must include `Last-Event-ID` in the `Access-Control-Allow-Headers` response header.

CDNs and reverse proxies often buffer SSE streams. The router must set:
- `X-Accel-Buffering: no` (nginx)
- `Cache-Control: no-cache`
- `Connection: keep-alive`

### 9. Client Integration

**Native EventSource (minimal)**:

```js
const source = new EventSource(
  `/graphql/stream?query=${encodeURIComponent('subscription { employeeUpdates { id } }')}`
);
source.addEventListener('next', (event) => {
  const result = JSON.parse(event.data);
  console.log(result.payload.data);
});
source.addEventListener('error', (event) => {
  // Browser automatically reconnects with Last-Event-ID
});
```

The browser handles reconnection and `Last-Event-ID` automatically. Zero extra client code for at-least-once delivery.

**graphql-sse client library**:

```js
import { createClient } from 'graphql-sse';
const client = createClient({ url: '/graphql/stream' });
// graphql-sse handles SSE under the hood; same API as today
```

`graphql-sse` will automatically pass `Last-Event-ID` on reconnect because it uses the native `EventSource` (or a polyfill that does the same).

**Apollo Client / urql via adapter**:

Both Apollo Client and urql support custom link/exchange implementations. An SSE link/exchange wrapping the native `EventSource` or `graphql-sse` client would be a small community package. It does not require changes to Apollo Client or urql core.

---

## Failure Modes and Edge Cases

### Broker Retention Gap

If the client has been offline longer than the broker's retention window, the cursor sequence is no longer available. The router detects this and:
- For JetStream: if `DeliverByStartSequence` points to a deleted sequence, JetStream starts from the earliest available. The router signals the gap via an `event: gap` SSE event before the first replayed `next`.
- For Kafka: `seek()` to a deleted offset falls back to `auto.offset.reset=earliest`. Same gap signaling.

### Large Replay Backlog

If a client reconnects after a long outage, there may be thousands of events to replay. The router should:
1. Start streaming replayed events immediately (do not buffer all of them in memory first).
2. Apply backpressure: use JetStream pull with `FetchNoWait(100)` in a loop; write and flush each batch before fetching the next.
3. The client's `EventSource` will buffer incoming events in order; no special client handling needed.

### Duplicate Events During Reconnect

The last event before disconnect may have been written to the SSE stream but `flusher.Flush()` may have failed (or the TCP connection may have been severed mid-frame). On reconnect with the previous `Last-Event-ID`, the router will replay that event. Clients must be idempotent with respect to event IDs.

### Multiple Router Instances

SSE reconnection can hit any router instance (no sticky sessions required). The cursor is broker-native (stream sequence or partition:offset) and is interpreted independently by each router instance. This works correctly as long as the underlying broker (NATS server cluster or Kafka broker cluster) is shared.

### Connection Timeout at Load Balancer

Many load balancers have default HTTP timeouts of 60–300 seconds. SSE connections are long-lived. The router should:
- Send a keep-alive comment (`:\n\n`) every 15–30 seconds.
- Document that load balancers need to have their timeout configured (or disabled) for the SSE endpoint.

---

## Backward Compatibility

- The existing WebSocket endpoint is unchanged.
- The SSE endpoint is additive; no existing functionality is modified.
- Clients using `graphql-sse` today (which already exist in the ecosystem) can be pointed to the new endpoint with at-least-once delivery automatically.

---

## Tradeoffs

| Factor | Assessment |
|---|---|
| Client changes required | Minimal: switch from WebSocket to `EventSource`. No library changes needed. |
| Browser native support | `EventSource` is supported in all major browsers. Automatic reconnection. |
| Unidirectionality | No client-to-server acks over the same connection. Application acks require a separate POST. |
| HTTP/1.1 connection limit | 6-per-origin limit. HTTP/2 required for multiple concurrent subscriptions. |
| Kafka support | Requires Kafka consumer seek + consumer group management (RFC-001 does not cover Kafka). |
| Proxy/CDN buffering | Requires specific proxy configuration; documented but still a deployment concern. |
| Replay backlog | Large backlogs can cause slow catch-up; need streaming replay, not in-memory buffering. |
| JetStream + Kafka parity | Cursor encoding differs between providers; clients need to handle opaque cursors. |
| Router statefulness | None: no per-client server state needed. |

---

## Comparison with RFC-001

| | RFC-001 (WS + cursor) | RFC-002 (SSE) |
|---|---|---|
| Transport | WebSocket (existing) | SSE (new endpoint) |
| Kafka support | No | Yes |
| Client changes | Read cursor from extensions; send on reconnect | Switch to `EventSource`; browser handles rest |
| Browser native reconnect | No | Yes |
| Client acks | No | No (both are at-least-once; acks need RFC-004) |
| Router state | None | None |
| Multiple subscriptions per connection | Yes (WS multiplexing) | HTTP/2 stream multiplexing |

---

## Open Questions

1. Should the SSE endpoint be `/graphql/stream` (separate URL) or `/graphql` with `Accept: text/event-stream` content negotiation?
2. Should multi-subscription single-connection mode (token-based) be included in v1 or deferred?
3. How should the Kafka cursor be structured for multi-partition subscriptions? A compact encoding or a base64 JSON blob?
4. Should keep-alive events update `lastEventId`? (They must, to keep the cursor fresh even during quiet periods.)
5. What is the maximum replay window? Should the router enforce a maximum number of replayed events per reconnect to prevent abuse?
6. Should the SSE endpoint require authentication via a query parameter (for environments where cookies are not available)?
