# RFC: At-Least-Once for GraphQL Subscriptions — End-to-End Client-Ack Protocol Extension (Pattern A)

**Status:** Draft (revised after adversarial review)

**TL;DR.**
Today Cosmo's EDFS pushes broker events to the client fire-and-forget:
the broker ack/commit is gated on a *flush attempt* (or never happens at all), not on the client actually receiving the message,
so a disconnect, a router restart, or a slow consumer silently drops events even when the backend itself has at-least-once.
This RFC closes that gap end to end.
Every delivered message carries a monotonic, subscription-scoped `id` plus a stable idempotency key;
the client returns an explicit `ack {id}`;
and the router holds the broker ack/commit (`msg.Ack()`, `XACK`, `DeleteMessage`, Pub/Sub `Ack`, AMQP `basic.ack`) until that client ack arrives,
with a per-subscriber in-flight window and an ack-timeout that triggers `nak`/redelivery.
This is MQTT QoS 1 for GraphQL subscriptions; with an optional double-ack plus a dedup window it reaches effectively exactly-once on capable backends.
It is opt-in, negotiated per client, and degrades explicitly (never silently) on backends and transports that cannot participate.

**The load-bearing dependency, stated up front.**
Pattern A *cannot* be built purely in the router's pubsub layer, as an earlier draft assumed.
The engine (`graphql-go-tools/v2`, pinned at `v2.4.1` per `router/go.mod:34`) owns subscriber fan-out, subscriber filtering, and **discards every per-subscriber delivery outcome** (`executeSubscriptionUpdate` returns `void`).
A delivery id assigned router-side never reaches the wire, and the router cannot learn whether any individual subscriber actually received an event.
Pattern A therefore *requires* the Pattern D bidirectional delivery-result engine contract — plus delivery-id threading to the writer, plus post-filter subscriber reporting — to land in the engine first.
That is an upstream, separately-versioned, maintainer-gated change.
Rough complexity: **XL**, gated on an upstream engine change being accepted.

---

## 1. Problem & Context

A common Cosmo deployment looks like this:
an application already has at-least-once *inside* its event backbone — Kafka with committed offsets, NATS JetStream with durable consumers, SQS with visibility timeouts, Redis Streams with a PEL.
The application team reasonably assumes that wiring that backbone into a GraphQL subscription via EDFS preserves the guarantee end to end.
It does not.
EDFS is **fire-and-forget by construction**, and the durability stops at the router.

The framework boundary makes this structural, not incidental.
The adapter contract `datasource.Adapter.Subscribe` hands the engine a `SubscriptionEventUpdater` whose only delivery method is `Update(events []StreamEvent)` — it returns no error and exposes no ack hook back toward the broker (`router/pkg/pubsub/datasource/provider.go:24-28`, `router/pkg/pubsub/datasource/subscription_event_updater.go:19-24`).
The generic glue therefore *cannot* report delivery success back to the adapter.
Durability is a per-adapter side effect, and today only one adapter even attempts it.

Concretely, here is where the guarantee evaporates:

**Ack is gated on a flush attempt, not client receipt.**
The NATS JetStream reader calls `updater.Update(...)` and then, on the very next line, `msg.Ack()` (`router/pkg/pubsub/nats/adapter.go:146-158`).
`Update` runs the full synchronous resolve + `writer.Flush()` for every shared subscriber, but `Flush()` is a single socket write under a write deadline —
a successful flush means *bytes handed to the kernel TCP buffer*, not an application-level ack from the client.
A client that drops between TCP-buffering and processing loses the message, and the message has already been acked → permanently lost.

**Ack fires even when delivery failed — and the engine swallows every failure signal.**
This is the deepest part of the gap, and it determines the whole shape of this RFC.
The no-hooks path calls `s.eventUpdater.Update(event.GetData())` with **only the payload, no subscriber identity** (`subscription_event_updater.go:37-42`).
The actual fan-out to N subscribers happens *inside the engine*, in `resolver.handleTriggerUpdate` (`graphql-go-tools/v2@v2.4.1/.../resolve.go:1086-1110`), which calls `trig.filterSubscriptions(data)` and then spawns one goroutine per surviving subscriber via `wg.Go(...)`.
Each goroutine runs `executeSubscriptionUpdate` (`resolve.go:616-687`), which **returns `void`** and `return`s silently on every failure: `InitSubscription` failure (line 632), `LoadGraphQLResponseData` failure (line 645), `Resolve` failure (line 663), and `Flush` failure (line 678, which additionally calls `UnsubscribeSubscription` internally).
None of these outcomes propagate back to the router.
If resolve/flush fails mid-disconnect the subscription is torn down, but `msg.Ack()` still runs → acked despite non-delivery.

**One ack covers N heterogeneous subscribers.**
Cosmo's shared-trigger optimization fans a single broker message out to every client with an identical subscription (the Kafka adapter even documents it: "The engine already deduplicates subscriptions with the same topics…", `router/pkg/pubsub/kafka/adapter.go:124-125`).
The single `msg.Ack()` acks the trigger for *all* of them, so a subset that failed to flush silently misses the event.

**Most backends never ack at all.**
Kafka consumes groupless with `ConsumeResetOffset(AfterMilli(now))` and never commits (`kafka/adapter.go`); NATS core uses an unbuffered channel and the nats.go client *drops* events on slow-consumer overflow; Redis uses Pub/Sub (`PSubscribe`/`PUBLISH`), which has no ack primitive at all.
These are at-most-once by construction.

**There is no client ack anywhere, and no resume.**
The recognized inbound WebSocket message set is exactly `Ping, Pong, Subscribe, Complete, Terminate` (`router/internal/wsproto/proto.go:88-94`); there is no "I received message N" concept.
`connection_init`/`connection_ack` is a one-time *connection* handshake, not a data ack (`graphql_ws.go:49-65`).
SSE/multipart are one-directional: `HttpFlushWriter` writes and flushes, and never emits an `id:` field (`router/core/flushwriter.go`), so even native SSE `Last-Event-ID` resume cannot work.
The delivered event structs carry only `Data`, `Headers` (and Kafka `Key`); no sequence/offset cursor is ever surfaced, and JetStream `msg.Metadata()` is never read.

The one-line summary from the dossier holds:
*only NATS JetStream achieves any durability, and only because its adapter independently calls `msg.Ack()` after a flush attempt; everywhere else delivery is at-most-once.*

**Why this RFC is structurally larger than an earlier draft claimed.**
The fan-out, the `filterSubscriptions` step, and the discarded per-subscriber outcomes all live *in the engine*, not in the router's `subscriptionEventUpdater`.
The router-side updater the earlier draft wanted to host the ledger **does not know which or how many subscribers exist** in the no-hooks path, and cannot, without re-implementing trigger/subscription bookkeeping that lives in the engine.
That single fact reshapes the design (§3) and the cost (§11): Pattern A's core promise — *broker-ack only after a specific subscriber's receipt, nak on that subscriber's failure* — requires the engine to (a) thread a delivery id through to the writer, (b) report, per `handleTriggerUpdate` call, **which** subscribers were actually written to (post-filter), and (c) return a **per-subscriber success/failure result** so the router can ack vs. nak.
(b) and (c) are exactly the engine contract the dossier scoped as **Pattern D** (`dossier §5 Pattern D`).
Pattern A is therefore Pattern D's engine work *plus* an ack protocol and ledger layered on top; it cannot ship before the Pattern D engine change lands upstream.

**Relationship to Cosmo Streams v1.**
This RFC builds on the Cosmo Streams v1 hook substrate.
The `SubscriptionOnStart` hook is the natural place to evaluate per-client ack capability and per-field `@edfs__delivery` class, and to reject clients whose declared delivery class cannot be honored.
The `StreamBatchEventHook` (`OnStreamEvents`) sits on the per-subscriber path where drop-vs-failure semantics must be reconciled (`subscription_event_updater.go:104-129`).
Pattern A does **not** replace those hooks; it adds an ack-tracking layer underneath them.

---

## 2. Goals & Non-Goals

**Goals.**

- Provide *true end-to-end* at-least-once: a message is broker-acked only after the **client** confirms receipt of it, not merely after a socket write.
- Make the guarantee **per-client and negotiated** — a stock client that cannot ack falls back to today's behavior, explicitly and observably, never silently.
- Make the guarantee **per-subscriber** within a shared trigger, *to the extent the backend's ack primitive allows it* (§7.4 confronts the cases where it cannot).
- Support an **optional double-ack + dedup window** path that reaches effectively exactly-once on backends that can dedup or whose ack is idempotent.
- Provide an explicit, documented **degradation matrix**: a user may pick any backend, learn the guarantee they actually get, and never be lied to.
- Keep the broker as the source of truth for redelivery wherever the broker can redeliver (JetStream, SQS, Rabbit, Redis Streams, Pub/Sub) — the router holds ack handles, it does not become a durable store.

**Non-Goals.**

- **Replay across long disconnect gaps / resume-from-cursor.** That is Pattern B's job. Pattern A guarantees delivery of *in-flight* (un-acked) messages; it does not seek the backend to an old position to backfill a multi-minute gap. (Combining A with B is discussed in §8.)
- **Cross-router-restart durability of in-flight ack state** beyond what the broker itself redelivers. If the router process dies holding un-acked-to-client handles, recovery relies on the broker's redelivery (JetStream/SQS/Rabbit/Redis-Streams/Pub/Sub do this); Kafka-by-offset does not per-message. A router-side durable ack store is explicitly Pattern C territory and out of scope here.
- **Per-subscriber redelivery under a shared trigger on per-message-ack backends.** As §7.4 establishes, a single broker handle cannot be both acked (for subscriber A) and redelivered (for subscriber B) on a per-message-ack backend without per-subscriber consumers. That is Pattern C. Pattern A's shared-trigger story is "redeliver to all on any nak under `ack_policy: all`, accepting duplicates for the subscribers who already acked."
- **Global ordering.** Ordering remains partition/stream/group-scoped, exactly as the backend provides it. Redelivery can reorder; we make the tradeoff explicit and tunable, we do not invent a total order.
- **Changing the publish path.** Idempotent ingest (`Nats-Msg-Id`, Kafka idempotent producer) is a separate concern; this RFC is about the *delivery* (subscribe) leg.
- **Inventing ack on backends that have no ack/redelivery primitive.** NATS core and Redis Pub/Sub cannot participate; they fall back to at-most-once. Manufacturing a window for them is Pattern E, not A.

---

## 3. Design — the mechanism in depth

### 3.1 The core idea

Insert a **per-subscriber in-flight ledger** between the broker reader and the engine's fan-out, and gate the broker ack on a *per-subscriber* client ack.
Each event the engine actually delivers to a given subscriber is assigned a monotonic `DeliveryID` (subscription-scoped) and is paired with an opaque **broker ack handle** — the thing the adapter needs to later confirm/redeliver that specific message (a JetStream `jetstream.Msg`, an SQS receipt handle, a Redis Streams entry id, a Pub/Sub ack id, an AMQP delivery tag).
The router records `(subID, DeliveryID → ackHandle, refcount)` in the ledger and **does not** ack the broker yet.
When the client sends `ack {id: DeliveryID}`, the router decrements the handle's refcount; when the policy is satisfied (§7.4) it calls the adapter's `Ack(handle)` and removes the entry.
If the ack does not arrive within `ack_wait`, or the client disconnects with the entry still open, the router calls `Nak(handle)` (or lets the broker's own redelivery timer fire) so the broker redelivers.

The id and the idempotency key are assigned router-side but only become real **once the engine reports the subscriber was actually written to** (§3.2). A subscriber filtered out by `filterSubscriptions` is never charged a delivery (§3.2 item 3).

This is QoS 1.
The double-ack / QoS 2 variant (§7.3) adds a second round trip and a dedup window for backends whose ack is not idempotent.

### 3.2 What must change — and where it actually lives

The earlier draft claimed three "surgical" router-side changes and one additive engine method.
Verification against `v2.4.1` shows that is wrong: the per-subscriber accounting Pattern A needs lives **inside the engine**, which fans out, filters, and discards outcomes.
The honest decomposition is:

1. **`StreamEvent` gains an optional ack handle (router-side).**
   The adapter, when it reads a message it *can* later confirm, attaches an opaque handle to the event it pushes through `updater.Update`.
   Events from non-ackable transports (NATS core, Redis Pub/Sub) attach `nil` — the ledger treats a `nil` handle as "ack immediately, nothing to hold," i.e. today's behavior.

2. **The engine must thread a `DeliveryID` (+ idempotency key) to the writer (engine-side).**
   In the no-hooks path the router never sees individual subscribers, so the id cannot be attached router-side.
   It must be threaded `handleTriggerUpdate` → `executeSubscriptionUpdate` → `t.resolvable.Resolve(..., sub.writer)` → `writer.Flush()` so it lands on the wire next to the payload (`resolve.go:616-687`). See §3.6.

3. **The engine must report, per `handleTriggerUpdate` call, the post-filter subscriber set (engine-side).**
   `handleTriggerUpdate` runs `subs, filterErrors := trig.filterSubscriptions(data)` *before* fan-out (`resolve.go:1093`).
   Subscriptions can be filtered out (skip filters, `@skip`/`@include`, field-level filtering) so that a given broker message reaches only a subset of the N shared subscribers, and filtered-out subscribers get a `writeError`, not data.
   The ledger refcount must be seeded from this **post-filter** set, not from "N subscribers on the trigger." A filtered-out subscriber must be excluded (or counted as immediately satisfied), or the refcount never reaches zero and the broker handle stalls forever (§7.4).

4. **The engine must return a per-subscriber delivery result (engine-side — this is the Pattern D contract).**
   `executeSubscriptionUpdate` currently returns `void` and swallows init/load/resolve/flush failure.
   For Pattern A to *nak on failure* — its core promise — the engine must hand back, per subscriber per update, a success/failure result so the router can ack vs. nak that subscriber's slice of the broker handle.
   This is exactly the dossier's Pattern D engine change. It is bidirectional: id flows out, result flows back.

5. **A new inbound control path carries the client ack back to the ledger (router-side).**
   For WebSocket this is a new `ack` message in `wsproto`; for SSE/multipart it is a side-channel `POST /graphql/stream-ack` (§4.2, §7.1).
   Both resolve to the same `AckController.Ack(streamKey, deliveryIDs)` call.

Crucially, the adapter no longer acks inline.
The JetStream reader's `msg.Ack()` at `nats/adapter.go:154` moves *out* of the reader loop and *into* the ledger, fired when the per-subscriber ack policy is satisfied.
The reader loop instead attaches `msg` as the ack handle.

### 3.3 The components touched

```
router/pkg/pubsub/datasource/
  provider.go                      Adapter gains Ack/Nak/Caps; StreamEvent gains AckHandle()
  subscription_event_updater.go    wires the ledger; forwards per-subscriber delivery results
  ack_ledger.go                    NEW: per-subscriber in-flight ledger + window + timeout + refcount
  delivery.go                      NEW: DeliveryClass, capability negotiation result

router/pkg/pubsub/nats/adapter.go     move msg.Ack() into Ack(handle); add Nak; double-ack opt
router/pkg/pubsub/kafka/adapter.go    ack -> cursor advance (in-order only); degrade to B-variant
router/pkg/pubsub/redis/adapter.go    Streams path: XACK on Ack; Pub/Sub path: no-op (at-most-once)

router/core/websocket.go         parse inbound `ack`; route to AckController; per-subscription class
router/internal/wsproto/proto.go new MessageTypeAck; graphql_ws.go encode/decode (modern subprotocol only)
router/core/flushwriter.go       emit DeliveryID + idempotency key with each SSE/multipart frame
router/core/graphql_handler.go   mount POST /graphql/stream-ack back-channel for HTTP transports

router/pkg/config/config.go      new events.delivery block + per-provider delivery override

graphql-go-tools (ENGINE, UPSTREAM, BLOCKING):
  resolve.SubscriptionUpdater + handleTriggerUpdate + executeSubscriptionUpdate:
    (a) thread DeliveryID + idempotency key to writer.Flush
    (b) report post-filter subscriber set per update
    (c) return per-subscriber delivery result (== Pattern D)

composition (optional)           @edfs__delivery directive to declare a per-field desired class
```

The changes that reach *into the engine* are not one additive method — they are the Pattern D bidirectional delivery-result contract plus id threading plus post-filter reporting (§3.6).
Everything else lives in the router's pubsub and transport layers, consistent with the Cosmo Streams v1 principle of keeping changes Cosmo-side where possible — but the engine change is the critical path and must land upstream first.

### 3.4 Lifecycle — one event, one ackable backend (QoS 1)

```
 BROKER          ADAPTER (reader)      LEDGER            ENGINE (fan-out)        WRITER         CLIENT
   │                   │                 │                    │                    │              │
   │ deliver msg ─────▶│                 │                    │                    │              │
   │ (+ack handle H)   │ Update([evt{H}])│                    │                    │              │
   │                   │────────────────▶│ stash H            │                    │              │
   │                   │                 │ eventUpdater.Update(data, H)──────────▶ │              │
   │                   │                 │           filterSubscriptions(data)     │              │
   │                   │                 │           post-filter subs = {A, B}     │              │
   │                   │                 │◀── reports {A,B} ──│                    │              │
   │                   │                 │ refcount[H] = 2    │ per sub:           │              │
   │                   │                 │ id_A, id_B assigned│  resolve+Flush(id) │──next{id}──▶ │ (A,B receive)
   │                   │                 │◀── result{A:ok,B:ok}                    │              │
   │                   │                 │ (failures here ⇒ nak that subscriber's slice)          │
   │                   │                 │◀──────────────────── ack{id_A} ───────────────────────│ (A)
   │                   │                 │ refcount[H]-- = 1   │                    │              │
   │                   │                 │◀──────────────────── ack{id_B} ───────────────────────│ (B)
   │                   │                 │ refcount[H]-- = 0   │                    │              │
   │◀── Ack(H) ────────│◀── adapter.Ack ─│ (policy=all satisfied)                  │              │
   │ (commit/XACK/del) │                 │                    │                    │              │
   │                   │                 │                    │                    │              │
   ════ failure paths ════
   (a) ack_wait elapses for a subscriber's id: that slice is nak'd (or broker AckWait fires).
       Under ack_policy=all this redelivers H to ALL subscribers (incl. those who already acked) → dup.
   (b) per-subscriber resolve/flush failure (engine result = fail): that slice is nak'd immediately (§7.7).
   (c) subscriber disconnects with id in-flight: that slice is nak'd; ledger drained for the subscriber (§7.1/§7.9).
```

The broker's own redelivery is the durability mechanism; the router only decides *when* to confirm vs. nak.
On reconnect the client re-subscribes (today: a brand-new subscription id, `websocket.go`), the broker redelivers the un-acked message to whichever router instance now owns the consumer, and delivery completes.
Note the gap Pattern A does *not* close: redelivery lands "from now-ish" on the broker's schedule, not from a precise client cursor — for an exact gap-fill you compose with Pattern B.

### 3.5 The in-flight window (backpressure & memory)

Each subscriber has a bounded window `max_ack_pending`.
While the ledger holds `max_ack_pending` un-acked entries for a subscriber, the router stops delivering *new* events to that subscriber.
Because deliveries flow from a shared broker reader, a stalled subscriber's window backpressures into the reader exactly as today's synchronous flush does — but now bounded and explicit rather than via the accident of a blocked socket write.

Two policy choices, both configurable:

- `max_ack_pending = 1` → strict in-order, at-least-once, lowest throughput. The "cursor = ack" mapping (needed for Kafka, §6) requires this.
- `max_ack_pending = N` → pipelined; out-of-order acks are fine for per-message-ack backends, but break the cursor mapping (so Kafka is forced to `1`).

When the window is full and the broker keeps delivering, the router must *not* drop:
on JetStream the held `msg` simply isn't acked (broker stops sending past `MaxAckPending` natively);
on SQS/Pub/Sub the router stops calling receive;
on Redis Streams the router stops `XREADGROUP`.
The shared-trigger interaction (one slow subscriber vs. the rest) is handled in §7.4.

### 3.6 The engine contract: id threading + post-filter reporting + per-subscriber result

This is the critical-path, upstream-gated change. Stated against the *real* `v2.4.1` interface (`resolve.go:1586`):

```go
// graphql-go-tools/v2/pkg/engine/resolve — CURRENT interface (v2.4.1), for reference
type SubscriptionUpdater interface {
    Update(data []byte)
    UpdateSubscription(id SubscriptionIdentifier, data []byte)
    Complete()
    Error(data []byte)               // terminal error, bypasses resolve pipeline
    Done()
    CloseSubscription(id SubscriptionIdentifier)
    Subscriptions() map[context.Context]SubscriptionIdentifier
}
// (the subscription writer also exposes Heartbeat(); executeSubscriptionUpdate returns void.)
```

Pattern A needs three additive-but-bidirectional changes to this engine layer. We deliberately keep the existing methods byte-for-byte so non-ack-tracked subscriptions are unaffected:

```go
// graphql-go-tools/v2/pkg/engine/resolve — PROPOSED additions (engine-side)

// Delivery carries the router-assigned id + idempotency key for one update.
// Zero value (empty ID) => not ack-tracked => current behavior, nothing written to the wire.
type Delivery struct {
    ID          string // subscription-scoped monotonic delivery id
    IdemKey     string // stable dedup key (Nats-Msg-Id / Kafka key / SQS dedup id / content hash)
    Phase       string // "" | "committed" (QoS 2)
}

// DeliveryResult is returned per subscriber per update so the router can ack/nak that slice.
type DeliveryResult struct {
    Sub       SubscriptionIdentifier
    Delivered bool   // true iff Resolve+Flush succeeded for this subscriber
    Filtered  bool   // true iff filterSubscriptions excluded this subscriber (no delivery charged)
    Err       error  // non-nil on init/load/resolve/flush failure
}

type SubscriptionUpdater interface {
    Update(data []byte)
    UpdateSubscription(id SubscriptionIdentifier, data []byte)
    Complete()
    Error(data []byte)
    Done()
    CloseSubscription(id SubscriptionIdentifier)
    Subscriptions() map[context.Context]SubscriptionIdentifier

    // UpdateWithDelivery is the ack-tracked path. It:
    //   - threads d.ID/d.IdemKey through handleTriggerUpdate -> executeSubscriptionUpdate
    //     -> Resolve -> writer.Flush so they land on the wire next to the payload, and
    //   - returns one DeliveryResult per POST-FILTER subscriber (Filtered subs reported too,
    //     so the router can seed the refcount correctly).
    // executeSubscriptionUpdate must stop swallowing outcomes: each init/load/resolve/flush
    // return path populates a DeliveryResult instead of returning void.
    UpdateWithDelivery(data []byte, d Delivery) []DeliveryResult
}
```

On WebSocket the id + idempotency key ride in the `next` message's `extensions` (which already exist on `graphQLWSMessage`, `graphql_ws.go:28-33`) under a `delivery` key, leaving the GraphQL `payload` untouched.
On SSE the id becomes the native `id:` line and the idempotency key rides in a `: idem=<key>` comment / `extensions`.
On multipart it rides in `extensions.delivery` of the part body.

**Why this is not "one additive method":** `UpdateWithDelivery` is the surface, but its contract forces `handleTriggerUpdate` to (a) propagate the post-filter `subs` set and `filterErrors` outward, and `executeSubscriptionUpdate` to (b) carry `d` to the writer and (c) populate a result on every `return`. That is a structural change to the engine's resolve pipeline, not a thin wrapper. It is the same work the dossier scoped as Pattern D, and Pattern A is blocked on it.

### 3.7 Capability negotiation: per-connection capability, per-subscription class

Ack tracking is meaningless if the client never acks — un-acked entries would pile up to `max_ack_pending` and then stall every subscriber.
So the router must know, per client, whether the client *will* ack, **before** it starts holding broker handles.
But a single graphql-ws connection multiplexes arbitrarily many subscriptions of different classes (`websocket.go` multiplexes by operation id), so the negotiated artifact must be split in two:

- **Client ack *capability* is per-connection.** Negotiated once in the `connection_init` payload for WebSocket and via a request header / query param for HTTP transports (§5). The client advertises `supports:["ack","double-ack"]` once. The connection-level result is simply *"this connection can / cannot ack."*
- **Effective *class* is per-subscription.** It is computed at `Subscribe` time (in `SubscriptionOnStart`) as `class = resolve(capability ∧ field directive ∧ backend caps ∧ config default)`. A connection can host one `at-most-once` field and one `AT_LEAST_ONCE, REJECT` field simultaneously; each subscription gets its own class, and `@edfs__delivery(... REJECT)` fires per field in `SubscriptionOnStart`.

```
client connection_init { payload: { "cosmo": { "delivery": { "supports": ["ack","double-ack"] } } } }
        │   (per-connection capability only)
        ▼
connection_ack { payload: { "cosmo": { "delivery": { "canAck": true, "ackWaitMs": 30000 } } } }
        │
        ▼   (per subscription, in SubscriptionOnStart)
effective class = min(field-directive-desired, config-default, backend-achievable) constrained by canAck
        │
        ▼
the class is reported back per subscription (and in the `next` extensions on first delivery)
```

If the connection advertises nothing, every subscription on it resolves to `at-most-once` and the router behaves exactly as today (eager ack, `nil` ledger) — zero overhead, full backward compatibility.

---

## 4. Wire protocol & client changes

### 4.1 graphql-transport-ws (modern graphql-ws) — `Next` carries id + idempotency key, client sends `Ack`

The server already sends data via the `next` message (`graphql_ws.go:117-124`).
We add the delivery id **and the idempotency key** to its `extensions` and introduce a new **inbound** `ack` message.
The idempotency key is on the wire *now* (not deferred), because the client's only correct dedup key across reconnect is the idempotency key, not the `DeliveryID` (see §11.2 note and the reconnect hazard below).

Server → client (unchanged shape, new extension):

```json
{
  "id": "<operationId>",
  "type": "next",
  "payload": { "data": { "employeeUpdates": { "id": 1 } } },
  "extensions": { "delivery": { "id": "42", "idemKey": "Nats-Msg-Id:8f3c…", "class": "at-least-once" } }
}
```

Client → server (new message type):

```json
{ "id": "<operationId>", "type": "ack", "payload": { "delivery": ["42"] } }
```

`payload.delivery` is an array so a client may batch-ack (cumulative or selective) several ids in one frame — important for throughput at `max_ack_pending > 1`.
For QoS 2 the round trip is `next{id}` → client `ack{id}` → server `next` with `extensions.delivery.phase: "committed"` → client may now release dedup state.

**Reconnect dedup hazard (why `idemKey` is mandatory on the wire).**
A reconnecting client gets a brand-new subscription id (`resolve.NewConnectionID()`, `websocket.go`), so `DeliveryID` 42 on the old subscription and 42 on the new subscription are unrelated.
A redelivered message after reconnect is the *same logical event* but arrives with a *different* `DeliveryID`.
The client's dedup key must therefore be `idemKey`, which is stable across reconnect; `DeliveryID` is only the ack handle for the *current* subscription. Shipping `idemKey` in the first `next` extension is what makes the at-least-once guarantee actionable by clients.

This requires extending `wsproto`:

```go
// wsproto/proto.go — add to the inbound enum
const (
    MessageTypePing MessageType = iota + 1
    MessageTypePong
    MessageTypeSubscribe
    MessageTypeComplete
    MessageTypeTerminate
    MessageTypeAck // NEW
)
```

and decoding the `ack` type in `graphql_ws.go` `ReadMessage`.
**Only `graphql-transport-ws` gets ack in v1** (§4.4 justifies excluding the legacy and absinthe subprotocols).

### 4.2 graphql-sse — native `id:` + a back-channel POST (with a fully specified stickiness contract)

SSE is one-directional, so the ack cannot return on the same stream.
The router emits the delivery id as the **native SSE `id:` field** (today `flushwriter.go` only writes `event:`/`data:`) and the idempotency key as a comment line:

```
event: next
id: 42
: idem=Nats-Msg-Id:8f3c…
data: {"data":{"employeeUpdates":{"id":1}}}

```

and the client acks out-of-band via a sibling endpoint:

```
POST /graphql/stream-ack
Content-Type: application/json
Cookie: cosmo_stream_affinity=<lb-stickiness-cookie>      # see stickiness contract below
X-Cosmo-Stream-Key: <streamKey>
{ "stream": "<streamKey>", "delivery": ["42"] }
```

`<streamKey>` is an opaque, signed token the router minted at subscription start and sent as the first SSE comment frame (`: stream=<streamKey>\n\n`).
It is the join key from the stateless POST back to the in-memory ledger entry on the router instance that owns the stream.

**The stickiness contract (previously hand-waved — now explicit).**
SSE ack is structurally harder than WebSocket ack, because the ack POST is a *different request* than the SSE GET. We specify the contract rather than assert it solvable:

- The router encodes its instance identity inside the signed `streamKey` *and* sets a load-balancer affinity cookie (`cosmo_stream_affinity`) on the SSE GET response.
- The client **must** replay that affinity cookie (and the `X-Cosmo-Stream-Key` header) on every `POST /graphql/stream-ack`. This is a hard requirement of SSE ack participation; a client that cannot replay the cookie cannot do SSE ack and is downgraded.
- Most managed LBs (ALB, GCLB) do cookie-based stickiness for HTTP requests; the affinity cookie is what carries instance affinity from the GET to the POST. If the LB ignores the cookie, the router falls back to routing the POST by the instance id embedded in the signed `streamKey` (requires the router fleet to expose a peer-routing path, or a shared ack bus — called out as a risk in §11.1).
- **Orphaned handles after reconnect (structural double-delivery window).** When a client reconnects, it gets a *new* SSE stream on a *possibly different* instance with a *new* `streamKey`. The old instance still holds the old stream's un-acked handles until `ack_wait` elapses, then nak's them → the broker redelivers them on the new stream → duplicate. This duplicate-on-reconnect window is **structural for SSE**, not an edge case; it is bounded by `ack_wait` and deduplicated by the client via `idemKey`. We document it rather than pretend it away.

The `multipart/mixed` transport uses the same back-channel, carrying the id in each part's `extensions.delivery.id`.

Because of this added complexity and the dossier's own assessment that SSE's strength is Pattern B's `Last-Event-ID` auto-resume, **SSE/multipart ack is opt-in and explicitly second-class** in Pattern A. §5 marks the recommended default for SSE-heavy deployments as Pattern B. See §11.1.

### 4.3 Fallback when a client/transport cannot participate

This is the non-negotiable part of the design: **fallback is explicit and observable, never silent.**

- **Stock graphql-ws client** (Apollo/urql/Relay, no ack support): advertises nothing in `connection_init` → every subscription resolves to `at-most-once` → router acks eagerly (today's behavior). `connection_ack` reports `canAck:false`, and the router emits a metric `cosmo_delivery_class{class="at-most-once",reason="client_no_ack"}`.
- **`@edfs__delivery(class: AT_LEAST_ONCE, onUnsupported: REJECT)` field + non-acking client**: `SubscriptionOnStart` rejects *that subscription* (not the connection) with a typed GraphQL error `DELIVERY_CLASS_UNSUPPORTED`, so the application fails loud rather than quietly degrading a field its author marked as critical. Whether a class mismatch is a hard reject or a soft downgrade is configurable per field (`onUnsupported: REJECT | DOWNGRADE`) and per provider.
- **SSE without the back-channel reachable** (a proxy strips the ack POST, or the client never replays the affinity cookie): the router's `ack_wait` elapses, entries are nak'd, the broker redelivers — but if the *client never acks at all*, every redelivery re-nak's and the window stalls. The router detects "subscriber never acked any of its first `silent_downgrade_after` deliveries" and downgrades that subscriber to `at-most-once` with a warning, rather than wedging the trigger.

The justification for *not* skipping protocol changes: there is no way to get true broker→client-receipt at-least-once without a client→server signal. Patterns that avoid the protocol change (B's cursor resume, F's backfill) buy a weaker guarantee. Pattern A's entire value proposition *is* the round trip, so the protocol extension is intrinsic, not incidental.

### 4.4 Subprotocol scope: only `graphql-transport-ws` in v1

Cosmo negotiates three WS subprotocols (`wsproto/proto.go:102-112`): modern `graphql-transport-ws`, legacy `graphql-ws` (subscriptions-transport-ws / Apollo), and `absinthe` (Phoenix).
**Only `graphql-transport-ws` gets ack support in v1.**
The dossier (§4.1) marks subscriptions-transport-ws as deprecated/unmaintained; investing new ack support in a deprecated subprotocol is poor ROI.
Legacy `graphql-ws` and `absinthe` connections report `canAck:false` in their connection handshake and every subscription on them is `at-most-once` — reported honestly, never silently. This is a deliberate scope cut, documented as such (§11.4 cut-line).

---

## 5. Per-backend adaptability & degradation matrix

The mechanism's natural shape is "hold a per-message ack handle, confirm on a per-subscriber client ack."
Backends split into three families: those with a real per-message ack/redelivery primitive (native fit), those with only a cursor/offset (degrade to an in-order B-variant), and those with no ack at all (fall back to at-most-once).

| Backend | Supported? | How the client-ack maps onto the backend | Guarantee achieved | Degradation / fallback | New-dep / test-infra cost |
|---|---|---|---|---|---|
| **NATS core** | ❌ No | No ack primitive; `ChanSubscribe` (`nats/adapter.go:168-199`). Handle is `nil`. | **At-most-once** (drops on slow consumer today) | Hard fallback, reason `backend_no_ack`. Recommend JetStream. | None (existing adapter) |
| **NATS JetStream** | ✅ Native | Hold `jetstream.Msg`; per-subscriber ack policy satisfied → `msg.Ack()` (moved out of `adapter.go:154`); timeout/disconnect → `msg.Nak()`. Double-ack via `msg.DoubleAck()`. `MaxAckPending` from window. | **At-least-once**; **effectively exactly-once** with double-ack + 2-min `Nats-Msg-Id` dedup | Full support. Must set `AckExplicit`, finite `AckWait`, `MaxDeliver`, not surfaced today. Cross-instance failover blocked by per-instance durable naming (§7.1). | None (existing adapter); config surface for AckPolicy/AckWait/MaxDeliver |
| **Kafka** | ⚠️ Degraded → B-variant | No per-message ack. Client-ack → **cursor advance**: commit = highest *contiguously acked across all shared subscribers*. Forces `max_ack_pending=1`. Requires a committed consumer group (today groupless). | **At-least-once, in-order only** (Pattern-B-like) | Out-of-order acks can't advance one offset → window pinned to 1. No per-message redelivery. Cross-subscriber replay amplification + restart-backlog semantic change (§7.4, §9). | Existing adapter; new consumer-group config + rebalance handling + migration note |
| **Redis Pub/Sub** | ❌ No | No ack primitive (`PSubscribe`/`PUBLISH`). Handle is `nil`. | **At-most-once** | Hard fallback, reason `backend_no_ack`. Recommend Redis Streams. | None (existing adapter) |
| **Redis Streams** | ✅ Native (new adapter) | `XREADGROUP` into PEL; hold entry id; ack → `XACK`; timeout → leave in PEL / `XCLAIM` on reconnect. | **At-least-once** (PEL prevents loss; dupes possible) | No native dedup → client must dedup on `idemKey`. | **New adapter** + go-redis Streams API + new integration test infra |
| **AWS SQS** | ✅ Native (new adapter) | Receive w/ visibility timeout; hold receipt handle; ack → `DeleteMessage`; timeout → visibility expiry or `ChangeMessageVisibility(0)` for fast nak. | Standard: **at-least-once**. FIFO: **exactly-once processing** per group | `ack_wait` ≤ visibility timeout (receipt handle is ephemeral). No replay/cursor. | **New adapter** + AWS SDK dep + IAM/credential config surface + visibility lifecycle mgmt + new test infra |
| **Google Pub/Sub** | ✅ Native (new adapter) | Hold ack id; `modifyAckDeadline` to extend; ack → `Ack()`; timeout → `Nack()`. | **At-least-once**; **exactly-once** on EOS subscription | Ack id valid only within the (extendable) deadline. | **New adapter** + GCP SDK dep + service-account config surface + deadline lifecycle mgmt + new test infra |
| **AWS Kinesis** | ⚠️ Degraded → B-variant | No per-message ack; checkpoint a sequence number. Ack → checkpoint advance, `max_ack_pending=1`, in-order. | **At-least-once, in-order only** per shard | Same as Kafka: cursor-advance, not per-message redelivery. Shard iterator expiry (5 min) is a liveness constraint. | **New adapter** + AWS/KCL dep + DynamoDB checkpoint store + new test infra |
| **Azure Event Hubs** | ⚠️ Degraded → B-variant | No broker ack; checkpoint offset per partition. Ack → checkpoint advance, in-order. | **At-least-once, in-order only** per partition | Same family as Kafka/Kinesis. Blob checkpoint store needed for cross-restart. | **New adapter** + Azure SDK dep + blob checkpoint store + new test infra |
| **RabbitMQ / AMQP** | ✅ Native (new adapter) | Consume w/ manual ack; hold delivery tag; ack → `basic.ack`; timeout/disconnect → `basic.nack(requeue=true)`. | **At-least-once** (manual ack) | Requeue reinserts near the head → ordering broken on redelivery. No replay/cursor, no native dedup. | **New adapter** + AMQP client dep + channel/connection lifecycle + new test infra |

Two structural notes the matrix encodes:

- **Per-message-ack backends are the home turf.** JetStream, SQS, Pub/Sub, Redis Streams, RabbitMQ all give per-message redelivery, which is exactly what per-subscriber client-ack-gated confirmation wants. Most of these (SQS, Pub/Sub, Streams, Rabbit) need *new* adapters — EDFS supports none of them today (dossier §3.1), and each new adapter is **not just "an `Ack`/`Nak` pair"** but a new broker-client dependency, a new credential/config surface, visibility/deadline lifecycle management, and new integration test infrastructure (the rightmost column). Pattern A's reach is bounded as much by adapter engineering as by protocol work.
- **Log/offset backends become a B-variant under A.** Kafka/Kinesis/Event Hubs have no per-message ack; mapping client-ack onto cursor advance only works in strict order and cannot redeliver a single message without rewinding everything after it. On these, "Pattern A" collapses into "Pattern B with an ack-driven commit," and we say so in the negotiated class (`at-least-once-inorder`).

The product rule: **a user may select any backend.** The router computes the achievable class at startup (and per subscription) and reports it. Selecting Redis Pub/Sub for an `AT_LEAST_ONCE` field is allowed but produces a startup warning and a per-subscription `at-most-once` class — the degradation is loud.

**Recommended-transport note.** For SSE-dominant deployments, the dossier and §11.1 both conclude Pattern B (cursor / `Last-Event-ID`) is the better fit. The matrix above describes what Pattern A *can* do on each backend; it does not claim SSE ack is the right default. v1 ships WebSocket + JetStream as the supported path; SSE ack is opt-in and second-class (§4.2, §11.4).

---

## 6. Delivery semantics achieved

**Per-message-ack backends (JetStream, SQS, Pub/Sub, Redis Streams, RabbitMQ).**

- **At-least-once, broker → client receipt, per subscriber.** A broker message is confirmed only after the ack policy over its post-filter subscriber set is satisfied (§7.4), so every confirmed slice was provably received by that client application. Any subscriber un-acked at disconnect/timeout/router-crash triggers redelivery — to *all* shared subscribers under `ack_policy: all`, because a single broker handle cannot be selectively redelivered (§7.4). Duplicates for already-acked co-subscribers are expected.
- **Duplicates are possible and expected. The client must be idempotent.** The stable idempotency key is on the wire next to the delivery id (`idemKey`, §4.1) — `Nats-Msg-Id`, SQS `MessageDeduplicationId`, Kafka record key, or a content hash. This is the client's dedup key across reconnect (where `DeliveryID` resets).
- **Effectively exactly-once** with the double-ack variant (§7.3) on JetStream (`DoubleAck` + 2-min dedup window) and Pub/Sub EOS, or SQS FIFO (5-min dedup). "Effectively" because the dedup window is finite; outside it, a very late redelivery can still duplicate.

**Offset/cursor backends (Kafka, Kinesis, Event Hubs).**

- **At-least-once, in-order only.** The committed cursor advances to the highest contiguously-acked delivery *across all shared subscribers*, so a gap cannot advance past it. `max_ack_pending` is pinned to 1.
- **No single-message redelivery; cross-subscriber replay amplification.** A nak rewinds the cursor and replays *everything* from that offset — and because the committed offset is the minimum across all shared subscribers, one slow client pins the offset for *every* co-subscriber on that partition, and on restart *all* of them replay from that pinned offset. The guarantee is real but coarser, and the blast radius is the whole fan-out (§7.4).

**No-ack backends (NATS core, Redis Pub/Sub).**

- **At-most-once, unchanged.** Reported honestly at negotiation.

**Ordering implications.**
At `max_ack_pending=1`, order is preserved.
At `max_ack_pending>1` on per-message-ack backends, the router *delivers* in broker order but a redelivered message arrives *after* later messages → out-of-order on the wire.
RabbitMQ requeue and any nak-then-redeliver reorder by construction.
We promise per-stream/partition order *modulo redelivery*, and expose `ordering: strict | best-effort`.

**The exact failure windows that remain.**

1. **Lost client ack, then router crash.** Client acked, the frame was in flight, router crashed before `adapter.Ack(H)` → broker redelivers → duplicate. (At-least-once with idempotent client.)
2. **Router crash holding un-acked-to-client handles.** In-memory ledger lost. On per-message-ack backends the broker's own `AckWait`/visibility timer redelivers → recovered. On Kafka-by-offset, the uncommitted offset means a new consumer resumes from the last commit → recovered, with replay of everything after it.
3. **`ack_wait` shorter than client processing.** A slow-but-alive client gets its message redelivered → duplicate. Tunable; double-ack and `modifyAckDeadline` (Pub/Sub) mitigate.
4. **Resolve timeout.** `executeSubscriptionUpdate` wraps resolve in `context.WithTimeout(ctx, maxSubscriptionFetchTimeout)` (30s, `resolve.go:621`). Under the new contract a resolve timeout produces a `DeliveryResult{Delivered:false}` → that subscriber's slice is nak'd *immediately* and counts toward `silent_downgrade_after` (§7.5). Without this rule it would be an infinite redelivery loop on a slow-to-resolve field (see §11.2).
5. **Client never acks (buggy/old client through a capable transport).** Window fills, subscriber is downgraded to at-most-once after `silent_downgrade_after` un-acked deliveries (§4.3) — bounded, not a permanent wedge.
6. **`ack_policy: all` on a shared trigger** — one slow subscriber backpressures the shared reader and, on any nak, forces redelivery to all co-subscribers (§7.4). The central tension Pattern A inherits from the shared-trigger model.

---

## 7. Cross-cutting concerns

### 7.1 Router HA / horizontal scaling & sticky sessions

The ledger is **per-process, in-memory** — un-acked handles live on the instance that read them.
This creates two HA realities:

- **Inbound ack must reach the holding instance.** For WebSocket the ack returns on the same socket → automatically on the right instance (sticky by connection). For SSE/multipart the `POST /graphql/stream-ack` must be routed to the same instance via the affinity contract in §4.2 (LB cookie, or peer-routing by the instance id in the signed `streamKey`). This makes SSE ack the harder HA case and is a reason SSE ack is second-class.
- **Failover relies on broker redelivery, not handoff.** If instance A dies, its un-acked handles vanish. We do *not* hand them to instance B. The client reconnects (to B), and the broker — JetStream durable consumer, SQS visibility expiry, Rabbit channel-close requeue, Pub/Sub deadline — redelivers to whichever instance now consumes. This works **only** because we kept the broker as the durability source.

The JetStream per-instance durable naming (`getDurableConsumerName` = hash of `hostname-listenAddr` + subjects, `nats/adapter.go:61-83`) is in direct tension here: a failover instance gets a *different* consumer and will *not* inherit A's un-acked messages.
For Pattern A to survive instance failover on JetStream, the durable name must key on the *subscription identity* (stable across instances) with a queue/`WorkQueuePolicy` so two instances don't double-consume — which is Pattern C substrate.
**v1 scope:** within a single instance and across client reconnects to the *same* instance, full at-least-once; across *instance* failover, at-least-once only on backends whose redelivery is instance-independent (SQS, Pub/Sub, Rabbit, Kafka-by-group) and explicitly *not* on the current JetStream per-instance-durable naming until that naming is fixed.

### 7.2 Per-subscription state / memory cost

Ledger memory is `O(in-flight per subscriber)` = `O(max_ack_pending × active subscribers)`.
Each entry holds a small struct: `DeliveryID`, the broker ack handle (a pointer/handle, not the payload), the subscriber id, the idempotency key, and a deadline timestamp.
With `max_ack_pending=10` and 100k subscribers that's ~1M small entries — bounded and tunable; the window is a first-class capacity-planning knob.
Critically, the *payload* is not retained (unlike Pattern E's buffer); we hold only what we need to confirm or nak.

### 7.3 Exactly-once via double-ack + dedup (QoS 2)

When `class: EXACTLY_ONCE` is requested and the backend supports it:

- **JetStream:** the ledger calls `msg.DoubleAck(ctx)` instead of `msg.Ack()`, which waits for server-persisted ack, and relies on the 2-min `Nats-Msg-Id` duplicate window for ingest-side dedup. The client runs a dedup set keyed by `idemKey`.
- **Pub/Sub EOS / SQS FIFO:** native dedup windows do the deduplication; the client still keeps a short dedup window for the receipt→ack gap.
- **Everywhere else:** `EXACTLY_ONCE` is *not achievable* and the negotiator downgrades to `at-least-once` (loudly). We never claim exactly-once we cannot deliver.

The wire flow for QoS 2 is `next{id}` → client `ack{id}` → router persists the broker ack (double-ack) → router sends `next` with `extensions.delivery.phase:"committed"` → client drops `idemKey` from its dedup set.

### 7.4 Multi-tenant shared-trigger fan-out — the central impossibility, stated honestly

This is Pattern A's hardest interaction, and the place an earlier draft papered over a fundamental tension with a refcount.

One broker subscription fans to N clients. The engine filters that set per message (`filterSubscriptions`, §3.2 item 3), so a given broker message reaches a **post-filter subset** of the N. The ledger seeds a refcount from that post-filter subset (reported by the engine — §3.6), excluding filtered-out and error-written subscribers:

```go
ledger[brokerHandle] = ledgerEntry{
    remaining: len(postFilterDeliveredSubs), // NOT N; filtered/errored subs excluded
    perSub:    map[SubscriptionIdentifier]DeliveryID{...},
    policy:    AckPolicyAll,
}
```

The broker `Ack(H)` fires when the policy over that subset is satisfied (`all`: every delivered subscriber acked; `quorum(k)`/`any`: k / the first).

**Three problems the refcount alone does not solve — and the honest answers:**

1. **Membership churns between delivery and ack.** A subscriber can join (new `Subscribe`) or leave (disconnect) at any instant; the engine mutates the trigger set concurrently (`sub.removed.Load()` checks throughout `handleTriggerUpdate`/`executeSubscriptionUpdate`). The refcount is *snapshotted from the post-filter set at delivery time* and never grows after — a subscriber that joins later was never charged this handle. A subscriber that disconnects with the id in-flight has its slice nak'd and the entry drained (§7.9). Late joiners simply do not participate in already-delivered handles; this is correct, not a bug, because they never received that message.

2. **The "A acked, B nak'd, same single broker handle" impossibility.** On a per-message-ack backend (JetStream, SQS, Pub/Sub, Rabbit), you get **exactly one** `msg.Ack()` *or* one `msg.Nak()` for that `jetstream.Msg` / receipt handle. You **cannot** satisfy A (ack) and redeliver to B (nak) from the same handle. There is no way around this under a shared trigger without per-subscriber consumers (Pattern C). We confront it rather than hide it:
   - **`ack_policy: all` means "redeliver to ALL on any nak, accept duplicates for the subscribers who already acked."** If B fails/times out, the router `Nak(H)` → the broker redelivers the message to *every* shared subscriber, including A who already received and acked it. A must dedup on `idemKey`. This is the documented cost of preserving the shared-trigger optimization.
   - **Per-subscriber redelivery is impossible under shared triggers** without breaking the dedup optimization (one consumer per subscriber = Pattern C). The RFC does not pretend otherwise. If an application needs per-subscriber redelivery without duplicates to co-subscribers, it must accept Pattern C's per-consumer fan-out cost.
   - `ack_policy: quorum(k)`/`any` bound the coupling: a stuck subscriber is nak'd/downgraded after `ack_wait` so it cannot pin the trigger indefinitely, at the cost of acking the handle before every subscriber confirmed (weaker guarantee for the slow subscriber, which is then downgraded).

3. **Offset backends amplify this across the whole fan-out.** On Kafka, "ack once for N" + "cursor advance" means the committed offset is the *minimum contiguously-acked offset across all shared subscribers* → one slow client head-of-line-blocks the committed offset for every co-subscriber, and on restart *all* of them replay from that pinned offset (the cross-subscriber replay amplification, §6). We surface this as a hard constraint of choosing Kafka with shared at-least-once.

The policy is configurable because the right answer is workload-dependent:

- `ack_policy: all` → strongest guarantee, worst backpressure coupling, duplicates-to-already-acked on any nak.
- `ack_policy: quorum(k)` / `any` → bounded coupling; a stuck subscriber is nak'd/downgraded.

### 7.5 Backpressure

The window is the backpressure mechanism (§3.5).
A full window stops new deliveries to that subscriber; on `ack_policy: all` it stops broker reads for the whole trigger.
This replaces today's *silent* slow-consumer drops (NATS core/Redis Pub/Sub) and *accidental* socket-blocking backpressure with an *explicit, bounded* mechanism.
The existing per-update resolve timeout (`MaxSubscriptionFetchTimeout`, 30s, `config.go:454`; `resolve.go:621`) remains a liveness guard, but under Pattern A a resolve-timeout is no longer silent: it yields `DeliveryResult{Delivered:false}` → immediate nak for that subscriber + counts toward `silent_downgrade_after` (§6 window 4). `ack_wait` must be configured larger than the realistic resolve-and-process time to avoid spurious redelivery loops; the router warns at startup if `ack_wait <= max_subscription_fetch_timeout`.

### 7.6 Security / authz

- **Delivery ids and stream keys must be opaque + signed + tenant-scoped.** The SSE `streamKey` is a capability: anyone who can POST it can ack (or probe) another tenant's stream. It must be an HMAC/JWT bound to `(tenant, connection, subscription, instance)` and validated on the `POST /graphql/stream-ack` path. Delivery ids are per-subscription monotonic integers and carry no cross-tenant meaning, but the *stream key* that scopes them does.
- **Redelivery re-runs authz.** A nak'd message redelivered after a token expiry or revoked scope must pass *current* authz (`SubscriptionOnStart`, `OnStreamEvents`), not the authz at original delivery. Pattern A's window is short (in-flight only), so this is far less exposed than Pattern B's long-window replay — but the rule holds.
- **Forged-ack DoS (data loss).** A client (or attacker with a valid stream key) that forges an *ack* for a `deliveryID` it never received causes premature broker confirmation → data loss for the real recipient. Signing + binding the stream key to the connection mitigates; the back-channel must reject unknown/expired keys and never leak whether a `deliveryID` exists (anti-enumeration).
- **Forged-nak / ack-withholding DoS (redelivery amplification).** The dual attack: a client that *withholds* acks or floods naks forces unbounded redelivery and, under `ack_policy: all`, pins a shared trigger's window — a DoS amplification specific to shared triggers. **Mitigations:** per-subscriber nak/redelivery rate limiting; the `silent_downgrade_after` cap (a withholding subscriber is downgraded to at-most-once and stops pinning the trigger); and a bounded `MaxDeliver` on the broker so a single message cannot be redelivered forever. The back-channel POST is rate-limited per stream key.

### 7.7 Interaction with existing Cosmo Streams hooks — drop semantics reconciled with the refcount

- `SubscriptionOnStart`: gains read access to the negotiated per-subscription `DeliveryClass`; may reject on class mismatch (§4.3).
- `OnStreamEvents` (`StreamBatchEventHook`): runs **per subscriber** in the hooks path (`subscription_event_updater.go:104-129`). This is the subtle case: subscriber A's hook may *drop* the event while subscriber B's keeps it, for the *same single broker handle*.
  - **Drop ≠ delivery failure, but a per-subscriber drop must NOT `Ack(handle)` outright.** Acking the handle for A's drop would ack-away B's still-in-flight delivery, re-introducing exactly the §1 "one ack covers N" bug.
  - **Correct reconciliation:** a per-subscriber drop *decrements `remaining`* for that subscriber (it is treated as satisfied for that subscriber — the drop was intentional, not a loss), exactly like a successful ack from that subscriber. The broker `Ack(H)` fires only when `remaining == 0` over the whole post-filter subset (all dropped or all acked). A per-subscriber delivery *failure* (engine `DeliveryResult{Delivered:false}`) instead nak's that subscriber's slice (§7.4).
  - The ledger API reflects this: the drop signal carries **both** the handle and the subscriber id (`AckDropped(subID, handle)`), never the handle alone (§10).
  - This fixes the v1 abandon-on-timeout hazard (`subscription_event_updater.go:69-79`): under Pattern A a hook-abandoned (timed-out) delivery is a *failure* for that subscriber → nak, not a silent ack.
- `OnPublishEvents`: unaffected (publish leg out of scope).

### 7.8 Negotiation payload compatibility

The `connection_ack` payload carries `payload.cosmo.delivery`. graphql-ws clients treat the `connection_ack` payload as opaque and ignore unknown keys, so the additive `cosmo` namespace is safe; some Apollo middleware echoes/validates the payload, but echoing an additive namespace is harmless. We confirm against the graphql-ws client's `connection_ack` handling (it ignores the payload today) and document the `cosmo` namespace as additive and ignorable. Low risk, stated explicitly.

### 7.9 Ledger ↔ subscription-removal ordering (TOCTOU)

There is a TOCTOU window between the engine reporting a post-filter subscriber and that subscriber being removed: the engine independently removes subscriptions (`sub.removed.Load()` checks; `UnsubscribeSubscription` on flush failure, `resolve.go:678`). If the ledger registers `(subID → deliveryID)` for a subscriber the engine removes before the result lands, the entry would never be acked (no client) nor nak'd-by-disconnect (the disconnect path may have already run).
**Ordering contract:** ledger registration for a subscriber is driven by the engine's `DeliveryResult` for that subscriber, *not* by an independent enumeration of `Subscriptions()`. Because the result is produced inside `executeSubscriptionUpdate` under the same `sub.writeMu` that the removal path takes (`resolve.go:656-687`), registration and removal are serialized: a `DeliveryResult{Delivered:false, Err: removed}` for a subscriber removed mid-flight cleanly nak's that slice and never creates a dangling entry. The removal path must drain any already-registered ledger entries for the subscriber. This cross-layer locking is non-trivial and is called out as a risk in §11.1.

---

## 8. Configuration surface

### 8.1 Router YAML — new `delivery` block

```yaml
version: "1"

events:
  # NEW: global delivery defaults; per-provider override below
  delivery:
    default_class: at-most-once       # at-most-once | at-least-once | at-least-once-inorder | exactly-once
    on_unsupported: downgrade          # downgrade | reject
    ack_wait: 30s                      # time to wait for client ack before nak/redelivery
    max_ack_pending: 10                # per-subscriber in-flight window (1 = strict in-order)
    ack_policy: all                    # all | quorum | any  (shared-trigger fan-out, §7.4)
    ack_quorum: 1                      # used when ack_policy = quorum
    ordering: best-effort              # strict | best-effort
    silent_downgrade_after: 5          # consecutive un-acked deliveries before downgrading a silent subscriber
    max_redeliver: 8                   # broker MaxDeliver cap (anti-redelivery-DoS, §7.6)

  providers:
    nats:
      - id: my-jetstream
        url: "nats://localhost:4222"
        delivery:                      # per-provider override
          default_class: at-least-once
          double_ack: true             # use msg.DoubleAck for exactly-once requests
    kafka:
      - id: my-kafka
        brokers: ["localhost:9092"]
        delivery:
          default_class: at-least-once-inorder
          max_ack_pending: 1           # forced anyway on offset backends
          consumer_group: cosmo-edfs   # NEW: required for ack->commit (today groupless) — see §9 migration note
    redis:
      - id: my-redis
        urls: ["redis://localhost:6379"]
        mode: streams                  # NEW: streams | pubsub (pubsub = at-most-once only)
```

The `POST /graphql/stream-ack` endpoint is mounted automatically when any provider has a non-`at-most-once` class and HTTP subscription transports are enabled; its path is configurable under the existing GraphQL handler block.

### 8.2 Schema directive (optional, composition)

To let a *schema author* declare a field's required delivery class, add an optional `@edfs__delivery` modifier parsed in composition alongside the existing `@edfs__*` directives (`composition/src/v1/normalization/normalization-factory.ts:2804-3169`) and serialized into the per-field event config (`DataSourceCustomEvents`, `proto/wg/cosmo/node/v1/node.proto:430-434`):

```graphql
type Subscription {
  criticalEmployeeUpdates: Employee!
    @edfs__natsSubscribe(subjects: ["employeeUpdates"], providerId: "my-jetstream")
    @edfs__delivery(class: AT_LEAST_ONCE, onUnsupported: REJECT)
}
```

This is the loud-failure lever, evaluated **per subscription** in `SubscriptionOnStart` (§3.7): a field marked `AT_LEAST_ONCE, onUnsupported: REJECT` refuses to serve a non-acking client (rejecting that subscription, not the whole connection) rather than degrade.
If the schema does not use it, behavior is governed entirely by router YAML, and the proto carries a zero value (fully backward compatible).

---

## 9. Migration & backward compatibility

- **Opt-in, off by default.** `default_class: at-most-once` means an upgraded router with no config change behaves *exactly* as today: eager ack on JetStream, fire-and-forget elsewhere, no new wire fields, no ledger allocated, the engine `UpdateWithDelivery` path never taken. The JetStream `msg.Ack()` only moves out of the reader loop when a non-`at-most-once` class is configured.
- **No client change required to keep working.** A stock graphql-ws/SSE client that never advertises ack support negotiates `at-most-once` and is unaffected.
- **Wire additions are additive.** The `extensions.delivery` on `next`, the SSE `id:` line + `: idem=` comment, and the new `ack` inbound type are all ignorable by clients that don't understand them.
- **Engine change is gated upstream.** The Pattern D delivery-result contract (§3.6) must land in `graphql-go-tools/v2` and the router must bump its pin before any non-`at-most-once` class can function. Until then the feature is dark. This is the single hardest migration dependency.
- **Kafka opt-in changes restart-backlog semantics (explicit migration note).** Enabling `at-least-once-inorder` on Kafka switches the adapter from groupless `ConsumeResetOffset(AfterMilli(now))` to a committed consumer group. This changes behavior: today a router restart *skips* the downtime backlog (dossier §2.3); under a committed group it *replays everything since the last commit*. It also changes HA topology — a single `cosmo-edfs` group across replicas distributes partitions across replicas, so a subscriber's events may arrive on a different replica than the one holding its WebSocket/ledger (the ack model assumes the acking instance owns the offset, which group rebalancing breaks). Operators must choose: **one shared group across replicas** (partition assignment, but ack-owner ≠ socket-owner mismatch under rebalance) **or per-replica groups** (each replica consumes all partitions → duplicate consumption across replicas). v1 documents this trade-off and defaults Kafka at-least-once to *off*; enabling it is a deliberate, breaking opt-in.
- **Adapter rollout is incremental.** JetStream first; Kafka B-variant second; SQS / Pub/Sub / Redis Streams / RabbitMQ as new adapters as they land. NATS core and Redis Pub/Sub never gain it and report `at-most-once` forever.
- **Rollout sequence (recommended):** (0) land the Pattern D engine contract upstream + bump pin; (1) ship negotiation + ledger + JetStream ack-on-client-ack behind `default_class` opt-in (WS only); (2) SSE back-channel; (3) Kafka ack→commit (B-variant) with the migration note; (4) new ackable adapters; (5) double-ack/exactly-once. Each post-(0) step is independently shippable and observable via `cosmo_delivery_class`.

---

## 10. Appendix: new/changed Go types

```go
// router/pkg/pubsub/datasource/delivery.go  (NEW)

// DeliveryClass is the negotiated/achieved delivery guarantee for a subscription.
type DeliveryClass string

const (
    DeliveryAtMostOnce         DeliveryClass = "at-most-once"
    DeliveryAtLeastOnce        DeliveryClass = "at-least-once"
    DeliveryAtLeastOnceInOrder DeliveryClass = "at-least-once-inorder" // offset backends
    DeliveryExactlyOnce        DeliveryClass = "exactly-once"
)

// AckHandle is an opaque, backend-specific token that lets the adapter later
// confirm or redeliver one specific message. nil = nothing to hold (no-ack backend
// or hook-dropped event with no co-subscribers) -> treated as immediate ack.
type AckHandle interface {
    // String returns a log-safe identifier for the handle (never the payload).
    String() string
}

// AckController is the negotiation + ack ingress seen by the transport layer.
// WebSocket and the POST /graphql/stream-ack endpoint both call into it.
type AckController interface {
    // Negotiate resolves a per-connection ack CAPABILITY (not a class).
    NegotiateCapability(connCaps ClientDeliveryCaps) ConnectionAckCaps
    // ResolveClass computes the per-SUBSCRIPTION effective class at Subscribe time.
    ResolveClass(canAck bool, desired DeliveryClass, backend BackendCaps) (DeliveryClass, error)
    // Ack confirms one or more delivery ids for a subscription/stream.
    Ack(streamKey StreamKey, deliveryIDs []DeliveryID) error
    // Committed (QoS 2) marks ids whose broker-ack is persisted.
    Committed(streamKey StreamKey, deliveryIDs []DeliveryID) ([]DeliveryID, error)
}

type DeliveryID string

// StreamKey is an opaque, signed, tenant+connection+subscription+instance-scoped
// capability used by the SSE/multipart back-channel to locate the ledger entry.
type StreamKey string

type ClientDeliveryCaps struct {
    SupportsAck       bool
    SupportsDoubleAck bool
}

type ConnectionAckCaps struct {
    CanAck    bool
    AckWaitMs int
}

type BackendCaps struct {
    PerMessageAck bool // true: JetStream, SQS, Pub/Sub, Redis Streams, Rabbit
    CursorOnly    bool // true: Kafka, Kinesis, Event Hubs (forces in-order, window=1)
    NativeDedup   bool // true: SQS FIFO, Pub/Sub EOS, JetStream (Nats-Msg-Id window)
}
```

```go
// router/pkg/pubsub/datasource/ack_ledger.go  (NEW)

// AckLedger tracks in-flight (delivered-but-unacked) messages per subscriber,
// enforces the in-flight window, applies the shared-trigger refcount/policy,
// and fires broker Ack/Nak on client ack / timeout / per-subscriber failure.
//
// Registration is driven by the engine's per-subscriber DeliveryResult set
// (post-filter), NOT by an independent Subscriptions() enumeration (§7.9).
type AckLedger interface {
    // Seed records a broker handle and the post-filter subscriber set the engine
    // reported it was delivered to, returning the per-subscriber delivery ids.
    // Filtered/errored subscribers are excluded from the refcount.
    Seed(handle AckHandle, results []resolve.DeliveryResult) (map[resolve.SubscriptionIdentifier]DeliveryID, error)
    // AckClient is called when the client confirms; decrements the handle refcount,
    // applies the policy, and calls Adapter.Ack when due.
    AckClient(subID resolve.SubscriptionIdentifier, id DeliveryID) error
    // NakSubscriber nak's every open delivery slice for a subscriber (disconnect /
    // per-subscriber failure / resolve-timeout path).
    NakSubscriber(subID resolve.SubscriptionIdentifier) error
    // AckDropped marks a hook-dropped event for ONE subscriber as satisfied
    // (decrements remaining for that subscriber). It takes BOTH the subscriber id
    // and the handle — never the handle alone — so a drop for A does not ack-away
    // B's still-in-flight delivery (§7.7).
    AckDropped(subID resolve.SubscriptionIdentifier, handle AckHandle) error
}

// ledgerEntry is held per (broker message) and refcounts shared subscribers.
type ledgerEntry struct {
    handle    AckHandle
    remaining int                                         // post-filter refcount (§7.4)
    deadline  time.Time                                   // ack_wait
    perSub    map[resolve.SubscriptionIdentifier]DeliveryID
    policy    AckPolicy
}

type AckPolicy string

const (
    AckPolicyAll    AckPolicy = "all"
    AckPolicyQuorum AckPolicy = "quorum"
    AckPolicyAny    AckPolicy = "any"
)
```

```go
// router/pkg/pubsub/datasource/provider.go  (CHANGED)

// Adapter grows confirm/redeliver. Existing methods unchanged.
type Adapter interface {
    Lifecycle
    Subscribe(ctx context.Context, cfg SubscriptionEventConfiguration, updater SubscriptionEventUpdater) error
    Publish(ctx context.Context, cfg PublishEventConfiguration, events []StreamEvent) error

    // Ack confirms the message behind handle to the broker
    // (JetStream msg.Ack / SQS DeleteMessage / Redis XACK / Pub/Sub Ack / AMQP basic.ack /
    //  Kafka+Kinesis+EventHubs: advance committed cursor when in-order).
    Ack(ctx context.Context, handle AckHandle) error
    // Nak requests redelivery (msg.Nak / visibility reset / XCLAIM / Nack / basic.nack(requeue)).
    Nak(ctx context.Context, handle AckHandle) error
    // Caps reports what guarantee this adapter can support, used by the negotiator.
    Caps() BackendCaps
}

// StreamEvent grows an optional ack handle. GetData/Clone unchanged.
type StreamEvent interface {
    GetData() []byte
    Clone() MutableStreamEvent
    // AckHandle returns the broker confirm/redeliver token, or nil if the
    // transport has no per-message ack (NATS core, Redis Pub/Sub).
    AckHandle() AckHandle
}
```

```go
// router/pkg/pubsub/datasource/subscription_event_updater.go  (CHANGED)

// When class != at-most-once, Update forwards the event + handle through the
// engine's UpdateWithDelivery path and seeds the ledger from the per-subscriber
// DeliveryResult set the engine returns. With a nil handle or at-most-once class,
// behavior is byte-for-byte today's path (s.eventUpdater.Update(data)).
type SubscriptionEventUpdater interface {
    Update(events []StreamEvent)
    Complete()
    Done()
    SetHooks(hooks Hooks)
    // SetLedger wires the ack ledger + negotiated per-subscription class.
    SetLedger(ledger AckLedger, class DeliveryClass)
}
```

```go
// router/internal/wsproto/proto.go  (CHANGED)

const (
    MessageTypePing MessageType = iota + 1
    MessageTypePong
    MessageTypeSubscribe
    MessageTypeComplete
    MessageTypeTerminate
    MessageTypeAck // NEW: client confirms receipt of one or more delivery ids
)

// AckPayload is the decoded payload of an inbound `ack` message.
type AckPayload struct {
    Delivery []DeliveryID `json:"delivery"`
}
```

```go
// router/pkg/config/config.go  (CHANGED) — Go struct sketch

type EventsConfiguration struct {
    Providers EventProviders
    Handlers  EventHandlers
    Delivery  DeliveryConfiguration `yaml:"delivery"` // NEW
}

type DeliveryConfiguration struct {
    DefaultClass         string        `yaml:"default_class" default:"at-most-once"`
    OnUnsupported        string        `yaml:"on_unsupported" default:"downgrade"` // downgrade|reject
    AckWait              time.Duration `yaml:"ack_wait" default:"30s"`
    MaxAckPending        int           `yaml:"max_ack_pending" default:"10"`
    AckPolicy            string        `yaml:"ack_policy" default:"all"` // all|quorum|any
    AckQuorum            int           `yaml:"ack_quorum" default:"1"`
    Ordering             string        `yaml:"ordering" default:"best-effort"`
    SilentDowngradeAfter int           `yaml:"silent_downgrade_after" default:"5"`
    MaxRedeliver         int           `yaml:"max_redeliver" default:"8"`
}
```

---

## 11. Risks, open questions, test plan, and a complexity/effort estimate

### 11.1 Where this pattern is weakest (vs. the other six)

- **Hard upstream dependency on the engine (Pattern D contract).** Pattern A cannot ship until `graphql-go-tools/v2` gains the bidirectional delivery-result contract + id threading + post-filter reporting (§3.6), and the router bumps its pin (currently `v2.4.1`, `router/go.mod:34`). This is a separately-versioned, maintainer-gated repo with documented version drift (dossier version-pin note). **This is the single biggest risk.**
- **Highest adoption cost.** Pattern A is the only pattern that *requires a client protocol change* to deliver its guarantee. Stock Apollo/urql/Relay/graphql-sse clients get nothing until they ship ack support. Pattern B gives stock SSE browsers auto-resume for free; Pattern F works with stock clients.
- **SSE/multipart are second-class.** The back-channel `POST /graphql/stream-ack` is a genuinely new, stateful, sticky, security-sensitive surface (§4.2, §7.6) with a structural duplicate-on-reconnect window. WebSocket is clean; HTTP transports are not. For SSE-dominant deployments, Pattern B is the recommended fit (§5), and the dossier agrees.
- **Shared-trigger coupling and the per-message-ack impossibility.** `ack_policy: all` lets the slowest client hold the broker handle and the window; any nak redelivers to all co-subscribers (duplicates for those who already acked, §7.4). On Kafka this becomes hard head-of-line blocking with cross-subscriber replay amplification. Per-subscriber redelivery without duplicates is impossible under shared triggers — that is Pattern C.
- **Cross-instance failover is not solved in-pattern.** The in-memory ledger means failover relies entirely on broker redelivery, and on JetStream the current per-instance durable naming actively defeats it (§7.1). True cross-restart durability is Pattern C.
- **Ledger ↔ removal cross-layer locking (§7.9)** is non-trivial and must be implemented carefully against the engine's `sub.writeMu`/`removed` semantics to avoid leaked entries.
- **Adapter surface is large and underestimated by adapter count alone.** Four natural-fit backends (SQS, Pub/Sub, Redis Streams, RabbitMQ) need *new adapters* — each carrying a new broker-client dependency, credential/config surface, lifecycle management, and integration test infra (matrix §5, rightmost column).

### 11.2 Open questions

1. **Engine contract acceptance (the top open question).** Will the `graphql-go-tools` maintainers accept the Pattern D bidirectional `DeliveryResult` + id-threading + post-filter-reporting change additively, or will it require an engine fork / major version bump? Everything downstream is gated on this. Needs maintainer sign-off before any router work starts.
2. **Shared-trigger default policy and the duplicate-to-acked cost.** Is `ack_policy: all` (strongest guarantee, but any nak redelivers to already-acked co-subscribers → duplicates they must dedup) the right default, or should we default to `quorum`/`any` to bound coupling at the cost of weaker guarantees for slow subscribers? This is the residual tension §7.4 documents and cannot fully resolve — it is inherent to shared triggers on per-message-ack backends.
3. **Cumulative vs. selective ack.** Selective on the wire, adapter collapses to cumulative on offset backends (offset backends *require* cumulative). Confirm clients can express selective acks ergonomically.
4. **`ack_wait` granularity.** Per-provider with a `@edfs__delivery(ackWait:)` field override is proposed; confirm per-field is worth the config surface.
5. **Idempotency key standardization.** Pinned to on-wire `idemKey` (§4.1); confirm the canonical key per backend (`Nats-Msg-Id` / Kafka key / SQS dedup id / content hash) and the content-hash algorithm for backends without a native id.

### 11.3 Test plan (§4 success-criteria, per the project's TDD norms)

Correctness here is dominated by failure-window behavior (§6), so the test plan is failure-injection-first. Each row is a reproducing test written before the corresponding code.

- **Per-backend ack/nak/redelivery (integration).** For each supported backend (JetStream first; then Kafka B-variant; then each new adapter): deliver → client ack → assert exactly one broker `Ack(H)`; deliver → no ack within `ack_wait` → assert `Nak(H)` and broker redelivery.
- **Forced-disconnect-mid-flight.** Deliver an id, drop the client socket before ack, assert the slice is nak'd and the broker redelivers on reconnect; assert no leaked ledger entry (§7.9).
- **Shared-trigger partial-ack refcount.** Two subscribers on one trigger, post-filter set = both: A acks, B does not → assert handle held until B acks; then B times out under `ack_policy: all` → assert `Nak(H)` redelivers to *both* and A's redelivery is deduplicated by `idemKey`.
- **Filtered-subscriber refcount.** `filterSubscriptions` excludes one of two subscribers → assert refcount seeded to 1, not 2, and the broker handle acks after the single delivered subscriber acks (regression test for the stall in §3.2 item 3).
- **Hook drop vs. failure.** Subscriber A's `OnStreamEvents` drops the event, B keeps it → assert A decrements `remaining` (not `Ack(H)`), handle acks only after B acks (§7.7).
- **Resolve-timeout nak.** Force a resolve longer than `max_subscription_fetch_timeout` → assert `DeliveryResult{Delivered:false}`, immediate nak, increment of the silent-downgrade counter, and no infinite redelivery loop (§6 window 4, §11.2 note).
- **No-ack-client downgrade.** Capable transport, client never acks → assert downgrade to `at-most-once` after `silent_downgrade_after` deliveries and a `cosmo_delivery_class{reason="client_no_ack"}` metric.
- **SSE stickiness + duplicate-on-reconnect.** Reconnect to a different instance → assert the old instance's orphaned handles nak after `ack_wait`, the new stream redelivers, and the client dedups on `idemKey` (§4.2).
- **Negotiation matrix.** Stock client → `at-most-once`; ack-capable client + `REJECT` field on incapable backend → `DELIVERY_CLASS_UNSUPPORTED` on that subscription only (not the connection).

### 11.4 Explicit v1 cut-line (what we will NOT build in v1)

- **In:** Pattern D engine contract (upstream) → WebSocket (`graphql-transport-ws` only) + JetStream + ledger + per-connection capability / per-subscription class negotiation + the `cosmo_delivery_class` metric.
- **Out of v1:** SSE/multipart ack; Kafka B-variant; all new adapters (SQS, Pub/Sub, Redis Streams, RabbitMQ, Kinesis, Event Hubs); double-ack/exactly-once; legacy `graphql-ws` and `absinthe` ack; cross-instance-failover-safe JetStream durable naming (Pattern C). These ship in the §9 rollout sequence steps (2)–(5), each independently.

### 11.5 Complexity / effort estimate: **XL (gated on an upstream engine change)**

| Work item | Size |
|---|---|
| **Engine: Pattern D delivery-result contract + id threading to writer + post-filter subscriber reporting** (`UpdateWithDelivery`, `handleTriggerUpdate`, `executeSubscriptionUpdate`) — **cross-repo, maintainer-gated, blocking** | **L–XL** |
| `wsproto` `ack` message + WS inbound routing (`websocket.go`) | M |
| Ack ledger + window + timeout + shared-trigger refcount + ledger/removal locking (§7.9) | L |
| Adapter `Ack`/`Nak`/`Caps` + move JetStream `msg.Ack` into ledger | M |
| Kafka ack→commit (consumer group, in-order, B-variant) + restart-backlog migration | L |
| SSE/multipart `id:`+`idemKey` emission + `POST /graphql/stream-ack` + signed stream key + stickiness contract | L |
| Per-connection capability + per-subscription class negotiation | M |
| New adapters (SQS, Pub/Sub, Redis Streams, RabbitMQ) — *each*: new broker dep + auth/config surface + lifecycle + integration test infra | L (×4) |
| Double-ack / exactly-once path (JetStream `DoubleAck`, dedup) | M |
| Config plumbing + `@edfs__delivery` directive + proto field | M |
| Observability (`cosmo_delivery_class`, in-flight gauges, nak/redelivery counters) + test plan (§11.3) | M |

The "minimum viable" path — engine contract + WS + JetStream + ledger + negotiation — is **not** "solidly L" as an earlier draft claimed, because it *includes* the upstream engine change and cannot proceed without it. Realistically the minimum viable is **XL**, dominated by the engine work and gated on upstream acceptance.
The full matrix (all transports, all adapters, exactly-once, HA-aware) is **XL+** and overlaps materially with Patterns B (offset backends become a B-variant), C (cross-instance durable ledger / per-subscription consumers), and D (the engine contract Pattern A is built on).
This argues for **sequencing Pattern D first as an independently valuable correctness fix** (it closes §1's ack-on-failure / fan-out-all-acked / abandon-but-acked bugs with no client change), then layering Pattern A's ack protocol and ledger on top — exactly as the dossier's selection guide recommends.
