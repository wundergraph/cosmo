# At-Least-Once Delivery: Research & Prior Art

**Date:** 2026-05-05  
**Author:** Research compilation  
**Status:** Reference

---

## 1. Delivery Guarantee Taxonomy

| Guarantee | Meaning | Duplicate risk | Loss risk |
|---|---|---|---|
| At-most-once | Delivered zero or one time | No | Yes |
| At-least-once | Delivered one or more times | Yes | No |
| Exactly-once | Delivered exactly once | No | No |

Exactly-once is the most expensive and, in distributed systems, always involves some form of distributed coordination or idempotent processing at the consumer.

---

## 2. Apache Kafka

### Core Model

Kafka is a durable, ordered, replicated log. Messages are persisted to disk. Consumers track their progress via _offsets_ (an integer per partition). The broker does not delete messages on delivery — retention is time- or size-based. This decouples producers from consumers completely and enables replay.

### At-Least-Once on the Producer Side

**`acks`**
- `acks=0` — fire-and-forget, no durability.
- `acks=1` — leader acknowledges; replica lag = potential loss on leader failure.
- `acks=all` (default since Kafka 3.0) — all in-sync replicas must acknowledge before the producer call returns. Strongest durability guarantee.

**`retries`** (default: `Integer.MAX_VALUE`)  
Kafka retries transient errors automatically. Combined with `delivery.timeout.ms` (default: 2 minutes) this caps the total retry window.

**`enable.idempotence`** (default: `true` since Kafka 3.0)  
The broker assigns each producer a unique Producer ID (PID). Every record sent to a partition carries a monotonically increasing sequence number per (PID, partition). The broker rejects duplicate sequence numbers silently. This makes `send()` idempotent within a single producer session.

> **Critical limit**: idempotence is per-session. A producer restart gets a new PID. Duplicate messages can occur across restarts.

Requires: `acks=all`, `retries > 0`, `max.in.flight.requests.per.connection <= 5`.

### At-Least-Once on the Consumer Side

**`enable.auto.commit=false` (manual commit mode)**  
Process messages first, then commit the offset. A crash between process and commit causes the next consumer to re-process — at-least-once.

- `commitSync()` — blocks, retries indefinitely, use before shutdown or in `onPartitionsRevoked()`.
- `commitAsync()` — non-blocking, higher throughput, no retry (to avoid ordering bugs). Use in the main poll loop.
- **Production pattern**: `commitAsync()` in the loop + `commitSync()` in `onPartitionsRevoked()` + shutdown hook.

**`auto.offset.reset`** (`earliest` | `latest`): where to start when no offset exists for a new consumer group.

**`consumer.seek(partition, offset)`**: manually position the consumer. Enables replay and recovery.

### Rebalancing Edge Cases

**Eager protocol** (classic): all consumers revoke all partitions, group restarts. Async commits in flight at this moment may fail, causing the new owner to re-process from the last committed offset.

**Cooperative (incremental) protocol** (default since Kafka 3.1+): only partitions that _need to move_ are revoked. Unaffected partitions continue processing without interruption. Dramatically reduces duplication risk.

**Key rule**: always call `commitSync()` in `onPartitionsRevoked()` before handing back the partition.

### Exactly-Once Semantics (Kafka Transactions)

EOS = idempotent producer + transactions.

**Flow**:
1. `initTransactions()` — registers `transactional.id`, receives PID + epoch.
2. `beginTransaction()`
3. Write records to N partitions (tagged with PID + epoch + seq).
4. `sendOffsetsToTransaction(offsets, groupId)` — atomically includes consumer offset commits in the transaction.
5. `commitTransaction()` — coordinator writes commit markers to all involved partitions.

**Epoch fencing**: on producer restart with the same `transactional.id`, the coordinator bumps the epoch and aborts any pending transactions from the old instance. Old instances are rejected on any write attempt.

**Consumer side**: set `isolation.level=read_committed`. Only records from committed transactions are visible. The Last Stable Offset (LSO) caps reads at the lowest open transaction.

**Kafka Streams EOS**: `processing.guarantee=exactly_once_v2`. Wraps the consume-process-produce pipeline in a Kafka transaction per `commit.interval.ms`.

> **Critical limit**: Kafka transactions are Kafka-internal only. There is no 2PC with external systems (databases, HTTP endpoints). For side effects outside Kafka, design idempotent consumers.

---

## 3. NATS JetStream

### Core NATS vs JetStream

**Core NATS** is at-most-once. Messages are delivered only to currently connected subscribers. No persistence.

**JetStream** adds a persistence layer: messages are written to _Streams_ (durable logs) and consumed by _Consumers_ (views into a stream with tracked delivery state). Enables temporal decoupling and replay.

### Streams

A stream captures messages on matching subjects. Retention policies: limits-based, work-queue, or interest-based. Storage: memory, file, or RAFT-replicated (replication factors 1, 2, 3, or 5).

### Consumer Types

**Push consumers**: server actively delivers messages to a specified delivery subject. Support queue groups for load balancing. Suitable for single-instance or simple setups.

**Pull consumers** (recommended): client explicitly fetches batches using `Fetch(batchSize, timeout)` or `FetchNoWait(batchSize)`. Client controls processing rate. Preferred for scalable, reliable processing.

### Ack Policies

| Policy | Behavior | Use case |
|---|---|---|
| `AckExplicit` | Every message must be individually acked | At-least-once (recommended) |
| `AckAll` | Acking message N implicitly acks 1..N-1 | Reduce ack volume |
| `AckNone` | No ack required; server assumes delivery | At-most-once / fire-and-forget |

`AckExplicit` is the only policy supported for pull consumers.

### Ack Types

- `Ack()` — confirms successful processing.
- `AckSync()` — server acknowledges the ack receipt (double-ack). Closes the "ack lost in flight" race. Required for exactly-once.
- `InProgress()` — extends the `AckWait` timer. Use for long-running processing.
- `Nak()` — negative ack; requests immediate or delayed redelivery. `nakDelay()` supports backoff.
- `Term()` — permanently terminates delivery of this message. No future redelivery.

### Key Consumer Configuration

**`AckWait`** (default: 30s): how long the server waits for an ack before scheduling redelivery.

**`MaxDeliver`** (default: unlimited): maximum delivery attempts. On exhaustion, a JetStream Advisory is emitted (`$JS.EVENT.ADVISORY.CONSUMER.MAX_DELIVERIES.{stream}.{consumer}`). The message is _not_ automatically deleted — it must be manually acked or deleted. This is the JetStream dead-letter mechanism.

**`BackOff`**: a sequence of durations for redelivery delays (e.g., `[1s, 5s, 30s, 5m]`). Overrides `AckWait`. Length must be ≤ `MaxDeliver`.

**`MaxAckPending`**: maximum outstanding unacknowledged messages. Acts as application-level flow control.

### Sequence Numbers

Each message carries two sequence numbers:
- **Stream sequence**: immutable position in the stream. Does not change across redeliveries.
- **Consumer sequence**: counts delivery attempts to a specific consumer. Incremented on every delivery including redeliveries.

If `ConsumerSeq=4, StreamSeq=3`, message 3 has been delivered 4 times.

### Message Headers (JetStream metadata)

| Header | Meaning |
|---|---|
| `Nats-Sequence` | stream sequence number |
| `Nats-Time-Stamp` | publication timestamp |
| `Nats-Subject` | original subject |
| `Nats-Stream` | stream name |
| `Nats-Consumer` | consumer name |
| `Nats-Num-Delivered` | delivery count (redelivery counter) |
| `Nats-Num-Pending` | remaining pending messages for consumer |
| `Nats-Msg-Id` | publisher-assigned deduplication ID |

### Exactly-Once Semantics in JetStream

Two mechanisms combined:

**1. Publisher-side deduplication** (`Nats-Msg-Id`): publishers include a unique message ID. JetStream tracks seen IDs within a configurable window (default: 2 minutes). Duplicate IDs are silently discarded.

**Per-subject infinite deduplication**: using `DiscardNewPerSubject` + `MaxMsgsPerSubject=1`, a subject can only hold one message. Publishing to an occupied subject fails immediately. Using the message ID as part of the subject name (e.g., `orders.{uuid}`) provides infinite, non-windowed deduplication — analogous to a database unique-key constraint.

**2. Consumer-side double-ack** (`AckSync()`): the server acknowledges the consumer's ack. Once confirmed, the message will never be redelivered. Closes the "ack lost in network" race condition.

**Full EOS recipe**: `js.Publish()` with `Nats-Msg-Id` + pull consumer with `AckExplicit` + `AckSync()`.

### Durable vs Ephemeral Consumers

- **Durable**: named, server-persisted, survives restarts. Multiple instances can share one durable pull consumer (competing consumers pattern).
- **Ephemeral**: unnamed, deleted when no client is connected. For one-shot replays or testing.

---

## 4. At-Least-Once Delivery over WebSockets

### The Fundamental Problem

WebSockets (RFC 6455) run over TCP. TCP guarantees ordered, reliable delivery _within_ an active connection. It does not survive connection re-establishment. A new WebSocket connection is a fresh TCP connection with no shared state. Messages in flight at the moment of closure are lost.

### Pattern A: Sequence IDs + Connection Recovery (Azure Web PubSub)

Azure's reliable subprotocols implement a complete at-least-once protocol at the WebSocket level.

**Connection recovery**: on connect, the server sends `connectionId` + `reconnectionToken`. On reconnect, the client includes these in the URL. If recovery succeeds within 1 minute, the session resumes.

**Publisher side (`ackId`)**: each outgoing message carries a unique `ackId`. The server responds with `{"type":"ack","ackId":1,"success":true}`. On reconnect, the publisher resends with the same `ackId`. If the server already processed it, it responds with `"success":false,"error":{"name":"Duplicate"}`. Publisher stops resending.

**Subscriber side (`sequenceId`)**: data messages carry a monotonically increasing `sequenceId` per session. The subscriber sends `{"type":"sequenceAck","sequenceId":5}`. On reconnect, the service replays all messages with `sequenceId > 5`.

### Pattern B: MQTT over WebSockets (QoS 1 / QoS 2)

MQTT runs as a WebSocket subprotocol (`mqtt`). All QoS levels are preserved over WebSockets.

**QoS 1 (at-least-once)**:
1. Publisher sends `PUBLISH` with Packet ID, stores copy.
2. Broker sends `PUBACK` with same Packet ID.
3. Publisher deletes copy.
If no `PUBACK`, publisher retransmits with `DUP=1`. Broker always sends `PUBACK`. Duplicate delivery to subscribers is inherent — subscribers must be idempotent.

Session persistence (`CleanStart=0`): broker queues QoS 1 messages for disconnected clients. Unacknowledged messages retransmitted on reconnect.

**QoS 2 (exactly-once)**: four-step handshake — PUBLISH → PUBREC → PUBREL → PUBCOMP. The receiver's stored Packet ID prevents double-processing on duplicate PUBLISH.

### Pattern C: STOMP over WebSockets

STOMP is a text-based messaging protocol with native WebSocket support.

**Ack modes** (set on `SUBSCRIBE` frame):
- `ack:auto` — server assumes delivery on send.
- `ack:client` — cumulative; acking message N acks 1..N-1.
- `ack:client-individual` — non-cumulative; each message requires its own `ACK` or `NACK`.

**`NACK`**: signals non-consumption; broker redelivers, discards, or sends to DLQ (broker-dependent).

**`RECEIPT` frame**: add `receipt:id` header to any frame; server responds with `RECEIPT` confirming processing.

**Transactions**: `BEGIN` / `COMMIT` / `ABORT`. `SEND` and `ACK` inside a transaction are applied atomically. Uncommitted transactions are implicitly aborted on disconnect.

### Pattern D: Socket.IO Connection State Recovery

Socket.IO v4.6+ optionally buffers missed packets server-side for up to 2 minutes. On reconnect with a session ID, missed events are replayed. Default is still at-most-once — state recovery is opt-in and bounded.

**Manual at-least-once**: assign IDs to events, store in a database, client sends acks, track last received ID per client, replay on reconnect.

### Pattern E: Ably (Proprietary SDK)

Assigns every message a unique serial number (timestamp-based). Provides exactly-once delivery:
- Client provides its last received serial on reconnect.
- Ably replays missed messages and deduplicates.
- History persisted for 24–72 hours across three regions.
- Ping/pong every 15 seconds; reconnect window of 2 minutes.

### Summary: WebSocket Reliability

| Library / Protocol | Transport | At-Least-Once | Mechanism |
|---|---|---|---|
| Azure Web PubSub (reliable) | WebSocket | Yes | sequenceId + ackId + connectionId recovery |
| MQTT QoS 1 | WebSocket | Yes | PUBLISH/PUBACK + session persistence |
| MQTT QoS 2 | WebSocket | Exactly-once | 4-way handshake + session state |
| STOMP (client-individual) | WebSocket | Yes (broker-dep.) | ACK/NACK frames + broker redelivery |
| Socket.IO v4.6+ (state recovery) | WebSocket | Partial (2min) | Buffered events + session ID |
| Ably SDK | WebSocket (proprietary) | Exactly-once | Serial numbers + 72h history |
| `reconnecting-websocket` | WebSocket | No | Reconnect only, no replay |

---

## 5. At-Least-Once Delivery in GraphQL Subscriptions

### Current State of the Spec

GraphQL subscriptions are defined in the spec as an operation type, but the spec does not define a transport protocol. The `graphql-over-http` working draft explicitly states: _"GraphQL Subscriptions are beyond the scope of this specification at this time."_

There is **no standardized delivery guarantee** in the GraphQL spec. graphql-spec issue #419 ("Acknowledgement of messages in Subscription") was raised requesting ack/nack and replay capability. It was closed without being incorporated.

Reliability is entirely the responsibility of the transport layer and application implementation.

### Protocol: `graphql-ws` (`graphql-transport-ws`)

The de facto standard for GraphQL subscriptions over WebSockets.

**Messages**:
- `ConnectionInit` (C→S): initiate connection, optional payload.
- `ConnectionAck` (S→C): accepted.
- `Subscribe` (C→S): `{id, payload: {query, variables, operationName, extensions}}`.
- `Next` (S→C): `{id, payload: ExecutionResult}`.
- `Error` (S→C): execution errors, terminates operation.
- `Complete` (bidirectional): terminates operation.
- `Ping` / `Pong` (bidirectional): heartbeat.

Multiplexing: multiple operations with different IDs on one connection.

**Delivery guarantee**: none. If the WebSocket closes, in-flight `Next` messages are lost. On reconnect, the client re-subscribes from `ConnectionInit` — it receives only messages published _after_ the new subscription starts.

The `ConnectionInit` payload is free-form JSON, which makes it the natural extension point for passing resume cursors.

### Protocol: `graphql-sse`

Uses Server-Sent Events rather than WebSockets.

- **Distinct Connections Mode** (HTTP/2+): each operation is its own SSE stream.
- **Single Connection Mode** (HTTP/1 safe): one persistent SSE stream for all events; operations multiplexed with a token.

The SSE `Last-Event-ID` mechanism is available at the HTTP level, but the reference implementation does not implement server-side replay based on it. Replay depends entirely on the server implementation.

### Commercial Implementations

**AWS AppSync**: WebSocket-based subscriptions. Does not document at-least-once delivery. Explicitly states messages may not arrive in order.

**Hasura subscriptions**: live queries, not event streams. The server polls the database and sends the current result when it changes. Missed state transitions between polls are never delivered. GitHub issue #3517 ("Not all mutations delivered to subscribed client") acknowledges this. Hasura _Event Triggers_ (separate HTTP webhooks) do guarantee at-least-once, but that is not a GraphQL subscription.

**Hasura feature request #2317**: proposal for Kafka-backed event subscriptions providing true at-least-once with replay. Not yet implemented as of 2025.

### Application-Level Cursor-Based Resumption (Platformatic Pattern)

The emerging pattern for reliable GraphQL subscriptions:

1. **Schema**: the subscription resolver accepts an optional `afterCursor` argument:
   ```graphql
   type Subscription {
     onMessage(afterCursor: String): Message
   }
   ```
2. **Server**: events are stored in a persistent store with sequential IDs. On subscribe with `afterCursor`, replay all stored events after that cursor, then transition to live delivery.
3. **Client**: track the `id` (or `cursor`) field of each received message. On reconnect, re-subscribe with `afterCursor: <last_received>`.
4. **Heartbeat**: 30-second pings to detect stale connections.

This shifts subscriptions from connection-stateful to _stateless and resumable_. Achieves 100% delivery across connection failures in testing, but requires explicit server and client implementation.

---

## 6. Server-Sent Events with Last-Event-ID

SSE (`text/event-stream`) has built-in reconnection and replay support in the HTML spec.

```
id: 42
event: order-update
data: {"orderId":"abc","status":"shipped"}
retry: 3000
```

**`id` field**: sets the browser's `lastEventId`. Persisted across reconnects.

**`Last-Event-ID` header**: on reconnect, the browser sends this header. The server replays all events with ID > lastEventId.

**At-least-once via SSE**:
1. Server assigns sequential IDs to events.
2. Events stored in a persistent log (database, Kafka, Redis Streams, JetStream).
3. On reconnect with `Last-Event-ID`, server queries the log and replays.
4. Client is idempotent (GraphQL provides a deterministic view, but order matters for events).

**Caveats**:
- HTTP/1.1 6-connection-per-domain limit. HTTP/2 resolves this (100 concurrent streams default).
- SSE is unidirectional (server → client). No client acks; `Last-Event-ID` is the only feedback.
- Events without `id` do not update `lastEventId` — server must always set IDs.

---

## 7. How Cosmo Streams Works Today

Based on the codebase at `/home/user/cosmo`:

### Architecture

```
Client (WebSocket: graphql-transport-ws or subscriptions-transport-ws)
  → Router WebSocket Handler (core/websocket.go)
    → Protocol layer (internal/wsproto/)
    → Operation planner → DataSource selection
    → Provider (NATS / Kafka / Redis / Engine subgraph)
      ↕ Events (batched)
    → Hook pipeline (SubscriptionOnStart, OnReceiveEvents, OnPublishEvents)
    → SubscriptionUpdater → write Next message to WebSocket
```

### Delivery Guarantees by Provider

| Provider | Broker → Router | Router → Client | Notes |
|---|---|---|---|
| NATS JetStream | ✅ At-least-once | ❌ None | Manual `msg.Ack()` after delivery to subscriber (`adapter.go:154`) |
| NATS Core | ❌ At-most-once | ❌ None | Fire-and-forget pub/sub |
| Kafka | ❌ At-most-once | ❌ None | Polls from `time.Now()`, no offset commits |
| Redis | ❌ At-most-once | ❌ None | Pattern-based pub/sub |

### Current NATS JetStream Consumer Configuration

From `router/pkg/pubsub/nats/adapter.go`:
- Durable consumers: named `{durable_name}-{xxhash(hostname+listenAddr+subjects)}`
- `FetchNoWait(300)` — pull consumer, non-blocking batch fetch
- `msg.Ack()` called _after_ event is processed and dispatched to subscribers
- Consumer inactivity threshold for automatic cleanup
- `NatsStreamConfiguration` proto: `consumer_name`, `stream_name`, `consumer_inactive_threshold`

### The Delivery Gap

The critical gap is the **router → client** leg. When `msg.Ack()` is called in the NATS adapter, the message has been dispatched to the `SubscriptionUpdater`, but the WebSocket write to the client may not yet have occurred (or may fail). If the WebSocket write fails (connection drop), the JetStream message has already been acked — it is gone.

Additionally, Kafka currently starts from the current offset (`time.Now().UnixMilli()`), so any events published during a client disconnect are permanently lost.

### Existing Extension Points

The `SubscriptionOnStart`, `StreamReceiveEventHandler`, and `StreamPublishEventHandler` hooks (Cosmo Streams v1) provide customization points. At-least-once implementations can leverage these hooks without core changes — but the hooks run _after_ the broker ack, so the gap remains at the transport layer.

---

## 8. General At-Least-Once Implementation Primitives

Regardless of transport, at-least-once delivery requires:

| Component | Purpose |
|---|---|
| Message ID / Sequence number | Unique identity for each message; consumer tracks last processed ID |
| Server-side persistence | Messages stored until acked; survives server restarts |
| Visibility timeout / AckWait | Lock message to one consumer; redelivery if not acked in time |
| Exponential backoff + jitter | Space out retries; prevent thundering herd |
| Dead Letter Queue (DLQ) | Isolate poison messages after `maxRetries` |
| Idempotent consumer | At-least-once guarantees duplicates; consumer must handle them |
| Resume token | Client-side opaque cursor encoding last-received position; sent on reconnect |
| Session recovery | Server maps resume token to buffered or logged state |

---

## 9. Key References

- [Confluent: Message Delivery Guarantees for Apache Kafka](https://docs.confluent.io/kafka/design/delivery-semantics.html)
- [Apache Kafka: Producer Configs](https://kafka.apache.org/41/configuration/producer-configs/)
- [Confluent: Exactly-once Semantics are Possible](https://www.confluent.io/blog/exactly-once-semantics-are-possible-heres-how-apache-kafka-does-it/)
- [NATS Docs: JetStream](https://docs.nats.io/nats-concepts/jetstream)
- [NATS Docs: Consumers](https://docs.nats.io/nats-concepts/jetstream/consumers)
- [NATS Docs: JetStream Model Deep Dive](https://docs.nats.io/using-nats/developer/develop_jetstream/model_deep_dive)
- [NATS Blog: Per-subject discard policy (infinite deduplication)](https://nats.io/blog/new-per-subject-discard-policy/)
- [Microsoft Learn: Create reliable WebSocket clients (Azure Web PubSub)](https://learn.microsoft.com/en-us/azure/azure-web-pubsub/howto-develop-reliable-clients)
- [Ably: WebSocket reliability in realtime](https://ably.com/topic/websocket-reliability-in-realtime-infrastructure)
- [Socket.IO: Delivery Guarantees](https://socket.io/docs/v4/delivery-guarantees)
- [HiveMQ: MQTT QoS Levels](https://www.hivemq.com/blog/mqtt-essentials-part-6-mqtt-quality-of-service-levels/)
- [STOMP Protocol Specification v1.2](https://stomp.github.io/stomp-specification-1.2.html)
- [graphql-ws PROTOCOL.md](https://github.com/enisdenjo/graphql-ws/blob/master/PROTOCOL.md)
- [graphql-sse PROTOCOL.md](https://github.com/enisdenjo/graphql-sse/blob/master/PROTOCOL.md)
- [graphql-spec #419: Acknowledgement of messages in Subscription](https://github.com/graphql/graphql-spec/issues/419)
- [Platformatic: Resumable GraphQL Subscriptions](https://blog.platformatic.dev/resumable-graphql-subscriptions)
- [MDN: Using server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)
- [RFC 6202: Known Issues with Long Polling and Streaming](https://datatracker.ietf.org/doc/html/rfc6202)
- [Hasura #3517: Not all mutations delivered to subscribed client](https://github.com/hasura/graphql-engine/issues/3517)
- [AWS AppSync: Real-Time Data](https://docs.aws.amazon.com/appsync/latest/devguide/aws-appsync-real-time-data.html)
