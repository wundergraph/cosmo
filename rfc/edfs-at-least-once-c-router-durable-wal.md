# RFC At-Least-Once Delivery for Cosmo Streams via a Router-Side Durable Write-Ahead Log + Per-Subscription Checkpoints

- **Author:** automated RFC workflow
- **Status:** Draft
- **Date:** 2026-05-28
- **RFC variant:** C — "Router-Side Durable Write-Ahead Log / Outbox + Per-Subscription Checkpoints"

## Abstract

Cosmo Streams (EDFS) today delivers events to subscribers with an **at-most-once**
guarantee: an event is consumed from the broker, passed through hooks, and pushed to
connected clients in a fire-and-forget manner. If the router crashes, a hook times out,
a client is momentarily disconnected, or the broker has no retention (Redis PubSub, core
NATS), the event is silently lost.

This RFC proposes to make the delivery guarantee **a first-class responsibility of the
router itself** rather than delegating it to each broker. We introduce a persistent,
append-only **Write-Ahead Log (WAL / "DeliveryLog")** that records every event consumed
from a provider *before* it is delivered, and a **per-subscription checkpoint store**
that records, durably, how far each logical subscription has been confirmed. The router
only advances the upstream broker position (ack / commit / offset) **after** the event is
durably in the WAL. Delivery to clients is a read from the WAL; checkpoints advance as
clients confirm receipt.

The payoff is a **uniform, provider-independent at-least-once guarantee** that works
identically for Kafka, JetStream, *and* for providers with no native durability at all
(Redis PubSub, core NATS), and that **survives router restarts without depending on
broker retention windows**. The cost is that the router becomes stateful: it now owns
disk I/O, fsync policy, retention/compaction, and (in multi-replica deployments) a shared
durability substrate. This RFC argues that cost is worth paying and is the only design in
the candidate set that delivers the guarantee everywhere.

---

## 1. Problem statement

### 1.1 The current path is at-most-once

The runtime flow today (verified against the codebase) is:

```
Broker
  └─▶ provider adapter goroutine (kafka/nats/redis adapter.go)
        └─▶ updater.Update([]StreamEvent)                       // SubscriptionEventUpdater
              └─▶ subscriptionEventUpdater.updateSubscription() // semaphore-bounded, 5s timeout
                    └─▶ OnReceiveEvents hooks (per subscription)
                          └─▶ resolve.SubscriptionUpdater.UpdateSubscription(subID, data)
                                └─▶ WS / SSE write
```

Concretely:

- `router/pkg/pubsub/datasource/subscription_event_updater.go:36` — `Update()` fans events
  out to subscriptions through a semaphore (`MaxConcurrentHandlers`) under a 5s timeout. If
  the timeout expires, in-flight updaters are **abandoned** (`subscription_event_updater.go:69-80`):
  events may arrive late, out of order, or not at all. Nothing is persisted; there is no
  checkpoint.
- `router/pkg/pubsub/kafka/adapter.go:51` — `topicPoller()` calls `client.PollRecords`,
  hands records to `updater.Update(...)`, and the franz-go client auto-commits offsets on
  its own cadence. There is no consumer group tied to delivery success, and the consume
  offset is `AfterMilli(time.Now())` (`adapter.go:147`) — i.e. "from now", so a restart
  loses everything produced while the router was down.
- `router/pkg/pubsub/nats/adapter.go:154` — for JetStream, `msg.Ack()` is called
  **after** `updater.Update(...)` *returns*, but `Update()` returning does not mean the
  event reached the client; it means it was handed to the fan-out. The ack therefore
  acknowledges *consumption*, not *delivery*. Core NATS (`adapter.go:168-224`) is plain
  `ChanSubscribe` with no ack and no durability whatsoever.
- `router/pkg/pubsub/redis/adapter.go:88` — Redis PubSub. Fire-and-forget by construction:
  Redis PubSub does not persist, does not replay, and drops messages for any channel with
  no connected subscriber at publish time.

On the publish side, every adapter's `Publish()` is fire-and-forget relative to the
GraphQL mutation that triggered it (`kafka/adapter.go:188`, `nats/adapter.go:227`,
`redis/adapter.go:154`). If the router crashes between "mutation committed its side
effects" and "event left the adapter", the event is lost with no record that it was owed.

### 1.2 Broker-native durability is not uniform

It is tempting to say "just use durable brokers". But:

- **Redis PubSub has no durability at all.** There is nothing to configure. (Redis
  *Streams* is a different data structure that the current adapter does not use.)
- **Core NATS has no durability.** Only JetStream does, and only when a stream + durable
  consumer are configured.
- **Kafka has durability**, but the current adapter does not bind delivery to offset
  commits, and uses `AfterMilli(now)` so restarts skip the backlog.
- Even where the broker *can* be durable, **retention is a broker-side, time/size-bounded,
  operator-controlled window**. A subscriber that disconnects for longer than the retention
  window loses data, and the router has no way to extend or reason about that window
  uniformly across three very different systems.

So broker-native durability gives an *inconsistent* guarantee that is strongest exactly
where customers least need help (Kafka) and absent exactly where the surprise is worst
(Redis / core NATS).

### 1.3 Router restart loses in-flight events

Regardless of broker, everything between "consumed from broker" and "written to the
client socket" lives in volatile memory: the adapter goroutine, the `Update()` fan-out,
the semaphore-bounded updaters, the resolver buffers. A router restart (deploy, crash,
OOM, scale-down) drops all of it. No current component can answer "which events had I
accepted responsibility for but not yet delivered?"

### 1.4 Goal

Provide an **opt-in** at-least-once delivery mode that:

1. Works identically across **all** providers, including non-durable ones.
2. Survives **router restarts** independent of broker retention.
3. Does not require a wire-protocol change to achieve *restart survival* (it does require
   one only to close the *last-mile* client-loss gap; see scope below).
4. Is **off by default** and fully backward compatible.

---

## 2. Definitions

- **At-least-once (this RFC's boundary):** An event is considered *accepted* once it is
  durably persisted in the router's WAL (fsynced per the configured policy). Once accepted,
  the router guarantees the event will be delivered to every matching live subscription at
  least once, surviving router restarts, until that subscription has **checkpointed past**
  it or the subscription is permanently torn down. "Delivered at least once" therefore
  means: *replayed from the WAL until confirmed*.

- **Confirmed / checkpointed:** A subscription's cursor has advanced past a WAL position,
  meaning the router will not replay entries at or below that position to that subscription
  again. What counts as "confirmed" is configurable (see §3 scope):
  - **`write` confirm (default):** confirmed when the bytes are handed to the transport
    write buffer (WS/SSE). This closes the *restart-survival* gap but not last-mile loss.
  - **`ack` confirm (opt-in, requires protocol support):** confirmed when the client sends
    an application-level acknowledgement. This additionally closes last-mile loss.

- **Idempotency requirement:** At-least-once implies **possible duplicate delivery** (on
  recovery, a WAL entry that was delivered but not yet checkpointed will be re-delivered).
  Consumers MUST be able to tolerate duplicates. To help, every delivered event carries a
  stable, monotonic `wal_offset` and an `event_id` so clients can dedupe.

- **Scope — what this guarantees and what it does not:**
  - **In scope (no protocol change):** No event accepted into the WAL is lost across router
    restarts, crashes, redeploys, hook timeouts, or broker outages. A reconnecting client
    resumes from its durable checkpoint and receives the backlog it missed (subject to
    retention).
  - **Out of scope unless `ack` confirm is enabled (requires protocol change to
    `router/core/websocket.go`):** the "last mile" — an event written to a socket that the
    client never actually received because the TCP connection died between write and client
    processing. With `write` confirm this can still be lost; with `ack` confirm it cannot.

- **Subscription identity:** a stable key that lets the router recognize "the same logical
  subscription" across reconnects, so a reconnecting client resumes from its checkpoint
  rather than starting fresh. See §7.

---

## 3. Architecture overview

We add two new durable subsystems and a recovery routine, all owned by the router:

1. **`DeliveryLog` (the WAL / "inbox"):** an append-only, ordered, per-*stream* log of
   accepted events. "Stream" here is the router's internal logical channel: a
   `(providerID, providerType, destination)` triple — destination being a Kafka topic, a
   NATS subject (or JetStream stream), or a Redis channel. Each appended entry gets a
   monotonically increasing `Offset` within that stream.

2. **`CheckpointStore`:** a durable map from **subscription identity** to the highest
   confirmed `Offset` per stream that the subscription consumes.

3. **`OutboxLog`:** an append-only log on the *publish* side that records events a mutation
   intends to publish, written transactionally with (or immediately after) the mutation's
   own durable effect, then drained to the broker by a publisher worker. (See §6.)

```
                       ┌──────────────────────────────────────────────────────────┐
                       │                        ROUTER                             │
                       │                                                           │
 Broker ──consume──▶ Adapter ──append──▶ ┌────────────┐                            │
 (kafka/nats/redis)   poller             │ DeliveryLog│◀── replay/read ──┐         │
                        │                 │  (WAL)     │                  │         │
                        │ ack/commit      └─────┬──────┘                  │         │
                        │  ONLY AFTER           │ tail                    │         │
                        │  durable append       ▼                         │         │
                        │            SubscriptionEventUpdater             │         │
                        │              (fan-out + hooks)                  │         │
                        │                       │ deliver                 │         │
                        │                       ▼                         │         │
                        │                  WS / SSE write ────confirm─────┘         │
                        │                       │                                   │
                        │                       ▼                                   │
                        │                ┌────────────────┐                         │
                        │                │ CheckpointStore│  per (subId, stream)    │
                        │                └────────────────┘                         │
                       └──────────────────────────────────────────────────────────┘
```

### 3.1 Core Go interfaces

These live in a new package `router/pkg/pubsub/durable` and are wired into the existing
`datasource` package.

```go
package durable

import "context"

// Offset is a monotonically increasing position within a single logical stream's WAL.
// It is dense (no gaps) and assigned by the DeliveryLog on append.
type Offset uint64

// StreamID identifies a router-internal logical stream. It is provider-independent:
// the same abstraction covers a Kafka topic, a NATS subject/stream, and a Redis channel.
type StreamID struct {
    ProviderID   string // e.g. "my-nats"
    ProviderType string // "nats" | "kafka" | "redis"
    Destination  string // topic / subject / channel (canonicalized)
}

// Record is one durable WAL entry. Payload is the *provider-neutral* serialized
// StreamEvent (data + provider-specific extras like headers/key/metadata), so that on
// replay we can reconstruct a datasource.StreamEvent without re-reading the broker.
type Record struct {
    Offset    Offset
    EventID   string // stable dedupe id (e.g. broker msg id, or content hash + seq)
    Stream    StreamID
    Payload   []byte // codec-encoded MutableStreamEvent (data + extras)
    AppendTS  int64  // unix nanos, for time-based retention
}

// AppendResult is returned once the records are durably persisted per the fsync policy.
type AppendResult struct {
    FirstOffset Offset
    LastOffset  Offset
}

// DeliveryLog is the append-only, ordered, durable WAL.
type DeliveryLog interface {
    // Append durably writes records for a single stream and returns the assigned offsets.
    // It MUST NOT return until the configured durability (fsync) guarantee is met.
    Append(ctx context.Context, stream StreamID, records []Record) (AppendResult, error)

    // Read returns up to `limit` records for `stream` with Offset > after, in order.
    // Used both for steady-state tailing and for replay on reconnect/restart.
    Read(ctx context.Context, stream StreamID, after Offset, limit int) ([]Record, error)

    // Head returns the highest assigned offset for a stream (0 if empty).
    Head(ctx context.Context, stream StreamID) (Offset, error)

    // Truncate compacts the log, deleting all records with Offset <= upTo for a stream.
    // Called by the GC once all live subscriptions have checkpointed past upTo.
    Truncate(ctx context.Context, stream StreamID, upTo Offset) error

    // Streams enumerates known streams (for recovery and GC scans).
    Streams(ctx context.Context) ([]StreamID, error)

    Close() error
}

// CheckpointStore durably records per-subscription delivery progress.
type CheckpointStore interface {
    // Load returns the confirmed offset for (subID, stream); ok=false if none recorded.
    Load(ctx context.Context, subID SubscriptionIdentity, stream StreamID) (Offset, bool, error)

    // Advance moves the checkpoint forward to `offset` (monotonic; lower values ignored).
    // Implementations MAY batch/coalesce writes per the checkpoint flush policy.
    Advance(ctx context.Context, subID SubscriptionIdentity, stream StreamID, offset Offset) error

    // MinConfirmed returns the lowest confirmed offset across all LIVE subscriptions of a
    // stream, plus whether any live subscription exists. Drives GC. Subscriptions that are
    // not currently live but are within their resumability window count as confirmed at
    // their last persisted checkpoint (so we do not GC data a reconnecting client needs).
    MinConfirmed(ctx context.Context, stream StreamID, live []SubscriptionIdentity) (Offset, error)

    // Forget removes checkpoints for a subscription that has been permanently torn down
    // or has exceeded its resumability TTL.
    Forget(ctx context.Context, subID SubscriptionIdentity) error

    Close() error
}

// SubscriptionIdentity is the stable key for "the same logical subscription". See §7.
type SubscriptionIdentity struct {
    // DurableID is a client-supplied stable id when provided (preferred). Empty otherwise.
    DurableID string
    // Fingerprint is a deterministic hash of the resolved subscription: operation hash +
    // normalized variables + provider config + auth subject. Used when DurableID is absent
    // and as a guard that a reused DurableID actually refers to the same logical stream.
    Fingerprint string
}

func (s SubscriptionIdentity) Key() string // stable string key for storage
```

### 3.2 Pluggable backends

Both `DeliveryLog` and `CheckpointStore` are interfaces with multiple implementations
selected by config:

| Backend | DeliveryLog | CheckpointStore | Topology | Notes |
|---|---|---|---|---|
| `embedded` (default) | local segment-file log (custom) **or** BadgerDB | same store, separate keyspace | single-node / sticky | Lowest latency; no external dependency; router is now stateful on local disk. |
| `bbolt` | bbolt B+tree | bbolt bucket | single-node | Simpler than segment files; single-writer; fine for moderate throughput. |
| `sqlite` | SQLite WAL-mode table | SQLite table | single-node | Easy ops, transactional outbox is trivial; throughput ceiling lower than segment log. |
| `redis` | Redis Streams (`XADD`/`XRANGE`/`XTRIM`) | Redis hash | multi-replica shared | Shared durability across replicas; durability bounded by Redis persistence (AOF). |
| `sql` (Postgres) | append table + `LISTEN/NOTIFY` tail | row per (subID, stream) | multi-replica shared | Strong durability + transactional outbox; highest per-event cost. |
| `object` | segment objects in S3/GCS | small KV (e.g. DynamoDB) | multi-replica shared | Cheap bulk retention; high latency; good for replay-heavy/lagging clients. |

**Default decision: `embedded` segment-file log + bbolt-backed checkpoints, single-node /
sticky topology.** Rationale:

- It introduces **zero new infrastructure dependencies** — critical for a feature that is
  off by default and that many users will trial before committing.
- A segment-file append log with batched `fsync` is the cheapest possible durable write
  path; it is the same shape as Kafka's own on-disk format and gives us full control over
  the fsync/throughput knob.
- bbolt gives transactional, crash-safe checkpoint updates without a second moving part.
- The trade-off — that durability is per-node and requires sticky routing in multi-replica
  setups — is acceptable for v1 and is explicitly addressed in §10, with `redis`/`sql` as
  the documented path to shared multi-replica durability.

We default to the **simplest thing that is correct and dependency-free**, and make the
shared-store backends a config switch for users who need replica fungibility.

---

## 4. Write / deliver / checkpoint path

### 4.1 Write path (consume → durable → ack upstream)

The adapter poller no longer calls `updater.Update(...)` directly. Instead it appends to
the WAL first, then acks the broker, then a separate **delivery tailer** reads the WAL and
fans out. This is the heart of the design: **the upstream position is advanced only after
the event is durably ours.**

```
for each batch fetched from broker:
    records := encode(batch)                                  // provider-neutral payloads
    res, err := deliveryLog.Append(ctx, streamID, records)    // BLOCKS until fsync policy met
    if err != nil:
        // do NOT ack upstream; let the broker redeliver (or, for non-durable
        // providers, log+metric the loss — there is nothing to redeliver from).
        return err
    ackUpstream(batch)                                        // commit offset / msg.Ack()
```

Per provider, "ackUpstream" is:

- **Kafka** (`kafka/adapter.go`): switch to a consumer group and a manual-commit client
  (`kgo.DisableAutoCommit()`); after a successful `Append`, call
  `client.CommitRecords(ctx, batch...)`. Also change `ConsumeResetOffset` from
  `AfterMilli(now)` to the group's committed offset (or `AtStart` on first run) so restarts
  resume from the backlog. The WAL append is what makes "consumed but not yet delivered"
  durable; the consumer-group commit is what makes the *broker* side resumable.
- **NATS JetStream** (`nats/adapter.go:154`): move `msg.Ack()` to *after* a successful
  `Append` instead of after `Update()` returns. Now the ack means "durably ours", not
  "handed to fan-out".
- **Core NATS / Redis PubSub:** there is no upstream ack and no redelivery. The WAL append
  is the *only* durability these providers will ever have. Once appended, the router owns
  it; if `Append` fails before the event is captured, it is genuinely lost (and counted in
  a `wal_append_failed` metric) — but that window is now a single fsync, not the entire
  delivery+hook+socket pipeline. This is precisely where this design beats every alternative.

### 4.2 fsync policy — the durability/throughput knob

`Append` must not return until the configured guarantee is met. We expose three policies:

- **`per_batch` (default for `embedded`):** `fsync` once per `Append` call (i.e. per broker
  fetch batch). Strong durability; cost amortized across the batch (Kafka fetches up to
  10,000 records per poll today, NATS up to 300, so batches are naturally large).
- **`interval`:** `fsync` on a timer (e.g. every 50ms / `fsync_interval`). Higher
  throughput; bounded loss window (events appended but not yet fsynced at crash time are
  lost). `Append` returns after the in-memory write; durability is asynchronous. This
  weakens the guarantee to "at-least-once within the fsync window" and MUST be documented
  as such.
- **`always`:** `fsync` per record. Maximum durability, lowest throughput; for low-volume,
  high-value streams.

This single knob is the throughput/durability dial and is set per WAL backend (and
overridable per provider).

### 4.3 Deliver path (WAL → subscriptions)

A **delivery tailer** goroutine per active stream reads the WAL from a low-water mark and
drives the existing fan-out. The integration point is `subscription_event_updater.go`:
`Update()` is refactored so that the *source* of events is the WAL tailer rather than the
adapter directly, and so that each subscription is driven from its own checkpoint.

```go
// New: the tailer reads durable records and feeds the existing per-subscription fan-out.
func (t *deliveryTailer) run(ctx context.Context) {
    for {
        // For steady state we tail from the stream head; for a reconnecting/lagging
        // subscription we replay from its checkpoint (see resumeSubscription, §7).
        recs, _ := t.log.Read(ctx, t.stream, t.cursor, t.batchSize)
        if len(recs) == 0 { t.waitForAppendOrCtx(ctx); continue }

        events := decodeAll(recs) // []datasource.StreamEvent, each tagged with its Offset
        t.updater.UpdateFromWAL(recs[len(recs)-1].Offset, events)
        t.cursor = recs[len(recs)-1].Offset
    }
}
```

`SubscriptionEventUpdater` gains a WAL-aware method. The existing hook-running and
semaphore logic in `updateSubscription()` is preserved verbatim; we only (a) carry the
`Offset` alongside the events and (b) advance the checkpoint on confirm:

```go
// Extends the interface in subscription_event_updater.go.
type SubscriptionEventUpdater interface {
    Update(events []StreamEvent)                         // unchanged (used when WAL disabled)
    UpdateFromWAL(upTo durable.Offset, events []StreamEvent) // new: durable path
    Complete()
    Done()
    SetHooks(hooks Hooks)
}
```

```go
func (s *subscriptionEventUpdater) updateSubscription(/* ...existing args... */,
    upTo durable.Offset, events []StreamEvent) {

    // ... existing hook loop and per-event s.eventUpdater.UpdateSubscription(subID, data) ...

    // CONFIRM. With write-confirm (default), this runs once the transport write returns.
    // With ack-confirm, it runs from the WS ack handler instead (see §7.3).
    if err == nil {
        _ = s.checkpoints.Advance(ctx, identityFor(subID), s.stream, upTo)
    } else {
        // On hook error we still DO NOT advance the checkpoint past the failed offset,
        // so a reconnect (or restart) will redeliver from the last confirmed position.
        s.eventUpdater.CloseSubscription(subID)
    }
}
```

Key correctness point: **the checkpoint is the unit of progress, not the broker offset.**
Even with the 5s hook timeout that today silently abandons updaters
(`subscription_event_updater.go:69`), an abandoned/timed-out subscription simply does *not*
advance its checkpoint, so its events remain in the WAL and are redelivered on the next
tail/reconnect instead of being lost.

### 4.4 Wiring

The WAL and checkpoint store are constructed once at router start and threaded through
`BuildProvidersAndDataSources` in `router/pkg/pubsub/pubsub.go:56` (a new field on
`ProviderOpts` / the `Hooks` struct), then handed to each `NewSubscriptionEventUpdater`
(`subscription_event_updater.go:142`) and to the adapters' pollers.

---

## 5. Outbox for the publish side

Today a GraphQL mutation that publishes an event (`@edfs__natsPublish`,
`@edfs__kafkaPublish`, `@edfs__redisPublish`) calls the adapter's `Publish()` directly and
fire-and-forget (`kafka/adapter.go:188`, `nats/adapter.go:227`, `redis/adapter.go:154`).
If the router crashes after the resolver returns success to the client but before/while the
broker write happens, the event is lost and nobody knows it was owed.

We add a **transactional outbox**:

```go
type OutboxRecord struct {
    ID        string
    Provider  StreamID            // where to publish
    Payload   []byte              // encoded event
    EnqueueTS int64
    Attempts  int
}

type OutboxLog interface {
    // Enqueue durably records intent-to-publish. With the `sql`/`sqlite` backend this can
    // share a transaction with the mutation's own DB effect (true transactional outbox).
    Enqueue(ctx context.Context, recs []OutboxRecord) error
    // Pending returns undelivered records for the publisher worker to drain.
    Pending(ctx context.Context, limit int) ([]OutboxRecord, error)
    // Done marks records as successfully published to the broker.
    Done(ctx context.Context, ids []string) error
    Close() error
}
```

Publish path becomes **publish-after-commit**:

```
resolver publish step:
    outbox.Enqueue(ctx, records)   // durable; returns success to client only after this
                                   // (optionally in the same txn as the mutation effect)

publisher worker (background):
    recs := outbox.Pending(ctx, N)
    for each: adapter.Publish(ctx, conf, [event])   // existing OnPublishEvents hooks still run
    outbox.Done(ctx, succeededIDs)                  // retry the rest with backoff
```

This makes publishes at-least-once into the broker (duplicates possible on crash-after-
publish-before-`Done`; the `EventID` lets downstream dedupe). The `OnPublishEvents` hooks
(`hooks.go:12`) run in the publisher worker exactly as they do today, so module behavior is
unchanged. For brokers/stores that cannot share a transaction with the mutation, we use the
standard outbox pattern: enqueue durably first, then drain — the worst case is a duplicate
publish, never a lost one.

---

## 6. Subscription identity & reconnect

This is the hard part. The whole guarantee hinges on recognizing "the same logical
subscription" across a reconnect so we resume from its checkpoint instead of starting fresh
(and instead of leaking checkpoints forever).

### 6.1 Identity resolution

`SubscriptionIdentity` (see §3.1) is resolved in priority order:

1. **Client-supplied durable subscription ID (preferred).** The client sends a stable
   `durableId` (see §11 for the protocol surface). The router keys checkpoints on it. This
   survives connection drops, process restarts, and even client process restarts, because
   the client deterministically reuses the same id. We **guard** it with the `Fingerprint`:
   if a reused `durableId` arrives with a different operation/variables/auth subject, we
   reject the resume (it is not the same logical subscription) and start fresh under a new
   identity to avoid cross-talk.

2. **Derived fingerprint (fallback, no client cooperation).** When no `durableId` is
   supplied, `Fingerprint = hash(normalizedOperation + sortedVariables + providerConfig +
   authSubject)`. Two reconnects of the *same* query by the *same* principal collapse to the
   same identity. This is best-effort: it cannot distinguish two browser tabs running the
   identical authenticated query (they share a checkpoint and so may each see the other's
   confirms). That is an acceptable degradation for the no-cooperation case and is
   documented; clients that need precise resume semantics supply a `durableId`.

The existing engine already deduplicates identical subscriptions
(`kafka/adapter.go:124` comment: "The engine already deduplicates subscriptions with the
same topics..."). Our identity sits *above* that: it is about durable resume across
disconnects, not in-process dedup.

### 6.2 Resume flow

```
client (re)connects with durableId D (or we derive fingerprint F)
    identity := resolve(D, F)
    for each stream this subscription consumes:
        cp, ok := checkpoints.Load(ctx, identity, stream)
        from := cp if ok else stream.Head()   // new subs start at head (current behavior),
                                               // or AtStart if `replay_on_first_connect` set
        spawn deliveryTailer replaying from `from`
```

A reconnecting client therefore receives exactly the WAL backlog between its checkpoint and
the current head, then transitions seamlessly into live tailing — **as long as that backlog
is still within retention** (§8). If the client was gone longer than retention, it resumes
from the oldest retained offset and we emit a `subscription_gap` metric + optional in-band
notice so the client knows it missed data (turning silent loss into observable loss).

### 6.3 Last-mile confirm (optional, requires protocol change)

With `write` confirm, "confirmed" = "written to socket", which does not survive a TCP reset
between write and client receipt. To close that gap we add an **application-level ack** over
the GraphQL-WS / SSE channel: the server tags each delivered payload with its `wal_offset`,
and the client periodically sends `{ "type": "ack", "id": <subId>, "offset": <n> }`. The
checkpoint then advances on ack rather than on write. This is the only part of the design
that touches `router/core/websocket.go` (which today is unidirectional push with no
app-level ack). **Restart survival does NOT depend on this**; only last-mile loss does.

---

## 7. Retention, compaction, GC, disk pressure

The WAL grows unboundedly without GC. Retention has two jobs: (a) reclaim space once
everyone has consumed, and (b) keep a bounded backlog so reconnecting/lagging clients can
replay.

### 7.1 GC rule (correctness-critical)

For each stream, compute the **minimum confirmed offset across all live subscriptions plus
all not-currently-live subscriptions still within their resumability TTL**:

```
safe := MinConfirmed(stream, liveSubs)
log.Truncate(stream, min(safe, headOffset - retentionFloor))
```

We may only truncate up to `safe`. Truncating past a subscription's checkpoint would lose
data that subscription is still owed — this is the single most important invariant in the
design and is covered by property tests (§13). A subscription that has gone away but whose
resumability TTL has not expired is treated as confirmed *at its last persisted checkpoint*,
which *pins* the log and prevents premature GC; when its TTL expires we `Forget()` it and
the floor can advance.

### 7.2 Bounded retention for replay

Independently of GC, operators set a **retention floor**: `retention_max_age` and/or
`retention_max_bytes` per stream. The WAL keeps at least this much history beyond the safe
point so that a brief disconnect can always replay. If `safe` is older than the floor we
keep up to the floor; if a slow subscriber's checkpoint is older than the floor, the floor
loses and we keep the data (we never drop unconfirmed data for a *live* sub — see disk
pressure).

### 7.3 Disk pressure handling

The router is now stateful and can fill a disk. Policy, in order:

1. **Backpressure first (safe):** when WAL size for a stream exceeds `soft_limit`, slow or
   pause the adapter poller (stop calling `Append`, stop acking upstream). For durable
   brokers (Kafka/JetStream) this is lossless — the backlog stays in the broker. This is the
   preferred response and turns disk pressure into broker backpressure.
2. **Evict the laggard (configurable):** if `hard_limit` is hit and the cause is one slow
   subscription pinning the log, optionally close that subscription (emitting a gap signal)
   so GC can advance, rather than degrading the whole stream. Controlled by
   `on_disk_pressure: backpressure | evict_laggards`.
3. **For non-durable providers (Redis/core NATS):** there is no broker backlog to fall back
   on, so `backpressure` means we keep accepting into the WAL until `hard_limit`, then we
   must either evict laggards or drop new events (counted) — there is no free lunch when the
   source has no durability. Default `evict_laggards`.

---

## 8. Recovery on restart

On router start, before accepting client traffic for streams:

```
for each stream in deliveryLog.Streams():
    head := deliveryLog.Head(stream)
    minCP := MinConfirmed(stream, /* all persisted identities within TTL */)
    // 1. Resume delivery: live subscriptions reconnect and replay from their checkpoints
    //    (which are durable in CheckpointStore). New tailers start from minCP and serve
    //    each subscriber from its own checkpoint.
    // 2. Reconcile upstream: re-point the broker consumer so we don't double-append.
    reconcileUpstream(stream, head)
```

**Upstream reconciliation** prevents re-appending events we already captured:

- **Kafka:** resume the consumer group from its committed offset. Since we commit *after*
  `Append`, any records appended-but-not-committed before the crash will be re-fetched and
  re-appended — these are **duplicates in the WAL**. We dedupe on `EventID` at append time
  (the WAL `Append` skips records whose `EventID` already exists within a recent window) so
  recovery is idempotent.
- **JetStream:** the durable consumer redelivers unacked messages; same `EventID` dedupe
  applies.
- **Redis PubSub / core NATS:** nothing to reconcile — whatever was in the WAL at crash
  time (and fsynced) is preserved; whatever was in flight in the broker at crash time was
  never durable anywhere and is genuinely gone (this is the irreducible floor for
  non-durable providers, and it is *far* smaller than today's whole-pipeline window).

Recovery completes when every stream's tailer is running and reconciled. Clients that
reconnect during/after recovery resume from their durable checkpoints transparently.

---

## 9. Multi-replica deployments

This is the design's main operational trade-off, addressed head-on.

### 9.1 Embedded backend → sticky routing (default)

With the `embedded`/`bbolt` backend, each replica has its **own** WAL and checkpoints on
local disk. The guarantee is then **per replica**:

- A subscription's durable state lives on the replica that served it. Reconnects must land
  on the **same replica** to resume from checkpoint. This requires **sticky routing**
  (session affinity by `durableId` / connection) at the LB/ingress.
- If a replica is permanently lost, its WAL is lost; subscriptions it served fall back to
  their broker-side resumability (Kafka/JetStream) or start fresh (Redis/core NATS). We
  document this clearly: embedded durability protects against *router restart*, not against
  *node loss*.
- Scaling down a replica must drain: stop accepting, let live subscriptions checkpoint, then
  exit. A `prestop` hook flushes checkpoints.

This is the right default because most EDFS deployments are modest in replica count and
sticky routing is a well-understood ingress feature, and because it keeps the feature
dependency-free.

### 9.2 Shared store backend → fungible replicas

With `redis`/`sql`/`object` backends, the WAL and checkpoints are **shared**. Any replica
can serve any subscription's reconnect because the checkpoint is globally visible.
Consistency implications:

- **Single appender per stream:** to keep offsets dense and ordered, exactly one replica
  must append for a given stream at a time. We elect a per-stream **append leader** via a
  lease in the shared store (e.g. a Redis/SQL advisory lock). Followers do not consume from
  the broker for that stream; they only *read* the shared WAL to deliver to their locally
  connected clients. This keeps the broker consumer single-owner (also fixing the
  `kafka/adapter.go:150` "what if multiple router instances?" FIXME).
- **Checkpoint contention:** `Advance` is monotonic and last-writer-wins-by-max, so
  concurrent advances from different replicas for the *same* identity (shouldn't happen with
  sticky-by-identity, but possible during failover) are safe.
- **Cost:** every append and every checkpoint advance is now a network round-trip to the
  shared store. We mitigate with batching (append per broker-batch, checkpoint flush
  coalesced over `checkpoint_flush_interval`).

Operators choose embedded (simple, sticky) vs shared (fungible, heavier) per their
availability needs. The interface is identical; only config changes.

---

## 10. Configuration & schema surface

All new behavior is gated behind `events.delivery` and is **off by default** (absent block
== today's at-most-once behavior, byte-for-byte).

```yaml
version: "1"

events:
  providers:
    nats:
      - id: my-nats
        url: "nats://localhost:4222"
    redis:
      - id: my-redis
        urls: ["redis://localhost:6379"]

  # NEW: at-least-once delivery via router-side WAL. Omit to keep at-most-once.
  delivery:
    enabled: true
    guarantee: at_least_once          # at_most_once (default) | at_least_once

    wal:
      backend: embedded               # embedded | bbolt | sqlite | redis | sql | object
      path: /var/lib/cosmo/edfs-wal   # for embedded/bbolt/sqlite
      fsync_policy: per_batch         # per_batch (default) | interval | always
      fsync_interval: 50ms            # only used when fsync_policy=interval
      segment_max_bytes: 268435456    # embedded segment rollover (256MiB)
      # external backends:
      # redis: { urls: ["redis://..."] }
      # sql:   { dsn: "postgres://..." }
      # object:{ bucket: "s3://cosmo-edfs-wal", region: "..." }

    checkpoints:
      backend: bbolt                  # bbolt | sqlite | redis | sql  (defaults to wal.backend family)
      flush_interval: 200ms           # coalesce checkpoint advances
      confirm: write                  # write (default, no protocol change) | ack (needs client ack)
      resumability_ttl: 1h            # how long a disconnected sub's checkpoint pins the WAL

    retention:
      max_age: 30m                    # bounded replay window beyond the safe GC point
      max_bytes: 1073741824           # per-stream cap (1GiB)
      gc_interval: 30s
      on_disk_pressure: backpressure  # backpressure | evict_laggards
      soft_limit_bytes: 805306368     # 75% of max_bytes
      hard_limit_bytes: 1073741824

    outbox:
      enabled: true                   # publish-after-commit for mutations
      backend: sqlite                 # inherits wal.backend if omitted
      drain_batch: 256
      max_attempts: 10

    multi_replica:
      topology: sticky                # sticky (embedded) | shared (external store)
      append_lease_ttl: 15s           # for shared topology single-appender election
```

### 10.1 Per-subscription opt-in via SDL (optional)

To allow durability per subscription rather than per router, we extend the existing EDFS
subscribe directives (`composition/src/v1/constants/directive-definitions.ts`) with an
optional `delivery` argument and surface it in the router config
(`shared/src/router-config/graphql-configuration.ts`):

```graphql
type Subscription {
  employeeUpdates: Employee!
    @edfs__natsSubscribe(
      subjects: ["employeeUpdates"]
      providerId: "my-nats"
      delivery: AT_LEAST_ONCE          # NEW, optional; defaults to router-level setting
    )
}

enum edfs__DeliveryGuarantee { AT_MOST_ONCE AT_LEAST_ONCE }
```

When absent, the field inherits `events.delivery.guarantee`. This lets a customer turn on
durability only for the streams that need it, keeping high-volume telemetry streams cheap.

### 10.2 Client protocol surface (only for resume / ack)

Over `graphql-transport-ws`, the `subscribe` message `payload` gains an optional
`extensions.edfs`:

```json
{
  "id": "1",
  "type": "subscribe",
  "payload": {
    "query": "subscription { employeeUpdates { id } }",
    "extensions": { "edfs": { "durableId": "client-abc-employeeUpdates", "resumeFrom": "checkpoint" } }
  }
}
```

And an optional client→server ack (only when `confirm: ack`):

```json
{ "id": "1", "type": "edfs_ack", "payload": { "offset": 4711 } }
```

Clients that send neither still get **restart-survival** via derived-fingerprint identity
and `write` confirm; they only miss precise resume and last-mile guarantees.

---

## 11. Architecture diagram (consolidated)

```
                         CONSUME / DELIVER (subscription side)

  ┌────────┐   poll/fetch   ┌──────────────────┐
  │ Broker │ ─────────────▶ │  Adapter poller   │
  │ K/N/R  │                │ (kafka/nats/redis │
  └────────┘                │     adapter.go)   │
      ▲                     └─────────┬─────────┘
      │  (4) ack/commit               │ (1) Append(records)   [BLOCKS on fsync policy]
      │      ONLY AFTER append        ▼
      │                     ┌────────────────────┐
      └──────(4)────────────│   DeliveryLog WAL   │  append-only, per-stream, dense offsets
                            │  embedded | redis   │
                            │  | sql | object     │
                            └─────────┬───────────┘
                                      │ (2) Read(after=cursor)  / replay(after=checkpoint)
                                      ▼
                            ┌────────────────────────────────┐
                            │   deliveryTailer per stream     │
                            │     → SubscriptionEventUpdater  │  (existing hooks + semaphore)
                            └─────────┬───────────────────────┘
                                      │ (3) UpdateSubscription(subID, data)  → WS/SSE write
                                      ▼
                            ┌────────────────────┐  confirm (write | ack)
                            │  CheckpointStore    │ ◀── Advance(subID, stream, offset)
                            │  per (identity,     │
                            │       stream)       │ ── MinConfirmed ──▶ GC/Truncate
                            └────────────────────┘

                         PUBLISH (mutation side)

  GraphQL mutation ─▶ Enqueue(OutboxLog)  ─▶ [return success to client]
                                  │
                                  ▼ (background publisher worker)
                          adapter.Publish() ─▶ Broker ─▶ Done(OutboxLog)

  RECOVERY (restart): for each stream → replay tailers from min checkpoint,
                      reconcile broker consumer to WAL head, dedupe on EventID.
```

---

## 12. Considerations and Risks

- **Write amplification.** Every event is now written at least twice: once into the WAL
  (and fsynced), and once out to each socket. With the `sql`/`redis` backends it is also a
  network write. For high-volume, low-value streams this can dominate cost. *Mitigation:*
  per-field opt-in (§10.1), `interval`/batched fsync, and keeping the feature off by default.

- **Disk I/O as a new bottleneck.** The WAL append (and especially fsync) can become the
  throughput ceiling. A single SSD fsync is ~0.1–1ms; with `per_batch` over 10k-record
  Kafka fetches this amortizes well, but `always` will throttle hard. *Mitigation:* the
  fsync policy knob (§4.2) is the explicit dial; we publish a benchmark matrix.

- **fsync vs throughput is a genuine, unavoidable trade-off.** `interval` mode weakens the
  guarantee to "at-least-once within the fsync window." We must document that `interval`
  trades a small loss window for throughput, and that only `per_batch`/`always` give the
  full guarantee.

- **The router becomes stateful (the big one).** Today the router is effectively stateless
  and trivially horizontally scalable. The WAL turns it into a stateful service: it needs
  durable local disk (embedded) or a shared store, careful drain on shutdown, sticky
  routing or leader election, capacity planning, and backup/restore thinking. This is a real
  operational burden and the single biggest cost of this design. We mitigate by making it
  opt-in, defaulting to embedded (no new infra), and documenting topologies clearly.

- **Duplicate delivery on recovery (idempotency).** At-least-once means clients WILL see
  duplicates after a crash (everything between last checkpoint and crash is replayed).
  Consumers must dedupe on `wal_offset`/`EventID`. We surface both on every delivered event
  and document the contract prominently.

- **Checkpoint store as SPOF.** If the checkpoint store is corrupted or lost, subscriptions
  cannot determine resume points and fall back to "replay from oldest retained" (safe but
  duplicate-heavy) or "start from head" (lossy). *Mitigation:* checkpoints are crash-safe
  (bbolt txn / SQL row / Redis with AOF); embedded checkpoints share the WAL's fate, so a
  lost node loses both consistently rather than diverging.

- **GC correctness.** Truncating past any live (or TTL-pinned) subscription's checkpoint
  silently loses owed data — the worst possible failure. This invariant gets dedicated
  property/fuzz tests, and GC computes `MinConfirmed` conservatively (a not-yet-expired
  disconnected sub *pins* the log).

- **Ordering under recovery.** The existing 5s-timeout abandonment
  (`subscription_event_updater.go:69`) can already reorder; with the WAL, a redelivered
  range is replayed in offset order, so the *durable* order is well-defined even if the
  legacy in-memory path was not. We treat WAL offset order as the canonical order.

- **Memory vs disk for hot path.** We keep a small in-memory tail cache of recent WAL
  records per stream so steady-state delivery does not hit disk for reads (only appends
  fsync). Reads only touch disk on replay/reconnect.

- **Non-durable provider floor.** For Redis/core NATS, events in flight in the broker at
  crash time (before `Append`) are irrecoverable — there is no source to replay from. This
  design shrinks that window from "the entire pipeline" to "a single fsync," but cannot
  eliminate it without broker durability. This is honestly the floor of what is physically
  possible for those providers.

---

## 13. Migration / rollout & backward compatibility

1. **Phase 0 — feature flag, default off.** Ship the `durable` package, interfaces, and the
   `embedded` backend behind `events.delivery.enabled=false`. With it off, the code path is
   exactly today's `updater.Update(...)` — zero behavioral change, zero new dependencies,
   no schema change required.
2. **Phase 1 — embedded WAL, write-confirm, single-node.** Enable for opt-in streams
   (§10.1) on single-replica / sticky deployments. Delivers restart survival immediately.
   No client changes needed.
3. **Phase 2 — outbox.** Turn on publish-after-commit for mutations. Independent of the
   subscription-side WAL and separately gated.
4. **Phase 3 — shared-store backends + leader election.** For multi-replica fungibility.
5. **Phase 4 — ack-confirm protocol + durable resume IDs.** Closes last-mile loss; requires
   client SDK support, so it ships last and stays optional.

**Backward compatibility guarantees:**

- Absent `events.delivery` block ⇒ identical behavior to today (at-most-once).
- The `delivery` SDL argument is optional and additive; existing schemas compose unchanged.
- The `SubscriptionEventUpdater` interface is extended (new `UpdateFromWAL`) but the old
  `Update` remains the path when WAL is disabled, so existing adapters and hooks are
  unaffected when the feature is off.
- Existing `OnReceiveEvents` / `OnPublishEvents` / `SubscriptionOnStart` module hooks run
  unchanged in both modes.

---

## 14. Why this over the alternatives

This RFC is one of several. The defining claim of variant C is: **own the durability in the
router.** The contrast:

- **vs. broker-native durability (lean on Kafka/JetStream).** Provider-specific and deeply
  uneven: it does **nothing** for Redis PubSub or core NATS, which have no durability to
  configure, and its retention is a broker-controlled time/size window rather than a
  per-subscription guarantee. It also leaves restart-survival dependent on each broker's
  consumer semantics, which differ. Our WAL gives **one** guarantee, configured **one** way,
  that behaves identically across all three providers — including the two that otherwise
  have nothing.

- **vs. a client-ack protocol alone.** An ack/replay protocol over WS/SSE can close
  last-mile loss, but on its own it does **not survive a router restart**: if the router
  crashes, the un-acked events are gone because they were never persisted anywhere the
  router controls. Acks are necessary *only* for the last mile, and in our design they are
  an optional layer **on top of** durable WAL state — the durability does the heavy lifting,
  the ack closes the final gap. A protocol-only design has no answer for "the router that
  held my events restarted."

- **vs. a separate delivery-manager / sidecar layer.** Factoring delivery into an external
  service is essentially relocating this same WAL+checkpoint design into another process,
  adding a network hop and a second deployable while keeping all the same statefulness
  problems. Putting the WAL *inside* the router keeps the consume→persist→ack sequence
  local and atomic (no "appended to manager but crashed before broker ack" cross-process
  window), reuses the existing `SubscriptionEventUpdater` fan-out and hook machinery
  verbatim, and avoids operating a second tier.

The honest cost is real and stated plainly in §12: the router becomes stateful, and disk
I/O / fsync become first-order concerns. But this is the **only** option that delivers a
**uniform, provider-independent, restart-surviving** at-least-once guarantee — including for
the ephemeral providers where every other approach simply gives up. For a federation
gateway that already abstracts heterogeneous subgraphs, abstracting heterogeneous broker
durability behind one router-owned guarantee is the architecturally consistent choice.
