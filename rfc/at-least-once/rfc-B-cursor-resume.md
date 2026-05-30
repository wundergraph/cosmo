# RFC: At-Least-Once for GraphQL Subscriptions — Cursor / Resume-Token Replay on Reconnect (Pattern B)

**Status:** Draft (revised after adversarial review)

**Verified against.**
Router pins `github.com/wundergraph/graphql-go-tools/v2 v2.4.1` (`router/go.mod:34`).
All engine line numbers in this RFC are re-cited against `v2.4.1`, **not** the dossier's `v2.1.1-...` snapshot.
Key engine locations used below: `SubscriptionUpdater` interface at `resolve/resolve.go:1586`; `SubscriptionResponseWriter` at `resolve/response.go:69`; `addSubscription` at `resolve.go:771`; `executeSubscriptionUpdate` at `resolve.go:616`; `handleTriggerUpdate` at `resolve.go:1086`; `handleUpdateSubscription` at `resolve.go:1113`; `prepareTrigger` at `resolve.go:1277`.
Where the dossier and the pinned engine disagree on line numbers, the pinned engine wins.

**TL;DR.**
Cosmo's EDFS pushes broker events to subscribers fire-and-forget,
so any disconnect, router restart, or slow-consumer overflow drops every event that arrives while the client is not reading.
This RFC restores at-least-once delivery without a per-message ack protocol,
by surfacing an **opaque, signed cursor** alongside every delivered message and, on reconnect, **replaying the missed events from the broker's own retained log before going live**.
This is the "`Last-Event-ID` done properly" / Hasura-streaming model.

Two honest corrections versus the previous draft, forced by reading the pinned engine:

1. **There is no "splice the replayed client into the shared live trigger" primitive in the engine, and adding one is an L/XL change.**
   `addSubscription` (`resolve.go:771`) either attaches a new subscriber to an existing trigger (no `Source.Start` re-run) or creates a trigger and starts the source once.
   There is no code path that runs a per-subscriber backlog reader and then re-parents that subscriber onto a *different*, already-running trigger.
   This RFC therefore **abandons shared-trigger splicing for resuming clients**.
   A resuming client gets its **own trigger** whose key includes a replay marker, runs a single contiguous *seek-then-live* read on one consumer, and never joins the shared live trigger.
   Fresh (cursor-less) clients keep the shared-trigger fan-out exactly as today.
   The cost: resuming clients do not share fan-out and pay their own broker reader for the lifetime of the resumed subscription, not just during catch-up.
   We accept and document this trade-off (§4, §8.3, §12.1) rather than claim an unbuildable optimization.

2. **The engine change is not a one-line additive widening.**
   Threading a per-message cursor to the writer touches `SubscriptionUpdater` (`resolve.go:1586`), `handleTriggerUpdate`/`handleUpdateSubscription`, `executeSubscriptionUpdate` (`resolve.go:616`), and the **exported** `SubscriptionResponseWriter` interface (`response.go:69`) which the *router* implements (`websocketResponseWriter`, `HttpFlushWriter`).
   It is a coordinated engine+router release, graded **L** (§11, §12.3).

The cursor encodes the backend's own position primitive (JetStream stream sequence, Kafka `(partition, offset)`, Redis Streams entry id, Kinesis sequence number, Event Hubs offset, Pub/Sub snapshot/time).
The guarantee is bounded by the backend's retention/replay window:
within the window it is at-least-once across gaps;
beyond it (retention-evicted events) it cleanly degrades to at-most-once and surfaces a non-silent `CURSOR_EXPIRED` error.
It works only on **log/cursor backends with a configured durable log** (JetStream subjects with a stream, Kafka topics within `retention.ms`, Redis Streams).
On core NATS, Redis Pub/Sub, and delete-on-ack queues there is no durable position to seek, so those degrade explicitly to at-most-once or compose with a router-side buffer (Pattern E).

**Hard dependency.**
Pattern B's per-event authz-on-replay safety claim depends on **Cosmo Streams v1** landing first (its `OnStreamEvents`/`StreamEvent` envelope).
The current code ships `OnReceiveEvents` (`router/pkg/pubsub/datasource/hooks.go:14`), not `OnStreamEvents`, and has no `WriteEvent`.
See the new **§0 Dependencies** section; the per-event guarantee is explicitly gated on a configured hook, and the no-hook default is documented as a known residual exposure (§8.5).

---

## 0. Dependencies

Pattern B is **not** self-contained. It has two hard dependencies and one soft one.

| Dependency | Status today | What Pattern B needs | If absent |
|---|---|---|---|
| **Cosmo Streams v1 event envelope** (`StreamEvent` carrying per-provider metadata) | Live code has `StreamEvent` with `GetData()` only (`subscription_event_updater.go`); v1's richer envelope is an unmerged draft (`rfc/cosmo-streams-v1.md`). | Extend `StreamEvent` with `Position()` (§4.3). This is the *same* "richer envelope" change v1 proposes. | Pattern B cannot read/surface a position. Blocking. |
| **Cosmo Streams v1 receive hook** — proposed `OnStreamEvents`; **current symbol is `OnReceiveEvents`** (`hooks.go:14`) | `OnReceiveEvents` ships today; `OnStreamEvents`/`WriteEvent` exist only in the v1 draft. | A per-event filter/authz hook that runs identically on live and replayed events (§8.5). The current `OnReceiveEvents` signature is sufficient for the minimal subset. | Per-event authz on replay is **not** enforced (only operation-level authz at resubscribe). Documented residual exposure, not a silent one — see §8.5. |
| **Engine cursor threading** (`SubscriptionUpdater` + `SubscriptionResponseWriter` change) | Neither interface carries a per-message id (`resolve.go:1586`, `response.go:69`). | Coordinated engine+router change (§11). | No cursor reaches the wire. Blocking. |

**Minimal hook subset Pattern B requires (so it can ship without the full v1 surface).**
Pattern B does **not** need `OnStreamEvents`/`WriteEvent` by those names.
It needs exactly one capability: *a per-event filter that runs on replayed events with the same semantics as on live events*.
The existing `OnReceiveEvents` hook (`hooks.go:14`, signature `func(subscriptionCtx, updaterCtx, subConf, eventBuilder, evts []StreamEvent) ([]StreamEvent, error)`) already provides this for live events; Pattern B routes replayed events through the **same** call.
If v1 renames `OnReceiveEvents`→`OnStreamEvents`, Pattern B follows the rename; nothing in the design depends on the new name.
All references to `OnStreamEvents` in this RFC mean "the v1 receive hook, currently `OnReceiveEvents`."

**Timeline gate.** Ship order: (1) engine cursor threading + `StreamEvent.Position()` envelope (can land with or just after v1), (2) seekable adapters + SSE/WS wire, (3) per-event authz-on-replay once the v1 hook contract is final. Steps (1)–(2) deliver at-least-once with operation-level authz; step (3) closes the per-event authz gap.

---

## 2. Problem & Context

An application that publishes to Kafka or NATS JetStream already *has* at-least-once on the ingest side:
Kafka tracks committed offsets, JetStream tracks consumer/stream sequence and redelivers un-acked messages.
But the moment an event crosses from the broker into a GraphQL subscription, Cosmo throws that guarantee away.

The dossier establishes that the entire path from broker callback to client socket write is **one synchronous, fire-and-forget call stack** with no internal buffer
(`00-research-dossier.md` §1.3).
The concrete loss points:

- **The framework abstraction is fire-and-forget by construction.**
  `datasource.Adapter` (`router/pkg/pubsub/datasource/provider.go:22-28`) and the engine's `SubscriptionUpdater.Update(data)` (`resolve.go:1586-1588`) return **no error and have no ack hook back to the broker**.
  Durability is therefore a per-adapter property, not a property of EDFS, and today only NATS JetStream even attempts it (dossier §2).
- **No cursor is ever surfaced.**
  The delivered event structs carry only `Data`, `Headers` (and Kafka `Key`) — no sequence/offset/position field exists
  (`nats/engine_datasource.go:39-42`, `kafka/engine_datasource.go:58-63`).
  JetStream's `msg.Metadata()` (which carries stream and consumer sequence) is **never read** (dossier §2.1 Hop D).
  Kafka's `r.Offset` is never read (dossier §3.1).
- **No resume / replay anywhere.**
  A grep of `core/` and `internal/wsproto/` for `Last-Event-ID` / `LastEventID` / `resume` / `cursor` / `resumeToken` returns nothing (dossier §2.1 Hop D).
  A reconnecting client always starts a brand-new subscription "from now":
  it gets a new `ConnectionID` (`resolve.NewConnectionID()`, `websocket.go:367`) and a brand-new subscription id (`websocket.go:1160-1185`),
  and the trigger is keyed by data hash, **not** by client identity (dossier §1.4; `prepareTrigger`, `resolve.go:1277`).
- **The SSE writer never emits `id:`.**
  `HttpFlushWriter.Flush` writes only `event:` / `data:` (`router/core/flushwriter.go:116-167`),
  so even the *stock browser* `Last-Event-ID` auto-resume cannot work, because there is no id to track.
- **The WS inbound message set has no resume concept.**
  Recognized inbound messages are `Ping`, `Pong`, `Subscribe`, `Complete`, `Terminate` (`router/internal/wsproto/proto.go:88-94`).
  `connection_init` / `connection_ack` is a one-time *connection* handshake, not a data position (dossier §2.1 Hop C).
- **The WS heartbeat is a no-op, so half-open WS sockets are not detected promptly.**
  `websocket.go:659-662` is an explicit no-op; the router never pings the downstream WS client (dossier §1.6).
  A suspended-mobile or NAT-timed-out WS is not noticed until the next *write* fails.
  This matters for resume: the "client reconnects and replays" story assumes the disconnect is detected so the client *knows* to reconnect (§5.5).
- **Backends actively skip the gap.**
  Kafka re-subscribes with `ConsumeResetOffset(AfterMilli(now))` (`kafka/adapter.go:32-34, 142-153`),
  so on every (re)subscribe and after every restart it **skips everything produced during downtime**.
  NATS core uses an unbuffered channel and the nats.go client **drops** on slow-consumer overflow (`nats/adapter.go:168`, `provider_builder.go:96-105`).
  Redis uses Pub/Sub (not Streams) and drops on overflow (`redis/adapter.go:88-152`).

The gap in one line (dossier §2.4): there is no client acknowledgement, no resume token, no replay, and no per-subscriber delivery accounting anywhere in EDFS.

**This RFC attacks Hop D directly** (no resume/replay) and, as a side effect, neutralizes most of the damage from Hops A and B for log backends —
because if the client can always re-read from where it left off, an in-flight loss is simply re-delivered on reconnect rather than permanently lost.
It is deliberately the *lightest durable option for cursor-able backends* in the seven-pattern space:
it adds no per-message ack protocol and leans on the durability the broker already provides.
It does **not** claim to be "essentially stateless" — resuming subscribers carry a per-subscriber broker reader for the life of the resumed subscription (§4.4, §8.3).

**Relationship to Cosmo Streams v1.**
See §0. Pattern B extends the v1 `StreamEvent` envelope with a position and reuses the v1 receive hook (currently `OnReceiveEvents`) for per-event authz on replay.
It does not replace v1; it is gated on it.

---

## 3. Goals & Non-Goals

### Goals

1. **Restore at-least-once across disconnect gaps** (client reconnect, router restart, broker reconnect) on log/cursor backends *with a configured durable log*, bounded by the backend's retention/replay window.
2. **Make degradation explicit and non-silent.**
   When the guarantee weakens, the router surfaces it (capability negotiation + an `extensions.cosmo.delivery` report + a hard `CURSOR_EXPIRED` error when a replay request lands outside the window).
3. **Keep the router's *steady-state, non-resuming* footprint unchanged.**
   No per-subscriber broker consumer and no external checkpoint store for cursor-less clients; they keep the shared-trigger fan-out.
   Resuming clients accept a per-subscriber reader (the honest cost — §8.3). Durability stays in the broker; the router persists no checkpoint.
4. **Make stock SSE clients resume for free.**
   Emit `id:` and honor `Last-Event-ID`;
   a standards-compliant browser `EventSource` then auto-resumes with zero client code, subject to the `Last-Event-ID` caveats in §5.1.
5. **Preserve the shared-trigger fan-out for live (cursor-less) delivery** (one broker subscription, N live subscribers — dossier §1.4).
6. **Reuse the existing resolve + receive-hook + flush path** for replayed events, so filtering, data mapping, and authz behave identically live and on replay *when a hook is configured* (§8.5).

### Non-Goals

- **Per-message client ack / end-to-end receipt confirmation.** That is Pattern A.
- **Cross-restart durability on backends with no durable log** (NATS core, Redis Pub/Sub, SQS, RabbitMQ). They degrade or compose with Pattern E.
- **Exactly-once.** At-least-once implies duplicates on replay. Clients must be idempotent.
- **Global ordering across a fan-out.** Ordering is per-partition/per-stream (dossier §6.1).
- **Changing the publish path.** Idempotent ingest (`Nats-Msg-Id`, Kafka idempotent producer) is out of scope, referenced only where dedup matters.
- **Detecting half-open WS sockets.** Pattern B does not add WS keepalive (the heartbeat is a no-op — §2); WS resume depends on disconnect detection the router does not currently provide. Cross-referenced to Pattern D / a WS-keepalive change (§5.5).

---

## 4. Design — the mechanism in depth

### 4.1 The core idea

Every backend in the "log/cursor" family addresses its retained log by a **position primitive**:
a JetStream stream sequence, a Kafka `(partition, offset)`, a Redis Streams entry id `<ms>-<seq>`, a Kinesis sequence number, an Event Hubs offset, a Pub/Sub snapshot or publish time (dossier §3.2, §3.3).
Pattern B does three things the current code does not:

1. **Read** that primitive on every event (the code already has it in hand and throws it away — `msg.Metadata()`, `r.Offset`, the Redis entry id).
2. **Surface** it to the client as an **opaque, signed cursor** attached to the delivered message (SSE `id:` line; WS `Next` extension).
3. **Honor** a returned cursor on (re)subscribe by translating it into a backend **seek**, then running a *single contiguous reader* from that position through to live (§4.4).

The router persists no per-subscriber durable checkpoint.
The cursor *is* the persisted state, and it lives on the client.
The broker *is* the durable buffer, and it already exists.

### 4.2 The cursor

A cursor is an opaque base64url token the client must treat as a blob.
Internally it is a signed envelope:

```go
// router/pkg/pubsub/datasource/cursor.go (new)

// Cursor is the provider-agnostic, opaque resume token surfaced to the client.
// It is signed (HMAC) and tenant-scoped so a client cannot forge a position
// or seek into data it is not authorized to read (see §8.5).
type Cursor struct {
    Version    uint8  // envelope version, for forward-compat
    ProviderID string // must match the live subscription's provider
    // Position is the provider-native encoding of the backend offset/sequence.
    // For multi-partition/shard subscriptions this is a *vector* (one entry per
    // partition/shard), encoded in a single opaque blob (§12.1).
    Position   ProviderPosition
    // ResumeKey binds the cursor to a STABLE subscription identity (rendered
    // operation input + provider + subject set) — explicitly EXCLUDING volatile
    // forwarded headers, so a token refresh does not invalidate resume (§8.5).
    ResumeKey  uint64
    // Subject identifies the authenticated principal/tenant at issue time.
    // On resume the router checks the *current* principal is still in scope.
    // May be empty for unauthenticated/API-key subscriptions (§8.5).
    Subject    string
    IssuedAt   int64 // unix seconds; used for max-resume-age policy
    KeyID      uint8 // signing-key id, for current+previous rotation (§8.1)
}

// ProviderPosition is implemented per backend. It must round-trip through
// Encode/Decode and translate to a native seek request.
type ProviderPosition interface {
    ProviderType() string // "nats" | "kafka" | "redis" | ...
    Encode() []byte       // bytes embedded in the signed cursor envelope
}
```

The signing key is fleet-shared and rotatable with a current+previous overlap window (§8.1).
A client never sees the raw `(partition, offset)` — only the signed blob.
This matters: a raw offset would let a client seek to data it should never see (dossier §6.8).

**Why `ResumeKey`, not `TriggerHash`.**
The engine trigger key (`prepareTrigger`, `resolve.go:1277-1291`) folds `SubgraphHeadersBuilder.HeadersForSubgraph(...)` — i.e. *forwarded subgraph headers* — into the hash.
Forwarded headers routinely include request-derived values (Authorization bearer tokens, `Accept-Language`, trace ids, cookies).
Binding the cursor to the engine trigger hash would mean a client presenting a **refreshed token** on reconnect computes a different hash → `CURSOR_INVALID` → forced at-most-once on every normal token refresh.
So the cursor binds to a **stable** identity (`ResumeKey` = hash of rendered operation input + `ProviderID` + the authenticated subject set), explicitly excluding volatile forwarded headers.
Header-propagation configs that route on *non-identity* headers (e.g. a per-request trace id forwarded to the subgraph) are compatible with resume because those headers are not in `ResumeKey`; configs that *partition tenants by a forwarded header* must include that header in the subject set (a documented configuration requirement, §8.5).

### 4.3 The adapter contract change

Today the adapter pushes data with no position and accepts no seek.
Pattern B widens the contract on both ends.

**Outbound (read path): events carry a position.**
The v1 envelope replaces the bare payload with a per-provider `StreamEvent`.
Pattern B requires that envelope to carry the backend position:

```go
// router/pkg/pubsub/datasource/subscription_event_updater.go (extended)

type StreamEvent interface {
    GetData() []byte
    // Position returns the backend position of THIS event, or nil if the
    // backend has no durable position (NATS core / Redis Pub/Sub) — in which
    // case no cursor is surfaced and the field degrades to at-most-once.
    Position() ProviderPosition
}
```

For NATS JetStream this is `msg.Metadata().Sequence` (currently ignored).
For Kafka it is `(record.Partition, record.Offset)`.
For Redis Streams it is the entry id.
For core NATS / Redis Pub/Sub, `Position()` returns `nil` and the cursor machinery is disabled for that field.

**Inbound (subscribe path): the adapter can start from a position and replay-then-live on a single reader.**
We add an optional capability interface that durable adapters implement.
The base `Adapter` interface (`provider.go:22-28`) is **not** changed:

```go
// router/pkg/pubsub/datasource/provider.go (additive — capability interface)

type SeekableAdapter interface {
    Adapter

    // SubscribeFrom behaves like Subscribe but, before going live, replays
    // every retained event strictly AFTER `from` through the same `updater`,
    // in backend order, then transitions to live ON THE SAME READER without a
    // gap. This is the load-bearing requirement: replay and live MUST be the
    // same consumer/iterator (§4.4), so there is no two-consumer boundary race.
    //
    // If `from` is older than the backend retention window, it returns
    // ErrCursorExpired and DOES NOT start a live subscription.
    //
    // If `from` is nil, it is identical to Subscribe (start live from now).
    SubscribeFrom(ctx context.Context, from ProviderPosition, cfg SubscriptionEventConfiguration, updater SubscriptionEventUpdater) error

    // RetentionWindow reports the backend's approximate replay horizon. It is
    // BEST-EFFORT and may be stale (§9.1): for Kafka it requires a broker
    // round-trip; for JetStream a stream-info call; for Redis a config read.
    RetentionWindow() time.Duration
}

var ErrCursorExpired = errors.New("pubsub: cursor outside backend retention window")
```

**Single-reader replay-then-live is mandatory, not an optimization.**
The previous draft allowed "open a transient replay reader, then attach to the shared live trigger."
Reading the engine shows that is unbuildable (no splice primitive — §4.4 below), and even if it existed it would be a *two-consumer* design (durable live consumer + ephemeral replay consumer) with a genuine boundary race that can **skip** events published between "replay caught up to head H" and "live consumer's position at attach" (review issues 7, 8).
We forbid it. `SubscribeFrom` MUST use one consumer that seeks then continues:

- **Kafka:** one groupless consumer, `assign(partition)` + `seek(partition, offset+1)`, then `poll` continues seamlessly through head into live. Same reader throughout.
- **JetStream:** one ephemeral `OrderedConsumer` with `DeliverByStartSequence = cursor.seq + 1`; an ordered consumer delivers from the start sequence and keeps delivering live with no second consumer.
- **Redis Streams:** one `XREAD` (groupless, BLOCK) starting from `<lastId>`, which naturally continues blocking for new entries after draining history.

If a backend *cannot* express replay-then-live on a single reader (e.g. a hypothetical backend offering only "snapshot read" + "separate live subscription"), it MUST NOT advertise `SeekableAdapter` and is reported at-most-once.

### 4.4 Trigger model: resuming clients get their own trigger (no shared-trigger splice)

The shared trigger is Cosmo's central scaling optimization (dossier §1.4, §6.5): one broker subscription per `(rendered input + headers)` hash, fanned to N subscribers via `addSubscription` (`resolve.go:771`).

**What the engine actually supports (verified, `v2.4.1`).**
`addSubscription` does exactly one of two things:

1. If a trigger with the computed `triggerID` already exists, the new subscriber is attached via `registerSubscriptionLocked` (`resolve.go:800-801`, `831`) and **`Source.Start` is never called again** — it joins the existing fan-out.
2. Otherwise it creates the trigger, builds a `subscriptionUpdater`, and starts the source **once** for the whole fan-out (`resolve.go:813-833`).

There is **no** code path that (a) starts a per-subscriber broker reader, (b) drains it into one `subscriptionState`, then (c) re-parents that subscriber onto a different already-running trigger.
The only per-subscriber delivery primitive is `UpdateSubscription(id, data)` (`resolve.go:1500`, dispatching to `handleUpdateSubscription`, `resolve.go:1113`), a one-shot synchronous write used by startup hooks (`executeStartupHooks`, invoked from `addSubscription` at `resolve.go:802-810`). It is not a streaming source with a lifecycle.

**Consequence — and the design decision.**
"Replay into a transient reader, then splice into the shared live trigger" is **unbuildable without a new engine concept** (a replay-source attached to a single `subscriptionState` with an explicit hand-off state machine — an L/XL engine change we are not taking).
We therefore make the opposite, buildable choice:

> A subscriber that presents a cursor gets its **own trigger**, distinct from the shared live trigger, running one `SubscribeFrom` reader (seek-then-live, §4.3). It never joins the shared trigger.

Concretely:

- A subscriber arriving **without** a cursor (or `nil`) joins the **shared live trigger** exactly as today (`addSubscription` path 1/2). Zero new cost. It receives a cursor on each message so it can resume later.
- A subscriber arriving **with** a valid cursor is routed to a **replay trigger**. The trigger key is widened to include a replay discriminator (the cursor's `ResumeKey` plus a per-subscription nonce) so it can never collide with — and therefore never be attached to — the shared live trigger (§4.5). The engine creates a fresh trigger and calls `Source.Start` → the adapter's `SubscribeFrom`, which seeks and then goes live on one reader.

**Trade-off, stated honestly (do not gloss over this).**
Resuming clients do **not** share the broker fan-out. Each resuming client runs its own broker reader **for the lifetime of the resumed subscription**, not merely during catch-up. This is more expensive than the old (unbuildable) splice claim. We accept it because:

1. It is the only design the current engine supports without an L/XL splice primitive.
2. It is *correct* — one reader, no two-consumer boundary race, no loss at a hand-off (there is no hand-off).
3. Resuming is the exception (reconnect), not the steady state; the shared fan-out is preserved for the common cursor-less case.

The cost is bounded by `delivery.max_concurrent_replays` (a global cap, §9.1) to contain reconnect storms (§8.3). It is the price of correctness over the unbuildable optimization.

**Optional future optimization (out of scope).** A "rejoin the shared trigger once caught up" hand-off would reduce steady-state cost for long-lived resumed subscriptions, but it requires the new engine replay-source concept and the splice state machine (L/XL). Listed in Open Questions (§12.2), not in scope here.

### 4.5 Trigger-key interaction with resume (closing the collision hole)

The previous draft carried the cursor only in `Subscribe.extensions.cosmo.cursor`, which is **not** part of `prepareTrigger`'s hash (`resolve.go:1277-1291` hashes rendered input + subgraph headers only).
A cursor-bearing subscribe would therefore compute the **same** `triggerID` as a fresh subscribe and be silently attached to the shared live trigger (`addSubscription` path 1) — the cursor ignored, the client resuming "from now," i.e. the exact at-most-once bug, now *silently*.

**Fix.** The router computes the trigger key for a resuming subscription so it cannot match the shared live trigger:

- The subscription input passed to `ResolveGraphQLSubscription` for a resuming client includes a **replay marker** (the cursor's `ResumeKey` + a fresh per-subscription nonce). Because `prepareTrigger` hashes the input, the resulting `triggerID` is guaranteed distinct from the shared live trigger's id and from every other resuming client's id.
- Therefore `addSubscription` always takes path 2 (create trigger, `Source.Start` → `SubscribeFrom`) for resuming clients. It can never take path 1 (attach to shared live trigger) before its backlog is drained, because the keys cannot collide.

This is a router-side change to how the subscription input/trigger discriminator is built for resuming clients; it does not require an engine change beyond the cursor threading (§11).
A test MUST assert: *a resuming client (cursor present) is never attached to the shared live trigger* — i.e. `Source.Start`/`SubscribeFrom` is invoked for it, and its `triggerID` differs from the cursor-less trigger's id (§ Testing).

### 4.6 Components touched

| Layer | Component | Change |
|---|---|---|
| Adapters | `router/pkg/pubsub/{nats,kafka,redis}/adapter.go` | Read backend position (`msg.Metadata()`, `record.Offset`, entry id) into `StreamEvent.Position()`; implement `SeekableAdapter.SubscribeFrom` as single-reader seek-then-live (JetStream stream-backed subjects, Kafka, Redis Streams). |
| Adapters | new `redis/streams_adapter.go` | Redis Streams adapter (`XADD`/`XREAD`/`XREADGROUP`), distinct from today's Pub/Sub adapter; selected by config. **Requires publisher `PUBLISH`→`XADD` migration (breaking) and has no native dedup** (§10, §18). |
| Engine boundary | `router/pkg/pubsub/datasource/subscription_event_updater.go` | Carry `Position` through to the engine; build the cursor alongside data. |
| Engine boundary | `router/pkg/pubsub/datasource/subscription_datasource.go:35-54` | Thread the inbound resume cursor + replay marker into `SubscribeFrom` and into the trigger-input discriminator (§4.5). |
| Engine | graphql-go-tools (`resolve.go:1586`, `1113`, `616`; `response.go:69`) | Thread a per-message opaque id (the cursor) from the updater through `handleTriggerUpdate`/`handleUpdateSubscription` and `executeSubscriptionUpdate` to the writer. **`SubscriptionResponseWriter` (exported, router-implemented) gains per-flush id.** See §11. Graded **L**, not additive. |
| Transport (WS) | `router/core/websocket.go`, `router/internal/wsproto/proto.go` | Read `cursor` from `Subscribe` payload `extensions`; emit `cursor` in each `Next` `extensions`. No new message type. |
| Transport (SSE) | `router/core/flushwriter.go:116-167` | Emit `id: <cursor>` per event (omit the `id:` line entirely for the synthetic initial message — §8.6); read `Last-Event-ID` request header on (re)connect; set `retry:`. |
| Negotiation | `router/core/graphql_handler.go`, `websocket.go` upgrade | Advertise `delivery` capability; report achieved class in `extensions`. |
| Config | `router/pkg/config/config.go` | New `delivery` block + global `max_concurrent_replays` (§9). |
| Composition | optional `@edfs__*` directive arg (§9) | Mark a field replay-eligible and set max resume age; otherwise no proto change. |

### 4.7 Lifecycle diagram

```
FIRST CONNECT (no cursor)                          RECONNECT (with cursor C)
─────────────────────────                          ─────────────────────────

client ── Subscribe (no cursor) ──▶ router         client ── Subscribe(cursor=C) ─▶ router
                                      │                                              │
                              compute trigger key            verify+decode C (HMAC w/ current|prev key,
                              (input+headers)                ResumeKey, Subject scope, IssuedAt<maxAge)
                                      │                                              │
                              addSubscription:                          ┌───────────┴───────────┐
                              JOIN shared live trigger                  │ valid?  in retention?  │
                              (path 1/2, resolve.go:771)                └──┬────────┬────────┬───┘
                                      │                            invalid │   no   │        │ yes
                              OnReceiveEvents (filter/authz)    CURSOR_INVALID  CURSOR_EXPIRED  build replay
                                      │                                                        input w/ marker
                              resolve + Flush(data, cursor)                                    (ResumeKey+nonce)
                                      │                                                              │
                              SSE:  id:<cursor> / data:{...}                          addSubscription: NEW trigger
                              WS:   Next{payload, ext:{cursor}}                       (path 2 — cannot collide,§4.5)
                                                                                       Source.Start→SubscribeFrom(C)
                                                                                              │
                                                                          ONE reader: seek C+1 → drain backlog
                                                                                       → continue LIVE (same reader)
                                                                                              │
                                                                          each event ─▶ OnReceiveEvents (authz re-run
                                                                                       IF hook configured — §8.5)
                                                                                              │
                                                                                       resolve + Flush(data, cursor)
                                                                                       (own trigger, own reader,
                                                                                        for the subscription's life)
```

### 4.8 Why this is the right shape

- It exploits a property the dossier calls out explicitly: log/cursor stores are "addressable by a position primitive → any consumer can re-read within retention. Natural fit for cursor/resume" (dossier §3.3).
- It keeps router state to **O(1) durable** (no checkpoint store; the broker is the buffer). The non-O(1) cost is the per-resuming-subscriber broker reader, bounded by `max_concurrent_replays` (§8.3) — stated, not hidden.
- It is the only pattern that gives stock browser clients durability **for free** (emit `id:`, the browser does the rest — dossier §4.1), subject to §5.1 caveats.

---

## 5. Wire protocol & client changes

The design principle: **no new message *types***, only new *fields* (extensions and the SSE `id:` line), so existing clients keep working and resume-aware clients opt in.

### 5.1 SSE (`graphql-sse` and plain `EventSource`)

**Server → client (per event):**

```
id: eyJ2IjoxLCJwIjoia2Fma...   <-- opaque signed cursor
event: next
data: {"payload":{"data":{...}}}

```

`HttpFlushWriter.Flush` (`flushwriter.go:116-167`) currently writes only `event:`/`data:`.
We add the `id:` line and, once, a `retry: <ms>` line.

**Client → server (on reconnect):**
A standards-compliant `EventSource` automatically re-issues the request with header `Last-Event-ID: <last id seen>`.

**Two honest caveats (review issue 11), documented, not waved away:**

1. **Explicit reopen does not carry `Last-Event-ID`.** The browser sends `Last-Event-ID` only on its *own automatic* reconnect. If the app explicitly `close()`s and re-creates the `EventSource` (route change, manual retry, framework remount), the header is **not** sent and resume silently does not happen — the client restarts at-most-once. Resume-aware SSE apps must therefore persist the last cursor themselves and pass it explicitly (query param `?cosmo_cursor=` as a fallback to `Last-Event-ID`) on manual reopen.
2. **Cursor size vs proxy header limits.** A signed JSON+HMAC base64url cursor is ~200–400 bytes for a single-partition position, and larger for a multi-partition *vector* cursor. `Last-Event-ID` rides in a request header; some proxies cap header line length (nginx `large_client_header_buffers`, default 8k total but per-line 8k; corporate proxies are often tighter). **Sizing table** (single-partition, base64url of `{v,provider,pos,resumeKey,subject,iat,keyid}` + 32-byte HMAC):

   | Backend | Position bytes | Typical cursor size | Multi-partition (8 shards) |
   |---|---|---|---|
   | JetStream | 8 (stream seq) | ~180 B | n/a (single stream order) |
   | Kafka | 12 (partition+offset) | ~190 B | ~700–900 B (vector) |
   | Redis Streams | ~18 (`<ms>-<seq>`) | ~200 B | n/a (single stream) |
   | Kinesis/Event Hubs | ~24 (seq) | ~210 B | ~900 B–1.6 KB (vector) |

   Single-partition cursors are comfortably under common 8k limits. **Multi-partition vector cursors over SSE `Last-Event-ID` are the risk**: an 8-partition Kafka vector approaches 1 KB and a 32-partition topic blows past conservative proxy limits. Mitigations (§12.2): cap the partition fan-in for SSE-resumable fields; or store the vector server-side keyed by a short opaque handle (reintroduces a small router-side map — a deliberate trade for large fan-ins, off by default).

**Result:** stock browsers resume with **zero client code** for single-partition backends within proxy limits. `graphql-sse` JS clients get the same once they forward `Last-Event-ID`.

If a replay request fails the retention check, the server emits a terminal `event: next` carrying a GraphQL error with code `CURSOR_EXPIRED`, then `event: complete`, and responds with a final HTTP status that stops the browser's auto-reconnect loop (`204` per WHATWG; dossier §4.1). The client restarts from "now" and self-reconciles (Pattern F territory).

### 5.2 WebSocket (`graphql-transport-ws` and legacy `graphql-ws`)

No new inbound message type — we stay within `Ping/Pong/Subscribe/Complete/Terminate` (`wsproto/proto.go:88-94`).

**Client → server: cursor in the `Subscribe` payload extensions.**

```jsonc
{
  "id": "1",
  "type": "subscribe",
  "payload": {
    "query": "subscription { employeeUpdates { id } }",
    "extensions": { "cosmo": { "cursor": "eyJ2IjoxLCJwIjoia2Fma..." } }
  }
}
```

**Server → client: cursor in each `Next` extensions.**

```jsonc
{
  "id": "1",
  "type": "next",
  "payload": {
    "data": { "employeeUpdates": { "id": "42" } },
    "extensions": { "cosmo": { "cursor": "eyJ2IjoxLCJwIjoia2Fma..." } }
  }
}
```

A resume-aware client persists the last `cursor` from `Next` and replays it in the next `Subscribe.extensions.cosmo.cursor`.
A stock client that ignores extensions never resumes (at-most-once) — no breakage.
`CURSOR_EXPIRED` / `CURSOR_INVALID` are delivered as a normal graphql-ws `Error` message for that subscription id, followed by `Complete`.

### 5.3 Capability negotiation

Two layers, both additive:

1. **Connection-level.** The client advertises `{"cosmo":{"delivery":{"resume":true}}}` in `connection_init` (WS) or `X-Cosmo-Delivery: resume` (SSE). The router replies in `connection_ack` with the per-connection achieved ceiling.
2. **Per-subscription report.** The first `Next` (and SSE response headers) carries `extensions.cosmo.delivery = { "class": "at-least-once" | "at-most-once", "window": "PT24H", "authz": "per-event" | "operation-only", "reason": "..." }`, so the client learns the *actual* class **and** whether per-event authz is enforced on replay (§8.5) — the dossier's "never silently pretends" requirement.

### 5.4 Fallback when a client/transport cannot participate

| Situation | Behavior |
|---|---|
| Stock WS client ignores extensions | Receives data normally; never sends a cursor → at-most-once. Reported in `extensions.cosmo.delivery`. No error. |
| Stock browser `EventSource`, single-partition backend, auto-reconnect | Resumes via `Last-Event-ID` with no code → at-least-once for free (within proxy limits, §5.1). |
| `EventSource` explicit reopen | No `Last-Event-ID` sent → at-most-once unless the app passes the cursor explicitly (§5.1). |
| `multipart/mixed` (Apollo HTTP default for some Apollo Client/Server combos) | No per-part id, no reconnect concept → **no resume, at-most-once, reported**. Migration guidance: use SSE or WS for at-least-once (§5.4 note, §21). |
| `subscribe once` | One-shot, N/A. |
| Backend has no durable position | `Position()` nil; no cursor; reported at-most-once (§6). |

**Migration guidance (called out, not buried).** Multipart-subscription users get **no** resume. To obtain at-least-once they must switch the client transport to SSE (stock-browser auto-resume) or WS (explicit cursor). State this prominently in upgrade docs.

No transport is *broken* by this RFC. Resume is strictly opt-in and degrades to today's behavior.

### 5.5 WS disconnect detection (the resume precondition)

Resume presumes the client *notices* the disconnect and reconnects. For WS this is not guaranteed today: the downstream WS heartbeat is an explicit no-op (`websocket.go:659-662`), so a half-open socket (mobile suspend, NAT timeout) is undetected until the next write fails. SSE/multipart get server heartbeats (5s default) that detect this; WS does not.

Pattern B does **not** add WS keepalive — that is a separate, small change (a real WS `Ping` on an interval, cross-referenced to Pattern D / a dedicated WS-keepalive RFC). We document the dependency: **WS resume reliability is bounded by disconnect-detection latency, which for WS is currently "until the next failed write."** Clients that drive their own reconnect on app-level liveness (e.g. graphql-ws `keepAlive` pings) are unaffected; clients that rely on the server to detect the half-open socket will resume late. This is a residual limitation, listed in Risks (§12.1).

---

## 6. Per-backend adaptability & degradation matrix

The architectural split is decisive (dossier §3.3): log/cursor stores can replay; delete-on-ack queues and ephemeral fan-out cannot.
Crucially, **seekability is a per-subscription (per-field) property, not a per-provider one** for NATS (review issue 6): the JetStream consumer path runs only when `StreamConfiguration != nil` on `@edfs__natsSubscribe` (requires both `consumerName` and `streamName`, `normalization-factory.ts:3076-3081`); the *same* `providerId` serves both stream-backed and core-NATS subjects. The matrix below is therefore keyed by **subscription configuration**, not provider.

| Backend / subscription config | Replay? How | Position → seek | Guarantee | Degradation / loss risk |
|---|---|---|---|---|
| **NATS core** (no `streamConfiguration`) | **No.** Ephemeral pub/sub, drops on overflow (`nats/adapter.go:168`). | none | **At-most-once** | Non-silent: `Position()=nil`, reported `at-most-once`. Recommend a stream-backed subject, or Pattern E. |
| **NATS JetStream subject** (`streamConfiguration` present) | **Yes.** `msg.Metadata().Sequence`; `SubscribeFrom` = one ephemeral `OrderedConsumer` with `DeliverByStartSequence`, seek-then-live on **one** consumer (§4.3). | stream sequence | **At-least-once** within stream retention (`LimitsPolicy`) | Outside retention → `CURSOR_EXPIRED`. **No two-consumer race** because replay+live share the ordered consumer. Native publisher dedup (`Nats-Msg-Id`, 2-min window) aids idempotency. |
| **Kafka** | **Yes.** `(partition, offset)`; `SubscribeFrom` = groupless `assign`+`seek(offset+1)`+`poll`, **same reader** continues live (replaces `AfterMilli(now)`, `kafka/adapter.go:32-34`). | `(partition, offset)` | **At-least-once** within `retention.ms` | Outside `retention.ms`/compacted → `CURSOR_EXPIRED`. Per-partition order only. **Timestamp fallback (`offsetsForTimes`) is best-effort and can SKIP a boundary event → loss**, not just dups (see note below). Per-resuming-client consumer (§8.3). |
| **Redis Pub/Sub** (`topology: pubsub`, default) | **No.** No log (`redis/adapter.go:88-152`). | none | **At-most-once** | Non-silent. Migrate to Redis Streams (below) or Pattern E. |
| **Redis Streams** (`topology: streams`, new adapter) | **Yes.** `XADD` ids; `SubscribeFrom` = `XREAD` BLOCK from `<lastId>`, same reader continues live. | entry id `<ms>-<seq>` | **At-least-once** within `MAXLEN`/`MINID` trim window | Trimmed below cursor → `CURSOR_EXPIRED`. **No native dedup** (dossier §3.2): idempotency is fully the client's job; the only stable key is the entry id (§7, §18). Publisher must `XADD` (breaking, §10). |
| **AWS SQS** | **No.** Delete-on-ack, ephemeral receipt handle. | none | **At-most-once** for *gap* | Use Pattern A (visibility/redelivery) or E. Not an EDFS backend today. |
| **Google Pub/Sub** | **Snapshot: yes. Timestamp: best-effort.** `seek` to snapshot or publish time. | snapshot / publish time | **At-least-once only via snapshot seek**; **timestamp seek is best-effort and can SKIP boundary events → loss** (see note). | Snapshot seek is loss-free within snapshot retention (7d). Timestamp seek may over-replay (dups, safe) *or* drop a boundary event whose server timestamp slightly exceeds the cursor time (loss). Matrix class for timestamp-only is **"at-least-once except a bounded boundary window"**. EOS subs add native dedup. |
| **AWS Kinesis** | **Yes.** `GetShardIterator(AFTER_SEQUENCE_NUMBER)` from stored sequence. | shard + sequence | **At-least-once** within retention, **per shard** | Iterator expires 5 min → re-derive from stored seq (we store the seq, not the iterator). Outside retention → `CURSOR_EXPIRED`. |
| **Azure Event Hubs** | **Yes.** `EventPosition.FromSequenceNumber`. | offset / sequence per partition | **At-least-once** within retention, **per partition** | Outside retention → `CURSOR_EXPIRED`. Per-partition order only. |
| **RabbitMQ / AMQP** | **No.** Delete-on-ack, `redelivered` flag only. | none | **At-most-once** for *gap* | Pattern A (ack/requeue) or E. (Rabbit *Streams* plugin would qualify; out of scope.) |

**Loss-risk note for time/timestamp seek (review issue 13).**
"Seek to a timestamp" (Google Pub/Sub time seek; Kafka `offsetsForTimes` fallback when only a time cursor is available) is **approximate**. If the seek lands *after* an event whose server-assigned timestamp is slightly later than the cursor's recorded time, that event is **skipped → permanent loss**, not merely duplicated. This is the same silent-loss failure mode this RFC exists to eliminate. Therefore:

- The **canonical** cursor for Kafka is `(partition, offset)` and for Pub/Sub is a **snapshot**, both of which are exact and loss-free.
- The **timestamp** cursor is a *fallback* only (e.g. an old cursor whose offset/snapshot is gone but whose time is still in retention), and when used the per-subscription report sets `delivery.class = "at-least-once-boundary-approx"` with a `reason`, so the client knows the boundary is best-effort. We do **not** silently advertise plain "at-least-once" for timestamp seeks.

Kinesis, Event Hubs, Google Pub/Sub, SQS, RabbitMQ are **not EDFS backends today** (dossier §3.1); the matrix shows what Pattern B *would* give. The shippable scope (§12) is **JetStream (stream-backed subjects) + Kafka + Redis Streams**.

**Degradation is never silent.** A non-seekable subscription, a non-opted-in client, or a timestamp-only resume gets an explicit `extensions.cosmo.delivery` report with a `reason`. A replay outside the window gets a hard `CURSOR_EXPIRED`, never a silent skip-to-now.

---

## 7. Delivery semantics achieved

**Steady state (no disconnect), cursor-less client:** identical to today — shared-trigger fan-out. The only addition is a cursor per message (a position read + sign, cheap).

**Steady state, resumed subscription:** runs on its own trigger/reader (§4.4) — more broker cost, same delivery semantics. Per-message cursor still emitted.

**Across a gap, on a seekable subscription, within retention, with an *exact* (offset/sequence/snapshot/entry-id) cursor:**
**At-least-once.** Every event after the cursor and within retention is replayed before live resumes, on one contiguous reader (no boundary race).

**Across a gap with a *timestamp* cursor:** at-least-once except a bounded boundary window that can drop an event whose timestamp straddles the cursor (§6 note). Reported explicitly; not silent.

**Duplicates: yes, expected.** Sources: (1) the boundary event at/just-after the cursor (cursors are "after this position," but the first replayed event may equal the last delivered one if the client recorded the cursor *before* processing); (2) timestamp-seek over-replay. There is **no** replay→live splice (single reader, §4.4), so the previous draft's splice-overlap duplicates are gone. We surface a stable idempotency key (the position; or `Nats-Msg-Id`/Kafka key; for Redis Streams *only* the entry id, §18) so the client can dedup.

**Ordering:** per-partition / per-stream, preserved; never global (dossier §6.1). The cursor *is* the order; replay is contiguous and in-order within a partition. Multi-partition/shard subscriptions restore each shard's order independently.

**Beyond retention (evicted/trimmed):** degrades to at-most-once, loudly (`CURSOR_EXPIRED`). Permanent loss = events between the cursor and "now" that fell off the log.

**Remaining failure windows (honest):**

1. **Retention eviction during a long disconnect.** Fundamental; surfaced as `CURSOR_EXPIRED`.
2. **Lossy client cursor persistence.** If the client crashes before durably recording cursor N, it resumes from an older cursor → **more duplicates (safe)**, never loss. Erring on the duplicate side is correct.
3. **Non-seekable subscription / non-participating client.** At-most-once, reported.
4. **Timestamp-seek boundary (§6 note).** A bounded window that can *skip* an event → loss. The reason it is *not* in the "no loss" column. Mitigated by preferring exact cursors; reported when a timestamp fallback is used.
5. **WS late disconnect detection (§5.5).** Resume happens, but late — bounded by failed-write latency, not by a heartbeat.
6. **Per-event authz on the no-hook path (§8.5).** Without a configured receive hook, replay re-checks only operation-level authz, not per-event field-level authz.

**Net (precise):** within retention, with an exact cursor and a configured authz hook, **at-least-once with idempotency-required duplicates and per-partition ordering**. This is **not** exactly-once: failure windows #1, #2, #4 mean it is at-least-once-with-possible-gaps even with an idempotent client. We claim "effective exactly-once" **only** for the strict case — events within retention, exact (non-timestamp) cursor, lossless client cursor persistence — and otherwise call it what it is: at-least-once within the window, at-most-once beyond it.

---

## 8. Cross-cutting concerns

### 8.1 Router HA / horizontal scaling & sticky sessions

Durable state is the cursor on the client, not in-process router state — so HA is lighter than for stateful patterns.

- **Cursor is portable across instances.** It encodes the *backend* position, so a client can reconnect to **any** router instance and that instance `SubscribeFrom`s the same position. No sticky session required for correctness — only the **signing key must be shared** across the fleet.
- **Signing-key rotation is a correctness requirement, not an open question (review issue 16).** The codec verifies with **current OR previous** key (`Cursor.KeyID` selects which), with an overlap window ≥ `max_resume_age`. A naive single-key rotation would invalidate every outstanding cursor fleet-wide → forced at-most-once for all reconnecting clients during the rotation. The two-key scheme is part of the design body (§4.2 `KeyID`, §11 `CursorCodec`), not deferred.
- **JetStream HA.** Replay uses an **ephemeral ordered consumer** with `DeliverByStartSequence` — no durable name, no cross-instance coordination (unlike the per-instance durable-name scheme, `nats/adapter.go:69-83`). Live for cursor-less clients continues to use the shared-trigger consumer.
- **Kafka HA.** Replay uses groupless `assign`+`seek` — no consumer group, no rebalance. Any instance seeks any partition.
- **Conclusion:** Pattern B is the most HA-friendly durable pattern. The only shared state is the fleet signing key (current+previous).

### 8.2 Per-subscription state / memory cost

- **Cursor-less subscriber:** ~O(1), identical to today plus a few bytes of cursor on each message.
- **Resuming subscriber:** one extra broker reader (consumer/iterator) **for the lifetime of the resumed subscription** (§4.4) — not just during catch-up. This is the honest cost of having no splice primitive. Plus the catch-up backlog buffered in the synchronous resolve path.
- A `delivery.max_replay_events` / `max_replay_duration` cap (§9) bounds a single pathological catch-up; past the cap the router truncates and surfaces `delivery.truncated=true` (better than silent loss; client reconciles).

### 8.3 Reconnect-storm capacity & the shared-trigger interaction

Because resuming clients do **not** share fan-out, a reconnect storm (deploy, LB failover, mobile network flap) spins up **one broker reader per reconnecting client**, each (for Kafka/Kinesis/Event Hubs) assigned to *all* partitions it subscribes and seeking each. This is the cost the previous draft wrongly dismissed as "a few bytes of cursor."

**Capacity analysis (Kafka, worst case).** Concurrent replay readers = (reconnecting clients) × 1 consumer each; broker-side partition assignments = readers × (partitions per topic). A 5,000-client reconnect on a 32-partition topic = 5,000 transient consumers × 32 partition assignments = 160,000 partition fetches against the broker. This is a real blast radius.

**Controls:**

- **Global cap `delivery.max_concurrent_replays`** (§9.1): a fleet-wide-intent, per-instance-enforced ceiling on concurrent replay readers. Beyond it, new resuming subscribers either (a) queue with a short timeout, or (b) fall back to `restart_live` with a *loud* `delivery.class=at-most-once`+`gap=true` marker (§19) — operator-chosen.
- **Per-client caps** `max_replay_events` / `max_replay_duration` bound each reader's catch-up.
- **Steady-state fan-out is preserved** for cursor-less clients (the common case), so the dossier's "per-subscriber durability → N broker consumers" tension (dossier §6.5) is paid **only by resuming clients, only while resumed**, not by the whole population.

Operators must size `max_concurrent_replays` against broker connection/partition limits. This is documented as a deployment requirement (§9.1, §12.1), not hidden behind an "O(1)" claim.

### 8.4 Backpressure

Live backpressure for cursor-less clients is unchanged (per-trigger-serial into the shared reader — dossier §2.2).
A resuming client's reader is **its own** trigger/reader, so a slow catch-up stalls only that client, not co-subscribers — correct isolation, and a genuine benefit of the own-trigger model.
`max_replay_*` and the existing `MaxSubscriptionFetchTimeout` (30s, `config.go:454`) bound it.

**Subgraph load amplification (review issue 20).** Each replayed event runs the *full* synchronous resolve path — `InitSubscription` + `LoadGraphQLResponseData` + `Resolve` (`executeSubscriptionUpdate`, `resolve.go:616`) — which can issue federated/nested **subgraph fetches per event**, all under the 30s `MaxSubscriptionFetchTimeout`. Replaying thousands of events therefore amplifies load on **subgraphs**, not just router memory. Consequently `max_replay_events` must be sized against *downstream subgraph cost*, not only router RAM. Documented in §9.1 guidance.

### 8.5 Security / authz — the critical requirement (corrected)

Two rules from the dossier (§6.8), with the honest caveat the previous draft omitted:

1. **Cursors must be opaque, signed, tenant-scoped.**
   A raw `(partition, offset)` lets a client seek to data it should not see.
   Our cursor is HMAC-signed (current/previous key), carries `ResumeKey` (binds to a *stable* identity excluding volatile forwarded headers, §4.2) and `Subject` (the principal at issue time).
   On resume the router (a) verifies signature, (b) checks `ResumeKey` matches the current subscription's stable identity, (c) checks the *current* authenticated principal is still in scope, (d) checks `IssuedAt` against `max_resume_age`.
   A forged / cross-subscription / stale cursor → `CURSOR_INVALID` (distinct from `CURSOR_EXPIRED`).

2. **Per-event authz on replay requires a configured receive hook — otherwise replay re-checks only operation-level authz. This is the corrected claim.**
   The previous draft asserted replay "automatically re-runs current authz because we reuse the live path." Reading the code, that is **only true when a hook is configured.** The no-hooks branch of `subscriptionEventUpdater.Update` (`subscription_event_updater.go:37-42`) calls `s.eventUpdater.Update(event.GetData())` directly with **zero per-event filtering**. For the *default* deployment (no `OnReceiveEvents` hook):
   - **GraphQL-layer authz (operation auth, `@requiresScopes`) does re-run** on every resubscribe via the normal handler, and `SubscriptionOnStart` (when present) fires once before replay — so a client whose access is *entirely* revoked is rejected before any replay.
   - **But per-event, content-dependent field-level filtering does NOT run** on replay (nor on live) without a hook. So a client whose access to *a subset* of events was revoked *during* the disconnect can be replayed events it could see when they were published but should no longer see.
   - This makes Pattern B **strictly worse than today for that narrow case**: today there is no replay, so a revoked-mid-disconnect client simply gets nothing; with Pattern B (no hook) it is replayed in-window data authored while it still had access.

   **Resolution (explicit, not silent):**
   - When `delivery.mode: at-least-once` is set, the per-subscription report advertises `delivery.authz = "operation-only"` unless a receive hook is configured, in which case it advertises `"per-event"`.
   - Config validation **warns loudly** (and offers `delivery.require_event_authz_hook: true` to make it a hard error) when at-least-once is enabled on a field without a receive hook, so operators consciously accept the residual exposure.
   - The residual exposure — *replay of in-window events authored while access was valid, after a partial access revocation during the disconnect, on the no-hook path* — is documented as a known limitation (§12.1). Closing it fully requires the v1 receive-hook contract (§0) and a configured hook.

`SubscriptionOnStart` (when present) still fires once at (re)subscribe before any replay, so a fully-revoked client is rejected before replay begins regardless of the per-event hook.

### 8.6 Interaction with existing Cosmo Streams hooks

- **`SubscriptionOnStart`** (currently `hooks.go:10`) — fires once on (re)subscribe, before replay. Natural place to additionally validate the resume request (reject resume for fields the tenant may not replay).
- **`OnReceiveEvents`** (currently `hooks.go:14`; v1-proposed name `OnStreamEvents`) — when configured, runs on **both** live and replayed events identically (§8.5). When *not* configured, neither live nor replay gets per-event filtering (the honest default).
- **`OnPublishEvents`** — unaffected (publish path unchanged).
- **v1 synthetic initial message (`WriteEvent` in the v1 draft; not in current code)** — the synthetic initial message has **no** backend position. Its wire encoding (review issue 15):
  - SSE: the `id:` line is **omitted entirely** (not emitted empty), so the browser does not record it as `Last-Event-ID` and never tries to resume from it.
  - WS: `extensions.cosmo.cursor` is **absent** for the initial message (not a sentinel value), so a resume-aware client has nothing to persist for it.
  - No signed sentinel is needed because no cursor is emitted at all — avoiding the "sentinel must pass HMAC or client gets `CURSOR_INVALID`" problem. A behavior table:

    | Message | SSE `id:` | WS `extensions.cosmo.cursor` | Resumable? |
    |---|---|---|---|
    | Synthetic initial | omitted | absent | No (intentionally) |
    | Live/replayed event with position | `id: <cursor>` | `<cursor>` | Yes |
    | Event on non-seekable backend | omitted | absent | No (at-most-once) |

---

## 9. Configuration surface

### 9.1 Router YAML — new `delivery` block

```yaml
version: "1"

events:
  # NEW: fleet-wide delivery controls
  delivery:
    cursor_signing_key: ${COSMO_CURSOR_SIGNING_KEY}            # current key (required to enable resume)
    cursor_signing_key_previous: ${COSMO_CURSOR_SIGNING_KEY_PREV}  # previous key for rotation overlap (§8.1)
    max_resume_age: 24h            # reject cursors older than this regardless of retention
    max_replay_events: 100000      # per-catch-up cap (size vs SUBGRAPH cost too, §8.4)
    max_replay_duration: 20s       # wall-clock cap per catch-up
    max_concurrent_replays: 500    # global ceiling on concurrent replay readers (§8.3)
    require_event_authz_hook: false # if true, at-least-once without a receive hook is a HARD error (§8.5)

  providers:
    nats:
      - id: my-jetstream
        url: "nats://localhost:4222"
        # NOTE: seekability is PER-SUBJECT (stream-backed), validated at subscription time, not here (§9.1 validation)
        delivery:
          mode: at-least-once       # at-most-once (default) | at-least-once

    kafka:
      - id: my-kafka
        brokers: ["localhost:9092"]
        delivery:
          mode: at-least-once
          on_cursor_expired: error  # error (default) | restart_live (still loud, §19)

    redis:
      - id: my-redis
        urls: ["redis://localhost:6379"]
        topology: streams            # pubsub (default) | streams (publisher must XADD — breaking, §10)
        delivery:
          mode: at-least-once        # only valid when topology: streams
```

**What is validated when (review issue 9) — the honest staging.**
The previous draft promised "hard config error at startup" for at-least-once on a non-seekable provider. That is only partly possible, because seekability and retention are not all known at startup:

| Check | When | Behavior |
|---|---|---|
| `at-least-once` + `cursor_signing_key` unset | **Startup** | Hard error (you cannot sign cursors). |
| `at-least-once` on Redis `topology: pubsub` | **Startup** | Hard error (Pub/Sub has no log; config-local fact). |
| `at-least-once` on a NATS *subject* with no `streamConfiguration` | **Subscription time** (per-field) — the proto/exec config is a control-plane artifact loaded after startup and changeable via config push (review issue 6) | Per-subscription: report `at-most-once` with a loud `reason` for that field; emit a one-time startup warning listing all such fields once the exec config is loaded. |
| `at-least-once` + no receive hook | **Startup** | Warn loudly; hard error iff `require_event_authz_hook: true` (§8.5). |
| Retention (`RetentionWindow()`) ≥ `max_resume_age` | **Best-effort at startup** (broker round-trip) **and continuously** | Startup: warn if a round-trip shows retention < `max_resume_age`. Runtime: retention can shrink underneath the router; we cannot *prevent* it. Detection is the rising `cursor_expired` rate (§10), wired to an alert. A re-validation probe re-reads `RetentionWindow()` on an interval and flips the per-field `delivery.window` report + raises a `delivery_retention_below_max_resume_age` gauge. |
| Publisher actually `XADD`s to Redis Streams | **Never verifiable by the router** | The router cannot verify the publisher's behavior; documented operator responsibility (§10). |

So the promise is precisely: **config-local non-seekability is a startup error; per-field and broker-property degradation is detected and reported (not silently lossy), with continuous re-validation and an alert path** — not "always caught at startup." This is the honest version.

### 9.2 Schema directive — optional per-field replay control

Replay is primarily a *runtime* (YAML) concern, so **no proto change is required** for the basic mechanism.
One *optional* composition addition, mirroring `streamConfiguration` on `@edfs__natsSubscribe`:

```graphql
type Subscription {
  employeeUpdates: Employee!
    @edfs__natsSubscribe(
      subjects: ["employeeUpdates"]
      providerId: "my-jetstream"
      streamConfiguration: { consumerName: "...", streamName: "..." }  # required for JetStream seekability
      deliveryConfiguration: { resume: true, maxResumeAge: "24h" }     # NEW optional
    )
}
```

If added, it serializes one optional message on `DataSourceCustomEvents` (`node.proto:430-434`), parsed in `normalization-factory.ts` next to `streamConfiguration` (`:3076-3081`).
**Recommendation:** ship the YAML surface first; add the directive only if per-field policy must differ from the provider default.

---

## 10. Migration & backward compatibility

- **Opt-in, default off.** With no `cursor_signing_key`, behavior is byte-for-byte today's: no SSE `id:`, no WS `cursor`, at-most-once. Existing deployments unaffected.
- **Per-provider/per-field rollout.** Enable `delivery.mode: at-least-once` incrementally; left at default keeps today's semantics.
- **Backward-compatible wire format.** New fields are additive (SSE `id:`, WS `extensions.cosmo.cursor`). Stock clients ignore them. No subprotocol/message-type change → Apollo, urql, Relay, legacy `graphql-ws` keep working (and get free SSE auto-resume per §5.1).
- **Redis migration (breaking for that field).** `topology: streams` requires the **publisher** to `XADD` instead of `PUBLISH` — a breaking change for existing Redis EDFS users. Gated behind the explicit `topology` switch so nobody flips it accidentally. Redis Streams has **no native dedup**; the client's only stable idempotency key is the entry id (§18).
- **Kafka behavior change.** Replacing `AfterMilli(now)` with seek-from-cursor changes restart behavior **only when resume is enabled**; with resume off, `AfterMilli(now)` is retained.
- **Observability.** Metrics: `cosmo_subscription_replay_events_total`, `cosmo_subscription_replay_duration_seconds`, `cosmo_subscription_cursor_expired_total`, `cosmo_subscription_cursor_invalid_total`, `cosmo_subscription_concurrent_replays` (gauge, vs `max_concurrent_replays`), `cosmo_subscription_replay_truncated_total`, `delivery_retention_below_max_resume_age` (gauge). Achieved `delivery.class` and `delivery.authz` as labels on subscription metrics. SLO/alert mapping in §13.

---

## 11. Appendix: new / changed Go types

```go
// ============================================================================
// router/pkg/pubsub/datasource/cursor.go  (NEW)
// ============================================================================

type Cursor struct {
    Version    uint8
    ProviderID string
    Position   ProviderPosition // provider-native, opaque above the adapter; vector for multi-partition
    ResumeKey  uint64           // STABLE identity: input + provider + subject set, EXCLUDING volatile headers (§4.2)
    Subject    string           // principal at issue time; may be empty (§8.5)
    IssuedAt   int64            // unix seconds (max_resume_age)
    KeyID      uint8            // signing-key id (current|previous rotation, §8.1)
}

type ProviderPosition interface {
    ProviderType() string
    Encode() []byte
}

// CursorCodec signs/verifies with current OR previous key (rotation, §8.1).
type CursorCodec interface {
    Encode(c Cursor) (string, error)
    // Decode verifies against current then previous key (by KeyID), checks
    // ResumeKey, Subject scope, and maxAge. Returns ErrCursorInvalid otherwise.
    Decode(token string, currentResumeKey uint64, currentSubject string, maxAge time.Duration) (Cursor, error)
}

var (
    ErrCursorInvalid = errors.New("pubsub: cursor invalid, forged, or out of scope")
    ErrCursorExpired = errors.New("pubsub: cursor outside backend retention window")
)

// ============================================================================
// router/pkg/pubsub/datasource/provider.go  (ADDITIVE — capability interface)
// ============================================================================

type SeekableAdapter interface {
    Adapter
    // SubscribeFrom: single-reader seek-then-live (§4.3). ErrCursorExpired if
    // `from` predates retention (starts NO live subscription). from==nil ≡ Subscribe.
    SubscribeFrom(ctx context.Context, from ProviderPosition, cfg SubscriptionEventConfiguration, updater SubscriptionEventUpdater) error
    RetentionWindow() time.Duration // best-effort; may be stale (§9.1)
}

// ============================================================================
// router/pkg/pubsub/datasource/subscription_event_updater.go  (EXTENDED)
// ============================================================================

type StreamEvent interface {
    GetData() []byte
    Position() ProviderPosition // nil on non-durable backends (NATS core / Redis Pub/Sub)
}

// ============================================================================
// graphql-go-tools  (COORDINATED ENGINE+ROUTER CHANGE — graded L, NOT additive)
// ============================================================================
//
// The cursor must reach the writer per-message. Tracing v2.4.1:
//   Update(data) -> handleTriggerUpdate(id, data) (resolve.go:1086)
//                -> executeSubscriptionUpdate(ctx, sub, data) (resolve.go:616)
//                -> ... -> sub.writer.Flush()  (SubscriptionResponseWriter, response.go:69)
// A single Update fans out to N subscribers, each doing an independent
// resolve + Flush. The cursor is the SAME for all N (it is the broker
// position), so it must travel alongside `data` through the fan-out and be
// matched to each subscriber's flush.
//
// EVERY touched signature (enumerated honestly):
//   1. SubscriptionUpdater (resolve.go:1586): add per-message id to Update /
//      UpdateSubscription, e.g. UpdateWithID(data []byte, id string) and
//      UpdateSubscriptionWithID(subID, data, id). Existing Update(data) kept
//      as UpdateWithID(data, "").
//   2. handleTriggerUpdate(id uint64, data []byte) -> must carry the cursor.
//   3. handleUpdateSubscription(...) (resolve.go:1113) -> per-subscriber id path.
//   4. executeSubscriptionUpdate(resolveCtx, sub, sharedInput) (resolve.go:616)
//      -> thread the id to the flush.
//   5. SubscriptionResponseWriter (response.go:69): per-flush id. THIS IS AN
//      EXPORTED INTERFACE IMPLEMENTED OUTSIDE THE ENGINE (router's
//      websocketResponseWriter, HttpFlushWriter). Changing it is a BREAKING
//      interface change for every writer, hence a coordinated engine+router
//      release — NOT an additive one-liner. Graded L (§12.3).
//
// Proposed minimal shape:
type SubscriptionUpdater interface {
    UpdateWithID(data []byte, id string) // id == "" => no cursor (at-most-once)
    UpdateSubscriptionWithID(subID SubscriptionIdentifier, data []byte, id string)
    // ... existing Complete/Error/Done unchanged ...
}

// SubscriptionResponseWriter gains a way to attach the id to the next flush,
// e.g. FlushWithID(id string) error, or SetNextID(id string) before Flush().
// Both router writers (websocketResponseWriter, HttpFlushWriter) implement it.

// ============================================================================
// router/core  — transport-side (sketch)
// ============================================================================

type resumeRequest struct {
    Token   string // WS Subscribe.extensions.cosmo.cursor OR SSE Last-Event-ID / ?cosmo_cursor
    Present bool
}

type deliveryReport struct {
    Class     string `json:"class"`            // "at-least-once" | "at-least-once-boundary-approx" | "at-most-once"
    Authz     string `json:"authz"`            // "per-event" | "operation-only" (§8.5)
    Window    string `json:"window,omitempty"` // ISO-8601 duration, if known (best-effort, §9.1)
    Reason    string `json:"reason,omitempty"`
    Truncated bool   `json:"truncated,omitempty"`
    Gap       bool   `json:"gap,omitempty"`    // restart_live happened (§19)
}

// ============================================================================
// router/pkg/config/config.go  (NEW)
// ============================================================================

type DeliveryGlobalConfiguration struct {
    CursorSigningKey         string        `yaml:"cursor_signing_key"`
    CursorSigningKeyPrevious string        `yaml:"cursor_signing_key_previous"`
    MaxResumeAge             time.Duration `yaml:"max_resume_age"`
    MaxReplayEvents          int           `yaml:"max_replay_events"`
    MaxReplayDuration        time.Duration `yaml:"max_replay_duration"`
    MaxConcurrentReplays     int           `yaml:"max_concurrent_replays"`
    RequireEventAuthzHook    bool          `yaml:"require_event_authz_hook"`
}

type ProviderDeliveryConfiguration struct {
    Mode            string `yaml:"mode"`              // "at-most-once" | "at-least-once"
    OnCursorExpired string `yaml:"on_cursor_expired"` // "error" | "restart_live"
}

// Provider-native positions:
type natsPosition struct{ StreamSeq uint64 }                  // msg.Metadata().Sequence.Stream
type kafkaPosition struct{ Partitions []kafkaPartPos }        // VECTOR for multi-partition
type kafkaPartPos struct{ Partition int32; Offset int64 }
type redisStreamsPosition struct{ EntryID string }            // "<ms>-<seq>"
```

---

## 12. Risks, open questions, and complexity/effort estimate

### 12.1 Where this pattern is weakest (honest)

- **The guarantee is only as good as the retention window.** A client gone longer than retention gets `CURSOR_EXPIRED` and permanent gap-loss. Patterns C/A can hold a position open without relying on broad retention; B cannot. **Biggest weakness.**
- **Resuming clients do not share fan-out (the corrected cost).** Each runs its own broker reader for the subscription's life (§4.4, §8.3) — not "free after catch-up." Reconnect storms must be capped (`max_concurrent_replays`). This is the price of the engine having no splice primitive.
- **No receipt confirmation, ever.** B knows where the client *resumed from*, never that it *processed* a message. Lossy client cursor persistence → duplicates (safe), never loss, but weaker liveness feedback than Pattern A.
- **Timestamp-seek boundary loss.** Pub/Sub time seek and Kafka `offsetsForTimes` fallback can *skip* a boundary event → loss (§6 note). Exact cursors avoid it; timestamp use is reported, not silent.
- **No-hook per-event authz gap.** Without a configured receive hook, replay re-checks only operation-level authz; a partial-revocation-during-disconnect client can be replayed in-window data (§8.5). Strictly worse than today for that narrow case; documented and operator-gated (`require_event_authz_hook`).
- **WS late disconnect detection.** The WS heartbeat is a no-op (§5.5); half-open sockets resume late.
- **Multi-partition SSE resume.** Vector cursors can exceed proxy `Last-Event-ID` limits (§5.1).
- **Hard dependency on log backends and on Cosmo Streams v1** (§0).

### 12.2 Open questions

1. **Multi-partition vector cursor vs SSE header limits.** Cap SSE-resumable partition fan-in, or store the vector server-side behind a short opaque handle (small router-side map, off by default)? (§5.1)
2. **"Rejoin the shared trigger once caught up" (the optimization we dropped).** Worth a future engine replay-source + splice state machine (L/XL) to reclaim steady-state fan-out for long-lived resumed subscriptions? (§4.4)
3. **Replay-then-live single-reader proofs per backend.** JetStream `OrderedConsumer` continuity; Kafka assign+seek+poll continuity; Redis `XREAD` BLOCK continuation — each needs a tested no-gap proof (§ Testing).
4. **`on_cursor_expired: restart_live` loudness.** Kept, but must emit `delivery.class=at-most-once`+`gap=true` (§19).
5. **Empty/unstable `Subject`.** Behavior for API-key/anonymous/rotating-identity tenants (§17 below).
6. **Continuous retention re-validation cadence** vs broker round-trip cost (§9.1).

### 12.3 Complexity / effort estimate (re-graded)

**Overall: L–XL.** The previous "M–L / lightest" framing understated the engine writer-interface fan-out (§11) and the per-resuming-subscriber reader state (§4.4, §8.3). Honest grade:

| Work item | Size | Notes |
|---|---|---|
| Cursor codec (sign/verify, current+previous key, scope checks, vector positions) | M | Was S; rotation + vector raise it. |
| `StreamEvent.Position()` + read backend metadata | S | Data already in hand. |
| `SeekableAdapter.SubscribeFrom` — JetStream (ordered, single-reader) | M | |
| `SeekableAdapter.SubscribeFrom` — Kafka (assign+seek+poll, single-reader) | M | Replace `AfterMilli(now)` under resume. |
| Redis Streams adapter (new) + publisher `XADD` migration | M | Breaking publisher change; no native dedup (§18). |
| **Engine cursor threading** (`SubscriptionUpdater` + `handleTriggerUpdate` + `executeSubscriptionUpdate` + **`SubscriptionResponseWriter`** + router writers) | **L** | Was mis-graded M. Breaking exported-interface change; coordinated engine+router release (§11). |
| Resuming-client own-trigger routing + replay-marker trigger key (§4.4, §4.5) | **L** | The genuinely hard router-side work; collision-avoidance + no-shared-attach test. |
| SSE `id:`/`Last-Event-ID`/`?cosmo_cursor`/`retry:` | S | |
| WS `cursor` extension in Subscribe/Next | S | |
| Negotiation + `extensions.cosmo.delivery` (class + authz) | S | |
| Config + staged validation (§9.1) + `max_concurrent_replays` | M | More than the previous S: staged, continuous re-validation, authz-hook gate. |
| Composition `deliveryConfiguration` directive (optional) | M | Defer unless per-field policy needed. |

Risk is concentrated in **two L items**: the engine cursor threading (breaking writer interface) and the resuming-client own-trigger routing. Pattern B is **not** "essentially stateless" — it is O(1)-durable but pays a per-resuming-subscriber broker reader. It remains the lightest *cursor-able* durable option relative to C (which explodes consumer count for *all* subscribers), but the L–XL grade is the honest one.

Recommended sequencing (dossier §5.x): **D** (fix the existing ack timing) → **B** (cursor resume on log backends, emit `id:`), once Cosmo Streams v1 (§0) lands.

---

## 13. Testing & Verification

A concrete matrix, not a TODO.

**Correctness (per backend: JetStream stream-backed, Kafka, Redis Streams):**
- **No-gap replay:** publish N events, disconnect after event k, reconnect with cursor k, assert events k+1..N all delivered, in order, exactly via the single reader (no skip). Assert the *full* delivered sequence with `assert.Equal` on the ordered list — no `Contains`.
- **No two-consumer race:** publish continuously across the reconnect; assert no event published during the seek→live transition is skipped (the single-reader invariant).
- **Bounded duplicates:** assert duplicates only at the boundary (cursor recorded pre-processing), never loss.
- **`CURSOR_EXPIRED`:** force retention eviction below the cursor; assert a `CURSOR_EXPIRED` error frame and that **no** live subscription starts (loud, not silent skip-to-now).
- **Timestamp-seek boundary:** Pub/Sub/Kafka time fallback — assert the report flips to `at-least-once-boundary-approx`.

**Trigger model (engine):**
- **Resuming client never joins the shared trigger:** assert a cursor-bearing subscribe creates a *new* trigger (`Source.Start`/`SubscribeFrom` invoked) with a `triggerID` distinct from the cursor-less trigger (§4.5). This is the regression guard for review issue 2.
- **Cursor-less client still shares fan-out:** assert two identical cursor-less subscribes share one broker subscription.

**Security:**
- **Token-refresh resume:** reconnect with a *refreshed* auth token; assert resume **succeeds** (because `ResumeKey` excludes volatile headers — §4.2). This is the regression guard for review issue 10.
- **Forged/cross-subscription/stale cursor → `CURSOR_INVALID`.**
- **Key rotation:** rotate the signing key; assert in-flight cursors signed with the previous key still verify within the overlap window (§8.1).
- **Per-event authz on replay (hook configured):** revoke access to a subset mid-disconnect; assert replay filters those events. **No-hook path:** assert the report says `authz: operation-only` (documents the gap, §8.5).

**Load / capacity:**
- **Reconnect storm:** 5,000 concurrent resuming clients on a 32-partition Kafka topic; assert `max_concurrent_replays` caps concurrent readers and the overflow path (`restart_live`+`gap=true` or bounded queue) behaves as configured (§8.3).
- **Subgraph amplification:** replay 10k events that each trigger a federated fetch; assert `max_replay_events` bounds downstream fetch volume (§8.4).
- **Repeated reconnect during replay (§22):** disconnect mid-catch-up, reconnect; assert intermediate cursors (if emitted) prevent full re-replay, or that the original-cursor re-replay is bounded and the transient reader is torn down (no leak/livelock).

**Wire:**
- **SSE initial-message:** assert the `id:` line is **omitted** for the synthetic initial message (§8.6).
- **Cursor size:** assert single-partition cursors stay under the configured proxy header limit; assert multi-partition vector behavior matches the §5.1 mitigation.

## 14. Rollback

- **Instant disable:** remove `cursor_signing_key` (and `_previous`). The router stops emitting `id:`/`cursor` and stops honoring inbound cursors; behavior reverts **byte-for-byte** to today's at-most-once (asserted by a golden-output test per §10). No data migration, no schema change to undo.
- **Per-provider disable:** set `delivery.mode: at-most-once` (or remove the block) on the affected provider; other providers unaffected.
- **Redis Streams:** rollback is *not* free for a field already migrated to `topology: streams` (publisher now `XADD`s). Rolling back that field to `pubsub` requires reverting the publisher too — call this out as the one non-instant rollback (§10).
- **Engine change:** because the writer-interface change is coordinated (§11), rolling back the engine requires rolling back the router build together. Pin both.
- **Failure trigger:** if resume corrupts delivery in prod (e.g. observed loss, mis-routed cursors), disable via signing-key removal first (instant), then investigate. The kill switch is config-only and requires no redeploy if `cursor_signing_key` is hot-reloadable; otherwise a config push + restart.

## 15. SLO / observability targets

- **`cursor_expired` rate** is the primary health signal: a sustained rate > X% of resume attempts means **retention is too short for `max_resume_age`** → operator action: raise broker retention or lower `max_resume_age`. Alert threshold: `rate(cosmo_subscription_cursor_expired_total) / rate(resume_attempts) > 0.01` for 10m.
- **`concurrent_replays` near `max_concurrent_replays`** → reconnect storm / under-provisioned cap → alert at 80% saturation.
- **`delivery_retention_below_max_resume_age`** gauge true → guaranteed future `cursor_expired` → page.
- **`cursor_invalid` rate** spike → client/clock/rotation misconfig or an attack → alert.
- **`replay_truncated` rate** → `max_replay_events`/`duration` too low for real backlogs → tune.

## 16. Alternatives considered

- **Why B over E (router buffer) for log backends:** E manufactures a replay window in router RAM, duplicating the broker's own log and bounding the window by memory; B reuses the broker's retained log (durable, larger, free). For log backends B is strictly better; E is for *non-log* backends (NATS core, Redis Pub/Sub, SQS), which B cannot serve.
- **Why not just D:** D fixes ack *timing* (flush-success), but flush ≠ receipt and D has no resume — a client gone during downtime still misses everything. D is the prerequisite correctness fix; B adds the resume D lacks. They compose (D then B).
- **Why not C (durable per-subscriber consumer):** C survives router restart without relying on broad retention, but explodes broker consumer count for *every* subscriber (breaks shared-trigger dedup for all) and needs an external checkpoint store. B pays the per-subscriber-reader cost **only for resuming clients** and needs no checkpoint store. B is the lighter durable win where a retention window suffices; C is the answer when retention is too short to lean on.
- **Why not A (client ack) here:** A is the strongest guarantee but requires a new inbound ack message and an SSE back-channel (SSE is one-way) — a heavier client-protocol change. B reuses the existing one-way SSE primitive (`Last-Event-ID`) and adds only optional WS extension fields.
