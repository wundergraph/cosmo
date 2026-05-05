# RFC-003: Router-Managed Session Buffer

**Date:** 2026-05-05  
**Status:** Draft  
**Author:** TBD  
**Related:** [at-least-once-research.md](./at-least-once-research.md)

---

## Abstract

The router maintains a per-client session buffer in shared storage (JetStream Key/Value or Redis). When events are delivered from a broker, the router writes them to the buffer before acking the broker message. The client receives events from this buffer. On reconnect, the client sends a session token; the router replays unacknowledged events from the buffer. This approach works with _all_ backend providers (JetStream, Kafka, Redis) and requires no client protocol changes beyond passing a session token in `ConnectionInit`.

---

## Motivation

RFC-001 and RFC-002 require either JetStream or Kafka as the underlying broker (each of which provides a replayable log). Subscriptions backed by Redis pub/sub, or by engine-based GraphQL subscriptions (subgraph WebSocket), have no durable log and cannot be replayed from the source.

Additionally, both RFC-001 and RFC-002 require at least minor client library changes (reading a cursor extension or switching to SSE). This RFC is designed so that the only client change is passing a session token in the `ConnectionInit` payload — a change that can be added transparently to any GraphQL client using the existing `connectionParams` mechanism.

---

## Scope

**In scope**:
- At-least-once delivery for all provider types (JetStream, Kafka, Redis, engine subscriptions).
- `graphql-transport-ws` (graphql-ws) protocol.
- Client reconnection with session token replay.

**Out of scope**:
- Exactly-once semantics (still requires client-side deduplication).
- SSE transport (see RFC-002).
- Cross-datacenter replication of the session buffer.

---

## Design

### 1. Session Lifecycle

1. **Client connects** for the first time (no session token). Router generates a `sessionId` (UUID v7, time-ordered) and returns it in `ConnectionAck.payload`:

```json
{
  "type": "connection_ack",
  "payload": {
    "x-cosmo-session-id": "01926d8e-6b3a-7e0a-b1c2-3d4e5f6a7b8c"
  }
}
```

2. **Events are delivered** to the client. Before each event is written to the WebSocket, the router writes it to the session buffer with a monotonic sequence number. The event is marked `pending` in the buffer.

3. **Client sends an ack** (see section 4) for a sequence number. The router marks events ≤ that sequence as `acknowledged` in the buffer. Acknowledged events are eligible for GC.

4. **WebSocket disconnects** (client or network). Pending (unacknowledged) events remain in the buffer. The buffer has a TTL (default: 5 minutes, configurable).

5. **Client reconnects** with the session token in `ConnectionInit`:

```json
{
  "type": "connection_init",
  "payload": {
    "x-cosmo-session-id": "01926d8e-6b3a-7e0a-b1c2-3d4e5f6a7b8c"
  }
}
```

6. Router looks up the session buffer. All pending events (in order) are replayed to the client over the new WebSocket connection. New events continue flowing after the replay is complete.

7. **Session expires** (TTL exceeded, or client sends explicit `ConnectionComplete`). The buffer is deleted.

### 2. Buffer Storage Options

#### Option A: JetStream Key/Value

Use a JetStream KV bucket as the session buffer. Each key is `session:{sessionId}:{seq}`, value is the serialized event.

Pros:
- Already required by Cosmo for JetStream subscriptions.
- RAFT-replicated; survives individual NATS node failures.
- TTL natively supported via bucket `TTL` config.
- No additional infrastructure.

Cons:
- Additional load on the NATS cluster.
- KV is optimized for individual value access, not range scans. Listing `session:{sessionId}:*` keys requires a watcher, which is efficient but adds subscription overhead.

#### Option B: JetStream Stream per Session

Each session gets its own ephemeral JetStream stream (`cosmo-session-{sessionId}`) with a retention policy and TTL. Events are published to the stream. On reconnect, a consumer is created from the last acknowledged sequence.

Pros:
- Clean semantics: the session buffer is itself a JetStream stream with all its reliability properties.
- Replay is exactly the JetStream consumer pattern from RFC-001, applied to a session stream rather than the source stream.
- Natural backpressure and flow control.

Cons:
- Creates O(active-sessions) streams. JetStream has a practical limit on concurrent streams (~100k depending on hardware). For large deployments, this may be a bottleneck.
- Creating and deleting streams is more expensive than KV operations.

#### Option C: Redis

Use a Redis sorted set per session. Key: `cosmo:session:{sessionId}`, members: serialized events, scores: sequence numbers.

Pros:
- Redis is already a Cosmo provider (pub/sub).
- Sorted sets support range queries (`ZRANGEBYSCORE`) for efficient replay.
- `EXPIRE` for TTL.
- Widely understood by operators.

Cons:
- Redis is a separate infrastructure dependency (beyond NATS).
- Redis pub/sub is in-memory; durability depends on AOF/RDB config.
- If Redis is the source provider for the subscription, storing the buffer in the same Redis adds contention.

**Recommendation**: Option B (JetStream Stream per Session) for deployments that already use JetStream as a provider. Option C (Redis) as an alternative for deployments that do not use JetStream.

### 3. Event Sequencing

The router assigns monotonic sequence numbers to events within a session. These are independent of the broker's sequence numbers. The session sequence:
- Starts at 1 for each new session.
- Increments by 1 for each event delivered (or buffered, regardless of whether delivery succeeds).
- Is included in every `Next` message extension:

```json
{
  "type": "next",
  "id": "sub-1",
  "payload": {
    "data": { "employeeUpdates": { "id": 1 } },
    "extensions": {
      "x-cosmo-seq": 7
    }
  }
}
```

### 4. Client Acknowledgment

#### Option A: Cumulative Ack via `ConnectionInit`-Extension Message

The client sends a dedicated ack message over the existing WebSocket connection (a custom message type):

```json
{
  "type": "x-cosmo-ack",
  "payload": { "seq": 7 }
}
```

This acks all events ≤ seq 7. The server removes them from the session buffer (marks for GC).

The `x-cosmo-ack` message type is an extension to the `graphql-transport-ws` protocol. Servers that do not understand it must ignore it; clients that send it to non-supporting servers will see no effect.

#### Option B: Implicit Ack by Reconnection

When a client reconnects with a `sessionId` and provides a `lastSeq`, events ≤ `lastSeq` are implicitly acked:

```json
{
  "type": "connection_init",
  "payload": {
    "x-cosmo-session-id": "...",
    "x-cosmo-last-seq": 7
  }
}
```

No explicit ack message is needed. The tradeoff: events are only acked when the client reconnects, so the buffer may hold events longer than necessary.

#### Option C: Periodic Ack Extension

The client sends acks periodically (e.g., every 5 seconds or every 10 events), encoded as a heartbeat:

```json
{
  "type": "ping",
  "payload": { "x-cosmo-ack-seq": 7 }
}
```

This reuses the existing `Ping` message type's optional payload to avoid adding a new message type.

**Recommendation**: Option A (explicit ack message) for maximum flexibility. Option B as a lower-effort alternative for clients that prefer not to send acks.

### 5. Buffer Write Ordering

The critical ordering is:

```
Broker message received
  → Write event to session buffer (persist)
  → Write event to WebSocket (deliver)
  → On WebSocket success: mark buffer event as pending-ack-from-client
  → On WebSocket failure: event remains in buffer, will be replayed on reconnect
  → On client ack: mark buffer event as acknowledged
  → GC acknowledged events
```

The broker message (JetStream or Kafka) must only be acked _after_ the event is successfully written to the session buffer. This ensures that if the router crashes before writing to the buffer, the broker will redeliver.

```
Old: broker → ack broker → write WebSocket
New: broker → write buffer → ack broker → write WebSocket
```

If writing to the buffer fails, the router should _not_ ack the broker message. JetStream will redeliver after `AckWait`. The router should log and potentially circuit-break if the buffer is consistently unavailable.

### 6. Cross-Router Replay

Because the session buffer is stored in shared infrastructure (JetStream or Redis), any router instance can serve a reconnect. The `sessionId` is the only key needed to locate the buffer.

On reconnect:
1. Router A was serving the session; client reconnects to Router B.
2. Router B reads the `sessionId` from `ConnectionInit`.
3. Router B looks up the session buffer by key.
4. Router B replays pending events.
5. Router B re-establishes the live subscription from the broker (NATS/Kafka) from the position after the last buffered event.

Step 5 requires knowing where to resume the live subscription. The session buffer entry for each event must include the broker cursor (JetStream sequence or Kafka partition:offset) alongside the session sequence number. The router uses the maximum broker cursor in the buffer to create a new consumer at `brokerCursor + 1`.

### 7. Buffer Size Limits and Backpressure

The session buffer must be bounded to prevent runaway memory/storage growth.

**Hard limit**: maximum N events in the buffer (default: 1000). If the buffer is full and a new event arrives, the router closes the WebSocket connection with a `4400 Session buffer full` close code. The client must reconnect; the router creates a new session (old session is discarded) and starts fresh. The client observes an event gap.

**Soft limit**: when the buffer reaches 80% capacity, the router sends a `Ping` with `{"x-cosmo-buffer-pressure": 0.8}`. Clients that consume acks quickly will drain the buffer; clients that don't will hit the hard limit.

### 8. Session Expiry

Sessions expire after the TTL (default: 5 minutes from last disconnect). On expiry:
- The session buffer is deleted.
- If a client reconnects with an expired `sessionId`, the router creates a new session (no replay) and includes `"x-cosmo-session-expired": true` in `ConnectionAck`.

The TTL is configurable per-router:
```yaml
subscriptions:
  session_buffer:
    enabled: true
    ttl: 5m
    max_events: 1000
    storage: jetstream  # or redis
```

### 9. Client Integration

**Minimal client change** (any framework, any language):

```js
// Apollo Client
const wsLink = new GraphQLWsLink(createClient({
  url: 'ws://router/graphql',
  connectionParams: () => {
    const sessionId = sessionStorage.getItem('cosmo-session-id');
    return sessionId ? { 'x-cosmo-session-id': sessionId } : {};
  },
  on: {
    connected: (socket, payload) => {
      if (payload?.['x-cosmo-session-id']) {
        sessionStorage.setItem('cosmo-session-id', payload['x-cosmo-session-id']);
      }
    },
  },
}));
```

```js
// urql
import { createClient } from '@urql/core';
import { subscriptionExchange } from '@urql/core';
// same pattern: store session ID, pass on reconnect
```

Ack messages (Option A) require a slightly more involved client integration, but can be handled transparently in the `graphql-ws` client library by monkey-patching or wrapping the `next` callback. A thin wrapper package (`@wundergraph/cosmo-ws-client`) can handle this.

---

## Failure Modes and Edge Cases

### Buffer Storage Unavailable

If the session buffer storage (JetStream or Redis) is unavailable when an event arrives:
- The router falls back to _best-effort delivery_ (deliver without buffering, do not ack broker).
- Alert/metric emitted: `cosmo_session_buffer_unavailable_total`.
- JetStream will redeliver the broker message after `AckWait`. When the buffer recovers, delivery resumes.

### Router Crash Mid-Buffer-Write

If the router crashes after writing the event to the session buffer but before acking the broker:
- The broker redelivers the message to another router instance (or the same, after restart).
- The duplicate event is written to the buffer with a new session sequence number.
- The client sees a duplicate. Client deduplication via `x-cosmo-seq` (if the event was already in the buffer with the same broker sequence, the router deduplicates before writing).

### Client Sends Ack for Unknown Sequence

The router ignores acks for sequences it has already GC'd or that are out of range. No error is returned.

### Multiple Active Connections with Same Session

If a client opens two WebSocket connections with the same `sessionId` (browser tab duplication), both connections receive events. The buffer is written once per event; acking from one connection acks for all. This is acceptable behavior. If strict isolation is needed, the `sessionId` should be treated as single-use (invalidated when a new connection uses it).

---

## Backward Compatibility

- Clients that do not send a `sessionId` receive the existing at-most-once behavior.
- `ConnectionAck.payload` is extended with `x-cosmo-session-id`. Clients that ignore `ConnectionAck.payload` are unaffected.
- The `x-cosmo-ack` message type is additive; servers that do not support it ignore it.

---

## Tradeoffs

| Factor | Assessment |
|---|---|
| Provider coverage | All providers (JetStream, Kafka, Redis, engine). |
| Router statefulness | Session buffer requires shared storage. Added operational dependency. |
| Client changes | Minimal: store and pass session token. No library changes for basic use. |
| Buffer storage cost | O(unacked events × active disconnected sessions). Bounded by TTL and max_events. |
| Cross-router reconnect | Works: session buffer is in shared storage. |
| Duplicate risk | Low: broker cursor deduplication prevents duplicate buffer writes. |
| Complexity | Highest of all RFCs: buffer management, GC, cross-router replay, backpressure. |
| GraphQL ecosystem fit | Works with `graphql-ws` via `connectionParams` (Apollo Client, urql, gql-ws). |

---

## Comparison with Other RFCs

| | RFC-001 (WS cursor) | RFC-002 (SSE) | RFC-003 (session buffer) |
|---|---|---|---|
| Provider coverage | JetStream only | JetStream + Kafka | All providers |
| Router state | None | None | Shared storage required |
| Client changes | Cursor in extensions | Switch to EventSource | Session token in connectionParams |
| Kafka support | No | Yes | Yes |
| Redis support | No | No | Yes |
| Engine sub support | No | No | Yes |
| Acks to router | No | No | Yes (optional) |
| Broker ack timing | Post-write | Post-flush | Post-buffer-write |
| Buffer TTL dependency | No | No | Yes (events lost after TTL) |
| Infrastructure | NATS only | NATS or Kafka | NATS or Kafka + buffer store |

---

## Open Questions

1. Should the session buffer be enabled by default (opt-out) or disabled by default (opt-in)? Default-on improves reliability for all users but adds storage overhead.
2. Should acks from the client be required, or should the router use implicit acks (events are acked once the WebSocket write is confirmed, treating disconnects as the trigger for replay)? The latter simplifies the client but is more conservative about storage.
3. What is the right default TTL? 5 minutes covers most mobile network reconnects. Long-haul reconnects (hours) would require increasing this or combining with RFC-001/RFC-002's broker-native replay.
4. Should the session buffer be per-subscription or per-connection? Per-connection is simpler; per-subscription allows different TTLs for different subscriptions.
5. How should the buffer storage backend be selected in multi-provider setups (some subscriptions use JetStream, some use Kafka)?
6. Should the `x-cosmo-seq` extension be stable across reconnects (i.e., continuous sequence across sessions) or reset per-session?
