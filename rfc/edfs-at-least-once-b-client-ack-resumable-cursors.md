# RFC EDFS At-Least-Once Delivery — Client Acknowledgment Protocol + Resumable Cursors

- **Author:** automated RFC workflow
- **Status:** Draft
- **Date:** 2026-05-28
- **RFC Variant:** B — Client Acknowledgment Protocol + Resumable Cursors
- **Component:** Cosmo Router / EDFS (Event-Driven Federated Subscriptions, a.k.a. "Cosmo Streams")

## Abstract

Cosmo Streams today delivers subscription events fire-and-forget: the broker pushes an
event, a provider adapter goroutine calls `updater.Update(events)`, the per-subscription
hooks run, and `resolve.SubscriptionUpdater.UpdateSubscription(subID, data)` writes a
`next` frame to the WebSocket (or an `event: next` chunk to the SSE/multipart stream). Once
the bytes are handed to the wire, the router forgets them. If the client's socket is dead,
flapping, or its TCP buffer is full and the connection is reset, those events are gone. No
amount of broker-side durability fixes this, because the loss happens **after** the router
has already consumed and acknowledged the event upstream (see `nats/adapter.go:154`, where
`msg.Ack()` fires immediately after `updater.Update`).

This RFC proposes locating the at-least-once guarantee at the **transport/protocol layer
between router and client**. The router assigns every delivered event a monotonic,
per-subscription **cursor**. The client acknowledges receipt. On disconnect/reconnect the
client presents its last-acked cursor, and the router **resumes** delivery from that point,
replaying everything that was sent-but-unacked. This is the only design that closes the
last-mile (router → client) gap, and it composes cleanly with — rather than competing
against — broker durability for the broker → router gap.

The guarantee boundary is explicit: an event is delivered "at-least-once" **once the client
has acked its cursor**. Clients that do not negotiate the ack capability degrade gracefully
to today's at-most-once semantics, byte-for-byte unchanged.

## 1. Problem Statement

### 1.1 The reconnect gap

Consider the current happy path (verified against the source):

```
Broker ──▶ provider adapter goroutine (kafka/nats/redis adapter.go)
       ──▶ datasource.SubscriptionEventUpdater.Update(events)      // subscription_event_updater.go
       ──▶ per-subscription OnReceiveEvents hooks (semaphore-bounded, 5s timeout)
       ──▶ resolve.SubscriptionUpdater.UpdateSubscription(subID, data)
       ──▶ websocketResponseWriter.WriteGraphQLData(...)            // websocket.go
       ──▶ wsConnectionWrapper.WriteText(...)                       // bytes on the wire
```

There are four places an event can be irrecoverably lost **on the client side of the
router**, none of which broker durability addresses:

1. **Socket already half-closed.** The client's TCP connection died (laptop sleep, NAT
   rebind, mobile handoff) but the router has not yet observed the FIN/RST. `WriteText`
   succeeds into a kernel buffer that will never drain. The event is acked upstream and
   dropped.
2. **Write fails mid-stream.** `WriteText` returns an error and the connection handler tears
   down (`Close`). Any event already consumed from the broker but not yet written is lost,
   and the broker offset has advanced.
3. **Reconnect.** The client reconnects (new WebSocket, new `subscribe`) and the router
   starts a brand-new broker consumer. For Kafka this means
   `ConsumeResetOffset(NewOffset().AfterMilli(time.Now()))` (`kafka/adapter.go:147`) — i.e.
   **start from now**, skipping everything produced during the gap. For core NATS
   (`ChanSubscribe`) there is no replay at all. Even JetStream durable consumers re-deliver
   from the consumer's stored position, but the router cannot map "where the client got to"
   onto that position, so it either re-sends everything (dupes, but no protocol to
   deduplicate) or nothing.
4. **Slow / flapping client.** A client that is slow to read causes head-of-line blocking;
   today the router has no windowed buffer and no backpressure signal tied to client
   progress, so events are processed and discarded at broker pace regardless of whether the
   client kept up.

### 1.2 Why broker durability alone is insufficient

A sibling RFC proposes broker-native durability (JetStream/Kafka consumer groups, manual
ack to the broker only after client delivery). That is necessary but **not sufficient**:

- The broker's notion of "delivered" is "the router consumed it," not "the client received
  it." The ack in `nats/adapter.go:154` fires before the bytes reach the socket, let alone
  the client.
- Even if you defer the broker ack until after `WriteText` returns, `WriteText` returning
  success only means "queued in the kernel," not "the client application processed it." The
  reconnect gap (#3) is fundamentally a **client-identity + position** problem: after a new
  TCP connection, the router has no idea which events the previous connection actually
  consumed. Only the client knows. Therefore the client must tell us — via an acked cursor.
- Redis Pub/Sub (`redis/adapter.go`, `PSubscribe`) is inherently ephemeral; there is no
  broker position to be durable about. Resumability there *must* live above the broker.

The client-ack/resume protocol is the **only** layer that has the information required to
close the router → client gap: the client's own record of what it has durably consumed.

### 1.3 Scope

In scope: at-least-once delivery from router to client over `graphql-transport-ws` and
`graphql-sse` (and the existing SSE/multipart `HttpFlushWriter` path). Cursor assignment,
acknowledgment, bounded redelivery buffering, and resume-on-reconnect.

Out of scope (delegated to or composed with sibling RFCs): broker → router durability,
exactly-once (we explicitly do not promise it), and cross-broker transactional semantics.

## 2. Definitions

- **Cursor.** An opaque, monotonically increasing, per-subscription sequence token assigned
  by the router to each delivered event. Encodes enough to re-seek the upstream provider.
- **Ack.** A client → server message naming the highest cursor the client has durably
  processed. Acks are cumulative: acking cursor *N* acknowledges everything `<= N`.
- **At-least-once boundary.** An event is *delivered* (guaranteed) the moment the client
  acks a cursor `>=` that event's cursor. Before that ack, the event lives in the router's
  unacked window and will be replayed on reconnect.
- **Idempotency requirement.** Because reconnect replays the sent-but-unacked window, a
  client **may** see an event more than once. At-least-once implies the client (or its
  application layer) MUST be able to deduplicate. The cursor is the dedup key: a client that
  records "last cursor I applied" and discards events with `cursor <= lastApplied` gets
  effective exactly-once *application* on top of at-least-once *delivery*.
- **Degrade-to-at-most-once.** A client that does not advertise `ack` support in
  `connection_init` (or omits cursors on SSE) receives exactly today's behavior: no cursor
  extensions are emitted that would break it, no window is retained, no replay occurs.

## 3. Cursor Design

### 3.1 Structure

A cursor is an **opaque string** to the client. Internally it is a versioned, signed,
base64url-encoded struct. Opacity is load-bearing: clients must treat it as a token they
echo back, never parse, so the router can evolve provider mappings without breaking clients.

```go
// router/core/edfs/cursor.go (new)

// Cursor is the wire representation: opaque base64url to the client.
type Cursor string

// cursorPayload is the decoded internal form. Never exposed to clients.
type cursorPayload struct {
    Version  uint8        `json:"v"`   // cursor format version, starts at 1
    Seq      uint64       `json:"s"`   // per-subscription monotonic sequence (the ordering key)
    Provider ProviderKind `json:"p"`   // nats | kafka | redis | engine
    Pos      ProviderPos  `json:"pos"` // provider-native position to re-seek from
    // SubEpoch guards against cursor reuse across router restarts / re-plans
    // for the same logical subscription. Bumped when the broker binding is rebuilt.
    SubEpoch uint64       `json:"e"`
}

// ProviderPos is a tagged union; exactly one field is set per Provider.
type ProviderPos struct {
    // Kafka: topic + partition + offset of the record that produced this event.
    Kafka *KafkaPos `json:"k,omitempty"`
    // NATS JetStream: the stream sequence (msg.metadata.Sequence.Stream).
    NATS  *NATSPos  `json:"n,omitempty"`
    // Redis Streams: the entry ID "<ms>-<seq>".
    Redis *RedisPos `json:"r,omitempty"`
}

type KafkaPos struct {
    Topic     string `json:"t"`
    Partition int32  `json:"p"`
    Offset    int64  `json:"o"`
}
type NATSPos  struct { StreamSeq uint64 `json:"q"` }
type RedisPos struct { EntryID   string `json:"id"` }
```

The encoded form is `base64url(version_byte || hmac_sha256_truncated(16) || cbor(payload))`.
The HMAC is keyed by a per-router-cluster secret (`events.delivery.cursor_signing_key`) so
that a forged or tampered cursor is rejected (see §10.3). Typical encoded length is
60–110 bytes.

### 3.2 Monotonicity

`Seq` is assigned by an atomic per-subscription counter in the router at the point of
delivery, **after** all `OnReceiveEvents` hooks have run (because hooks can drop, split, or
reorder events — see `subscription_event_updater.go:104-123`). Monotonicity is therefore a
property of the *delivered* stream, independent of provider-side gaps, partition
interleaving, or hook fan-out. This is what makes the cursor a clean cumulative-ack key even
when the underlying Kafka offsets are non-contiguous (other partitions, filtered records).

The `Pos` is the **re-seek hint**: it records where in the provider this delivered event
came from, so that on resume the router can re-establish a consumer at the right place. When
hook-synthesized events (`ctx.NewEvent`, `EmitEvent` from the ADR) have no provider origin,
`Pos` is nil and the event is replayable only from the in-memory window (§6), never from the
broker.

### 3.3 Mapping to provider positions

| Provider | Native position | Re-seek mechanism | Adapter change required |
|---|---|---|---|
| Kafka | `(topic, partition, offset)` | `kgo.NewOffset().At(offset)` per partition instead of `AfterMilli(now)` | `kafka/adapter.go:147` must accept a start offset map; capture per-record `record.Offset/Partition` in `topicPoller` |
| NATS JetStream | stream sequence | `OrderedConsumer`/`Consumer` with `DeliverPolicy: ByStartSequence, OptStartSeq: seq+1` | `nats/adapter.go:413` `createOrUpdateDurableConsumer` must accept a start sequence; capture `msg.Metadata().Sequence.Stream` |
| Core NATS (`ChanSubscribe`) | none | not replayable from broker | window-only resume; cursor `Pos` nil |
| Redis Streams | entry ID `<ms>-<seq>` | `XREAD`/`XAUTOCLAIM` from `id` | requires migrating `redis/adapter.go` from `PSubscribe` to Redis Streams (`XADD`/`XREADGROUP`); Pub/Sub cannot resume |

The cursor deliberately encodes the provider position so resume is **stateless on the router
side beyond the in-memory window** — the broker is the source of truth for replay beyond the
window, and the client carries the bookmark. This is what lets a different router replica
honor a resume request (§10.6) when the broker supports server-side positions (Kafka,
JetStream, Redis Streams). For ephemeral providers (core NATS, Redis Pub/Sub), resume is
strictly bounded by the in-memory window and we say so explicitly in the capability response.

## 4. Protocol Design

### 4.1 Capability negotiation (`connection_init`)

The client advertises ack support in the `connection_init` payload. This is the gate for
everything else: if absent, the router never emits cursors and behaves exactly as today.

Client → Server:

```json
{
  "type": "connection_init",
  "payload": {
    "cosmo": {
      "ack": {
        "version": 1,
        "mode": "windowed",
        "maxInFlight": 256,
        "ackEvery": 32,
        "ackInterval": "2s"
      }
    }
  }
}
```

Server → Client (the existing `connection_ack`, now with a payload):

```json
{
  "type": "connection_ack",
  "payload": {
    "cosmo": {
      "ack": {
        "version": 1,
        "enabled": true,
        "mode": "windowed",
        "maxInFlight": 256,
        "resumeWindow": 4096,
        "resumeRetention": "10m"
      }
    }
  }
}
```

The current `Initialize()` (`graphql_ws.go:49-65`) already returns `msg.Payload` to the
caller and writes a bare `connection_ack`. We extend it to (a) surface the parsed client
capability to the `WebSocketConnectionHandler` and (b) echo the negotiated parameters in the
ack payload. Clients that never read the payload are unaffected (it is additive JSON).

If the client omits `cosmo.ack`, `enabled` is implicitly false and the connection runs in
legacy mode.

### 4.2 `next` frames carry a cursor (extensions)

The `graphql-transport-ws` `next` message already supports `extensions`
(`graphql_ws.go:117-124`, `WriteGraphQLData(id, data, extensions)` — extensions is already
plumbed). We place the cursor there. This is invisible to clients that ignore extensions.

Server → Client:

```json
{
  "type": "next",
  "id": "sub-1",
  "payload": { "data": { "employeeUpdates": { "id": 12, "__typename": "Employee" } } },
  "extensions": {
    "cosmo": { "cursor": "AY29tb18x...base64url...", "seq": 4711 }
  }
}
```

`seq` is included as a human/debug-friendly decimal mirror of the opaque cursor's `Seq`; it
is advisory and clients should ack with the opaque `cursor`.

### 4.3 New client → server `ack` message

This is the one genuinely new message type. It is a client → server frame the router reads
in its existing read loop (`websocket.go` `handleMessage`). Cumulative.

Client → Server:

```json
{
  "type": "ack",
  "id": "sub-1",
  "payload": { "cosmo": { "cursor": "AY29tb18x...base64url..." } }
}
```

The router:
1. Validates the cursor HMAC and that `SubEpoch` matches the live subscription.
2. Decodes `Seq`, advances the per-subscription `ackedSeq` (monotonic max).
3. Drops everything `<= Seq` from the unacked window (§6), freeing buffer and relaxing
   backpressure.
4. Optionally advances the broker-side commit (composes with the durability RFC): now the
   router can safely commit the Kafka offset / `msg.Ack()` the JetStream message
   corresponding to the *client-acked* cursor, not the consumed one. This is the join point
   between the two RFCs.

In **windowed** mode the client acks every `ackEvery` messages or every `ackInterval`,
whichever comes first. In **per-message** mode it acks each `next`. Windowed is the default
and recommended; per-message maximizes recovery granularity at the cost of an upstream
message per event.

### 4.4 `subscribe` with resume (`lastEventId` / cursor)

On reconnect the client re-sends `subscribe` for the same operation, carrying the last cursor
it durably processed, in the `payload.extensions`:

```json
{
  "type": "subscribe",
  "id": "sub-1",
  "payload": {
    "query": "subscription { employeeUpdates { id __typename } }",
    "extensions": {
      "cosmo": { "resumeFrom": "AY29tb18x...base64url..." }
    }
  }
}
```

The router treats `resumeFrom` as "deliver everything with `Seq > resumeFrom.Seq`." See §7
for the full flow, including the aged-out case.

### 4.5 graphql-sse and the SSE/multipart transport

SSE gets resumability **almost for free** thanks to the standard `Last-Event-ID` mechanism
and the `id:` field. Our `HttpFlushWriter` (`flushwriter.go`) and `GetWriterPrefix`
(`flushwriter.go:307`, currently emits `event: next\ndata: `) are extended to emit an
`id:` line carrying the opaque cursor:

```
event: next
id: AY29tb18x...base64url...
data: {"data":{"employeeUpdates":{"id":12,"__typename":"Employee"}}}

```

The browser `EventSource` (and graphql-sse clients) automatically remember the last `id:`
and, on reconnect, send it back as the `Last-Event-ID` request header. The router reads that
header at subscription setup and treats it identically to `resumeFrom`. For non-browser
graphql-sse clients using the single-connection POST mode, the same value travels in the
operation `extensions.cosmo.resumeFrom`, exactly as for WebSocket.

SSE has no application-level ack frame, and it does not need one: the EventSource reconnect
protocol *is* the resume mechanism, and `Last-Event-ID` is the implicit "I got at least up
to here." The at-least-once boundary on SSE is therefore "the last `id:` the browser
observed and will replay on reconnect." We treat receipt-with-id as the ack (there is no
finer-grained signal available on this transport), and we keep the window retention
(§6) to bound replay. Multipart (`multipart/mixed`) has no `id:` convention; multipart
clients get cursors only via an inline `extensions` field in the JSON body and must use the
explicit `?wg_resume_from=<cursor>` query parameter on reconnect, or they degrade to
at-most-once.

## 5. Where Unacked Events Live — Router-Side State

### 5.1 Per-subscription bounded ring buffer

Each ack-enabled subscription gets a bounded in-memory window keyed by cursor sequence:

```go
// router/core/edfs/window.go (new)

type windowEntry struct {
    seq     uint64
    cursor  Cursor
    data    []byte // the exact bytes written in the `next` payload
    sentAt  time.Time
}

// ackWindow is a per-subscription ring buffer of sent-but-unacked events.
type ackWindow struct {
    mu        sync.Mutex
    ring      []windowEntry // fixed capacity = maxInFlight
    head      int           // oldest unacked
    count     int
    nextSeq   uint64        // atomic-ish under mu; the monotonic assigner
    ackedSeq  uint64        // highest cumulatively acked
    capacity  int           // maxInFlight (negotiated, bounded by server max)
    full      chan struct{} // closed-and-recreated to signal "space available"
}

// Append assigns the next cursor, stores the entry, and returns the cursor to
// stamp on the outgoing frame. Blocks (or returns ErrWindowFull) when the
// window has maxInFlight unacked entries — this is the backpressure point.
func (w *ackWindow) Append(ctx context.Context, data []byte, pos ProviderPos) (Cursor, error)

// Ack advances ackedSeq and frees all entries <= seq. Idempotent / monotonic.
func (w *ackWindow) Ack(c Cursor) error

// Replay returns all retained entries with seq > fromSeq, in order, for resume.
// Returns ErrCursorAgedOut if fromSeq < oldest retained seq.
func (w *ackWindow) Replay(fromSeq uint64) ([]windowEntry, error)
```

The window stores the **post-hook, exact wire bytes**. This guarantees a replayed event is
byte-identical to the original (important: re-running hooks on replay could produce different
output if a hook is non-deterministic or depends on auth state that has since changed). The
broker remains the source of truth only for replay *beyond* the window (§6.3).

### 5.2 Integration point

The window sits between `subscription_event_updater.go`'s
`eventUpdater.UpdateSubscription(subID, data)` and the protocol write. Concretely we
introduce a thin decorator around `resolve.SubscriptionUpdater` per ack-enabled subscription:

```go
// Wraps the engine's SubscriptionUpdater. For ack-enabled subscriptions only.
type ackingUpdater struct {
    inner  resolve.SubscriptionUpdater
    window *ackWindow
    proto  wsproto.Proto // to write `next` with cursor extensions
    subID  string        // the client-facing operation id (msg.ID)
}

func (a *ackingUpdater) UpdateSubscription(id resolve.SubscriptionIdentifier, data []byte) {
    cursor, err := a.window.Append(a.ctx, data, currentProviderPos(a.ctx))
    if err == ErrWindowFull {
        // backpressure already applied inside Append; on ctx cancel we close.
        return
    }
    ext := buildCursorExtensions(cursor)
    a.proto.WriteGraphQLData(a.subID, data, ext) // graphql_ws.go:117
}
```

For non-ack subscriptions the decorator is absent and the path is byte-for-byte unchanged.

### 5.3 Backpressure when the window fills

When `count == capacity` (the client has `maxInFlight` unacked events outstanding), `Append`
blocks the delivering goroutine up to a deadline. Because delivery runs under the
`SubscriptionEventUpdater`'s semaphore + timeout (`subscription_event_updater.go:46-80`,
default 5s), a stuck client naturally exerts backpressure: the per-subscription update goroutine
parks on `Append`, the semaphore slot stays held, and — critically — we do **not** advance
the broker offset/ack for events still sitting unsent in the window. This converts "slow
client" from "silent data loss" into "bounded buffering then broker-paced backpressure,"
which is exactly the at-least-once posture we want.

Two overflow policies, configurable per subscription:

- `block` (default): park the delivering goroutine; rely on broker backpressure (Kafka poll
  pauses, JetStream `FetchNoWait` simply fetches less). Best for durability.
- `disconnect`: if the window stays full past `events.delivery.full_window_timeout`, close
  the subscription with a close frame instructing the client to reconnect-and-resume. The
  unacked events remain replayable from the broker (if `Pos` is durable) or are lost (if
  ephemeral). This protects router memory from a single wedged client.

## 6. Retention, Aging, and Replay Beyond the Window

### 6.1 Three tiers of replay source

```
                 ┌─────────────────────────────────────────────┐
   resume from   │  fromSeq within unacked ring window?         │ ──▶ replay from RAM (exact bytes)
   cursor C  ──▶ │  fromSeq within retained-acked window?       │ ──▶ replay from RAM (retained, exact bytes)
                 │  fromSeq older, but Pos durable in broker?   │ ──▶ re-seek broker, re-resolve, replay
                 │  fromSeq aged out everywhere?                │ ──▶ ErrCursorAgedOut → restart-from-now
                 └─────────────────────────────────────────────┘
```

- **Unacked ring (§5):** sent-but-unacked. Always replayed first on resume.
- **Retained-acked window:** acked entries are not freed immediately; they linger up to
  `resumeRetention` (default 10m) or `resumeWindow` entries (default 4096), whichever is
  smaller. This covers the common case where a client acked cursor N, then briefly
  disconnected, and reconnects asking for N+1 — we can serve it from RAM without touching the
  broker.
- **Broker re-seek:** beyond RAM, if the cursor's `Pos` is durable (Kafka offset, JetStream
  seq, Redis Stream ID), the router opens a fresh consumer at `Pos+1` and replays. This is
  where the per-provider adapter changes in §3.3 are exercised.

### 6.2 Cursor aged out

If `fromSeq` is older than the oldest retained entry **and** the broker can no longer serve
`Pos` (offset truncated by retention, JetStream stream sequence below `first_seq`, Redis
Stream trimmed by `MAXLEN`), the router cannot honor at-least-once for the gap. It MUST NOT
silently start from now and pretend nothing was lost. Instead it sends a typed signal and
then resumes live:

```json
{
  "type": "next",
  "id": "sub-1",
  "payload": { "data": null },
  "extensions": {
    "cosmo": {
      "resume": "aged_out",
      "message": "requested cursor is older than retention; resuming from latest",
      "resumedFrom": "AY29tb19...latest..."
    }
  }
}
```

The client learns definitively that a gap occurred (it can surface a "you may have missed
updates" state, refetch a snapshot via a query, etc.) rather than silently assuming
continuity. This honesty is a feature: at-least-once with a bounded, *observable* retention
window is far more useful than an unbounded promise the router cannot keep.

## 7. Reconnect & Restart Flow

### 7.1 Normal reconnect (cursor within retention)

```
1. Client WS dies after acking cursor seq=4700; events 4701..4711 were sent but unacked.
2. Client reconnects: connection_init {cosmo.ack v1}  -> connection_ack {enabled:true}
3. Client: subscribe id=sub-1 {..., extensions.cosmo.resumeFrom = cursor(4700)}
4. Router validates cursor HMAC + decodes Seq=4700.
5. Router locates the subscription's retained window; finds 4701..4711 in RAM.
6. Router replays next(4701) .. next(4711) with their original cursors and bytes.
7. Router attaches a live broker consumer starting after the window's newest Pos
   and continues delivery from seq=4712.
8. Client acks as it consumes; dedups any event it had already applied (<=4711 if it
   actually processed some before the disconnect).
```

### 7.2 Reconnect after router restart

The `SubEpoch` in the cursor was minted by the old process. On a fresh process the
subscription's epoch differs, and the RAM window is gone. The router cannot replay from RAM,
so it falls to broker re-seek (§6.1 tier 3) using the cursor's `Pos`. If durable, replay
proceeds; the router mints a **new** `SubEpoch` for the rebuilt binding and stamps it on all
subsequent cursors. If `Pos` is ephemeral or aged out, it is the §6.2 aged-out path.

### 7.3 Cursor aged out

```
3. Client: subscribe ... resumeFrom = cursor(120)   // very old
4. Router: Seq=120 < oldest retained (5000) AND Kafka offset for Pos truncated.
5. Router: emit next{extensions.cosmo.resume:"aged_out", resumedFrom: cursor(latest)}.
6. Router: attach live consumer from now; continue at seq = latest+1.
```

### 7.4 Spoofed / invalid cursor

HMAC check fails, or `SubEpoch`/provider mismatch the live subscription → the router
**rejects the resume** and treats the `subscribe` as a fresh subscription (start-from-now),
emitting `extensions.cosmo.resume:"rejected"`. It never trusts a client-supplied cursor to
seek the broker without validating the signature first (§10.3).

## 8. Architecture Diagram

```
                          ┌──────────────────────── Cosmo Router ─────────────────────────┐
                          │                                                                │
 Broker (Kafka/NATS/      │   provider adapter goroutine                                   │
   Redis Streams) ───────────▶ Update(events)  ──▶  OnReceiveEvents hooks (per sub)        │
        ▲                 │        (adapter.go)        (subscription_event_updater.go)      │
        │                 │                                   │                             │
        │ re-seek on       │                                   ▼                             │
        │ resume           │                        ┌─────────────────────┐                 │
        │ (Pos+1)          │                        │  ackingUpdater       │                 │
        │                 │                        │  (per subscription)  │                 │
        └──────────────────────────────────────────│   ▼                  │                 │
   commit/ack only         │                        │  ackWindow (ring)    │  cursor=seq++   │
   client-acked cursor     │                        │  [unacked | retained]│                 │
   (joins durability RFC)  │                        └─────────┬───────────┘                 │
                          │                                   │ next + extensions.cosmo.cursor │
                          │                                   ▼                             │
                          │              wsproto.WriteGraphQLData / HttpFlushWriter id:     │
                          └───────────────────────────────────┬─────────────────────────────┘
                                                               │  next(cursor)
                                                               ▼
                                              ┌─────────────────────────────┐
                                              │           Client            │
                                              │  applies + dedups by cursor │
                                              │  ack(cursor)  ───────────────┼──▶ back to ackWindow.Ack
                                              │  on reconnect: subscribe     │
                                              │    {resumeFrom: lastCursor}  │
                                              └─────────────────────────────┘
```

## 9. Configuration & Schema Surface

### 9.1 Router YAML

```yaml
version: "1"

events:
  delivery:
    # Master switch. When false, the router never negotiates acks and behaves
    # exactly as today (at-most-once). Backward compatible default: false.
    at_least_once_enabled: true

    # HMAC key protecting cursor integrity across replicas/restarts.
    # Required when at_least_once_enabled. Rotate via dual-key list.
    cursor_signing_key: "${EDFS_CURSOR_SIGNING_KEY}"

    # Default ack mode if the client does not specify. windowed | per_message
    ack_mode: windowed

    # Max unacked events held per subscription before backpressure. The server
    # caps whatever maxInFlight the client requests in connection_init.
    max_in_flight: 256

    # Retained-acked window for cheap RAM resume (entries and time, min wins).
    resume_window: 4096
    resume_retention: 10m

    # Overflow policy when the unacked window is full. block | disconnect
    full_window_policy: block
    full_window_timeout: 30s

    # Whether to allow broker re-seek beyond the RAM window (requires durable
    # providers; ignored for core NATS / Redis Pub/Sub).
    broker_reseek_enabled: true

  providers:
    nats:
      - id: my-nats
        url: "nats://localhost:4222"
```

This reuses the existing `events:` block (`config.go:781` `StreamsConfiguration`) and the
already-present `WebSocketClientAckTimeout` (`config.go:467`) as a sibling concept (that
field is router→subgraph; ours is client→router and lives under `events.delivery`).

### 9.2 Per-subscription override via SDL directive

We extend the existing EDFS subscribe directives
(`composition/src/v1/constants/directive-definitions.ts`) with an optional `delivery`
argument so schema authors can opt specific fields into at-least-once without flipping the
global switch:

```graphql
type Subscription {
  employeeUpdates: Employee!
    @edfs__natsSubscribe(
      subjects: ["employeeUpdates"]
      providerId: "my-nats"
      streamConfiguration: {
        streamName: "EMPLOYEES"
        consumerName: "router-emp"
        consumerInactiveThreshold: 30
      }
      delivery: { guarantee: AT_LEAST_ONCE, maxInFlight: 128 }
    )
}

enum edfs__DeliveryGuarantee { AT_MOST_ONCE AT_LEAST_ONCE }
input edfs__DeliveryConfiguration {
  guarantee: edfs__DeliveryGuarantee = AT_MOST_ONCE
  maxInFlight: Int
}
```

`AT_LEAST_ONCE` requires a provider position that can be encoded into a cursor; the
composition layer SHOULD warn at composition time if it is applied to a core-NATS or
Redis-Pub/Sub subscription (window-only resume, no broker replay).

## 10. Considerations and Risks

### 10.1 Buffer memory

Each ack-enabled subscription holds up to `max_in_flight + resume_window` event payloads in
RAM. With `max_in_flight=256`, `resume_window=4096`, and ~1 KB events, that is ~4.3 MB per
subscription worst case. With 10k concurrent subscriptions that is potentially tens of GB.
Mitigations: (a) `resume_window` defaults are conservative and time-bounded; (b) retained
entries store bytes already produced — we can offer a `resume_window: 0` mode that relies
purely on broker re-seek for any acked-then-disconnected gap; (c) large-payload guardrail
that caps total buffered bytes per subscription and falls back to broker re-seek. This is the
central cost of the design and is explicitly tunable.

### 10.2 Replay duplicates → idempotency is mandatory

By construction, resume replays the sent-but-unacked window, and a client that processed but
had not yet acked an event will see it again. We do **not** promise exactly-once delivery.
We promise at-least-once + a stable dedup key (the cursor). The client contract is: persist
`lastAppliedCursor`, drop any `next` whose `seq <= lastAppliedCursor.Seq`. This is documented
prominently in the client guidance. SSE has the same property via `Last-Event-ID`.

### 10.3 Cursor spoofing & validation

A client could fabricate a cursor to make the router seek arbitrary broker offsets (data
exfiltration across what the subscription's filters would otherwise allow, or DoS via
seeking to expensive positions). Defenses:
- HMAC-sign every cursor with `cursor_signing_key`; reject bad signatures (treat as fresh
  subscribe, §7.4).
- Bind the cursor to the subscription's provider + subjects/topic via the signed payload, so
  a cursor minted for subscription A cannot reseek subscription B.
- `SubEpoch` prevents replaying cursors across unrelated re-plans.
- Re-seek still passes through the subscription's existing authorization
  (`SubscriptionOnStart` hook) and `OnReceiveEvents` filters, so a valid cursor cannot bypass
  per-event authorization; replayed events are filtered exactly as live ones.

### 10.4 Ordering

Monotonic `Seq` is assigned post-hook at delivery time, so the *delivered* order is
well-defined and replay preserves it. However, the existing updater can abandon slow hook
goroutines on timeout and process the next batch, warning that "events may arrive out of
order" (`subscription_event_updater.go:77-80`). Under at-least-once we tighten this: when
the window is enabled, sequence assignment is serialized per subscription
(`ackWindow.Append` is mutex-guarded), so two batches cannot interleave their cursor
assignment. The timeout-abandon path must be reconciled: an abandoned-then-late update would
try to `Append` after a newer batch already advanced `nextSeq`. We resolve this by assigning
`Seq` at the moment of `Append` (not at batch receipt), so late writes simply get higher
cursors — correct for at-least-once, though it means a late event sorts after newer ones.
For strict ordering, operators should size `max_concurrent_handlers`/`handler_timeout` so
abandonment does not occur.

### 10.5 Protocol-version sprawl

We are adding a new `ack` message and new extensions to three transports
(graphql-transport-ws, graphql-sse, SSE/multipart) plus the legacy `graphql-ws`
(subscriptions-transport-ws) and Absinthe. Risk: a combinatorial matrix of client behaviors.
Mitigation: a single negotiated capability (`cosmo.ack.version`) gates all of it; the legacy
and Absinthe protocols simply never advertise it and stay at-most-once (we will not extend
Absinthe). The `version` integer lets us evolve the cursor/ack shape without guessing client
support.

### 10.6 Multi-replica reconnect

A client may reconnect to a **different** router replica behind a load balancer. That replica
has no RAM window for the subscription. Two postures:
- **Sticky sessions (recommended for v1):** route reconnects (by a connection/subscription
  affinity cookie or consistent hashing on a client-supplied subscription key) back to the
  origin replica so the RAM window is available. Simplest, no shared state.
- **Broker re-seek (works cross-replica):** because the cursor carries a durable `Pos`, any
  replica can honor a resume by re-seeking the broker — *provided* the provider is durable
  (Kafka/JetStream/Redis Streams). This is the strength of encoding the position in the
  cursor: cross-replica resume needs no shared cursor store, only a durable broker. RAM
  window is then a latency optimization, not a correctness requirement.
- **Future: shared cursor/window store.** A Redis-backed shared window would allow
  cross-replica RAM-tier resume for ephemeral providers too, at the cost of operational
  complexity. Explicitly deferred.

### 10.7 Interaction with hooks and synthesized events

Events created by `SubscriptionOnStart`'s `EmitEvent` or `ctx.NewEvent` (Cosmo Streams v1
ADR) have no broker `Pos`. They get a cursor and live in the RAM window, so they are
replayable within retention but never via broker re-seek. This is acceptable: such events are
router-local and would not exist on the broker anyway.

### 10.8 Acks consume the read loop

Adding a high-frequency client→server message (per-message ack mode) increases read-loop
load on `wsConnectionWrapper.ReadJSON` (`websocket.go:171`). Windowed mode (default) bounds
this to one ack per `ackEvery`/`ackInterval`. We recommend `ackEvery >= 32` for high-volume
streams.

## 11. Migration / Rollout & Backward Compatibility

1. **Phase 0 — dormant.** Ship the cursor/window/ack code behind
   `events.delivery.at_least_once_enabled: false` (default). No behavior change. The
   `connection_ack` payload remains empty unless the client advertised `cosmo.ack`.
2. **Phase 1 — opt-in per subscription.** Enable the global switch; opt specific fields in
   via the `@edfs__*Subscribe(delivery: {guarantee: AT_LEAST_ONCE})` directive. Only clients
   that advertise `cosmo.ack` get cursors; everyone else is unchanged at-most-once.
3. **Phase 2 — provider adapter seek support.** Land the `kafka/adapter.go` offset-seek and
   `nats/adapter.go` start-sequence changes, and (optionally) the Redis Streams migration, to
   enable broker re-seek beyond the RAM window and cross-replica resume.
4. **Phase 3 — join with durability RFC.** Defer broker commit/ack to client-acked cursor,
   giving end-to-end at-least-once (broker→router→client) when both RFCs are enabled.

Backward compatibility guarantees:
- Clients that do not send `cosmo.ack` in `connection_init`: byte-for-byte identical to
  today. No `extensions.cosmo` on `next`, no window, no replay.
- SSE/`EventSource` clients that ignore `id:`: unaffected; `id:` is a standard, optional SSE
  field. Browsers that *do* honor it get resume for free.
- `subscriptions-transport-ws` (legacy) and Absinthe clients: never negotiate acks, stay
  at-most-once.
- The new `ack` message type is only ever sent by clients that negotiated the capability, so
  the router only needs to accept it on ack-enabled connections; on others it is an unknown
  type and follows existing handling.

## 12. Why This Over the Alternatives

This RFC competes with three sibling approaches. The core claim: **only a client-ack/resume
protocol closes the last-mile router→client gap, because only the client knows what it
actually received.**

- **vs. Broker-native durability (JetStream durable consumers / Kafka consumer groups).**
  Durability fixes broker→router: if the router restarts, it can re-consume. But the broker's
  "delivered" means "the router consumed it" — which today happens *before* the bytes hit the
  socket (`nats/adapter.go:154`). It has zero visibility into whether the client received
  anything. A client that reconnects gets a fresh consumer starting from now (Kafka
  `AfterMilli(now)`) or full re-delivery (JetStream) with no protocol to dedupe. Durability
  is necessary for the broker gap and **composes** with us (Phase 3: commit on client-ack),
  but it cannot, by itself, deliver at-least-once to the client.
- **vs. Router-side WAL (persist every event to disk before sending).** A WAL gives the
  router durable replay across restarts without a durable broker, but it still has no signal
  for *which events the client received*. It must either replay everything since the last
  router-known position (dupes, no dedup key) or guess. It also adds disk I/O on the hot
  delivery path and a new operational surface (WAL compaction, disk pressure). Our window is
  the same idea bounded to RAM, but crucially paired with the **client ack** that tells us
  what to drop. A WAL without client acks is a strictly weaker version of this design.
- **vs. A generic "delivery-manager" layer (broker-agnostic durable queue in the router).**
  This centralizes retry/dedup in one component, but it sits *inside* the router and so
  shares the WAL's blind spot: it tracks router-side delivery state, not client receipt. It
  also tends to impose a uniform model that fights the providers' native positioning (Kafka
  offsets vs. JetStream seq vs. Redis IDs), whereas our opaque cursor *embeds* the native
  position and re-seeks each broker idiomatically.

The decisive argument: the failure mode we target — "client dropped, reconnected, and lost
in-flight messages" — is defined entirely by client-side state. The router cannot infer it.
The client must report its last durable position, and the router must be able to resume from
it. That is precisely a cursor + ack + resume protocol. Every other layer is solving a
different (real, but different) gap; this one owns the last mile, and it is the only one that
can.
