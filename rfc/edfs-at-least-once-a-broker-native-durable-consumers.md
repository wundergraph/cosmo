# RFC EDFS At-Least-Once Delivery via Broker-Native Durable Consumers (commit-on-deliver)

- **Author:** automated RFC workflow
- **Status:** Draft
- **Date:** 2026-05-28
- **RFC family:** EDFS / Cosmo Streams at-least-once delivery (RFC A of 4)

## Abstract

Cosmo Streams (EDFS) is fire-and-forget today. Each provider adapter consumes from a broker and immediately considers the event "done" — NATS JetStream calls `msg.Ack()` the instant `updater.Update()` returns (`router/pkg/pubsub/nats/adapter.go:154`), Kafka resets its offset to `now()` on every subscribe and never commits (`router/pkg/pubsub/kafka/adapter.go:147`), and Redis uses ephemeral `PSubscribe` with no acknowledgement at all (`router/pkg/pubsub/redis/adapter.go:99`). The consequence is at-most-once delivery: any failure between the broker and the client's WebSocket frame silently drops the event. This RFC proposes pushing durability **down to each broker's native consumer primitives** and inverting the acknowledgement: the router becomes a careful consumer that commits/acks an upstream position **only after** the event has been written to the wire for every (or each) client subscription that should receive it. The broker is the durable log; the router defers acknowledgement until delivery is confirmed. This gives at-least-once with no new router-side persistence, no new wire protocol, and no new delivery-manager service — at the cost of head-of-line blocking, broker resource pressure (`MaxAckPending`, PEL growth), and a real behavioural change for the Redis provider (PubSub → Streams).

---

## 1. Problem statement

The EDFS delivery path today is:

```
Broker → provider adapter (poll/fetch/subscribe goroutine)
       → updater.Update(events)                                 // SubscriptionEventUpdater.Update()
       → per-subscription hook execution (OnReceiveEvents)       // semaphore-bounded, MaxConcurrentHandlers
       → resolve.SubscriptionUpdater.UpdateSubscription(subID, data)
       → WebSocket / SSE / multipart write
```

At every provider, the upstream position is advanced **before** anything is known about whether the client received the event:

- **NATS JetStream.** `createOrUpdateDurableConsumer()` builds a durable consumer, `FetchNoWait(300)` pulls a batch, and the goroutine calls `updater.Update([]StreamEvent{...})` followed *immediately* by `msg.Ack()` (`router/pkg/pubsub/nats/adapter.go:146-158`). Because `Update()` is asynchronous with respect to client delivery (it fans out to N subscriptions under a semaphore, and on timeout it *abandons* in-flight updaters — see `subscription_event_updater.go:69-80`), the ack races ahead of delivery. Even on a durable JetStream stream, the effective guarantee is at-most-once: once acked, JetStream will never redeliver, so a client disconnect or a hook timeout loses the event permanently.

- **Kafka.** `Subscribe()` creates a fresh `kgo.Client` per subscription with `ConsumeResetOffset(NewOffset().AfterMilli(time.Now().UnixMilli()))` (`router/pkg/pubsub/kafka/adapter.go:147`). There is no consumer group and no offset commit anywhere in `topicPoller()`. The adapter explicitly replicates "a stateless publish-subscribe model" (comment at line 144-146). On router restart or client reconnect, consumption restarts from `now()`, so every event produced during the gap is lost, and there is no way to replay.

- **Redis.** `Subscribe()` uses `conn.PSubscribe(ctx, channels...)` (`router/pkg/pubsub/redis/adapter.go:99`). Redis PubSub is pure fan-out with zero persistence: if no subscriber is connected when a message is published, it is gone. There is no acknowledgement, no offset, no replay.

The failure points are well understood:

| Event | Kafka | NATS Core | NATS JetStream (today) | Redis PubSub |
|---|---|---|---|---|
| Client disconnect mid-delivery | event lost | event lost | acked → lost | event lost |
| Router restart | restart at `now()`, gap lost | lost | acked msgs gone, un-acked redelivered | lost |
| Reconnect | new offset `now()`, gap | new sub, gap | new durable, may replay un-acked | new sub, gap |
| Hook timeout (updater abandoned) | acked-equivalent → lost | lost | acked → lost | lost |

We want **at-least-once**: once an event is accepted by the broker and a matching subscription exists (or reconnects within the redelivery window), the router must keep trying to deliver it until delivery is confirmed.

---

## 2. Definitions

**At-least-once (the guarantee this RFC provides).** For every event accepted by the broker on a subscribed subject/topic/channel, the router will deliver it to each eligible client subscription **one or more times**, provided the subscription (or a reconnecting successor of it, within the broker's redelivery window) remains alive. Duplicates are explicitly permitted. After a confirmed delivery the router advances the broker position so the event is not redelivered indefinitely.

**Not exactly-once.** This design does **not** provide exactly-once. The window between "wrote frame to socket" and "broker recorded the ack" is non-atomic; a crash in that window causes redelivery on restart. Consumers **must be idempotent.** Every EDFS event already carries the entity `__typename` + key (`{"__typename":"Employee","id":1}`), which is a natural idempotency key; we recommend consumers dedupe on it. We will document this prominently.

**Delivery boundary — what counts as "delivered".** There are three candidate boundaries:

1. **Frame written to the WebSocket/SSE buffer** (router hands bytes to the engine's `SubscriptionUpdater`).
2. **TCP-flushed to the OS socket** (bytes left the router's userspace, kernel send buffer accepted them).
3. **Client application-level ack** (the client sends back a "got it" message).

**We pick boundary (2): a successful, flushed write to the client transport.** Boundary (3) requires a new wire protocol (that is the *client-ack* sibling RFC, which we deliberately reject — see §11) and is impossible for `graphql-ws`/`graphql-transport-ws`/SSE which are unidirectional push today (`router/core/websocket.go`). Boundary (1) is too weak: a buffered-but-never-flushed frame on a dead connection would be acked, reintroducing loss. Boundary (2) is the strongest guarantee achievable **without changing the client contract**, and it is exactly the boundary where the broker's own redelivery semantics line up: "I put the bytes on the wire, I commit; if I crash before committing, the broker redelivers." A flush failure (closed/broken socket) is treated as **not delivered** → no ack → broker redelivers to a reconnecting consumer.

We define a small result type the engine returns up the stack:

```go
// DeliveryResult is reported per subscription, per event batch.
type DeliveryResult struct {
    SubID     resolve.SubscriptionIdentifier
    Delivered bool   // true iff the frame was flushed to the client transport
    Err       error  // non-nil on transport error / closed connection
}
```

---

## 3. Proposed design

### 3.1 Core mechanism: invert the ack

Today `Update()` returns `void` and the adapter acks blindly. We make `Update()` **return a per-event delivery confirmation**, and we thread that confirmation back to the adapter so it can decide whether to ack the broker position.

We introduce an `Ackable` abstraction the adapter attaches to each consumed message, and a delivery-confirmation callback threaded through `SubscriptionEventUpdater`.

```go
// datasource/ack.go (new)

// Ackable is implemented per provider over the broker's native primitive:
//   - NATS JetStream: wraps jetstream.Msg (Ack / Nak / Term / InProgress)
//   - Kafka:          wraps an offset cursor for (topic, partition, offset)
//   - Redis Streams:  wraps a stream entry ID for XACK
type Ackable interface {
    Ack(ctx context.Context) error      // commit the upstream position (delivered)
    Nak(ctx context.Context) error      // negative-ack: redeliver soon
    Term(ctx context.Context) error     // terminate: never redeliver (poison message)
    InProgress(ctx context.Context) error // extend the redelivery deadline (AckWait/visibility)
}

// AckableEvent couples a StreamEvent with the broker handle that must be
// committed only after delivery is confirmed.
type AckableEvent struct {
    Event StreamEvent
    Ack   Ackable
}
```

`SubscriptionEventUpdater.Update` is replaced by an ack-aware variant. The existing `Update([]StreamEvent)` is retained for at-most-once providers/configs (backward compatible), and a new method is added:

```go
// datasource/subscription_event_updater.go (modified)

type SubscriptionEventUpdater interface {
    Update(events []StreamEvent)                              // existing, at-most-once path
    UpdateAckable(batch []AckableEvent) BatchDeliveryReport   // NEW, at-least-once path
    Complete()
    Done()
    SetHooks(hooks Hooks)
}

// BatchDeliveryReport tells the adapter, per event, whether every eligible
// subscription confirmed delivery (per the fan-out policy in §5).
type BatchDeliveryReport struct {
    // Confirmed[i] is true iff event i satisfied the configured fan-out ack
    // policy (e.g. all live subscriptions flushed it). Index aligns with batch.
    Confirmed []bool
    // Poison[i] is true iff event i must be Term()'d (see §9 poison handling).
    Poison []bool
}
```

The engine resolver's `resolve.SubscriptionUpdater` gains a delivery-reporting write. Today `UpdateSubscription(subID, data)` returns nothing; we extend the engine boundary so the WS/SSE writer reports flush success:

```go
// graphql-go-tools resolve.SubscriptionUpdater (extended)
type SubscriptionUpdater interface {
    // ... existing ...
    // UpdateSubscriptionAck writes data to the subscription and returns
    // whether the frame was flushed to the client transport (boundary 2).
    UpdateSubscriptionAck(id SubscriptionIdentifier, data []byte) (delivered bool)
}
```

In `router/core/websocket.go`, the WS protocol writers (`graphql-ws` / `graphql-transport-ws`) and the SSE/multipart writers return the result of their flush. A `nil` error from the underlying `bufio`/`http.Flusher` write+flush ⇒ `delivered = true`; a broken-pipe / context-cancelled error ⇒ `delivered = false`.

### 3.2 Where the ack moves — `subscription_event_updater.go`

The new `UpdateAckable` reuses the existing semaphore-bounded fan-out but **collects** per-subscription delivery results instead of discarding them, then applies the fan-out ack policy (§5) and acks/naks each event's `Ackable`.

```go
func (s *subscriptionEventUpdater) UpdateAckable(batch []AckableEvent) BatchDeliveryReport {
    subscriptions := s.eventUpdater.Subscriptions()
    nSubs := len(subscriptions)

    // Per-event delivery tallies across all subscriptions.
    type tally struct{ live, delivered int; hardErr bool }
    tallies := make([]tally, len(batch))
    var mu sync.Mutex

    events := make([]StreamEvent, len(batch))
    for i := range batch {
        events[i] = batch[i].Event
    }

    updaterCtx, cancel := context.WithDeadline(context.Background(), time.Now().Add(s.timeout))
    defer cancel()

    wg := sync.WaitGroup{}
    for subCtx, subID := range subscriptions {
        if err := s.semaphore.Acquire(updaterCtx, 1); err != nil {
            break
        }
        wg.Add(1)
        go func(subCtx context.Context, subID resolve.SubscriptionIdentifier) {
            defer wg.Done()
            defer s.semaphore.Release(1)
            // run OnReceiveEvents hooks (unchanged), then deliver per event
            delivered := s.deliverToSubscription(subCtx, updaterCtx, subID, events)
            mu.Lock()
            for i := range batch {
                tallies[i].live++
                if delivered[i] {
                    tallies[i].delivered++
                }
            }
            mu.Unlock()
        }(subCtx, subID)
    }
    wg.Wait()

    // Apply fan-out ack policy (§5): default ack-after-all-live.
    report := BatchDeliveryReport{
        Confirmed: make([]bool, len(batch)),
        Poison:    make([]bool, len(batch)),
    }
    for i := range batch {
        report.Confirmed[i] = tallies[i].live > 0 && tallies[i].delivered == tallies[i].live
        // if there are zero live subscriptions, see §5 "no subscribers" rule
    }
    return report
}

// deliverToSubscription runs hooks then writes each event, returning a
// per-event delivered[] using UpdateSubscriptionAck (boundary 2).
func (s *subscriptionEventUpdater) deliverToSubscription(
    subCtx, updaterCtx context.Context,
    subID resolve.SubscriptionIdentifier,
    events []StreamEvent,
) []bool {
    delivered := make([]bool, len(events))
    out := events
    var err error
    for i := range s.hooks.OnReceiveEvents.Handlers {
        out, err = s.hooks.OnReceiveEvents.Handlers[i](subCtx, updaterCtx, s.subscriptionEventConfiguration, s.eventBuilder, out)
        if err != nil {
            break
        }
    }
    if err != nil {
        s.eventUpdater.CloseSubscription(subID)
        return delivered // all false → not delivered → broker will redeliver
    }
    for i, event := range out {
        if event == nil {
            // hook dropped/filtered this event: treat as delivered for this
            // subscription (the consumer deliberately chose not to receive it).
            delivered[i] = true
            continue
        }
        delivered[i] = s.eventUpdater.UpdateSubscriptionAck(subID, event.GetData())
    }
    return delivered
}
```

Key semantics: a hook that **filters out** an event (returns `nil`/drops it) counts as "delivered" for that subscription — the consumer intentionally declined it, so the broker position may advance. A hook **error** closes the subscription and reports `delivered=false`, leaving the event un-acked for redelivery to other/future subscribers.

### 3.3 NATS JetStream

We already build durable pull consumers. We change the consumer config to **explicit ack** and move the ack to after delivery.

```go
// nats/adapter.go createOrUpdateDurableConsumer (modified)
consumerConfig := jetstream.ConsumerConfig{
    Durable:        durableConsumerName,
    FilterSubjects: subConf.Subjects,
    AckPolicy:      jetstream.AckExplicitPolicy,                // was implicit-ish
    AckWait:        subConf.StreamConfiguration.AckWait,        // e.g. 30s; redelivery deadline
    MaxAckPending:  subConf.StreamConfiguration.MaxAckPending,  // e.g. 1024; flow control
    MaxDeliver:     subConf.StreamConfiguration.MaxDeliver,     // e.g. 5; then Term/DLQ
}
```

The fetch loop wraps each `jetstream.Msg` in an `Ackable` and acks **only** on confirmation:

```go
msgBatch, err := consumer.Fetch(int(maxAckPending)) // bounded by MaxAckPending
// ... build AckableEvents ...
batch := make([]datasource.AckableEvent, 0, len(msgs))
for _, msg := range msgs {
    batch = append(batch, datasource.AckableEvent{
        Event: &Event{evt: &MutableEvent{Data: msg.Data(), Headers: ...}},
        Ack:   &jsAckable{msg: msg},
    })
}

report := updater.UpdateAckable(batch)

for i, msg := range msgs {
    switch {
    case report.Poison[i]:
        _ = msg.Term()       // never redeliver poison
    case report.Confirmed[i]:
        _ = msg.Ack()        // delivered to all live subs → commit
    default:
        _ = msg.Nak()        // not (yet) delivered → redeliver after backoff
    }
}
```

```go
// jsAckable adapts a jetstream.Msg to datasource.Ackable
type jsAckable struct{ msg jetstream.Msg }
func (a *jsAckable) Ack(context.Context) error        { return a.msg.Ack() }
func (a *jsAckable) Nak(context.Context) error        { return a.msg.Nak() }
func (a *jsAckable) Term(context.Context) error       { return a.msg.Term() }
func (a *jsAckable) InProgress(context.Context) error { return a.msg.InProgress() }
```

- **`AckWait`**: if the router crashes (or a hook stalls) before acking, JetStream redelivers after `AckWait`. The fan-out goroutine calls `msg.InProgress()` periodically for long hook runs to avoid premature redelivery (this replaces the silent "abandon the updater" behaviour at `subscription_event_updater.go:69`).
- **`MaxDeliver` + `Term`**: after `MaxDeliver` attempts we `Term()` the message and route it to a dead-letter subject (see §9). This prevents an undeliverable poison message from blocking the consumer forever.
- **`MaxAckPending`**: caps the number of un-acked (in-flight) messages, providing natural back-pressure. We set the `Fetch` size to track it.

The Core NATS path (`ChanSubscribe`, no `StreamConfiguration`) **cannot** offer at-least-once — Core NATS has no durability. It remains at-most-once; requesting `at_least_once` on a Core NATS subject is a config error at startup (§6).

### 3.4 Kafka

We replace the per-subscribe stateless client with a **consumer group** and commit offsets after delivery.

```go
// kafka/adapter.go Subscribe (modified)
client, err := kgo.NewClient(append(opts,
    kgo.ConsumeTopics(subConf.Topics...),
    kgo.ConsumerGroup(p.groupID(subConf)),          // NEW: stable group id (see §3.4.1)
    kgo.DisableAutoCommit(),                         // NEW: we commit manually after deliver
    kgo.RequireStableFetchOffsets(),
    // NO ConsumeResetOffset(AfterMilli(now)) — group offsets define start position;
    // first-ever start uses kgo.ConsumeResetOffset(NewOffset().AtStart()/AtEnd()) per config.
)...)
```

The poller commits **per partition, in offset order**, only up to the highest contiguous delivered offset:

```go
func (p *ProviderAdapter) topicPoller(ctx context.Context, client *kgo.Client, updater datasource.SubscriptionEventUpdater, opts PollerOpts) error {
    for {
        fetches := client.PollRecords(p.ctx, maxInFlight)
        // ... error handling unchanged ...

        // Group records by (topic, partition) to preserve per-partition ordering.
        byPart := groupByPartition(fetches) // map[tp][]*kgo.Record, each slice offset-ordered

        for tp, records := range byPart {
            batch := make([]datasource.AckableEvent, len(records))
            for i, r := range records {
                batch[i] = datasource.AckableEvent{
                    Event: &Event{evt: &MutableEvent{Data: r.Value, Headers: hdrs(r), Key: r.Key}},
                    Ack:   &kafkaCursor{record: r},
                }
            }
            report := updater.UpdateAckable(batch)

            // Commit only the highest *contiguous* delivered offset (the gap problem).
            commitUpTo := -1
            for i := range records {
                if report.Poison[i] {
                    p.deadLetter(tp, records[i]) // route poison aside, treat as committable
                    commitUpTo = i
                    continue
                }
                if !report.Confirmed[i] {
                    break // stop at first gap; everything after waits for redelivery
                }
                commitUpTo = i
            }
            if commitUpTo >= 0 {
                client.CommitRecords(p.ctx, records[:commitUpTo+1]...)
            }
            // Records after the gap are NOT committed; next poll re-fetches them
            // (we seek the partition back to commitUpTo+1) → redelivery.
            if commitUpTo+1 < len(records) {
                p.seekPartition(client, tp, records[commitUpTo+1].Offset)
            }
        }
    }
}
```

**The gap problem.** Kafka offsets are a single monotonic cursor per partition; you cannot ack offset 7 while leaving offset 5 un-acked. So we commit only the **longest contiguous prefix** of delivered offsets and rewind the partition to the first undelivered offset, accepting that everything after a gap is redelivered. This is the price of Kafka's commit model and is the main source of duplicates under partial failure (§9).

#### 3.4.1 Partition assignment & group identity

The group id must be **stable across restarts** (so offsets survive a restart) yet **distinct per router-side logical subscription set** so that two unrelated GraphQL subscriptions don't steal each other's partitions. We derive it like the NATS durable name: `cosmo.<providerId>.<hash(rootField, topics, streamConfig)>`. Within a multi-replica router deployment, all replicas sharing the same logical subscription join the **same** group → Kafka's group coordinator distributes partitions across replicas (competing consumers). This is desirable for throughput but has fan-out consequences (§5, §9).

### 3.5 Redis — PubSub → Streams (behavioural change)

Redis PubSub has no durability, full stop. To offer at-least-once we **migrate the Redis provider from `PSubscribe` to Redis Streams + consumer groups.** This is a deliberate, called-out behaviour change.

- **Publish** changes from `PUBLISH channel data` to `XADD channel * data <json>`.
- **Subscribe** changes from `PSubscribe` to a consumer-group reader:

```go
// redis/adapter.go Subscribe (rewritten for Streams)
group := p.groupName(subConf)          // stable, like Kafka group id
consumer := p.consumerName(subConf)    // per-replica unique
for _, ch := range subConf.Channels {
    // MKSTREAM creates the stream lazily; group starts at "$" (new) or "0" (replay) per config
    _ = p.conn.XGroupCreateMkStream(ctx, ch, group, "$")
}

for {
    // 1) claim entries this consumer already owns but hasn't acked (redelivery after crash)
    //    via XAUTOCLAIM, then 2) read new entries with ">".
    autoClaimed := p.conn.XAutoClaim(ctx, &redis.XAutoClaimArgs{
        Stream: ch, Group: group, Consumer: consumer, MinIdle: idleTimeout, Start: "0",
    })
    res := p.conn.XReadGroup(ctx, &redis.XReadGroupArgs{
        Group: group, Consumer: consumer, Streams: []string{ch, ">"},
        Count: maxInFlight, Block: blockTimeout,
    })

    batch := toAckableBatch(autoClaimed, res) // Ackable wraps (stream, group, entryID) for XACK
    report := updater.UpdateAckable(batch)

    var ackIDs []string
    for i, e := range batch {
        if report.Confirmed[i] || report.Poison[i] {
            ackIDs = append(ackIDs, entryID(e))  // XACK removes from PEL
            if report.Poison[i] { p.deadLetter(ch, e) }
        }
        // un-confirmed entries stay in the PEL → reclaimed by XAUTOCLAIM later
    }
    if len(ackIDs) > 0 {
        p.conn.XAck(ctx, ch, group, ackIDs...)
    }
}
```

- The **Pending Entries List (PEL)** is Redis Streams' equivalent of un-acked JetStream messages. `XACK` removes a delivered entry; anything left in the PEL is reclaimed via `XAUTOCLAIM` after `MinIdle`, giving crash redelivery.
- We must bound stream growth with `XADD ... MAXLEN ~ N` or rely on consumer acks + a trimming policy (§9).

---

## 4. (folded into §3) — the ack/commit threading

Summarised: the single new contract is `Ackable` + `AckableEvent` + `UpdateAckable` → `UpdateSubscriptionAck`. Each provider implements `Ackable` over its native primitive (JetStream `Msg`, Kafka offset cursor, Redis stream entry id). No router-side log is introduced; the broker *is* the log.

---

## 5. The fan-out problem

One broker consumer feeds **N** router-side GraphQL subscriptions (the engine deduplicates identical subscriptions, so a single durable consumer / consumer group / Redis group serves all clients subscribed to the same field+config). A single message therefore has N delivery outcomes but only **one** broker ack. Three candidate policies:

**(a) Ack-after-all-live (CHOSEN default).** Ack the message only when every currently-live subscription has confirmed delivery (boundary 2). If any live subscription fails to flush, `Nak`/leave-pending → redeliver. Clients that *did* receive it will get a duplicate on redelivery (acceptable — at-least-once). "Live" is snapshotted at fan-out time; a subscription that connects *after* the ack simply doesn't receive that already-acked event (it gets everything from its join point forward, exactly like today). **No subscribers at all:** if there are zero live subscriptions for a durable consumer, the message stays pending and is redelivered until either a subscriber appears (within the redelivery window / stream retention) or `MaxDeliver` is hit. This is the behaviour customers asking for at-least-once actually want: "don't drop my event just because the client was reconnecting."

**(b) Ack-after-each via per-subscription cursors.** Give each subscription its own broker consumer position. Eliminates the duplicate-to-already-delivered-clients problem and removes head-of-line coupling between subscriptions. **Rejected as default** because it means one durable JetStream consumer / Kafka group / Redis group **per client subscription**, which explodes broker-side state (JetStream `MaxAckPending` × clients, Kafka partitions can't exceed consumers usefully, Redis PEL per consumer). For high-fan-out subscriptions (thousands of clients on one field) this is untenable. We expose it as an opt-in mode `fanout: per_subscription` for low-fan-out, high-value streams.

**(c) One-consumer-per-subscription** is the extreme of (b) and shares its costs; not offered separately.

**Justification for (a).** It keeps broker-side consumer count proportional to the number of *distinct subscriptions* (field+config), not the number of *clients* — matching today's dedup model. The scaling cost is bounded by `MaxAckPending` (the in-flight window) rather than by client count. The trade-off is **head-of-line blocking**: one slow/stuck client holds the message pending and can stall the consumer up to `MaxAckPending`. We mitigate with a per-subscription **delivery deadline** — if a single subscription doesn't confirm within `deliverTimeout`, we `CloseSubscription(subID)` it (kick the slow client) and count it as not-live, so the rest of the fan-out can ack. A repeatedly-slow client is thus sacrificed to protect the stream, which is the correct priority for at-least-once semantics.

```yaml
# scaling cost summary
fanout: ack_after_all   # default: broker consumers ∝ distinct subscriptions; head-of-line risk
fanout: per_subscription # opt-in: broker consumers ∝ client count; no head-of-line; expensive
```

---

## 6. Configuration & schema surface

### 6.1 Router config (`config.yaml`)

A per-provider and per-subscription `deliveryGuarantee`. Default is `at_most_once` (today's behaviour) for full backward compatibility.

```yaml
version: "1"
events:
  providers:
    nats:
      - id: my-nats
        url: "nats://localhost:4222"
        deliveryGuarantee: at_least_once   # provider-level default
        atLeastOnce:
          ackWait: 30s
          maxAckPending: 1024
          maxDeliver: 5
          deadLetterSubject: "dlq.employeeUpdates"
          fanout: ack_after_all            # or per_subscription
          deliverTimeout: 10s              # kick a client that can't keep up
    kafka:
      - id: my-kafka
        deliveryGuarantee: at_least_once
        atLeastOnce:
          startOffset: latest              # first-ever start; group offsets win thereafter
          maxInFlight: 1024
          maxDeliver: 5
          deadLetterTopic: "employeeUpdates.dlq"
          fanout: ack_after_all
          deliverTimeout: 10s
    redis:
      - id: my-redis
        # IMPORTANT: at_least_once switches this provider from PubSub to Streams.
        deliveryGuarantee: at_least_once
        atLeastOnce:
          maxLen: 100000                   # XADD MAXLEN ~ trimming
          minIdle: 30s                     # XAUTOCLAIM reclaim threshold
          maxDeliver: 5
          deadLetterStream: "employeeUpdates.dlq"
          fanout: ack_after_all
          deliverTimeout: 10s
```

### 6.2 Directive / `streamConfiguration` additions

NATS already exposes `edfs__NatsStreamConfiguration { streamName, consumerName, consumerInactiveThreshold }` (`composition/src/v1/constants/directive-definitions.ts`). We extend it with at-least-once knobs so schema authors can opt in per field:

```graphql
input edfs__NatsStreamConfiguration {
  streamName: String!
  consumerName: String!
  consumerInactiveThreshold: Int! = 30
  # NEW
  deliveryGuarantee: edfs__DeliveryGuarantee = AT_MOST_ONCE
  ackWaitSeconds: Int = 30
  maxAckPending: Int = 1024
  maxDeliver: Int = 5
}

enum edfs__DeliveryGuarantee { AT_MOST_ONCE AT_LEAST_ONCE }
```

For Kafka and Redis (which currently take only `topics`/`channels` + `providerId`), the at-least-once configuration lives entirely in router config (§6.1), keyed by provider id + root field, because their `*Subscribe` directives have no stream-config block today and we prefer not to expand the SDL surface for them in v1. The serialized router config (`shared/src/router-config/graphql-configuration.ts`) gains an optional `deliveryGuarantee` and `atLeastOnce` block on the per-provider event configuration.

### 6.3 Defaults & backward compatibility

- Default everywhere: `at_most_once`. Existing schemas and configs behave **identically** to today; the new `UpdateAckable` path is never taken.
- Requesting `at_least_once` on **Core NATS** (a `@edfs__natsSubscribe` with no `streamConfiguration`) or any provider lacking durability is a **startup validation error** with a clear message.
- A schema-level `AT_LEAST_ONCE` overrides a provider-level `at_most_once` for that field (most-specific wins).

---

## 7. Reconnect & restart behavior

| Scenario | NATS JetStream | Kafka (consumer group) | Redis Streams |
|---|---|---|---|
| **Client disconnect mid-batch** | flush fails → not confirmed → message stays pending → redelivered after `AckWait` to whatever subscription is live (incl. the reconnecting client) | offset not committed for that record → re-fetched on next poll → redelivered | entry stays in PEL → reclaimed by `XAUTOCLAIM` → redelivered |
| **Client reconnects** | new subscription joins the **same** durable consumer; receives currently-pending + future messages | rejoins the **same** group; gets uncommitted offsets (redelivery) + new | new consumer in the **same** group; `XAUTOCLAIM` hands it pending entries + `>` gives new |
| **Router restart (single replica)** | durable consumer survives on the server; un-acked messages redelivered after `AckWait`; **no gap** | committed offsets survive in `__consumer_offsets`; resumes from last commit; **no gap** | PEL survives in Redis; `XAUTOCLAIM` reclaims on restart; **no gap** |
| **Router crash between flush and ack** | message redelivered (duplicate) | record re-fetched (duplicate) | entry reclaimed (duplicate) |
| **Multi-replica restart of one replica** | that replica's pending msgs redelivered; other replicas unaffected (each has its own durable name today — see §9 ordering caveat) | partitions reassigned by coordinator to surviving replicas; their uncommitted offsets redelivered | that consumer's PEL reclaimed by peers via `XAUTOCLAIM` |

The crucial change versus today: **the gap disappears.** Kafka no longer restarts at `now()`; Redis no longer loses everything; JetStream no longer pre-acks. The cost is duplicates in the crash window (§2: consumers must be idempotent).

---

## 8. Architecture diagram

```
                         BROKER  (the durable log)
   ┌──────────────────────────────────────────────────────────────────┐
   │ JetStream stream / Kafka partitions / Redis Stream                 │
   │   position advances ONLY on Ack/Commit/XACK                        │
   └───────────────▲───────────────────────────────────┬──────────────┘
                   │ Ack / Nak / Term                   │ Fetch / Poll / XREADGROUP
                   │ (after delivery confirmed)         │ (bounded by MaxAckPending /
                   │                                     │  maxInFlight / Count)
   ┌───────────────┴─────────────────────────────────────────────────────┐
   │ Provider Adapter (nats|kafka|redis/adapter.go)                        │
   │   wraps each msg → AckableEvent{Event, Ackable}                       │
   └───────────────┬─────────────────────────────────────────────────────┘
                   │ updater.UpdateAckable(batch) []AckableEvent
                   ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │ subscription_event_updater.go  (fan-out, semaphore-bounded)           │
   │   for each live subscription:                                         │
   │     OnReceiveEvents hooks → UpdateSubscriptionAck(subID,data)         │
   │   collect per-(event,sub) delivered bool                              │
   │   apply fan-out policy (ack_after_all | per_subscription)             │
   │   → BatchDeliveryReport{Confirmed[], Poison[]}                        │
   └───────────────┬───────────────────────────────────────▲─────────────┘
                   │ UpdateSubscriptionAck                   │ delivered bool
                   ▼                                         │ (= flush ok?)
   ┌─────────────────────────────────────────────────────────────────────┐
   │ resolve.SubscriptionUpdater → core/websocket.go                       │
   │   write + flush WS/SSE frame  ── boundary (2): flushed to transport   │
   └─────────────────────────────────────────────┬─────────────────────────┘
                                                  ▼
                                            CLIENT (graphql-ws / SSE)

   Confirmed[i]=true  → adapter Ack(i)  → broker advances position
   Confirmed[i]=false → adapter Nak(i)  → broker redelivers after AckWait/MinIdle
   Poison[i]=true     → adapter Term(i) → dead-letter, never redeliver
```

---

## 9. Considerations and Risks

**Head-of-line blocking.** Under `ack_after_all`, one stuck client holds a message pending and can stall the consumer up to `MaxAckPending` / `maxInFlight`. Mitigation: per-subscription `deliverTimeout` that closes the slow client and excludes it from the live set so the rest can ack. This trades client liveness for stream progress — the right call for at-least-once, but it means a chronically slow client gets disconnected. Document loudly.

**`MaxAckPending` / in-flight limits.** The in-flight window bounds throughput: with `AckWait=30s` and `MaxAckPending=1024`, sustained throughput is capped at ~`1024 / mean-delivery-latency` msgs/s per consumer. High-throughput streams need a larger window (more broker memory for the PEL/ack-pending tracking) or `fanout: per_subscription` to parallelise. There is a direct memory/throughput trade-off; we expose the knob rather than guessing.

**Redis provider semantics change.** Switching `at_least_once` flips Redis from PubSub to Streams. This changes: (1) publish is now `XADD` (entries persist and accumulate — requires `MAXLEN` trimming or memory grows unbounded), (2) late subscribers can see backlog (PubSub never did), (3) operational surface (RDB/AOF persistence now matters for the guarantee). Mixed deployments where some fields are `at_most_once` (PubSub) and some `at_least_once` (Streams) on the same Redis are supported but use different Redis data structures on different keys; we will namespace stream keys to avoid clashing with PubSub channel names.

**Multi-replica / competing consumers.** Kafka groups and Redis groups naturally load-balance partitions/entries across replicas. JetStream is the awkward one: today `getDurableConsumerName()` hashes in the **instance identifier** (`hostName-routerListenAddr`), so each replica has its **own** durable consumer and therefore each replica receives **all** messages independently — that is fine for fan-out (every client connected to any replica gets the event) but means at-least-once is *per replica*: a message is acked on replica A only when A's clients got it, independently of B. This is correct for delivery but breaks any notion of a single shared cursor. For Kafka/Redis the competing-consumers model means a given event is delivered to **one** replica's consumer and thus only to clients on **that** replica — which is wrong for broadcast fan-out. **Resolution:** for broadcast semantics, Kafka/Redis at-least-once must use a **per-replica group id** (mirroring NATS), so each replica independently consumes the full topic/stream and acks for its own clients. We therefore fold the replica identity into the group/consumer name for all three providers. The cost: N replicas = N× broker read load and N× storage of consumer/PEL state. This is the honest price of broadcast + durability.

**Ordering.** `ack_after_all` preserves per-partition/per-subject order on the happy path. On partial failure, Kafka rewinds to the first gap and redelivers a suffix → a client that already got offsets 5–7 sees 5–7 again before 8 (duplicates, but still non-decreasing). The abandoned-updater out-of-order hazard documented at `subscription_event_updater.go:69-80` is **eliminated** because we no longer advance past un-confirmed events. JetStream redelivery of a single pending message can interleave with newer messages — at-least-once does not promise global ordering, and we state that explicitly.

**Poison messages.** A message that no consumer can ever flush (e.g. it breaks a hook deterministically) would, without protection, redeliver forever and block the consumer. `MaxDeliver` caps attempts; on exceed we `Term()` (JetStream) / commit-past + copy aside (Kafka) / `XACK` + copy aside (Redis) into a dead-letter destination (`deadLetterSubject`/`deadLetterTopic`/`deadLetterStream`). This sacrifices the guarantee for genuinely-undeliverable messages, which is necessary for liveness.

**Memory/throughput cost.** Deferring acks keeps more state in the broker (JetStream ack-pending, Kafka uncommitted lag, Redis PEL). Throughput drops relative to fire-and-forget because the adapter now blocks on fan-out delivery before fetching the next window. Benchmarks must accompany rollout; we expect a measurable but acceptable hit for the streams that opt in.

**Engine boundary change.** `UpdateSubscriptionAck` requires a graphql-go-tools `resolve.SubscriptionUpdater` change to return flush success. This is the only cross-repo change and must be coordinated; we keep the existing `UpdateSubscription` for the at-most-once path so the change is additive.

---

## 10. Migration / rollout & backward compatibility

1. **Engine change first (additive).** Add `UpdateSubscriptionAck` to `resolve.SubscriptionUpdater` in graphql-go-tools, returning flush success from the WS/SSE writers in `router/core/websocket.go`. Existing `UpdateSubscription` untouched.
2. **datasource layer.** Add `Ackable`, `AckableEvent`, `UpdateAckable`, `BatchDeliveryReport`. The default `Update([]StreamEvent)` path is unchanged → zero behavioural change for current users.
3. **Per provider, behind config.** Implement `Ackable` + the commit-on-deliver loop in `nats/adapter.go`, then `kafka/adapter.go`, then `redis/adapter.go`. Each only activates when `deliveryGuarantee: at_least_once` is set.
4. **Config & SDL.** Add `deliveryGuarantee`/`atLeastOnce` to router config and `edfs__NatsStreamConfiguration`; serialize through `shared/src/router-config/graphql-configuration.ts`. Add startup validation (Core NATS rejection).
5. **Rollout.** Ship `at_most_once` as default. Customers opt in per provider/field. Provide a migration note for Redis (PubSub → Streams) including the `MAXLEN`/persistence implications. Roll out to a canary field, watch the new metrics (redelivery count, ack-pending depth, dead-letter rate, per-sub deliver latency), then widen.

**Backward compatibility:** total. No existing schema, config, or client changes are required to keep today's at-most-once behaviour; at-least-once is strictly opt-in and additive.

---

## 11. Why this over the alternatives

Three sibling RFCs propose: a **client-ack protocol** (extend graphql-ws so clients ack each message), a **router-side WAL** (persist in-flight events to local/remote storage and replay), and a **delivery-manager layer** (a new stateful service between adapters and clients tracking per-subscription delivery).

We bet on broker-native durability because **the durable log already exists** — JetStream, Kafka, and Redis Streams are purpose-built, battle-tested, horizontally-scalable durable logs with redelivery, retention, dead-lettering, and back-pressure baked in. Re-implementing any of that in the router is reinventing a worse wheel:

- **vs client-ack protocol:** requires changing every client and the wire protocol (`graphql-ws`/`graphql-transport-ws` are unidirectional push today; SSE/multipart literally cannot ack). It pushes the guarantee onto code we don't control and breaks every existing SDK. Our boundary (2) gives a strong guarantee with **zero** client changes.
- **vs router-side WAL:** introduces a brand-new durability subsystem in the router — fsync paths, compaction, its own crash-recovery, its own storage ops — duplicating exactly what the broker already does, and creating a second source of truth that must be reconciled with the broker on restart. We get crash recovery for free from the broker's own log.
- **vs delivery-manager layer:** a new stateful hop is a new failure domain, a new scaling axis, and a new thing to operate; it still needs a durable store underneath (so it collapses into the WAL approach) or it just moves the ack-deferral logic we propose into a separate process for no benefit.

Pushing durability to the broker means **the router stays stateless** (its core operational virtue), the guarantee is grounded in mature infrastructure customers already run, and the entire change is an *inversion of when we ack* plus per-provider plumbing — not a new subsystem. That is the smallest, most robust bet that delivers real at-least-once.
