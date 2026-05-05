# RFC-001: JetStream Cursor-Based Subscription Resumption

**Date:** 2026-05-05  
**Status:** Draft  
**Author:** TBD  
**Related:** [at-least-once-research.md](./at-least-once-research.md)

---

## Abstract

Expose JetStream stream sequence numbers as opaque _resume cursors_ in the GraphQL subscription protocol. When a client reconnects after a disconnect, it sends the last cursor it received. The router creates a new JetStream consumer starting from that sequence, replaying any missed messages before transitioning to live delivery. No external storage is required; JetStream itself is the replay log.

---

## Motivation

Today, when a WebSocket connection drops mid-subscription, the client re-subscribes and receives only events published _after_ the new connection is established. Events published during the outage are silently lost from the client's perspective.

JetStream already persists every published event with a monotonic stream sequence number. The router already acks JetStream messages after dispatching them (`adapter.go:154`). The gap is narrow: we need to (a) surface the sequence number to the client as a cursor, and (b) honor that cursor on reconnect to reposition the JetStream consumer.

This RFC proposes the minimum change required to close that gap for NATS JetStream-backed subscriptions.

---

## Scope

**In scope**:
- NATS JetStream-backed subscriptions (`@edfs__natsSubscribe` with `streamConfiguration`).
- `graphql-transport-ws` (graphql-ws) and `graphql-sse` transports.
- At-least-once delivery guarantee (duplicates may occur; clients must be idempotent).

**Out of scope**:
- Kafka-backed subscriptions (addressed in RFC-003).
- Exactly-once semantics.
- Client library implementation specifics.

---

## Design

### 1. Cursor Format

A _cursor_ is an opaque, URL-safe base64-encoded JSON object:

```json
{
  "v": 1,
  "s": "<stream-name>",
  "seq": 42
}
```

- `v` — version, for future evolution.
- `s` — JetStream stream name (needed to create a consumer on the right stream).
- `seq` — the stream sequence number of the last event delivered to the client.

Clients treat this as an opaque string. The encoding is an implementation detail.

### 2. Cursor Delivery to Client

Every `Next` message carries the cursor in the `extensions` field of the `ExecutionResult`:

```json
{
  "type": "next",
  "id": "sub-1",
  "payload": {
    "data": { "employeeUpdates": { "id": 1 } },
    "extensions": {
      "x-cosmo-cursor": "eyJ2IjoxLCJzIjoiZW1wbG95ZWVzIiwic2VxIjo0Mn0="
    }
  }
}
```

The cursor is only present when the underlying event originates from a JetStream source. Events from non-JetStream sources (e.g., Redis, engine-based subscriptions) do not include a cursor, and clients cannot resume those subscriptions.

### 3. Resuming a Subscription

On reconnect, the client passes the last received cursor in the `ConnectionInit` payload:

```json
{
  "type": "connection_init",
  "payload": {
    "x-cosmo-resume-cursor": "eyJ2IjoxLCJzIjoiZW1wbG95ZWVzIiwic2VxIjo0Mn0="
  }
}
```

The router decodes the cursor and stores the resume position for the connection. When a `Subscribe` message arrives for a JetStream-backed field, the router creates a JetStream pull consumer with:

```
DeliverByStartSequence: cursor.seq + 1
```

This replays all events after the last delivered sequence, then continues with live events.

For SSE, the cursor is passed as a custom HTTP header:

```
X-Cosmo-Resume-Cursor: eyJ2IjoxLCJzIjoiZW1wbG95ZWVzIiwic2VxIjo0Mn0=
```

Or as a query parameter:

```
GET /graphql/stream?x-cosmo-resume-cursor=eyJ...
```

### 4. Router Changes

#### 4.1 NATS Adapter: Expose Sequence Numbers

`router/pkg/pubsub/nats/adapter.go` — when fetching from JetStream, extract the stream sequence from the message metadata and attach it to the `MutableEvent`:

```go
meta, err := msg.Metadata()
if err == nil {
    event.SetHeader("x-nats-stream-seq", strconv.FormatUint(meta.Sequence.Stream, 10))
    event.SetHeader("x-nats-stream-name", meta.Stream)
}
```

#### 4.2 Subscription Updater: Attach Cursor to Extensions

`router/pkg/pubsub/datasource/subscription_event_updater.go` — before calling `UpdateSubscription`, encode the cursor from event headers and inject it into the response extensions.

#### 4.3 WebSocket Handler: Read Resume Cursor from `ConnectionInit`

`router/core/websocket.go` — parse `x-cosmo-resume-cursor` from `ConnectionInit.payload`. Store the decoded cursor on the connection context.

#### 4.4 DataSource Factory: Start Consumer at Cursor Position

`router/pkg/pubsub/nats/engine_datasource.go` — when a cursor is present in the context, create a consumer starting at `cursor.seq + 1` instead of `DeliverNew`.

### 5. Consumer Lifecycle

Because cursor-based consumers are created per-reconnect, they should be **ephemeral** by default (no durable name, auto-deleted by JetStream when the client disconnects). This avoids consumer accumulation from many reconnects.

If the subscription is expected to have very long disconnects (hours), the cursor consumer can optionally be made durable with a TTL driven by the stream's own retention window.

### 6. Ack Timing Fix

Currently `msg.Ack()` is called after dispatching to the `SubscriptionUpdater`, _before_ the WebSocket write completes. This means a network failure after ack but before write drops the message permanently.

This RFC changes the ack timing: `msg.Ack()` is called only after the WebSocket write is confirmed (i.e., after `Flush()` returns without error). If the write fails, the message is _not_ acked, and JetStream redelivers it after `AckWait`.

```
Old: fetch → dispatch → ack → write
New: fetch → dispatch → write → ack (on write success) | nack (on write failure)
```

This introduces a small duplication window (if the write succeeds but the ack is lost in the network), which is acceptable for at-least-once semantics.

### 7. Heartbeat and Cursor Consistency

To keep the cursor up-to-date during periods of inactivity, the router periodically sends a `Ping` with the latest cursor in its payload. The client updates its stored cursor on receipt, even if no events have arrived.

### 8. Client Responsibilities

A conforming client must:
1. Store the most recent `x-cosmo-cursor` received for each active subscription.
2. On WebSocket reconnect, include the cursor in `ConnectionInit.payload`.
3. Handle duplicate events (same data may arrive twice due to the at-least-once window). Deduplication can use the sequence number embedded in the cursor or a domain-level ID in the event payload.

A non-conforming client (no cursor support) receives the same behavior as today: live-only delivery, no replay.

---

## Failure Modes and Edge Cases

### JetStream Stream Retention

If the client is offline longer than the stream's retention window, `cursor.seq + 1` may no longer exist. JetStream will start the consumer from the earliest available sequence, potentially replaying a large number of events. The router signals this in the first resumed `Next` message via an extension field:

```json
"extensions": {
  "x-cosmo-cursor": "...",
  "x-cosmo-cursor-gap": true
}
```

The client can use this flag to indicate to the user that a gap occurred.

### Router Restart Between Disconnect and Reconnect

The cursor is entirely client-side. A router restart has no effect — the new router instance decodes the cursor and creates a fresh ephemeral consumer at the specified sequence.

### Multiple Router Instances

Because the cursor encodes the stream name and sequence (not a router-local state), any router instance can serve a reconnect. Load balancer stickiness is _not_ required.

### Clock Skew / Sequence Regression

JetStream stream sequences are monotonically increasing and assigned by the NATS server, not the router. There is no clock skew risk. If a cursor arrives with a sequence higher than the current stream head (which should be impossible in normal operation), the consumer is started at the stream head and `x-cosmo-cursor-gap: true` is set.

### Subscription Field Mismatch on Reconnect

If the client reconnects with a cursor but sends a different subscription query or variables, the cursor is silently ignored and the subscription starts at `DeliverNew`.

---

## Backward Compatibility

- Clients that do not send a cursor receive no change in behavior (live-only delivery).
- Clients that do not read the `extensions.x-cosmo-cursor` field are unaffected.
- No breaking changes to the `graphql-transport-ws` or `graphql-sse` protocols; the cursor uses the existing `extensions` and payload extension points.

---

## Tradeoffs

| Factor | Assessment |
|---|---|
| Complexity | Low: leverages existing JetStream durability. No new storage. |
| Router statefulness | None: cursor is client-held. Any router instance can serve any reconnect. |
| JetStream-only | Kafka, Redis, and engine subscriptions are not covered. |
| Duplicate handling | Required: at-least-once guarantees duplicates. Client must be idempotent. |
| Ack timing | Minor change with measurable duplication window during write failures. |
| Stream retention dependency | If the client is offline longer than retention, gaps occur. |
| Client changes required | Minimal: read and re-send cursor; handle duplicates. |
| GraphQL ecosystem compatibility | Works with Apollo Client, urql, and others via `extensions` field. |

---

## Alternatives Considered

**Use durable consumers per client**: creates O(clients) durable consumers, straining JetStream. Ephemeral consumers per reconnect are preferred.

**Encode cursor in subscription `id`**: the `id` is used for multiplexing and must be client-controlled. Overloading it would break existing protocol semantics.

**Store cursor server-side (session store)**: requires shared state between router instances. Addressed in RFC-003.

---

## Open Questions

1. Should cursor validity be validated against the stream's known sequence range before starting the consumer, or fail-open (gap + `x-cosmo-cursor-gap`)?
2. What is the recommended `AckWait` value when cursor-based consumers are in use? The current default of 30s may be too short for slow clients.
3. Should the cursor include a signature/HMAC to prevent clients from forging arbitrary sequence positions? (Security vs. simplicity tradeoff.)
4. Should `x-cosmo-cursor` be opt-in (disabled by default, enabled per-subscription or per-connection) or opt-out?
5. How should this interact with the `StreamReceiveEventHandler` hook, which can filter or modify events? Replayed events will also pass through the hook.

---

## Implementation Plan

1. Add `SetHeader` / `GetHeader` to `MutableStreamEvent` / `StreamEvent` interfaces (if not already present).
2. Modify NATS adapter to attach stream sequence and stream name as event headers.
3. Add cursor encoding/decoding utilities to `router/pkg/pubsub/`.
4. Modify `subscription_event_updater.go` to inject cursor into response extensions.
5. Modify `websocket.go` to parse and store resume cursor from `ConnectionInit`.
6. Modify NATS `engine_datasource.go` to honor resume cursor when creating consumers.
7. Change ack timing in `adapter.go` to post-write.
8. Add integration tests: reconnect with cursor, gap detection, multi-router reconnect.
9. Document the cursor protocol for client implementors.
