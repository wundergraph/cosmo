# RFC: At-Least-Once for GraphQL Subscriptions — Durable-Consumer-Per-Subscription + Router-Side Checkpoint Store (Pattern C)

**Status:** Draft

**TL;DR.**
Today EDFS delivers broker events to GraphQL clients fire-and-forget,
and only NATS JetStream achieves any durability — by accident,
because its adapter calls `msg.Ack()` after a *flush attempt*.
This RFC proposes a server-side durability substrate:
give each logical client subscription its own durable consumer / checkpoint
(JetStream durable consumer, Redis Streams consumer group,
or an external checkpoint in Redis/DynamoDB/Postgres for Kafka/Kinesis/Event Hubs),
and advance that checkpoint only after the router has confirmed the event left the subscriber's writer.

**Be honest about what the *default* deployment buys you.**
With a stock client (Apollo, urql, Relay, graphql-sse) and the default `shared` isolation,
Pattern C delivers **at-least-once relative to flush, restart-survivable**, with shared-trigger
head-of-line risk and a documented silent-loss window where a stuck/dropped subscriber loses events.
That is a real improvement over today (which loses everything on restart), but it is **not** end-to-end at-least-once.
The strong claim — "at-least-once to client receipt, across both router restart and client reconnect" —
holds **only** when you opt into `per-subscriber` isolation *and* run a patched client that sends per-message acks.
Neither is the default, and both carry the costs spelled out below:
per-subscriber isolation defeats Cosmo's shared-trigger fan-out (one broker consumer becomes N),
and per-message ack requires forking every client SDK because the graphql-ws protocol has no native ack frame.
Because a confirmed *flush* is still not a confirmed *client receipt*,
Pattern C is best framed not as a complete answer on its own,
but as the substrate that Pattern A (client ack) and Pattern B (cursor resume) ride on
to close the last hop to the client.

This draft has been revised after adversarial review. Several earlier claims were materially wrong
(Kafka per-message at-least-once, "minimal engine change," a single contiguous-prefix invariant
that only holds in one isolation mode, Redis Streams without a publisher change, Google Pub/Sub
per-client subscriptions). Those are corrected below, and the honest trade-offs are documented in §6, §7, and §12.

---

## 1. Problem & Context

A team running Cosmo EDFS already has at-least-once *in their backend*.
Their Kafka topic commits offsets,
their JetStream stream retains messages and tracks a durable consumer's ack floor,
their Redis Stream keeps a Pending Entries List.
The durability they paid for stops at the router's front door.

Cosmo's EDFS layer is fire-and-forget by construction.
The generic glue between a broker adapter and the GraphQL engine carries **no delivery result and no ack hook back to the broker**.
`datasource.Adapter` (`router/pkg/pubsub/datasource/provider.go:22-28`) exposes
`Subscribe(ctx, cfg, updater)` and the engine's `SubscriptionUpdater.Update(data)` returns `void`.
There is nowhere for "the client got it" to travel back to "advance the broker position."
Durability is therefore a *per-adapter property*, not a property of EDFS,
and today exactly one adapter even tries.

The concrete current behavior, anchored in the code:

- **NATS JetStream acks on a flush attempt, not on receipt.**
  The reader loop fetches a batch (`consumer.FetchNoWait(300)`),
  calls `updater.Update(...)` which synchronously runs resolve + `writer.Flush()` for every subscriber,
  then calls `msg.Ack()` (`router/pkg/pubsub/nats/adapter.go:146,154`).
  A successful `Flush()` means *bytes handed to the kernel TCP buffer*,
  not an application ack from the client.
  A client that crashes after TCP-buffering but before processing loses the message — yet it is acked.
- **The durable consumer is named per *router process*, not per *subscription*.**
  `getDurableConsumerName` hashes `instanceID + subjects`
  (`router/pkg/pubsub/nats/adapter.go:61-83`).
  This is deliberate — it stops two routers from fighting over one consumer —
  but it means a *different* router instance after failover gets a *different* consumer,
  and a reconnecting client gets a brand-new subscription id from "now" anyway
  (`resolve.NewConnectionID()`, `websocket.go:367`; new sub id `websocket.go:1160-1185`).
  Durable resume and HA are at odds.
- **Kafka and Redis don't even read durably.**
  Kafka uses a groupless direct consumer with `ConsumeResetOffset(AfterMilli(now))`
  and never commits (`router/pkg/pubsub/kafka/adapter.go:32-34,51-122`) —
  it *skips everything produced during downtime*.
  Redis uses Pub/Sub, not Streams, on **both** the publish (`PUBLISH`, `redis/adapter.go:191`)
  and subscribe (`PSubscribe`, `redis/adapter.go:88-152`) sides — no ack, no backlog.
  NATS core uses an unbuffered Go channel that drops on overflow (`nats/adapter.go:168`).
- **There is no client-side ack and no resume token anywhere.**
  The inbound WS message set is `Ping`, `Pong`, `Subscribe`, `Complete`, `Terminate`
  (`router/internal/wsproto/proto.go:88-94`) — no "ack received" concept.
  The SSE writer never emits an `id:` field (`router/core/flushwriter.go:116-167`),
  so even native `Last-Event-ID` auto-resume cannot work.
  A reconnecting client always starts fresh from "now."

This RFC builds on the **Cosmo Streams v1** hook surface where relevant.
The v1 `StreamBatchEventHook` / `SubscriptionOnStartHandler` (see `rfc/cosmo-streams-v1.md`)
are the natural place to plug per-subscription identity, replay authz, and checkpoint policy,
and the per-provider `StreamEvent` types that v1 introduces are exactly where we will surface the broker position
(stream sequence, partition+offset, entry id) that today's code throws away.

The goal of Pattern C is narrow and deep:
**make the broker position advance reflect confirmed router-side delivery,
per logical subscription, and survive a router restart.**

### 1.1 The engine model this RFC must change (verified against `graphql-go-tools/v2 v2.4.1`)

The single most consequential correction in this revision: the engine is **not** structured to return per-subscriber
delivery results to the adapter, and making it do so is **not** a "minimal change." The verified facts:

- The adapter's reader goroutine calls `updater.Update(data []byte)`. The engine's `subscriptionUpdater.Update`
  (`resolve.go:1479`) takes `s.mu.Lock()`, calls `r.handleTriggerUpdate`, and **returns `void`**.
- `handleTriggerUpdate` (`resolve.go:1086`) fans subscribers out via `wg.Go(...)`, then `wg.Wait()`,
  and **discards every per-subscriber result**. `executeSubscriptionUpdate` (`resolve.go:616`) returns nothing;
  on flush failure it calls `r.UnsubscribeSubscription(sub.id)` *internally* (`resolve.go:679`).
- The `s.mu.Lock()/defer Unlock()` in `Update` is held **across the entire trigger update including `wg.Wait()`**.
  The comment marks this as an "event serialization gate": event A fully completes before event B begins.
- The actual delivery happens on the resolver's **own event-loop goroutine** (`AsyncResolveGraphQLSubscription`);
  the `subscriptionUpdater` is a thin proxy. The adapter's reader goroutine does **not** synchronously observe
  per-subscriber flush results.

This means the back-channel Pattern C needs (collect `[]DeliveryResult`, drive the broker commit) requires four concrete engine changes,
detailed in §3.2. Treat the engine work as **L–XL on its own**, not "M, shared with Pattern D."

---

## 2. Goals & Non-Goals

### Goals

1. Each logical client subscription is backed by **its own durable consumer or checkpoint**,
   independent of which router process or instance serves it (in `per-subscriber` isolation; `shared` keeps one checkpoint per trigger).
2. The router **advances the checkpoint only after delivery is confirmed** at the writer boundary
   (flush success by default; client ack when combined with Pattern A).
3. Survive **router restart and instance failover**: a reconnecting client
   (or the same client re-routed to a new instance) resumes from its last committed checkpoint,
   bounded by broker retention.
4. Survive **client reconnect**: an un-acked window is redelivered, not lost (in `per-subscriber`; see §6 for the `shared`-mode hole).
5. Provide a **pluggable checkpoint store** abstraction so backends without per-consumer durable state
   (Kafka per-client, Kinesis, Event Hubs) get the same guarantee via an external store (Redis/DynamoDB/Postgres).
6. **Degrade explicitly and non-silently** to Pattern B's window or to at-most-once
   on backends that cannot support per-consumer durable state,
   surfacing the *actual* delivery class to the operator and (optionally) the client.

### Non-Goals

1. **End-to-end exactly-once to the client.** Out of scope here — requires Pattern A's client ack + client dedup.
   Pattern C is the substrate; it does not, alone, prove the client processed the event.
2. **Closing the flush ≠ receipt gap by itself.** Without Pattern A, the checkpoint can advance past an event
   the client TCP-buffered but never processed. We make this gap explicit (§7) rather than hide it.
3. **Preserving the shared-trigger optimization unchanged.** Per-subscription durability is fundamentally at odds
   with one-broker-subscription-per-input-hash. We will offer a hybrid (§8) but the durable path is per-subscriber.
4. **Inventing replay on delete-on-ack queues.** SQS-standard, RabbitMQ, NATS core, Redis Pub/Sub have no durable position.
   They degrade; Pattern E (router buffer) is the right tool there, not C.
5. **Global ordering across a fanned-out stream.** Ordering is per-consumer / per-partition, never global. Same as every backend.
6. **Per-message at-least-once on prefix-commit backends (Kafka, Kinesis, Event Hubs).** These commit a single
   monotonic offset per partition; there is no per-message nak. Pattern C on these backends advances a *prefix*,
   which means head-of-line blocking, not per-message redelivery. We route per-client durability on Kafka to the
   external-checkpoint path and document the head-of-line semantics honestly (§5, §6).

---

## 3. Design — the mechanism in depth

### 3.1 The core idea

Replace the implicit, per-process, flush-gated ack with an explicit, per-subscription, delivery-gated **checkpoint**.

Three new concepts:

1. **A stable subscription identity** — `SubscriptionKey` — derived from a *server-validated* client principal
   (a signed, tenant-scoped subscription token), the root field, and a *deterministically rendered* destination set.
   This is the key that survives reconnect and failover.
   It is deliberately *not* the engine's data-only trigger hash (§1.4 of the dossier),
   because that hash is shared across clients and reborn on reconnect.
   Its determinism and forgery resistance are load-bearing and are specced in §3.6 and §8.5.

2. **A `DurableConsumer`** — a per-`SubscriptionKey` durable read position in the broker.
   On JetStream it is a durable pull consumer named from the `SubscriptionKey`
   (the fix for `nats/adapter.go:61-83`).
   On Redis Streams it is a consumer-group + consumer-name pair.
   On Kafka, Kinesis, and Event Hubs there is **no viable per-client broker-side consumer state**
   (see §5 for why Kafka per-client consumer groups are an anti-pattern), so the position lives entirely in the checkpoint store
   and the adapter seeks by `(partition, offset)` / sequence number per read.

3. **A `CheckpointStore`** — an interface that loads/commits a `Checkpoint` (an opaque, backend-specific position)
   for a `SubscriptionKey`.
   For broker-native backends (JetStream ack floor, Redis PEL/last-delivered-id),
   the store is a thin wrapper over the broker's own commit primitive.
   For external-checkpoint backends (Kafka per-client, Kinesis, Event Hubs), it is Redis/DynamoDB/Postgres.

The reader loop changes from *"deliver, then ack the batch"* to
*"deliver, collect a per-subscriber delivery result, advance the checkpoint to the highest contiguous confirmed position, redeliver the rest."*

**Crucial distinction — two commit granularities (the reason the per-backend behavior differs):**

- **Per-message-ack backends** (JetStream, Redis Streams PEL, Google Pub/Sub, SQS, RabbitMQ):
  individual messages can be acked/nak'd; an unconfirmed message in the middle of a batch can be redelivered
  while later confirmed messages are *not* re-sent. The contiguous-prefix invariant is a *policy choice* here, for ordering.
- **Prefix-commit backends** (Kafka, Kinesis, Event Hubs):
  the committable unit is a monotonic offset/sequence per partition. Committing offset N implicitly acks everything ≤ N.
  There is **no per-message nak** — you can only *not advance*. "Nak the rest" from §3.1's prose is impossible here;
  the only lever is to hold the commit at the lowest unconfirmed offset, which blocks the whole partition prefix (head-of-line).

The `Checkpoint []byte` opaque type papers over this difference; §6 and §5 spell out where it bites.

### 3.2 New interfaces (sketch) and the concrete engine change

These slot into `router/pkg/pubsub/datasource/`, the boundary the dossier identifies as the fire-and-forget seam.

```go
// SubscriptionKey is the durable identity of a logical client subscription.
// It survives reconnect and instance failover. Unlike the engine's trigger
// hash, it is keyed on a *server-validated* client principal, not just the data,
// and the destination component is deterministically rendered (see §3.6).
type SubscriptionKey struct {
    // Tenant + client identity, taken from a server-validated principal (see §8.5).
    // ClientID MUST NOT be client-asserted (cross-user replay otherwise — §8.5).
    Tenant   string
    ClientID string
    // Logical operation identity.
    RootFieldName string
    // Deterministically rendered destination set (subjects / topics / channels), hashed.
    // Determinism across instances + engine versions is a correctness requirement (§3.6).
    DestinationHash string
}

func (k SubscriptionKey) String() string // stable, URL-safe, used as the durable name

// Checkpoint is an opaque, backend-specific read position.
// JetStream: stream sequence (ack floor). Kafka: map[partition]offset (PREFIX commit).
// Redis Streams: last-delivered entry id. Kinesis: per-shard sequence number.
// Event Hubs: per-partition offset. It is always serializable for the store.
//
// NOTE: per-message-ack backends and prefix-commit backends differ in commit
// granularity (§3.1). A Checkpoint on a prefix-commit backend represents
// "everything up to and including this position is acked," not a single event.
type Checkpoint []byte

// DeliveryResult is what the framework now collects per delivered event,
// per subscriber. This is the value that today is thrown away (Update returns void).
type DeliveryResult struct {
    Position    Checkpoint // backend position of this event
    Confirmed   bool       // writer flush succeeded (or client ack, with Pattern A)
    Err         error      // non-nil => redeliver (per-message-ack backends) / do-not-advance (prefix-commit)
}

// CheckpointStore persists the committed position for a subscription.
// For broker-native backends this delegates to the broker's commit primitive.
type CheckpointStore interface {
    // Load returns the committed checkpoint for a subscription, or (nil, false)
    // for a brand-new subscription. On a transport/store ERROR it returns (nil, false, err);
    // callers MUST refuse to start the subscription rather than fall back to "now" (§6 #3, §7).
    Load(ctx context.Context, key SubscriptionKey) (Checkpoint, bool, error)
    // Commit advances the durable position. Must be idempotent and monotonic:
    // a Commit to an older position than the stored one is a no-op.
    Commit(ctx context.Context, key SubscriptionKey, cp Checkpoint) error
    // Release marks a subscription inactive (for GC of external state).
    Release(ctx context.Context, key SubscriptionKey) error
}

// DurableAdapter is the extended adapter contract. It replaces the
// fire-and-forget Subscribe with one that takes a SubscriptionKey and a
// start checkpoint, and whose updater reports DeliveryResults back.
type DurableAdapter interface {
    datasource.Lifecycle
    SubscribeDurable(
        ctx context.Context,
        key datasource.SubscriptionKey,
        start datasource.Checkpoint, // nil => use StartPolicy
        cfg datasource.SubscriptionEventConfiguration,
        updater datasource.DurableUpdater,
    ) error
    Publish(ctx context.Context, cfg datasource.PublishEventConfiguration, events []datasource.StreamEvent) error
    // Capabilities advertises what this adapter can durably support, so the
    // negotiation layer can degrade non-silently.
    DurableCapabilities() DurableCapabilities
}

// DurableUpdater extends SubscriptionEventUpdater (subscription_event_updater.go:19-24)
// with a back-channel. Because the engine delivers on its own event-loop goroutine
// (resolve.go:1086, AsyncResolveGraphQLSubscription), confirmation is reported
// ASYNCHRONOUSLY via a channel, NOT a synchronous return value (see "Engine change" below).
type DurableUpdater interface {
    datasource.SubscriptionEventUpdater
    // UpdateDurable delivers events carrying their backend Position. Per-position
    // DeliveryResults are delivered on the returned channel as each subscriber's
    // flush (or ack) resolves on the engine goroutine. The adapter's commit loop
    // (decoupled from the engine serialization gate, §6 / §3.3) consumes them.
    UpdateDurable(events []datasource.PositionedEvent) <-chan datasource.DeliveryResult
}

// PositionedEvent is a StreamEvent plus its backend position. The position is
// read from data the code ignores today: msg.Metadata() (JetStream),
// r.Offset/r.Partition (Kafka), the entry id (Redis Streams).
type PositionedEvent struct {
    datasource.StreamEvent
    Position datasource.Checkpoint
}

type DurableCapabilities struct {
    PerConsumerDurable bool          // JetStream, Redis Streams, Pub/Sub, external-checkpoint backends
    PrefixCommitOnly   bool          // Kafka, Kinesis, Event Hubs: no per-message nak (head-of-line)
    ReplayWindow       time.Duration // retention bound; 0 => unbounded within store
    NativeDedup        bool          // SQS FIFO, Pub/Sub EOS, JetStream Nats-Msg-Id window
    Class              DeliveryClass // best achievable: AtLeastOnce | BWindow | AtMostOnce
}
```

**The engine change, specified concretely (BLOCKER #1).**
The earlier draft's `Update(data) []DeliveryResult` is *architecturally impossible* as a synchronous return,
because the result must cross from the resolver's event-loop goroutine back to the adapter's reader goroutine.
The concrete plan, naming the exact `graphql-go-tools` functions:

1. **`subscriptionUpdater.Update` (`resolve.go:1479`) gains a positioned variant** that does not discard results.
   Add `UpdatePositioned(events []PositionedEvent, results chan<- DeliveryResult)` (or attach a results sink to the
   `subscriptionUpdater` at subscribe time). The existing void `Update` stays for the at-most-once path.
2. **`handleTriggerUpdate` (`resolve.go:1086`) stops discarding per-subscriber outcomes.**
   Each `wg.Go` worker reports `(subID, position, confirmed, err)` instead of swallowing it.
3. **`executeSubscriptionUpdate` (`resolve.go:616`) returns a flush/ack outcome** rather than only calling
   `UnsubscribeSubscription` internally on failure. The internal unsubscribe-on-flush-failure behavior is preserved,
   but the *outcome* is now also surfaced upward.
4. **The result crosses the goroutine boundary via a channel**, consumed by the adapter's **decoupled commit loop**
   (§3.3), *not* inside the `s.mu`-guarded serialization gate (§6, MAJOR #7). The commit loop is keyed by position
   so it can advance the contiguous confirmed prefix independently of which event batch the engine is currently processing.

This is a cross-repo change to a separately-released, version-pinned engine (`router/go.mod`:
`graphql-go-tools/v2 v2.4.1`, with a commented-out local `replace`). It requires cutting a new engine release and
bumping the pin — a coordination cost listed as its own workstream in §12. Line numbers are against the `v2.4.1`
snapshot and must be re-verified against the engine version the implementation targets (the dossier notes line drift between snapshots).

### 3.3 Lifecycle — one durable subscription, happy path (decoupled commit)

```
                         ┌───────────────────────────────────────────────────────┐
                         │                    Cosmo Router                        │
  client ──Subscribe──▶  │  websocket.go / flushwriter.go                         │
  (signed sub token,     │      │                                                 │
   optional resume cp)   │      ▼                                                 │
                         │  principal = verify(token)  // server-validated, §8.5  │
                         │  SubscriptionKey = f(principal.tenant,                 │
                         │     principal.clientID, rootField, destHash)  // §3.6  │
                         │      │                                                 │
                         │      ▼                                                 │
                         │  CheckpointStore.Load(key)                            │
                         │      ├─ ok    -> start checkpoint                      │
                         │      ├─ miss  -> StartPolicy (new sub)                 │
                         │      └─ ERROR -> REFUSE: surface `resume-failed` (§7)  │
                         │      │                                                 │
                         │      ▼                                                 │
                         │  DurableAdapter.SubscribeDurable(key, start, cfg, upd) │
                         └──────┬────────────────────────────────────────────────┘
                                │
            ┌───────────────────▼─────────────────────┐
            │   Broker durable consumer (per key)      │
            │   JetStream durable | Redis cons-group | │
            │   external cp (Kafka/Kinesis/Event Hubs) │
            └───────────────────┬─────────────────────┘
                                │  fetch from `start`
                                ▼
   ┌────────────────────────────────────────────────────────────────────────┐
   │  reader loop (per SubscriptionKey in per-subscriber; per trigger shared) │
   │                                                                          │
   │   batch = fetch()                                                        │
   │   positioned = [(evt, position) ...]   // read msg.Metadata / r.Offset   │
   │        │                                                                 │
   │        ▼  Streams-v1 StreamBatchEventHook (map/filter/authz, §8.5)       │
   │   resultsCh = updater.UpdateDurable(positioned)   // returns a channel   │
   └────────────────────────────────────────────────────────────────────────┘
                                │
              (engine event-loop goroutine resolves + flushes per subscriber,
               OUTSIDE the adapter reader goroutine; resolve.go:1086)
                                │
                                ▼  DeliveryResult{position, confirmed, err}
   ┌────────────────────────────────────────────────────────────────────────┐
   │  decoupled commit loop (NOT inside the s.mu serialization gate, §6)      │
   │                                                                          │
   │   per-message-ack backend (JetStream/Redis Streams/Pub/Sub):            │
   │     advance ack floor to highest CONTIGUOUS confirmed position;          │
   │     nak / leave-in-PEL the unconfirmed => redeliver                      │
   │                                                                          │
   │   prefix-commit backend (Kafka/Kinesis/Event Hubs):                     │
   │     commit offset = (lowest unconfirmed) - 1  // do NOT advance past it  │
   │     => head-of-line: a stuck position blocks the whole partition prefix  │
   │                                                                          │
   │   CheckpointStore.Commit(key, hwm)   // monotonic + idempotent          │
   │   on Commit error: do NOT advance (fail-closed -> dup, never loss)       │
   └────────────────────────────────────────────────────────────────────────┘
```

The critical invariant **for per-message-ack backends**: the checkpoint advances to the highest *contiguous*
confirmed position, never past a gap. If positions 5,6,7 are delivered and 5 and 7 confirm but 6 fails,
the checkpoint commits at 5, and 6 (and therefore 7 again) are redelivered.
This trades duplicates for no-loss — the at-least-once bargain — and keeps ordering intact
because we never commit past an unconfirmed hole.

**This invariant is well-defined for one consumer reading one position sequence.** It is *not* a single universal
invariant across both isolation modes; §6 splits the two modes because their correctness properties are opposite.

### 3.4 Lifecycle — reconnect and restart

```
  t0  client subscribes, key=K, delivered+committed through position 100
  t1  client disconnects (or router instance crashes)
        - in-flight positions 101..105 were delivered but NOT committed
        - CheckpointStore still holds 100 (broker-native: ack floor; external: stored offset)
  t2  client reconnects -> verify(token) -> SAME principal -> SAME SubscriptionKey K
        - K is stable ONLY if DestinationHash is deterministic (§3.6); else Load misses -> resume-failed (§7)
        - may land on a DIFFERENT router instance
  t3  CheckpointStore.Load(K) => 100   (on store ERROR: refuse, surface resume-failed; never start from "now")
  t4  SubscribeDurable(K, start=100)
        - JetStream: bind to durable consumer K; redelivers un-acked from ack floor
        - Redis Streams: XAUTOCLAIM the PEL for consumer-group K, then XREADGROUP
        - Kafka (external cp): seek partition to committed offset 100 (+1); NO consumer group churn
        - Kinesis/Event Hubs (external cp): GetShardIterator AFTER_SEQUENCE_NUMBER(100)
  t5  router replays 101..105 (re-running authz, §8.5), then resumes live from 106
```

Because the durable name / checkpoint is keyed on the *subscription*, not the *process*,
a brand-new router instance reconstructs the exact read position and replays the gap —
**provided** the resume identity (`SubscriptionKey`) is stable (§3.6) and `experiment_delete_durable_consumers_on_shutdown`
is **off** (§3.5). The dossier calls HA the single biggest design axis;
Pattern C resolves it by paying for per-subscription consumer state and a shared checkpoint store.

### 3.5 Cosmo components touched

| Component | Change |
|---|---|
| `router/pkg/pubsub/datasource/provider.go:22-28` | Add `DurableAdapter` / `DurableCapabilities`; keep `Adapter` for non-durable fields. |
| `router/pkg/pubsub/datasource/subscription_event_updater.go:19-129` | Add `DurableUpdater.UpdateDurable` returning a `<-chan DeliveryResult`; collect outcomes instead of discarding. On hook timeout **cancel** in-flight deliveries (not abandon), see MAJOR #15. |
| `router/pkg/pubsub/nats/adapter.go:61-83,130-159,413-442` | Durable name = `SubscriptionKey` (fix per-instance hash); read `msg.Metadata()` for stream seq; `Ack/Nak` from `DeliveryResult` in the decoupled commit loop, not unconditionally at `:154`. **Must force `experiment_delete_durable_consumers_on_shutdown` off** in durable mode (it deletes exactly the consumers we rely on). |
| `router/pkg/pubsub/kafka/adapter.go:32-122` | Do **not** use per-client consumer groups (anti-pattern, §5). Keep a small pool of group-or-groupless readers; per-`SubscriptionKey` position lives in the external `CheckpointStore`; seek by `(partition, offset)`; commit = prefix only (head-of-line). |
| `router/pkg/pubsub/redis/adapter.go:88-152,191` | New Redis **Streams** path (`XREADGROUP`/`XACK`/`XAUTOCLAIM`) for the subscribe side **and** a publisher change to `XADD` (see MAJOR #11); durable mode requires Streams on both producer and consumer. |
| New `router/pkg/pubsub/checkpoint/` | `CheckpointStore` impls: `broker` (delegates), `redis`, `dynamodb`, `postgres`. |
| `router/core/websocket.go:367,1141-1185` | Derive `SubscriptionKey` from a **server-validated** principal; carry resume checkpoint from `Subscribe` payload; new `ack` inbound (only when Pattern A enabled). Confirm `connection_init.payload.cosmo` is additive and does not clobber existing `connectionParams` auth handling (MINOR #19). |
| `router/core/flushwriter.go:116-167,252-299` | Emit `id:` (the sealed checkpoint) on SSE; honor `Last-Event-ID`; `POST /ack` back-channel for Pattern A on SSE. |
| `router/internal/wsproto/proto.go:88-94` | Add `MessageTypeAck` (Pattern A); negotiate capability in `connection_init` payload. **Non-standard graphql-ws extension** — requires patched clients (§4.4). |
| `resolve.SubscriptionUpdater` (graphql-go-tools `v2.4.1`) | `Update` path must surface per-subscriber delivery success across the engine→adapter goroutine boundary (`resolve.go:1086,616,1479`). **L–XL engine change**, not minimal; requires an engine release + pin bump (§12). |
| `router/pkg/config/config.go:773-782` | New `delivery` block (see §9). |
| Composition / proto | Optional `@edfs__delivery(class: AT_LEAST_ONCE)` directive (see §9); otherwise pure router YAML. |

### 3.6 `DestinationHash` determinism and resume identity (BLOCKER #5)

The central premise — "same token on reconnect ⇒ same `SubscriptionKey` ⇒ `Load` hits" — fails if `DestinationHash`
is not byte-stable across reconnects, instances, and engine versions. Subjects/topics/channels are templated from
operation arguments (e.g. `employeeUpdates(id: $id)` → subject `employeeUpdates.{id}`), so the rendered destination
depends on the variables the client sends on resubscribe and on header rendering, which can differ per instance.

If the rendered destination differs even slightly on reconnect, the key changes, `Load` misses, and the naive design
would silently start from "now" and lose the gap. That is the exact silent loss this RFC forbids. Two mitigations,
both required:

1. **Specify `DestinationHash` inputs exactly and render them deterministically.** The hash is computed over the
   *canonicalized, sorted* rendered destination set only — not over raw variables or header maps. Canonicalization
   (lowercase subject tokens, sorted topic list, stable JSON encoding) must be identical across instances and pinned
   to the engine version. Header-derived destinations are excluded from the hash unless the header is part of the
   declared routing key. This makes the hash a pure function of the declared routing template plus the resolved
   routing arguments.

2. **Prefer a client-presented opaque resume token that *carries* the key (Pattern B primitive).** Rather than
   recompute the key on reconnect and hope it matches, the resume path uses the sealed `resumeFrom` token (§4.1, §8.5),
   which embeds the `SubscriptionKey` it was minted against. On resume the router verifies the token, extracts the
   embedded key, and loads against *that* key — eliminating recomputation drift entirely. Recomputation is used only
   for the *first* subscribe (no token yet).

**Failure mode (explicit, never silent):** if the resume token's embedded key does not match a recomputed key for the
presenting principal, or if `Load` misses where a token was presented, the router surfaces `resume-failed`
(WS `error` / SSE error event) and does **not** silently restart from "now." The client may then choose to resubscribe
fresh (accepting the gap) — but that is the client's explicit decision, surfaced, not the router's silent one.

---

## 4. Wire protocol & client changes

Pattern C, *strictly on its own*, **requires no client protocol change**:
the checkpoint advances on flush success, and a reconnecting client that re-presents the same signed token
resumes from the committed position transparently.
That is the honest framing — and also its honest weakness:
flush success is not client receipt, so "no client change" buys you only "at-least-once relative to flush,"
not "at-least-once relative to the client actually processing the event" (§7).

To close that last hop, Pattern C is designed to *carry* the wire primitives of Pattern A and Pattern B.
The substrate is the same; only the gate on `CheckpointStore.Commit` changes
(flush success → client ack).

### 4.1 graphql-transport-ws / graphql-ws

**Capability negotiation (connection scope).**
The client advertises support in the `connection_init` payload; the server echoes the negotiated class in `connection_ack`.
The `cosmo` key is **additive and namespaced** so it does not clobber the `connectionParams`/auth payload that Apollo,
urql, and others already place at `connection_init.payload` (MINOR #19); the negotiation must be tested against
Apollo/urql strict-parser configurations to confirm unknown keys in `connection_ack.payload` do not trip client validation.

```jsonc
// client -> server
{ "type": "connection_init",
  "payload": { "cosmo": { "delivery": { "supports": ["resume", "ack"] } } } }

// server -> client
{ "type": "connection_ack",
  "payload": { "cosmo": { "delivery": { "class": "at-least-once",
                                        "ack": true, "resume": true } } } }
```

**Resume on (re)subscribe (Pattern B primitive, optional).**
The client carries its last checkpoint in the `Subscribe` payload. Opaque + signed; it *embeds* the `SubscriptionKey` (§3.6, §8.5).

```jsonc
{ "id": "1", "type": "subscribe",
  "payload": { "query": "subscription { employeeUpdates { id } }",
               "extensions": { "cosmo": { "resumeFrom": "eyJzZXEiOjEwMH0...signed" } } } }
```

**Per-message checkpoint + client ack (Pattern A primitive, optional).**
Each `next` carries its checkpoint in `extensions`; the client acks by id+checkpoint via a **new inbound message type**.
This is the addition to `wsproto/proto.go:88-94` (`MessageTypeAck`). It is a **non-standard graphql-ws extension**
(§4.4): the graphql-ws message set is fixed, and a spec-compliant server rejects unknown inbound types, so a stock
client cannot send this — every client SDK that wants end-to-end ack must be patched.

```jsonc
// server -> client
{ "id": "1", "type": "next",
  "payload": { "data": { "employeeUpdates": { "id": 7 } },
               "extensions": { "cosmo": { "cp": "eyJzZXEiOjEwMX0...signed" } } } }

// client -> server  (NEW: MessageTypeAck — non-standard, requires a patched client)
{ "id": "1", "type": "ack",
  "payload": { "cp": "eyJzZXEiOjEwMX0...signed" } }
```

When `ack` is negotiated, `CheckpointStore.Commit` is gated on the ack rather than the flush —
this is the only change that makes the guarantee truly end-to-end.

### 4.2 graphql-sse / plain SSE

SSE is one-directional, so it splits along the two primitives:

- **Resume (free with *native browser* EventSource only).**
  Emit the checkpoint as the SSE `id:` field (today `flushwriter.go:116-167` emits only `event:`/`data:`).
  On reconnect a native browser `EventSource` sends `Last-Event-ID`; the router maps it to a checkpoint and replays.
  **Caveat:** the `graphql-sse` library does *not* implement `Last-Event-ID` resumption (dossier §4.1) — it treats the
  operation `id` as correlation, not an SSE event id. So this zero-client-change resume works only for clients using a
  native `EventSource`, not for the `graphql-sse` SDK.

```
id: eyJzZXEiOjEwMX0...signed
event: next
data: {"data":{"employeeUpdates":{"id":7}}}
```

- **Ack (needs a back-channel).**
  Since SSE has no client→server frame, Pattern A on SSE uses a separate
  `POST /graphql/subscriptions/{id}/ack` with `{ "cp": "...signed" }`.
  Only required for end-to-end ack; resume alone does not need it.

### 4.3 Fallback when the client cannot participate

A stock client that advertises nothing gets:

- the **server-side substrate transparently** (durable consumer + checkpoint committed on flush),
- **no per-message ack** (so the flush ≠ receipt gap remains),
- **no replay on reconnect** unless it is a native-`EventSource` browser (which gets `Last-Event-ID` resume for free).

The negotiated class in `connection_ack` always reports the *actual* class
(e.g. `at-least-once-on-flush` vs `at-least-once`), so the degradation is never silent.
This composes directly with Pattern G (capability negotiation) if/when it ships.

### 4.4 Realistic client adoption (MAJOR #9)

This subsection states bluntly what the default deployment actually gets, because the rest of the RFC's strong claims
are conditional on client capabilities that **no stock client has today** (dossier §4.1–4.2):

- **graphql-ws, Apollo, Relay, urql, graphql-sse: none support per-message ack or resume.** The graphql-ws protocol
  message set is fixed; a spec-compliant server rejects unknown inbound types.
- **The WS `ack` frame is a non-standard protocol extension.** Every client SDK must be **forked/patched** to send it.
  Until then, `commit_gate: client_ack` is unusable for that client, and the guarantee is `at-least-once-on-flush`.
- **Only a native browser `EventSource` gets resume for free** via `Last-Event-ID` (once the router emits `id:` and
  replays). The `graphql-sse` SDK does **not** — it ignores `Last-Event-ID`.
- **Therefore the realistic default shipped class is `at-least-once-on-flush`, restart-survivable** — which is the same
  flush ≠ receipt limitation as today, merely survivable across router restart and (for per-subscriber) client reconnect.
  It is a real improvement, but it is not the headline "at-least-once to receipt."

The honest framing: the strong guarantee is available, but it is **earned** by (a) opting into `per-subscriber`
isolation and (b) patching the client to ack. The TL;DR leads with this reality.

---

## 5. Per-backend adaptability & degradation matrix

The hard rule: **a user may pick any supported backend, even if it means a weaker guarantee,
and the weaker guarantee is reported, never silently assumed.**
`DurableCapabilities.Class` is logged at subscription start and surfaced in `connection_ack`.

| Backend | Supported? | How (durable consumer / checkpoint) | Guarantee with Pattern C | Degradation / fallback |
|---|---|---|---|---|
| **NATS core** | No (durable) | No durable position, unbuffered chan drops (`nats/adapter.go:168`) | — | Degrades to **at-most-once**; refuse durable mode at startup, or fall back to Pattern E (router buffer). |
| **NATS JetStream** | **Yes (per-message ack)** | Durable pull consumer named from `SubscriptionKey` (fix `nats/adapter.go:61-83`); checkpoint = ack floor `(cons,stream)`; `AckExplicit`, `MaxAckPending` cap | **At-least-once** across restart + reconnect, retention-bound; **exactly-once** with `Nats-Msg-Id` dedup window + Pattern A double-ack | Full support. Must force `experiment_delete_durable_consumers_on_shutdown` **off**. |
| **Kafka** | **Yes (prefix-commit, external cp)** | **Not** per-client consumer groups (anti-pattern). Pooled reader + per-`SubscriptionKey` offset in the external `CheckpointStore`; seek by `(partition, offset)` | **At-least-once across restart + reconnect, but PREFIX granularity**: a slow/stuck subscriber blocks the partition prefix (head-of-line). No per-message nak. Bounded by `retention.ms` | This is effectively **Pattern B (stateless cursor)** for Kafka. Per-client `group.id` is explicitly rejected (see note below). Surface "cursor expired" on offset eviction. |
| **Redis Pub/Sub** | No (durable) | Pub/Sub has no ack/PEL; producer uses `PUBLISH` (`redis/adapter.go:191`) | — | Degrades to **at-most-once**; require **Redis Streams** for durable mode on **both** producer (`XADD`) and consumer (`XREADGROUP`) (explicit config error otherwise). |
| **Redis Streams** | **Yes (new, per-message ack)** | Consumer-group + consumer per `SubscriptionKey`; checkpoint = last-delivered-id + PEL; `XREADGROUP`/`XACK`/`XAUTOCLAIM`. **Requires publisher `XADD`** | **At-least-once** across restart + reconnect, bounded by `MAXLEN`/`MINID` trim | New adapter path on both producer and consumer. Mixed deployment (old `PUBLISH` producers + new `XREADGROUP` consumers) = **zero delivery** — must be gated (see note below). |
| **SQS (Standard)** | Window only | Delete-on-ack queue, no cursor | **At-least-once within visibility window** only; no historical replay | Degrade to **Pattern A** (ack ↔ `DeleteMessage` / visibility timeout) or **Pattern E** buffer; cross-restart loses position. |
| **Google Pub/Sub** | **Window / Pattern A** | One shared subscription, ack-based; **not** per-client subscriptions (quota + `seek` semantics, see note) | **At-least-once** within ack/redelivery scope; cross-client per-cursor resume is **not** supported via `seek` | Route to **Pattern A/B**, not per-subscriber-durable. Document why per-client subscriptions are infeasible (note below). |
| **Kinesis** | **Yes (prefix-commit, external cp)** | No broker consumer state; checkpoint = per-shard sequence in `CheckpointStore` (DynamoDB, KCL-style); `GetShardIterator AFTER_SEQUENCE_NUMBER` | **At-least-once** across restart + reconnect, prefix/sequence granularity (head-of-line per shard); bounded by retention (24h→7d→365d) | Iterator expires 5 min (re-derive from checkpoint); requires external store. |
| **Event Hubs** | **Yes (prefix-commit, external cp)** | No broker ack; checkpoint = per-partition offset+seq in `CheckpointStore` (blob/Postgres) | **At-least-once** across restart + reconnect, prefix granularity (head-of-line per partition); bounded by retention (7d / 90d premium) | Requires external store; per-partition ordering only. |
| **RabbitMQ / AMQP** | Window only | `basic.ack`/`nack`, unacked auto-requeue; no cursor | **At-least-once within the unacked window**; no historical replay | Degrade to **Pattern A** (ack ↔ `basic.ack`) or **Pattern E**; requeue breaks FIFO. |

**Why Kafka per-client `group.id` is rejected (BLOCKER #4).**
The earlier draft proposed one `group.id` per `SubscriptionKey` with static membership. This is a known Kafka anti-pattern:
(a) Kafka commits a single offset *per partition*, so per-message at-least-once is impossible — only prefix advance, with
head-of-line blocking on a slow subscriber; (b) one consumer group per client means tens of thousands of single-member
groups, and `__consumer_offsets` is itself a topic with `offsets.retention.minutes` (7d default) eviction plus
group-coordinator memory/metadata load that scales with group count; (c) `group.instance.id` static membership with one
member per group defeats partition parallelism and makes every reconnect to a different router fence/rejoin with a
`session.timeout.ms` delay (and, during a network partition where the old member is still alive, fences a live member —
the split-brain the HA story must avoid). **Decision:** Kafka per-client durability uses the external-checkpoint path
(seek by `(partition, offset)`, no per-client consumer group) — this is Pattern B's model. The guarantee is
"at-least-once with prefix granularity," and we say so.

**Why Google Pub/Sub per-client subscriptions are rejected (MAJOR #12).**
A Pub/Sub *subscription* is a heavyweight, quota-limited resource (default 10k subscriptions/topic, creation latency in
seconds); one per client is infeasible at fan-out scale. `seek` to a snapshot is a *bulk* operation affecting the whole
subscription's ack state, not a per-consumer cursor — it cannot resume one client without disturbing others sharing the
subscription. EOS subscriptions cannot be created on the fly per client. **Decision:** Google Pub/Sub routes to Pattern
A/B (one subscription, ack-based) and is **not** offered as a per-subscriber-durable backend.

**Redis Streams requires a publisher change (MAJOR #11).**
Cosmo's Redis publish path is `PUBLISH` (`redis/adapter.go:191`), which writes to Pub/Sub channels — **not** `XADD` to a
stream. A Streams consumer group reads from a stream key nothing is writing to. Durable Redis mode therefore requires the
**publisher** to switch to `XADD` (changing `@edfs__redisPublish` semantics: `XADD` always succeeds and returns an entry
id, whereas `PUBLISH` returns a subscriber count, so `success:true` changes meaning). Mixed deployments (old `PUBLISH`
producers, new `XREADGROUP` consumers) deliver **zero** events; the rollout must flip producer and consumer together, or
gate durable Redis mode behind a check that the publisher is on the Streams path.

**Two families decide everything (dossier §3.3).**
Log/cursor stores (JetStream, Redis Streams, Kafka, Kinesis, Event Hubs) get a durable position + historical replay.
Among these, **per-message-ack backends** (JetStream, Redis Streams) support true per-message redelivery; **prefix-commit
backends** (Kafka, Kinesis, Event Hubs) support only prefix advance with head-of-line blocking — a strictly weaker shape
that we route through the external-checkpoint / cursor path.
Delete-on-ack queues (SQS-std, RabbitMQ, NATS core, Redis Pub/Sub, Google Pub/Sub-as-queue) cannot hold a seekable
per-client position, so Pattern C *degrades to a redelivery window* (Pattern A scope) and **must say so**.
The startup check is hard: `delivery.class: at-least-once` on NATS core or Redis Pub/Sub is a **config error**, not a silent downgrade.

---

## 6. Delivery semantics achieved — split by isolation mode (BLOCKER #3)

The single most important correction in this revision: **`shared` and `per-subscriber` isolation have *opposite*
correctness and backpressure properties.** The earlier draft presented one contiguous-prefix invariant that only holds
in `per-subscriber`. They are now specified separately.

### 6.1 `shared` isolation (default) — Pattern D semantics, one checkpoint, slowest-wins

One trigger, one broker consumer, one checkpoint, **N clients fanned out** (today's shared-trigger model). The checkpoint
advances only on the **slowest confirmed subscriber** across the fan-out (you cannot commit past an event some subscriber
has not confirmed without losing it for that subscriber).

Consequences, stated honestly:

- **Head-of-line blocking is inherent.** A slow subscriber holds the checkpoint for *everyone* on the trigger.
- **The drop-a-stuck-subscriber hole is real and is NOT at-least-once for that client.** If a subscriber disconnects
  mid-batch and never confirms, the prefix cannot advance for the group. The router resolves this exactly as today:
  it drops the stuck subscriber (`UnsubscribeSubscription`) so the healthy subscribers progress. **The dropped subscriber
  loses its un-confirmed events** — this is at-most-once *for that client*, even in `shared` "at-least-once" mode.
  This is an inherent trade-off of fan-out under one shared position; we document it rather than pretend the single
  invariant covers it. A client that needs no-loss-on-disconnect **must** use `per-subscriber`.
- **Guarantee class:** `at-least-once-on-flush-shared` — events are redelivered after a router restart from the shared
  checkpoint, but an individual client that disconnects mid-batch can lose its in-flight suffix.

`shared` mode is the correctness fix Pattern D makes (no longer ack-on-failure / fan-out-all-acked / abandon-but-acked),
plus restart survival via the shared checkpoint. It is cheap and is the default precisely because most subscriptions do
not need per-client no-loss.

### 6.2 `per-subscriber` isolation — true per-client checkpoint

One broker consumer / checkpoint per client (defeating trigger dedup, §8.3). Each client reads its own position sequence,
so the contiguous-prefix invariant (§3.3) is well-defined per client:

- **At-least-once relative to flush** with no client change. Every event whose flush succeeded, *and every event in an
  unconfirmed prefix*, is (re)delivered after a gap, within retention.
- **At-least-once relative to client receipt** when combined with Pattern A (client ack) — the commit gate moves from
  flush to ack. This is the version that actually closes the dossier's §2.1 bug.
- **A slow client stalls only its own consumer** (no co-subscriber penalty) — the property `shared` lacks.
- **A disconnect does not lose the un-acked window** — it is redelivered on reconnect from the per-client checkpoint
  (the property `shared` lacks).

The two modes are not interchangeable: `shared` is cheap but has head-of-line + drop-loss; `per-subscriber` is expensive
but isolates and never loses on disconnect. The config (§9) makes the choice explicit and the negotiated class (§4) reports
which one is actually in force.

### 6.3 Common semantics (both modes)

- **Exactly-once (effective)** = at-least-once + an idempotent client (dedup on the surfaced idempotency key).
- **Exactly-once (broker-level)** only on JetStream (`Nats-Msg-Id` + double-ack), Pub/Sub EOS, and Kafka EOS
  (`read_committed` + transactional commit) — opt-in, with the usual LSO-stall caveat.

**Duplicates.** Guaranteed possible. Any redelivery after an unconfirmed gap, any failover mid-batch, and any
commit-then-crash re-runs the uncommitted suffix. **Clients must be idempotent.** We surface a stable idempotency key
(`Nats-Msg-Id`, Kafka record key, Redis entry id, or content hash) in `extensions.cosmo.idk` so the client can dedup.

**Ordering.** Preserved *within a consumer / partition / stream*, because we only ever commit a **contiguous confirmed
prefix** — we never advance past an unconfirmed hole, so redelivery cannot reorder relative to the committed point. There
is **no global order** across a fanned-out subscription set. See §6.4 for the hook-timeout reordering hazard, which must be
fixed for this to hold.

**Prefix-commit backends (Kafka, Kinesis, Event Hubs).** "Nak the rest" is impossible; the only lever is to not advance
past the lowest unconfirmed offset. A stuck position blocks the whole partition prefix. This is head-of-line blocking, not
per-message redelivery, and is why these backends route through the external-checkpoint / cursor path (§5).

### 6.4 Hook-timeout reordering must be fixed with cancellation, not abandonment (MAJOR #15)

Today, on a hook/resolve timeout, `subscription_event_updater.go:69-79` **abandons** in-flight deliveries and the loop
proceeds (warning "Events may arrive out of order"); the abandoned goroutines **keep running, hold semaphore slots, and
may push their events late** (`updateSubscription` lines ~95-129). Under Pattern C, a timeout must result in
**no-commit / nak** — but if the abandoned goroutine later *succeeds*, the redelivered copy and the late original produce
the event twice, with the redelivery possibly *reordered before* the late original. The "ordering preserved because
contiguous prefix" claim does **not** survive this concurrency reality.

**Fix:** on timeout the in-flight deliveries must be **cancelled** (context cancellation that actually aborts the resolve
mid-`LoadGraphQLResponseData`), not merely abandoned, *before* the no-commit/nak. This requires the resolve to be
cancellable mid-load. Without cancellation, the at-least-once + ordering claim is unsound on the hooks path.

---

## 7. Failure modes & remaining windows

(Restored as a distinct section; the earlier draft folded this into §6 with a placeholder — MINOR #16.)

1. **Flush ≠ receipt** (default, no Pattern A).
   Event flushed to the kernel TCP buffer, checkpoint advanced, client crashes before reading the buffer → **lost**.
   This is the *same* bug as today; Pattern C alone narrows it (per-subscriber, restart-survivable) but does not eliminate
   it. Pattern A eliminates it.

2. **`shared`-mode mid-batch disconnect** (default isolation).
   A subscriber that disconnects before confirming its in-flight suffix is dropped so the group can progress; its
   un-confirmed events are lost → **at-most-once for that client** (§6.1). Inherent to fan-out under one shared position;
   the escape hatch is `per-subscriber`.

3. **Checkpoint-store unavailability — two distinct cases (MAJOR #10).**
   - *On `Commit` failure:* do **not** advance (fail-closed → duplicates on redelivery, never loss). A store outage
     degrades throughput, not correctness.
   - *On `Load` failure at (re)subscribe:* the router **must refuse to start the subscription** and surface
     `resume-failed` to the client. It must **never** fall back to "now" — that would be silent loss of the entire gap.
     This is explicit in the `CheckpointStore.Load` contract (§3.2): a transport/store error returns an error and the
     caller refuses. Note the engine tears the subscription down on flush failure (`executeSubscriptionUpdate`,
     `resolve.go:679`); if the store is also down at reconnect, the only correct behavior is refuse-and-surface, not
     start-from-now.

4. **Beyond retention.**
   A disconnect longer than the broker's retention / offset-retention / trim window → the position is evicted →
   **at-most-once for the gap**, surfaced as "checkpoint expired."

5. **Consumer/checkpoint GC vs resume window (MAJOR #13).**
   `inactive_ttl` GCs inactive consumers; `resume_window` promises replay. These are **two different lifetimes** and
   must not be conflated. The *consumer* may be GC'd, but the *checkpoint position* must survive the full `resume_window`.
   Startup validation: if `inactive_ttl < resume_window`, emit a **warning** that resume is not actually guaranteed for the
   promised window (a client reconnecting after `inactive_ttl` but within `resume_window` would otherwise hit a deleted
   position and silently restart). The fix is to keep the checkpoint row alive for `resume_window` independently of
   consumer GC.

6. **Unstable resume identity** (BLOCKER #5, §3.6).
   If `DestinationHash` drifts on reconnect, `Load` misses. Mitigated by deterministic hashing + a resume token that
   embeds the key; on mismatch the router surfaces `resume-failed`, never silent restart.

7. **Authz-changed replay** (BLOCKER #6, §8.5).
   Distinguishing transform-drop (advance) from authz-revoke (terminate) is required to avoid silently advancing past
   data the client was entitled to. See §8.5.

8. **Hook-timeout reorder/double-deliver** (MAJOR #15, §6.4).
   Requires cancellation, not abandonment, of in-flight deliveries before nak.

9. **Non-monotonic commit race.**
   Two router instances briefly serving the same `SubscriptionKey` (split-brain during failover) could both commit;
   `Commit` is monotonic + idempotent (older position = no-op) and broker-native consumers use single-active-consumer /
   leasing to make double-consumption a transient duplicate, not a loss (§8.1).

10. **`experiment_delete_durable_consumers_on_shutdown` (MINOR #21).**
    This existing knob deletes JetStream consumers on shutdown — destroying exactly the consumers Pattern C relies on for
    restart resume. Durable mode must **force it off**, or **error** if it is set, since otherwise the restart-survival
    story silently breaks.

---

## 8. Cross-cutting concerns

### 8.1 Router HA / horizontal scaling & sticky sessions

This is where Pattern C earns its XL rating and also where it shines — but the stickiness story is **conditional on the
checkpoint store** (MAJOR #8), not the blanket "not required" of the earlier draft.

- **The durable name is keyed on the subscription, not the process** — the explicit fix to `nats/adapter.go:61-83`.
  A reconnecting client (same verified principal → same `SubscriptionKey`) resumes on *any* instance.
- **Single-active-consumer is mandatory** to avoid two instances double-consuming one durable position:
  JetStream consumer with `MaxAckPending` + single-active or push-with-queue-group;
  Redis Streams consumer name uniqueness within the group;
  external-checkpoint backends (Kafka per-client, Kinesis, Event Hubs) fence via a **lease** in the `CheckpointStore`
  (lease the `SubscriptionKey` to one instance, TTL-bounded).
- **Stickiness requirement is conditional on `checkpoint.store`:**
  - **External store** (`redis`/`dynamodb`/`postgres` + leasing): truly portable. A non-sticky reconnect to any instance
    works (Load → lease → SubscribeDurable → replay). This is the case where "stickiness preferred, not required" holds.
  - **Broker-native store** (`broker` on JetStream/Redis Streams): the position lives in the broker's consumer-group /
    durable-consumer identity. A non-sticky reconnect to a new instance is **sensitive to instance identity** and needs
    single-active enforcement via the broker primitive (queue group / single-active consumer). During a network partition
    where the old instance is still alive, a naive takeover can double-consume; the broker's single-active primitive (or a
    lease) bounds this to transient duplicates, never loss. **It is not "stickiness-free" in the unqualified sense the
    earlier draft claimed.**
- This is still strictly better than Pattern B for external-store mode, which needs stickiness for correctness on some backends.

### 8.2 Per-subscription state / memory cost

The dossier flags this as the most expensive pattern, correctly.

- **One durable consumer / checkpoint per active subscription** in `per-subscriber`, not per shared trigger.
- Broker resource cost scales **O(active subscriptions)**: JetStream consumers, Redis consumer-group entries, external
  checkpoint rows.
- External-checkpoint backends add a row/key per subscription in Redis/DynamoDB/Postgres.
- **Consumer GC is fiddly and must respect `resume_window` (§7 #5):** inactive *consumers* are GC'd on `inactive_ttl`,
  but the *checkpoint position* survives for `resume_window`. JetStream's `consumerInactiveThreshold`
  (`schema.graphqls:115-119`, default 30s) is the existing knob to generalize for the consumer lifetime; the checkpoint
  lifetime is separate.

### 8.3 How per-subscriber isolation defeats trigger dedup (BLOCKER #2)

Per-subscriber durability is **not** a pure broker-side cost — it requires a change to the *engine's* trigger keying. The
engine assigns a broker subscription to a **trigger**, and the trigger is keyed by `prepareTrigger`
(`resolve.go:1277-1289`) on a hash of *rendered input + subgraph headers* — explicitly **not** client identity (dossier
§1.4). N clients with identical subscriptions collapse onto **one** trigger and **one** `Adapter.Subscribe` call.

To get one durable consumer per client, you must **defeat trigger dedup**: the per-client `SubscriptionKey` (or a salt
derived from it) must enter the trigger hash, so identical-query clients no longer share a trigger. Concretely, this is a
change to `prepareTrigger`'s key generation in `graphql-go-tools`, gated on the field/provider being marked
`per-subscriber`. The effect: at the engine level, one shared trigger becomes **N triggers** for N clients, each driving
its own `SubscribeDurable`. This is a **structural engine change**, not a broker-only cost, and it deletes the
shared-trigger optimization for any field marked `per-subscriber`.

Cosmo's central optimization — one broker subscription per input+headers hash, fanned to N clients
(`kafka/adapter.go:124-125`) — is therefore **broken by `per-subscriber`**: N clients now means N triggers and N broker
consumers, at both the engine and broker levels.

### 8.4 The hybrid: shared (default) vs per-subscriber (opt-in)

We offer a **hybrid** rather than an absolute:

- **Shared-trigger (default, today's behavior)** for `at-most-once` and `at-least-once-on-flush-shared` classes:
  one consumer, one checkpoint, slowest-wins, **head-of-line blocking + mid-batch-disconnect drop-loss** (§6.1). Cheap.
- **Per-subscription durable (opt-in via `delivery.isolation: per-subscriber`)** for true restart+reconnect survival:
  one trigger + consumer per client, full isolation, no disconnect loss, **full engine + broker cost** (§8.3).

The RFC's opinion: **default to shared, make per-subscriber an explicit, costed opt-in**, because most subscriptions do
not need cross-restart per-client durability and the fan-out cost (engine triggers + broker consumers) is real. The
directive/config must make the trade-off visible (§9), and the negotiated class (§4) must report which mode is in force,
because they have opposite correctness properties (§6).

### 8.5 Security / authz

- **`ClientID` MUST be server-validated, never client-asserted (MAJOR #14).**
  `SubscriptionKey` derives from a tenant-scoped principal. If `ClientID` were taken from a client-presentable token (a
  router-minted token persisted client-side), a malicious member of the *same tenant* could mint/replay a token carrying
  another user's `ClientID` and resume **their** stream — the AEAD seal proves the checkpoint is well-formed but does
  **not** prove the presenter *is* that `ClientID`. Therefore `ClientID` must be derived from a server-validated auth
  principal bound to the authenticated session. **Threat:** same-tenant cross-user replay. **Decision:** `at-least-once`
  is **forbidden for unauthenticated/anonymous subscriptions** — this resolves the §12 open question in the negative.
- **Resume checkpoints are opaque, signed, and embed the key.**
  A raw `(partition, offset)` or stream-seq would let a client seek to data it shouldn't see. The `Checkpoint`/`resumeFrom`
  on the wire is sealed (AEAD with a router key), embeds the `SubscriptionKey` it was minted against (§3.6), and is scoped
  to the verified principal; the router rejects a token that doesn't verify against the presenting principal.
- **Replay re-runs authz per event** — with a critical distinction (BLOCKER #6).
  Replayed events pass through the *same* filter/authz hooks as live events, with the **current** authorization. But
  "drop" is ambiguous, and the two meanings must be handled differently, or the RFC silently reintroduces at-most-once:
  - **Transform/filter drop** (the event was never meant for this client — content filter, projection): **advance the
    checkpoint** (drop ≠ failure). Otherwise a permanently-filtered event wedges the prefix forever.
  - **Authz-revoked drop** (the client *was* entitled to this data when it disconnected, but its tenant/role was revoked
    since): **terminate the subscription with an error** (`authz-revoked`); do **NOT** silently advance past data the
    client was entitled to at disconnect time. Silently advancing here is exactly the at-most-once-presented-as-at-least-once
    silent loss the RFC forbids.
  - **Hook signal mapping:** the `StreamBatchEventHook` must distinguish these — e.g. a filter-drop return vs. an
    authz-error return. A filter-drop marks the position confirmed (advance); an authz-error terminates the subscription
    (client sees `authz-revoked`, no silent advance). There is no correct *universal* rule; the hook must tell us which
    case it is, and the contract must make that explicit.

### 8.6 Interaction with existing Cosmo Streams hooks

Pattern C is *additive* to Streams v1:

- `SubscriptionOnStartHandler` is where the `SubscriptionKey` is finalized and a custom resume policy can run.
- `StreamBatchEventHook` runs on both live and replayed batches (re-authz, re-map). Its return must distinguish
  (§8.5): *transform/filter-drop* → mark positions confirmed (advance, don't block the prefix); *authz-revoke* →
  terminate with `authz-revoked` (no silent advance); *transient error* → no-commit/nak (redeliver).
- `WriteEvent` (the v1 initial-message mechanism) emits a synthetic event with **no broker position**; synthetic events
  are flagged so they are never checkpointed.
- On hook/resolve timeout, in-flight deliveries are **cancelled** (not abandoned) before nak (§6.4).

---

## 9. Configuration surface

### 9.1 Router YAML — new `delivery` block

Per-provider, with a global default. Lives alongside `events.providers` (`config.go:773-782`).

```yaml
version: "1"

events:
  providers:
    kafka:
      - id: my-kafka
        brokers: ["localhost:9092"]
    nats:
      - id: my-nats
        url: "nats://localhost:4222"

  # NEW: delivery durability substrate (Pattern C)
  delivery:
    default:
      class: at-most-once          # at-most-once | at-least-once | exactly-once
    providers:
      my-nats:
        class: at-least-once
        isolation: per-subscriber  # per-subscriber | shared (default: shared)
        commit_gate: flush         # flush | client_ack (client_ack needs Pattern A + patched client)
        checkpoint:
          store: broker            # JetStream ack floor (broker-native)
        resume_window: 168h        # promised replay window; must be <= backend retention
        inactive_ttl: 5m           # GC durable CONSUMER after last disconnect
        checkpoint_ttl: 168h       # GC checkpoint POSITION; MUST be >= resume_window (§7 #5)
        max_in_flight: 256         # backpressure cap (MaxAckPending equivalent)
      my-kafka:
        class: at-least-once       # prefix-commit: at-least-once with HEAD-OF-LINE, not per-message
        isolation: per-subscriber
        commit_gate: flush
        checkpoint:
          store: dynamodb          # external cp; NO per-client consumer group (§5)
          dynamodb:
            table: cosmo-checkpoints
            region: eu-central-1
        resume_window: 72h
        checkpoint_ttl: 72h
```

**Hard validation at startup** (non-silent degradation):

- `class: at-least-once` on a provider whose `DurableCapabilities.PerConsumerDurable == false`
  (NATS core, Redis Pub/Sub, Google Pub/Sub-as-queue) → **fatal config error** listing the supported alternatives.
- `commit_gate: client_ack` without Pattern A wire support enabled **and** a client that advertises `ack` → **fatal**
  (and at runtime, a client that does not advertise `ack` falls back to `flush` with the reported class, never silently
  promoted).
- `checkpoint.store: broker` on Kafka/Kinesis/Event Hubs (no viable per-client broker consumer state) → **fatal** (must be external).
- `class: at-least-once` on Redis without the publisher on the `XADD`/Streams path → **fatal** (MAJOR #11).
- `inactive_ttl >= resume_window` or `checkpoint_ttl < resume_window` → **warning**: resume is not actually guaranteed
  for the promised window (§7 #5).
- `resume_window` exceeding the backend's known retention → **warning** (we cannot enforce broker config).
- `class: at-least-once` for an unauthenticated/anonymous subscription path → **fatal** (§8.5, cross-user replay).
- `experiment_delete_durable_consumers_on_shutdown: true` together with a durable provider → **fatal** (§7 #10).

### 9.2 Schema directive (optional, per-field)

For teams that want delivery class to travel with the schema (composition layer), an optional directive that composition
serializes into the existing `DataSourceCustomEvents` carrier (`node.proto:430-434`):

```graphql
type Subscription {
  employeeUpdates: Employee!
    @edfs__natsSubscribe(subjects: ["employeeUpdates"], providerId: "my-nats")
    @edfs__delivery(class: AT_LEAST_ONCE, isolation: PER_SUBSCRIBER)
}
```

The directive is **advisory and capped by router YAML**: a field may not request a stronger class than the provider's
configured ceiling. If omitted, the provider/global default applies. This mirrors how `streamConfiguration` is parsed and
attached today (`normalization-factory.ts:3076-3081`), and keeps the router YAML as the source of truth for *connection
and store* details (never in the control plane).

---

## 10. Migration & backward compatibility

- **Opt-in, default off.**
  `delivery.default.class` defaults to `at-most-once` — byte-for-byte today's behavior, including the existing JetStream
  flush-gated `msg.Ack()`. Nothing changes for existing deployments until an operator sets a `delivery` block.
- **The `DurableAdapter` is additive.**
  Existing `Adapter` callers (publish path, non-durable subscribe) are untouched. An adapter that does not implement
  `DurableAdapter` simply cannot be configured for `at-least-once` (caught by the §9 startup validation).
- **Wire changes are negotiated.**
  A client that doesn't advertise `ack`/`resume` gets the substrate transparently (commit-on-flush) and the *reported*
  class. No existing client breaks. (Per §4.4, that reported class is realistically `at-least-once-on-flush`.)
- **Redis durable mode is a coupled producer+consumer flip (MAJOR #11).**
  Enabling Redis Streams durable mode requires moving publishers to `XADD` *and* consumers to `XREADGROUP` together;
  mixed deployments deliver zero events. The rollout must coordinate both sides (and the §9 validation gates it).
- **Rollout sequencing** (matches the dossier's recommended order, with C as substrate):
  1. Ship the `[]DeliveryResult` plumbing (async channel back-channel) + decoupled commit loop + per-subscriber commit in
     **shared isolation** — this is also Pattern D's correctness fix. Requires the engine change + release (§12).
  2. Ship the durable-name fix + `per-subscriber` isolation on JetStream (broker-native checkpoint, no new store);
     force `experiment_delete_durable_consumers_on_shutdown` off.
  3. Add Redis Streams durable adapter (producer `XADD` + consumer `XREADGROUP`, coupled flip).
  4. Add the external `CheckpointStore` (Redis/DynamoDB/Postgres) for Kafka per-client / Kinesis / Event Hubs (prefix-commit,
     head-of-line documented).
  5. Layer Pattern A (client ack) on top to move `commit_gate` from `flush` to `client_ack` — gated on patched clients (§4.4).
- **Reversibility.** Flipping a provider back to `at-most-once` is safe: durable consumers are GC'd on `inactive_ttl`,
  checkpoints are released, and behavior reverts to fire-and-forget.

---

## 11. Appendix: new/changed Go types

```go
// ─── package datasource (new / changed) ────────────────────────────────────

// SubscriptionKey: durable identity, survives reconnect + failover.
// ClientID is server-validated (NOT client-asserted) — §8.5.
// DestinationHash is deterministically rendered — §3.6.
type SubscriptionKey struct {
    Tenant          string
    ClientID        string
    RootFieldName   string
    DestinationHash string
}
func (k SubscriptionKey) String() string

// Checkpoint: opaque, backend-specific position. Always serializable.
// Granularity differs: per-message (JetStream/Redis Streams) vs prefix (Kafka/Kinesis/Event Hubs).
type Checkpoint []byte

// DeliveryClass: the achievable / requested delivery semantics.
type DeliveryClass int
const (
    AtMostOnce  DeliveryClass = iota // today's default
    BWindow                          // at-least-once within a redelivery/replay window
    AtLeastOnce                      // at-least-once across restart + reconnect
    ExactlyOnce                      // broker-level EOS (JetStream / Pub/Sub / Kafka-EOS)
)

// CommitGate: when the checkpoint may advance.
type CommitGate int
const (
    GateFlush     CommitGate = iota // bytes to kernel (no client change)
    GateClientAck                   // client ack received (needs Pattern A + patched client)
)

// Isolation: shared trigger vs per-subscriber durable consumer.
// These have OPPOSITE correctness/backpressure properties — §6.
type Isolation int
const (
    IsolationShared       Isolation = iota // keeps fan-out dedup; one checkpoint; slowest-wins; mid-batch-disconnect drop-loss
    IsolationPerSubscriber                 // one trigger+consumer per client (defeats trigger dedup, §8.3)
)

// PositionedEvent: a StreamEvent plus its backend position (read from
// data ignored today: msg.Metadata(), r.Offset/r.Partition, entry id).
type PositionedEvent struct {
    StreamEvent
    Position Checkpoint
}

// DeliveryResult: the value that today is discarded (Update returns void).
// Delivered ASYNCHRONOUSLY over a channel (engine resolves on its own goroutine, §3.2).
type DeliveryResult struct {
    Position  Checkpoint
    Confirmed bool
    Err       error
}

// DurableCapabilities: advertised per adapter for non-silent degradation.
type DurableCapabilities struct {
    PerConsumerDurable bool
    PrefixCommitOnly   bool // true for Kafka/Kinesis/Event Hubs (no per-message nak)
    ReplayWindow       time.Duration
    NativeDedup        bool
    Class              DeliveryClass
}

// DurableUpdater: extends SubscriptionEventUpdater with a delivery back-channel.
// Channel, not return value, because confirmation crosses the engine event-loop
// goroutine boundary (resolve.go:1086, AsyncResolveGraphQLSubscription) — §3.2.
type DurableUpdater interface {
    SubscriptionEventUpdater // Update/Complete/Done/SetHooks (unchanged)
    UpdateDurable(events []PositionedEvent) <-chan DeliveryResult
}

// DurableAdapter: extended adapter contract (additive to Adapter).
type DurableAdapter interface {
    Lifecycle
    SubscribeDurable(
        ctx context.Context,
        key SubscriptionKey,
        start Checkpoint, // nil => StartPolicy
        cfg SubscriptionEventConfiguration,
        updater DurableUpdater,
    ) error
    Publish(ctx context.Context, cfg PublishEventConfiguration, events []StreamEvent) error
    DurableCapabilities() DurableCapabilities
}

// CheckpointStore: persists the committed position per subscription.
// Broker-native impls delegate to the broker; external impls use Redis/DynamoDB/Postgres.
// Load ERROR => caller MUST refuse to start (never "now") — §6/§7.
type CheckpointStore interface {
    Load(ctx context.Context, key SubscriptionKey) (Checkpoint, bool, error)
    Commit(ctx context.Context, key SubscriptionKey, cp Checkpoint) error // monotonic + idempotent
    Release(ctx context.Context, key SubscriptionKey) error
}

// ─── package config (config.go:773-782, new) ───────────────────────────────

type DeliveryConfiguration struct {
    Default   DeliveryClassConfig                   `yaml:"default"`
    Providers map[string]ProviderDeliveryConfig     `yaml:"providers"`
}

type DeliveryClassConfig struct {
    Class string `yaml:"class"` // at-most-once | at-least-once | exactly-once
}

type ProviderDeliveryConfig struct {
    Class         string           `yaml:"class"`
    Isolation     string           `yaml:"isolation"`     // per-subscriber | shared
    CommitGate    string           `yaml:"commit_gate"`   // flush | client_ack
    Checkpoint    CheckpointConfig `yaml:"checkpoint"`
    ResumeWindow  time.Duration    `yaml:"resume_window"`
    InactiveTTL   time.Duration    `yaml:"inactive_ttl"`    // consumer GC
    CheckpointTTL time.Duration    `yaml:"checkpoint_ttl"`  // position GC; MUST be >= resume_window (§7 #5)
    MaxInFlight   int              `yaml:"max_in_flight"`
}

type CheckpointConfig struct {
    Store    string                    `yaml:"store"` // broker | redis | dynamodb | postgres
    Redis    *RedisCheckpointConfig    `yaml:"redis,omitempty"`
    DynamoDB *DynamoCheckpointConfig   `yaml:"dynamodb,omitempty"`
    Postgres *PostgresCheckpointConfig `yaml:"postgres,omitempty"`
}

// ─── wire (wsproto/proto.go:88-94, new) ────────────────────────────────────

const (
    MessageTypePing      MessageType = iota + 1
    MessageTypePong
    MessageTypeSubscribe
    MessageTypeComplete
    MessageTypeTerminate
    MessageTypeAck // NEW: client ack {id, payload:{cp}} — NON-STANDARD graphql-ws extension, patched clients only (§4.4)
)
```

---

## 12. Risks, open questions, and complexity/effort estimate

### Where this pattern is weakest (vs the other six)

1. **Flush ≠ receipt, on its own.**
   The honest headline weakness. Pattern C alone advances the checkpoint on a flush attempt — the *exact* bug the dossier
   identifies (§2.1 #1). It narrows it (per-subscriber, restart-survivable, replayable) but does **not** eliminate it.
   Only Pattern A closes it, and Pattern A needs a patched client (§4.4). For the simplest *correct-relative-to-receipt*
   win, A or D is closer to the bone.
2. **The strong guarantee is conditional, the default is weaker.**
   The headline "at-least-once across restart + reconnect to receipt" holds only with `per-subscriber` + a patched client
   doing `ack`. The realistic default (stock client, `shared` isolation) is `at-least-once-on-flush-shared` with
   head-of-line blocking and a mid-batch-disconnect drop-loss hole (§6.1). This is documented, not hidden.
3. **It breaks the shared-trigger optimization at the *engine* level (§8.3).**
   Per-subscriber turns one trigger into N triggers (a `prepareTrigger` keying change) and N broker consumers. For
   high-fan-out subjects this is an engine + broker resource explosion. Patterns B and E preserve sharing better. This is
   the single biggest scaling risk and the reason `shared` is the default.
4. **The engine change is L–XL, cross-repo, and version-pinned (§3.2).**
   The `Update`-returns-void / discard-all-results / deliver-on-own-goroutine reality means a real async back-channel,
   not a signature tweak. It must be cut as a `graphql-go-tools` release and the `router/go.mod` pin bumped.
5. **It introduces a new stateful dependency** (the external `CheckpointStore`) for Kafka per-client / Kinesis / Event
   Hubs, with its own HA, consistency, and operational burden. Patterns B and F have near-zero router-side state.
6. **Consumer lifecycle / GC is genuinely fiddly** — two separate lifetimes (`inactive_ttl` for consumers,
   `checkpoint_ttl` ≥ `resume_window` for positions). Get it wrong and resume silently breaks (§7 #5).
7. **Degradation surface is large.** Several backends degrade to a window, prefix-commit head-of-line, or fail-closed; the
   §9.1 validation matrix is the largest of any pattern. Done wrong, this is the "confusing matrix of what you actually
   get" risk the dossier raises for Pattern G.

### Open questions

- **Contiguous-prefix commit vs. throughput / poison messages.**
  Strict prefix commit means one stuck position holds the whole prefix (and on prefix-commit backends, the whole
  partition). Do we need a per-subscriber dead-letter for a position that fails N times, to avoid a poison message
  wedging a subscription forever? What does the client see when a position is dead-lettered (a gap notification)?
- **Authz-revoke vs transform-drop hook signaling (§8.5).**
  We require the `StreamBatchEventHook` to *distinguish* these two drop reasons, with opposite checkpoint behavior. Is the
  v1 hook contract (empty slice = drop, error = abort) expressive enough, or do we need a third signal (`authz-revoke`)?
  Confirm with the Streams team — this is load-bearing for the no-silent-loss promise and is currently the most likely
  place for the guarantee to regress.
- **Lease/fencing for external-checkpoint single-active enforcement (§8.1).**
  The lease TTL vs. broker single-active-consumer trade-off needs a concrete design. Split-brain → transient duplicates
  (acceptable) but must be bounded; what is the worst-case duplicate window during a network partition?
- **`shared`-mode mid-batch-disconnect loss (§6.1) — is it acceptable as the default?**
  The default isolation has a documented at-most-once-for-that-client hole on mid-batch disconnect. Is that the right
  default, or should the default be "shared, but drop-on-disconnect surfaces a warning to the operator"?

### Complexity / effort estimate: **XL**

| Workstream | Size | Notes |
|---|---|---|
| graphql-go-tools async back-channel (`Update`/`handleTriggerUpdate`/`executeSubscriptionUpdate`) | **L–XL** | Not "M shared with D": result must cross the engine event-loop goroutine boundary via a channel; `resolve.go:1086,616,1479`. |
| graphql-go-tools `prepareTrigger` keying change (per-subscriber defeats dedup) | **L** | `resolve.go:1277-1289`; folds `SubscriptionKey` into the trigger hash; deletes shared-trigger for marked fields. |
| graphql-go-tools release + `router/go.mod` pin bump coordination | **M** | Cross-repo release; re-verify line numbers vs the targeted engine snapshot (dossier line-drift caution). |
| Decoupled commit loop (outside the `s.mu` serialization gate) | **M** | Keyed by position; consumes the result channel; must not block the engine gate (MAJOR #7). |
| Hook-timeout cancellation (not abandon) of in-flight resolve | **M** | Requires resolve cancellable mid-`LoadGraphQLResponseData` (MAJOR #15). |
| JetStream durable-name fix + per-subscriber + ack/nak + force-experiment-off | **M** | Broker-native checkpoint, no new store. |
| Redis Streams durable adapter (producer `XADD` + consumer `XREADGROUP`, coupled flip) | **M–L** | Publisher change + mixed-deployment gate (MAJOR #11). |
| External `CheckpointStore` (Redis/DynamoDB/Postgres) + leasing | **L** | New stateful dependency + HA + lease/fencing. |
| Kafka (external cp, prefix-commit) / Kinesis / Event Hubs adapters | **L** | Seek by offset/sequence; head-of-line semantics; NO per-client consumer groups. |
| `DestinationHash` determinism + sealed resume-token-carries-key | **M** | Correctness-critical (BLOCKER #5). |
| Wire: `MessageTypeAck`, resume payload, SSE `id:`, `/ack` + client-patch reality | **M** | Pattern A's surface; non-standard extension, patched clients only (§4.4). |
| Config + directive + startup validation matrix | **M** | Non-silent degradation is the load-bearing part. |
| Consumer GC / two-lifetime checkpoint vs resume window | **M** | Fiddly; correctness-adjacent (§7 #5). |

**Sequencing recommendation:** ship the async `[]DeliveryResult` seam + decoupled commit loop + JetStream broker-native
per-subscriber path first (highest guarantee for least new infrastructure, no external store), then Redis Streams, then the
external `CheckpointStore` for Kafka/Kinesis/Event Hubs, and finally layer Pattern A (gated on patched clients) to move the
commit gate from flush to client ack. Treat Pattern C as the durable substrate that A and B ride on, **not** as a
standalone end-to-end guarantee — and ship it knowing the *default* class is `at-least-once-on-flush-shared`, with the
strong class earned only by `per-subscriber` + a patched, acking client.
