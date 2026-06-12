# RFC: At-Least-Once for GraphQL Subscriptions — Broker-Native Ack Mapped to Client Delivery Confirmation (Pattern D)

**Status:** Draft

**TL;DR.**
Today EDFS is fire-and-forget by construction.
The one adapter that even tries durability — NATS JetStream — acks the broker message *unconditionally* after a delivery *attempt*,
so a message is acked even when the resolve failed, even when the client was mid-disconnect, and even when only some of the shared subscribers actually received it (Section 2.1, bugs #1–#4 in the dossier).
This RFC proposes the **minimal, surgical correctness fix**:
make the delivery pipeline *return a per-subscriber result* — `executeSubscriptionUpdate` → `handleTriggerUpdate` → the engine `SubscriptionUpdater.Update` → `datasource.SubscriptionEventUpdater.Update` → the broker adapter — so the adapter can `Ack` only when every (or a policy-quorum of) subscriber's **flush succeeded**, and `Nak`/redeliver otherwise.
The guarantee delivered is **at-least-once relative to flush success** (bytes handed to the kernel), *not* client receipt.
It requires **no wire-protocol or client change at all**.

The v1 scope is deliberately narrow: **NATS JetStream, no-hooks path only.**
It closes bug #2 and (under `policy: all`) bug #3 for the subscriber set present across a redelivery; it narrows bug #1.
Bug #4 (hooks abandonment) and Kafka are **explicitly deferred** — both require their own redesign (Sections 8.6, 6) and folding them into v1 would silently reintroduce the duplicate/reorder this RFC claims to fix.
Pattern D is the server-side substrate that Patterns A (client ack), B (cursor resume), and C (durable per-subscription) all build on.
Complexity for the JetStream-only / no-hooks slice: **M.** Full pattern (with hooks rework + Kafka cursor): **L.**

---

## 1. Title & Status

See heading above.
Pattern ID: **D**.
Pattern name: **Broker-Native Ack Mapped to Client Delivery Confirmation (Fix the Ack Timing)**.
Status: **Draft**.

**Engine version pin.** All `resolve.go` line numbers in this RFC are against **`github.com/wundergraph/graphql-go-tools/v2 v2.4.1`**, which is what `router/go.mod:34` pins (`go list -m` confirms `v2.4.1`).
An earlier draft cited `v2.1.1-0.20260504064838-5a00844995b5`; that was the wrong tag and every line number was off by a few — all re-derived below against `v2.4.1`.

---

## 2. Problem & Context

### 2.1 The gap, restated

An application can already have at-least-once *in its backend*.
Kafka has committed offsets, JetStream has durable consumers with explicit ack, Redis Streams has the Pending Entries List, SQS has visibility-timeout redelivery, RabbitMQ has manual `basic.ack`.
The broker will faithfully redeliver an un-acked message.
But Cosmo's EDFS pushes that event to the GraphQL client *fire-and-forget* and then tells the broker "done" regardless of what actually happened downstream.
So a client disconnect, a router restart, or a slow co-subscriber silently drops events that the broker was perfectly willing to redeliver.

The framework abstraction is fire-and-forget *by construction*.
The engine's `SubscriptionUpdater.Update(data []byte)` returns nothing (`resolve.go:1586`), and the `datasource.Adapter` boundary has no ack hook and no error channel back to the broker (dossier §2, `router/pkg/pubsub/datasource/provider.go:22-28`).
Durability is therefore a per-adapter property, not a property of EDFS — and only NATS JetStream attempts it.

### 2.2 The concrete current behavior (file:line anchors, v2.4.1)

The entire chain from broker callback to socket write is **one synchronous call stack** (dossier §1.3).
The NATS JetStream reader goroutine does this, verbatim, in `router/pkg/pubsub/nats/adapter.go:145-157`:

```go
updater.Update([]datasource.StreamEvent{
    &Event{evt: &MutableEvent{
        Data:    msg.Data(),
        Headers: map[string][]string(msg.Headers()),
    }},
})

// Acknowledge the message after it has been processed
ackErr := msg.Ack()
if ackErr != nil {
    log.Error("error acknowledging message", ...)
    return
}
```

`updater.Update(...)` returns **void**.
It blocks (synchronously, via `wg.Wait()`) until resolve + flush completes for every subscriber, then control returns and `msg.Ack()` runs *unconditionally*.

Two layers below, the engine `SubscriptionUpdater` contract is (`pkg/engine/resolve/resolve.go:1586`):

```go
type SubscriptionUpdater interface {
    // Update sends an update to the client. It is not guaranteed that the update is sent immediately.
    Update(data []byte)
    UpdateSubscription(id SubscriptionIdentifier, data []byte)
    Complete()
    Error(data []byte)
    Done()
    CloseSubscription(id SubscriptionIdentifier)
    Subscriptions() map[context.Context]SubscriptionIdentifier
}
```

`Update` returns nothing.
The concrete impl `subscriptionUpdater.Update` (`resolve.go:1479-1489`) is where the **serialization gate** lives, and it matters for this whole design (Section 4.6):

```go
// mu serves two roles:
//   1. Event serialization gate -- held across the entire Update() call including
//      wg.Wait(), ensuring event A fully completes before event B begins.
//   2. Lifecycle guard -- the done flag prevents callbacks after Done() ...
func (s *subscriptionUpdater) Update(data []byte) {
    s.mu.Lock()
    defer s.mu.Unlock()
    if s.done || s.ctx.Err() != nil { return }
    s.resolver.handleTriggerUpdate(s.triggerID, data)
}
```

Inside, `handleTriggerUpdate` (`resolve.go:1086`) fans out under a `sync.WaitGroup` and `wg.Wait()`s for all subscribers — a *perfect* place to collect per-subscriber results, except the result is currently discarded:

```go
subs, filterErrors := trig.filterSubscriptions(data)        // resolve.go:1095
for _, fe := range filterErrors {
    fe.sub.writeError(r.errorFormatter, fe.ctx, fe.err, fe.response)
}
var wg sync.WaitGroup
for _, sub := range subs {
    if sub.removed.Load() { continue }
    wg.Go(func() {
        r.executeSubscriptionUpdate(sub.ctx, sub, data)  // returns void today
    })
}
wg.Wait()
```

And `executeSubscriptionUpdate` (`resolve.go:616`) has the following terminal branches — **this is the crux of bug #1's misclassification, so read it carefully**:

| # | Branch | What it does to the writer | Does it `Flush()`? |
|---|---|---|---|
| 1 | `InitSubscription` fails (`:632-642`) | `sub.writeError(...)` → buffers a GraphQL error into `sub.writer` | **No** — `return` without flush |
| 2 | `LoadGraphQLResponseData` fails (`:645-655`) | `sub.writeError(...)` → buffers a GraphQL error | **No** — `return` without flush |
| 3 | `sub.removed` mid-flight (`:657-661`) | nothing | n/a (skipped) |
| 4 | `resolvable.Resolve` fails (`:663-674`) | `r.errorFormatter.WriteError(...)` → buffers a GraphQL error | **No** — `return` without flush |
| 5 | **Success path** (`:676-690`) | resolve OK, then `sub.writer.Flush()` (`:678`) | **Yes** — the one place a flush occurs |

The decisive fact (verified in `core/websocket.go:699-736` and `core/graphql_handler.go:378`): **`WriteError` / `writeError` write the error bytes into the writer's in-memory buffer (`rw.buf.Write`) — they do *not* flush to the socket.**
On WebSocket, the buffered payload only reaches the client when `websocketResponseWriter.Flush()` later calls `protocol.WriteGraphQLData`.
Branches 1/2/4 buffer an error and then `return` *without flushing* — so under the current code those buffered errors are **not actually delivered to the client** (they are overwritten/reset on the next event or dropped on teardown).

The single real delivery signal is therefore: **did `Flush()` get called and return `nil`?**
A successful flush means **bytes handed to the kernel/TCP buffer**, *not* an application ack from the client — this is the ceiling of Pattern D, and we state it loudly below.

### 2.3 The four bugs this RFC closes (dossier §2.1, Hop B)

1. **Ack gated on flush *attempt*, not client receipt.** Flush = bytes to kernel, not client receipt. *Narrowed, not fully closed — that is Pattern A's job.*
2. **Ack fires even when delivery failed.** A flush that errors (client mid-disconnect) tears down the subscription, yet `msg.Ack()` still runs. **Closed.**
3. **Multi-subscriber fan-out is acked-anyway.** One JetStream message fans to N shared subscribers; some flush, some fail; the single `msg.Ack()` acks the whole trigger. **Closed under `policy: all`, for the subscriber set present across the redelivery** — see the honest scope in Section 4.6 / Section 7. Not "closed unconditionally"; the trigger set is mutable and identity-free, which bounds the claim.
4. **Hooks path abandons and acks.** With `on_receive_events` hooks, on timeout the updater abandons in-flight deliveries (detached goroutines) and proceeds (`subscription_event_updater.go:65-78`), while JetStream still acks. **Deferred to a follow-up (Section 8.6)** — the abandonment is a detached-goroutine `select`, so it cannot synchronously produce a failure report, and naïvely mapping "timeout → Nak" reintroduces a duplicate+reorder. v1 **disallows** `mode: at_least_once` together with `on_receive_events` hooks.

### 2.4 What this builds on

This is the foundation pattern.
It is intentionally the smallest change that makes the ack *mean something*.
It does not touch the wire protocol, the client, the schema, or the proto.
Patterns A/B/C in the dossier all assume a delivery result exists at the adapter boundary; Pattern D is what creates it.

---

## 3. Goals & Non-Goals

### Goals

- Make broker ack/commit reflect **actual flush success per subscriber**, not a blind attempt.
- Close bug #2 outright; close bug #3 **under `policy: all`, scoped to the subscribers present across the redelivery** (Section 7); narrow bug #1.
- Introduce a **per-subscriber delivery result** that propagates engine → `SubscriptionEventUpdater` → `Adapter`, so each adapter can ack/nak correctly for *its* backend.
- Make the ack policy on a shared trigger explicit and configurable (`all` vs `quorum` vs `any`), because one broker message maps to N heterogeneous client outcomes — and make any silent minority loss under `quorum`/`any` **observable** (Section 8.8 metrics).
- Keep the change **opt-in** and **default-off** so existing deployments are byte-for-byte unchanged until they ask for it.

### The honest guarantee statement (replaces "strict upgrade / never worse")

We do **not** claim "never worse than today for everyone." That is false at the per-client level, and pretending otherwise is exactly the kind of mush this RFC must avoid. The precise claim is:

> **No event that is acked today is *lost* under Pattern D that today's code would deliver.**
> In exchange, on the enabled provider:
> - a **healthy, fast co-subscriber** sharing a trigger with a slow/dead subscriber may receive **duplicate events** (Section 4.6) and may be **stalled** for up to `nak_backoff × max_redeliveries` behind the serialization gate (Section 4.6) — this is observably *worse* for that client than today's silent drop of the slow client's event;
> - under `quorum`/`any`, the failed minority **still silently misses** the event (bug #3 for the minority), now made visible via a metric (Section 8.8).

"Strict upgrade" is true only at the *system* level under a specific value judgment: *a redelivered duplicate (and some added latency) is preferable to a silent drop.* Operators who do not share that judgment should leave `mode: off`.

### Non-Goals

- **Client receipt.** Flush ≠ receipt. End-to-end client-ack is Pattern A; this RFC does not add a client ack and is honest that a client crashing between TCP-buffer and processing still loses the message.
- **Replay / resume across reconnect.** No cursor, no `Last-Event-ID`. That is Pattern B.
- **Cross-router-restart durability per subscriber.** No per-subscriber durable consumer or external checkpoint store. That is Pattern C.
- **Wire-protocol / client changes.** None. Explicitly (Section 5).
- **Kafka in v1.** Kafka is **deferred**: it is groupless with no offset commit at all (`kafka/adapter.go:142-153`), so "commit a floor" is unimplementable without pulling in a consumer group — i.e. Pattern C territory. See Section 6.
- **The hooks (`on_receive_events`) path in v1.** Deferred; see Sections 2.3 #4 and 8.6.
- **Fixing the durable publish path.** The Cosmo NATS *publish* path uses **core NATS** even for stream-backed subjects (`nats/adapter.go:254`) and can drop a message before it ever reaches the stream. Pattern D only fixes the *consume* ack and assumes the event is durably in the stream. See Non-Goal note in Section 5.
- **Fixing the per-instance JetStream durable naming** (`nats/adapter.go:69-83`). That is HA-scope (Pattern C); we only *correctly ack* what the current consumer actually reads.
- **Exactly-once / dedup.** At-least-once means duplicates on redelivery; idempotency stays the client's responsibility (dossier §6.2).

---

## 4. Design — the mechanism in depth

### 4.1 The one idea

Today the call stack returns void at every layer.
Pattern D threads a **`DeliveryResult`** back up through exactly the layers it falls down through, so the broker reader that holds the message handle (JetStream `msg`) can make a real ack/nak decision.

```
                       (today: void)                         (Pattern D: returns DeliveryReport)
broker msg ──▶ adapter.Subscribe reader goroutine (one msg per loop iteration)
                  │  report := updater.Update([]StreamEvent{oneEvent})  ───────────────────────┐
                  ▼                                                                             │
            datasource.SubscriptionEventUpdater.Update(events)  ────────────────────────────┐  │
                  │  (no-hooks v1: events is length 1 → s.eventUpdater.Update)              │  │
                  ▼                                                                          │  │
            engine resolve.SubscriptionUpdater.Update(data)  ──────────────────────────┐   │  │
                  │  (holds subscriptionUpdater.mu across the whole call — §4.6)        │   │  │
                  ▼                                                                      │   │  │
            resolver.handleTriggerUpdate(id, data)                                      │   │  │
                  │  wg.Go( executeSubscriptionUpdate ) ; wg.Wait()                      │   │  │
                  ▼                                                                      │   │  │
            executeSubscriptionUpdate(sub) ─▶ Init / Load / Resolve / Flush             │   │  │
                  │  outcome keyed on WHETHER THE FLUSH SUCCEEDED, not on resolve        │   │  │
                  └── per-sub: Flushed | DeliveredError | DeliveryFailed | Skipped ──────┘   │  │
                      aggregated across all subs on the trigger ─────────────────────────────┘  │
                          one decision for this one broker message ──────────────────────────────┘
                              ▼
                  adapter decides: Ack | Nak(redeliver) | Term(poison)
```

The synchronization point already exists: `handleTriggerUpdate` already does `wg.Wait()`.
We are not making the *fan-out* more synchronous; we capture the result of work that already completes synchronously and return it.
The one genuinely new interaction — that this return value is consumed *after* the `subscriptionUpdater.mu` gate is released, and a Nak then stalls the per-trigger reader — is analyzed honestly in Section 4.6.

### 4.2 The delivery result type — corrected per critique #1

The critical fix versus the prior draft: the outcome is keyed on **whether `Flush()` succeeded**, not on whether resolve succeeded. A subgraph GraphQL error that is written *and flushed* to the client is a **successful delivery of an error payload** — it must be ack-able, not redelivered. Redelivering it would loop forever (the same subgraph error recurs) and poison a message that *was* delivered.

```go
// resolve package (graphql-go-tools)

type DeliveryOutcome uint8

const (
    // DeliveryFlushed: a data payload was written and Flush() returned nil. (success path, :676-690)
    DeliveryFlushed DeliveryOutcome = iota
    // DeliveredError: a GraphQL error payload was written AND flushed to the client without a
    // transport error. This is a *successful delivery of an error response* — it MUST be ack-able.
    // (Reserved for the future where branches 1/2/4 flush their buffered error; see note below.)
    DeliveredError
    // DeliveryFailed: the FLUSH ITSELF errored — bytes could not be handed to the socket
    // (client gone / write deadline). This is the ONLY true non-delivery. (:678 error return)
    DeliveryFailed
    // DeliverySkipped: sub was removed or filtered out before any write — not a failure, ack-able.
    DeliverySkipped
)

// SubscriberDelivery is the outcome for one subscriber of one update.
type SubscriberDelivery struct {
    Outcome DeliveryOutcome
    // Err carries the *transport* error for DeliveryFailed (flush error). It is NOT a GraphQL/resolve
    // error — a resolve error that was written to the buffer is not a transport failure.
    Err error
}

type DeliveryReport struct {
    Flushed   int
    Delivered int // DeliveredError count
    Failed    int
    Skipped   int
}
```

**Why `DeliveredError` and `DeliveryFailed` are split (the bug-#1 fix).**
The prior draft lumped "branch 4: `Resolve` failed" into `DeliveryFailed` → Nak. That is wrong: a subgraph returning a GraphQL error (nullability violation, auth error surfaced as a GraphQL error) is a *normal outcome*. Under `policy: all` the prior design would Nak, redeliver, hit the *same* error, and loop until `MaxDeliver` → Term/DLQ of a message that, in a corrected implementation, was delivered to every client as an error exactly once. The corrected rule:

> The question is **"did the flush succeed?"**, not **"did resolve succeed?"**
> A buffered-and-flushed error response = `DeliveredError` = **ack-able**.
> Only a `Flush()` that *itself errors* = `DeliveryFailed` = Nak.

**Important implementation honesty:** in the *current* `v2.4.1` engine, branches 1/2/4 buffer the error and `return` **without flushing** (Section 2.2). So today the client does not actually receive those errors at all. Pattern D must therefore make a deliberate engine choice, stated here as an open question (Section 12): either (a) **flush the buffered error before returning** on branches 1/2/4 (then classify the flush result as `DeliveredError` on success / `DeliveryFailed` on flush error) — which *also fixes the latent "buffered error never delivered" bug* — or (b) leave branches 1/2/4 as non-flushing and classify them as `DeliveryFailed` (no bytes ever left the router → genuinely not delivered → Nak is correct). Option (b) is simpler and is the v1 default; option (a) is the cleaner long-term behavior and is called out as the recommended follow-up. Either way, **branch 4 is no longer unconditionally `DeliveryFailed`-then-looped**: under (a) it acks; under (b) it Naks but because *nothing was delivered*, which is legitimate.

The corresponding contract crossing the `datasource` boundary (the adapter never imports the engine):

```go
// router/pkg/pubsub/datasource

type DeliveryReport struct {
    Flushed   int // includes DeliveredError under option (a)
    Failed    int
    Skipped   int
}

type Decision uint8

const (
    DecisionAck  Decision = iota // all good per policy → broker Ack
    DecisionNak                  // at least one required subscriber's FLUSH failed → redeliver
    DecisionTerm                 // redelivery budget exhausted → terminate/DLQ
)
```

Per critique #14, identity (`SubscriptionIdentifier`) is **not** carried across the `datasource` boundary, because the adapter makes exactly one ack decision for the whole trigger and never needs per-subscriber identity. The counts suffice for the decision; the *metric* that needs per-subscriber visibility (`delivery_subscriber_dropped_total`, Section 8.8) is incremented inside the engine where identity is still in scope, before collapsing to counts. We therefore deliberately drop `ID` from the boundary type (and from `SubscriberDelivery`, which never leaves the engine).

### 4.3 The engine changes (graphql-go-tools)

Three surgical changes, all additive:

1. `executeSubscriptionUpdate` (`resolve.go:616`) returns its outcome instead of void. The branch table from Section 2.2 maps to outcomes as:

```go
func (r *Resolver) executeSubscriptionUpdate(resolveCtx *Context, sub *subscriptionState, sharedInput []byte) SubscriberDelivery {
    // branch 1 InitSubscription fail / branch 2 Load fail / branch 4 Resolve fail:
    //   v1 (option b): buffered error, NOT flushed → return {Outcome: DeliveryFailed} (nothing delivered)
    //   follow-up (option a): flush the buffered error; on flush nil → DeliveredError, on flush err → DeliveryFailed
    // branch 3 sub.removed: return {Outcome: DeliverySkipped}
    // branch 5 success: sub.writer.Flush()
    //   flush nil → return {Outcome: DeliveryFlushed}
    //   flush err → _ = r.UnsubscribeSubscription(sub.id); return {Outcome: DeliveryFailed, Err: err}
}
```

2. `handleTriggerUpdate` (`resolve.go:1086`) collects the per-sub results its `wg.Wait()` already gates on and returns a `DeliveryReport`. Filter drops (`trig.filterSubscriptions`, `resolve.go:1095`) count as `DeliverySkipped` (the engine *correctly chose* not to deliver — not a broker failure, dossier §6.8).

```go
func (r *Resolver) handleTriggerUpdate(id uint64, data []byte) DeliveryReport {
    trig, ok := r.getTrigger(id)
    if !ok { return DeliveryReport{} } // trigger gone: nothing to ack against
    subs, filterErrors := trig.filterSubscriptions(data)
    var rep DeliveryReport
    var mu sync.Mutex
    for _, fe := range filterErrors {
        fe.sub.writeError(r.errorFormatter, fe.ctx, fe.err, fe.response)
        rep.Skipped++
    }
    var wg sync.WaitGroup
    for _, sub := range subs {
        if sub.removed.Load() { rep.Skipped++; continue }
        wg.Go(func() {
            d := r.executeSubscriptionUpdate(sub.ctx, sub, data)
            mu.Lock(); rep.add(d); mu.Unlock()
        })
    }
    wg.Wait()
    return rep
}
```

3. `SubscriptionUpdater.Update` (`resolve.go:1586`) returns a `DeliveryReport`. This is the one signature change to the engine's public interface — additive in meaning (callers that ignore the return are unchanged in behavior). The concrete `subscriptionUpdater.Update` (`resolve.go:1479`) returns what `handleTriggerUpdate` now returns; the `s.mu`-guarded body is otherwise unchanged.

```go
type SubscriptionUpdater interface {
    // Update fans an event out to a trigger's subscribers and reports per-subscriber
    // delivery outcomes. The report reflects FLUSH success, not client receipt.
    Update(data []byte) DeliveryReport
    Complete()
    Error(data []byte)
    Done()
    CloseSubscription(id SubscriptionIdentifier)
    Subscriptions() map[context.Context]SubscriptionIdentifier
}
```

Note `UpdateSubscription` is **not** changed to return a result in v1, because the only caller of `UpdateSubscription` is the hooks path (`subscription_event_updater.go:117`), which is deferred (Section 8.6). Leaving it void avoids dead plumbing.

### 4.4 The router `datasource` changes — one decision per broker message

This is the seam correction from critique #9. Both real adapters call `updater.Update` with a **single-element** event slice and ack **per message**:
- NATS: `FetchNoWait(300)` returns a batch, but the reader loops `for msg := range msgBatch.Messages()` and calls `updater.Update([oneEvent])` then `msg.Ack()` **per `msg`** (`nats/adapter.go:145-157`).
- Kafka (deferred): `PollRecords(10_000)` then `updater.Update([oneRecord])` **per record** (`kafka/adapter.go:110-118`).

So `events` is **always length 1** at the `Update` boundary. There is no multi-event batch to "ack the lowest contiguous prefix" of at this seam. The prior draft's `DeliveryReport.Merge` / batch-prefix machinery was solving a problem that does not exist here. **It is removed.** Each `Update` call corresponds to exactly one broker message and produces exactly one `Decision`.

The real batching (300 JetStream msgs per `FetchNoWait`, 10k Kafka records per poll) happens in the *reader loop*, and there each message already gets its own ack decision in loop order — which is already ordering-safe. The only ordering constraint that lives at the reader-loop level is documented in Section 7 (a Nak'd message redelivers later, after subsequent messages in the same fetch may have acked — an inherent at-least-once reorder, not something `Merge` could fix).

```go
type SubscriptionEventUpdater interface {
    // Update delivers a single broker message's event(s) and returns the delivery report.
    Update(events []StreamEvent) DeliveryReport
    Complete()
    Done()
    SetHooks(hooks Hooks)
}

// no-hooks path (v1): events is length 1 in both adapters today, but we keep the loop and
// take the conservative report (a failure in any element fails the message).
func (s *subscriptionEventUpdater) Update(events []StreamEvent) DeliveryReport {
    if len(s.hooks.OnReceiveEvents.Handlers) != 0 {
        // v1: at_least_once + hooks is rejected at startup validation (Section 8.6, 9.2).
        // This path therefore runs only in mode:off and its return is ignored.
        ... // existing behavior, return zero report
    }
    var rep DeliveryReport
    for _, event := range events {
        r := s.eventUpdater.Update(event.GetData()) // engine DeliveryReport
        rep.Flushed += r.Flushed; rep.Failed += r.Failed; rep.Skipped += r.Skipped
    }
    return rep
}
```

### 4.5 The adapter changes — `datasource.Adapter` keeps its signature, the reader loop changes

The `Adapter` *interface* (`provider.go:22-28`) does **not** change — `Subscribe` still takes a `SubscriptionEventUpdater`.
The NATS reader goroutine now reads the return value of `updater.Update` and maps the `DeliveryReport` to a broker decision via a small shared helper:

```go
// shared policy evaluation, datasource package
func (p DeliveryPolicy) Decide(r DeliveryReport) Decision {
    switch {
    case r.Failed == 0:
        // includes the all-skipped case (0 flushed, 0 failed, N skipped) → Ack, for EVERY policy.
        return DecisionAck
    case p == PolicyAny && r.Flushed > 0:
        return DecisionAck
    case p == PolicyQuorum && r.Flushed*2 > (r.Flushed+r.Failed):
        return DecisionAck
    default:
        return DecisionNak
    }
}
```

Per critique #11, the `Failed == 0` case is evaluated *first*, so an all-skipped event (every subscriber filtered/dropped — `Flushed==0, Failed==0, Skipped==N`) Acks under all three policies. Section 8.8 mandates a table-driven test row for this for each policy.

NATS JetStream reader, after the change (`nats/adapter.go:145-157`):

```go
report := updater.Update([]datasource.StreamEvent{ /* one event */ })

switch p.deliveryPolicy.Decide(report) {
case datasource.DecisionAck:
    if err := msg.Ack(); err != nil { log.Error("error acknowledging message", ...); return }
case datasource.DecisionNak:
    // redeliver after backoff; co-subscribers that DID flush will see a duplicate (§4.6).
    // JetStream's MaxDeliver (set finite in §4.7 / §8.7) bounds this; on exhaustion it Terms.
    if err := msg.NakWithDelay(p.nakBackoff); err != nil { log.Error("error nak'ing message", ...) }
case datasource.DecisionTerm:
    _ = msg.Term() // poison / budget exhausted; out of redelivery rotation
}
```

### 4.6 Lifecycle, the mutable trigger set, and the serialization-gate stall (critique #2 + #3)

A single JetStream message, two shared subscribers A (fast) and B (slow/dead), `policy: all`:

```
JetStream delivers msg (stream seq 42), reader holds `msg`
        ▼
reader: report := updater.Update([Event{seq42}])
        │   subscriptionUpdater.mu HELD for the whole call (the "event serialization gate")
        │   handleTriggerUpdate → wg.Go × {A,B} ; wg.Wait()
        │     sub A: Init→Load→Resolve→Flush ✔  → Flushed
        │     sub B: Flush ✖ (client gone)       → Failed ; UnsubscribeSubscription(B)
        │   returns DeliveryReport{Flushed:1, Failed:1}     ← mu RELEASED here
        ▼
   Decide(all) = Nak  →  msg.NakWithDelay(nak_backoff)
        │
        │  *** the reader goroutine for this trigger does not fetch the next message
        │      until after the backoff; meanwhile any NEW live event for this trigger
        │      arrives through the SAME subscriptionUpdater.mu and queues behind it. ***
        ▼  (after nak_backoff) JetStream redelivers seq 42 — a NEW Update() call, fanned to
           WHATEVER subscribers exist NOW (the trigger is keyed by data, not client identity):
        ├── sub A still present → Flush ✔  (DUPLICATE — A must be idempotent)
        ├── sub B gone forever  → not in the set; can NEVER be satisfied by redelivery
        └── a NEW sub C that joined after seq 42 → receives seq 42, an event that PREDATES its
            subscription (a pre-join, possibly-stale event). Re-authz'd against C (§8.5).
        ▼  DeliveryReport now depends on the CURRENT set, not the original one.
```

Three structural truths this RFC states plainly rather than hand-waving:

**(a) Redelivery targets the *trigger*, not the failed subscriber.** The engine re-runs `filterSubscriptions` over the *current* subscriber set on every `Update` (`resolve.go:1095`). The trigger is keyed by data, never by client identity (dossier §1.4). Consequences:
- Healthy co-subscribers (A) get **duplicates**.
- A **newly-joined** subscriber (C) can receive an event that predates its subscription — out-of-order/stale relative to C. Whether exposing a pre-join event to a fully-authorized new subscriber is acceptable is a **product decision** (Section 8.5, 12).
- A **permanently-departed** subscriber (B) is gone from the trigger, so the message can *never* satisfy `policy: all` for B. It will redeliver to A/C until `max_redeliveries`, then `Term`. The framing "redeliver until the slowest *required* subscriber flushes" is therefore **not literally true** — there is no stable "required set" across a redelivery. The honest claim is in Section 7.

**(b) The serialization-gate head-of-line stall (critique #3 — strictly worse than today for healthy clients).** `subscriptionUpdater.mu` is "held across the entire Update() call including wg.Wait()" (`resolve.go:1463-1466`). Our ack/nak decision runs in the *reader goroutine* after `Update` returns and `mu` is released. But on Nak, `NakWithDelay(nak_backoff)` stalls the reader for the backoff before it fetches the next message, and the redelivery comes back through the **same** `subscriptionUpdater.mu`. While a Nak→backoff→redelivery cycle is in flight, **new live events for that trigger queue behind the gate.** With `policy: all` and one permanently-stuck subscriber, the entire shared trigger (all N clients) is frozen for up to:

> **worst-case stall ≈ `nak_backoff × max_redeliveries`** (blast radius: every co-subscriber on the trigger).

This is *strictly worse than today* for the healthy clients on that trigger (today they keep getting fresh events; the slow client's event is silently dropped and never blocks anyone). This is the core cost of mapping one ack onto N clients, and it is the strongest argument for a finite `max_redeliveries` (Section 4.7) and for Pattern C when per-client isolation matters. We surface the stall via `delivery_trigger_stall_seconds` (Section 8.8).

**(c) Duplicates are the at-least-once tax.** Inherent and unavoidable; clients must be idempotent (dossier §6.2).

### 4.7 Bounded redelivery is mandatory (critique #7)

Today the JetStream consumer config (`nats/adapter.go:422-431`) sets only `Durable` and `FilterSubjects` — it does **not** set `MaxDeliver`, so the server default (**unlimited**) applies, along with default `AckExplicit` and 30s `AckWait` (dossier §3.1). Combined with truth (a) above (a departed subscriber can never satisfy `all`), **unlimited `MaxDeliver` + `policy: all` is a denial-of-service**: one client that disconnects uncleanly during an event causes that stream sequence to redeliver *forever*, the consumer's ack floor never advances, and its pending count grows unbounded — freezing the whole trigger per truth (b).

**Therefore, when `mode: at_least_once`:**
- Pattern D **sets `MaxDeliver` on the consumer config** to a finite `max_redeliveries` (default below), so a never-satisfiable message is `Term`'d (→ advisory / DLQ) rather than redelivered forever. `Term` is defined as the **normal** termination for "a required subscriber never came back."
- Startup validation **rejects** `mode: at_least_once` with `policy: all` and an effectively-unlimited `max_redeliveries` (`0` meaning "backend default = unlimited"). This combination is unsafe and must not start.
- Default `max_redeliveries` is **5** when `mode: at_least_once` (finite, bounded stall), overridable.

### 4.8 Components touched (precise, v2.4.1)

- **graphql-go-tools `pkg/engine/resolve/resolve.go`**: `executeSubscriptionUpdate` return value (`:616`); `handleTriggerUpdate` return value (`:1086`); the `SubscriptionUpdater` interface (`:1586`); the concrete `subscriptionUpdater.Update` (`:1479`). New types `DeliveryOutcome`, `SubscriberDelivery`, `DeliveryReport`. `UpdateSubscription` (`:1500`) is **unchanged** (hooks deferred). `handleUpdateSubscription` (`:1114`) **unchanged**.
- **router `datasource`**: `SubscriptionEventUpdater.Update` return value (`subscription_event_updater.go:19-24, 36-42`); `DeliveryPolicy.Decide`; mirror `DeliveryReport`. The `Adapter` interface (`provider.go:22-28`) is **unchanged**. No `Merge`/batch-prefix machinery.
- **router NATS adapter** `nats/adapter.go`: read `updater.Update`'s return and branch to `Ack`/`Nak`/`Term` (`:145-157`); set finite `MaxDeliver` on the consumer config (`:422-431`).
- **router config**: a new `delivery` block under the NATS provider (Section 9), plus startup validation (Section 4.7, 8.6).
- **router metrics**: extend `metric.StreamsEvent` taxonomy with delivery counters (Section 8.8).
- **`websocket.go` / `flushwriter.go`**: **no changes.** The flush they already do *is* the success signal; we only read its error, which the engine already has.
- **`wsproto/proto.go`**, **composition / proto / schema directives**: **no changes.**
- **Kafka / Redis adapters, hooks path**: **no changes in v1** (deferred — Section 6, 8.6).

---

## 5. Wire protocol & client changes

**None. Justified.**

Pattern D is a pure server-side correctness fix.
It changes *when the router tells the broker "done,"* nothing the client can observe except that — on the failure-then-redelivery path — a client that *was* connected and *did* receive an event may receive it **again** after a co-subscriber's failure triggered a Nak (Section 4.6).
That is at-least-once's defining property and requires no protocol affordance: duplicates are delivered over the existing `Next`/`next` frames on the existing `graphql-transport-ws`, `graphql-ws`, and `graphql-sse` transports.

We deliberately do **not** add an `ack` inbound message (`wsproto/proto.go:88-94` untouched), do **not** add an SSE `id:` field (`flushwriter.go` untouched), and do **not** negotiate a capability in `connection_init`.
Those are the surface of Patterns A/B/G.

**Fallback when a client/transport cannot participate:** not applicable — there is nothing for the client to participate in.
Every client benefits automatically with zero changes.

The only client-facing guidance is documentation: *because at-least-once now actually redelivers, your resolvers/clients must tolerate duplicates* (the standard idempotency caveat, dossier §6.2).

**Non-Goal note — the produce side caps the end-to-end guarantee (critique #12).**
"At-least-once relative to flush" is only meaningful if the event reached the stream in the first place. The Cosmo NATS *publish* path uses **core NATS** `p.client.Publish` even for stream-backed subjects (`nats/adapter.go:254`) and is itself fire-and-forget — it can drop a message before the stream. Pattern D assumes the event is durably in the broker and does **not** fix this; an at-least-once *publish* story (idempotent ingest with `Nats-Msg-Id`, JetStream `js.Publish`) is out of scope here but is a real ceiling on end-to-end guarantees and should be its own RFC.

---

## 6. Per-backend adaptability & degradation matrix

**v1 ships exactly one backend: NATS JetStream.** Everything else is either trivially unaffected (no-ack backends), explicitly deferred (Kafka), or not-yet-a-Cosmo-backend (forward-compatible only). The matrix below is honest about which row is in scope.

| Backend | In v1? | Guarantee achieved by Pattern D | Degradation / fallback (non-silent) |
|---|---|---|---|
| **NATS JetStream** | **Yes** | **At-least-once relative to flush**, per policy, for the subscriber set present across a redelivery (Section 7). Redelivery after `nak_backoff`; finite `MaxDeliver` bounds retries (Section 4.7). Closes bug #2; closes #3 under `all` for the present set. | The serialization-gate stall and duplicate-to-healthy-co-subscriber (Section 4.6); surfaced via `delivery_trigger_stall_seconds`, `delivery_nak_total`. After `MaxDeliver` exhaustion → `Term` + `delivery_exhausted_total`. |
| **NATS core** | n/a (no-op) | **Unchanged** — at-most-once | No ack primitive (`ChanSubscribe`, `nats/adapter.go:186`). If `delivery.mode: at_least_once` is set on a core-NATS subject, `on_unsupported` governs: `warn` (log once, run fire-and-forget) or `error` (refuse to start). **Never silent.** |
| **Redis Pub/Sub** | n/a (no-op) | **Unchanged** — at-most-once | Same as NATS core: no ack primitive (`PSubscribe`/`PUBLISH`, `redis/adapter.go:88-152`). `on_unsupported` warn/error. |
| **Kafka** | **No — deferred** | — | See note ‡ below. Requires a committed cursor → consumer group → Pattern C territory. **Rejected at startup** if `delivery.mode: at_least_once` is set on a Kafka provider in v1. |
| **Redis Streams** | No (not a Cosmo backend) | Would be at-least-once via `XACK`/PEL — result-plumbing identical to NATS | Forward-compatible only. |
| **SQS / Google Pub/Sub / Kinesis / Event Hubs / RabbitMQ** | No (not Cosmo backends) | delete-on-ack / ack-nack / checkpoint families map cleanly when added | Forward-compatible only; offset/checkpoint families inherit the head-of-line shape. |

**‡ Kafka note — why it is deferred, not "M" (critique #5).**
The Kafka poller (`kafka/adapter.go:51-122`) does `PollRecords(10_000)`, iterates **all records across all partitions in one `RecordIter`**, calls `updater.Update` **per record**, and is **groupless** with `ConsumeResetOffset(AfterMilli(now))` and a brand-new client per `Subscribe` (`:142`). A groupless client **has no offset commit mechanism at all.** To honor a `DeliveryReport` you would need *all* of:
1. per-`(topic, partition)` floor tracking (the current single-`RecordIter` loop has no per-partition offset state);
2. pause/resume of partitions whose floor is stuck — otherwise re-fetching from the floor re-delivers everything above it to *all* subscribers every poll (a duplicate storm);
3. a **committed cursor**, which means introducing a `kgo.ConsumerGroup` or manual `CommitOffsets` — which drags in rebalance, `group.instance.id`, and the per-instance naming problem the RFC otherwise defers to Pattern C.

With the *current* groupless client, an in-memory floor buys **nothing across restart**: on restart the consumer resets to `AfterMilli(now)` and re-reads from "now" anyway — the exact gap listed as out-of-scope. So Kafka either grows a consumer group (Pattern C, contradicting this RFC's scope boundary) or its "floor" is a lie across restart. **Kafka is therefore L-shaped and deferred**; v1 rejects `at_least_once` on Kafka at startup rather than pretending.

**Two families (dossier §3.3), restated for what *would* happen when these land:**
- *Per-message ack* (JetStream — v1; Redis Streams, SQS, Pub/Sub, Rabbit — future): Pattern D is exact — failed subscribers' messages are individually redelivered, succeeded ones are not held back.
- *Offset/sequence commit* (Kafka, Kinesis, Event Hubs — future): Pattern D can only advance a *floor*, so one slow subscriber blocks the head of the line for everyone sharing that partition, and a restart re-reads above the floor. This is the explicit, documented degradation of the log-offset family with the shared-trigger model — and the reason those backends are a better fit for Pattern B.

---

## 7. Delivery semantics achieved

**Headline:** **at-least-once relative to flush success** (bytes accepted by the writer's `Flush()` without error), per the configured shared-trigger policy, on NATS JetStream, **for the subscriber set present across a redelivery.**

- **At-most-once?** No longer — a flush failure now triggers redelivery instead of a silent drop.
- **At-least-once?** Yes, *bounded by* (i) the broker's redelivery + finite `MaxDeliver`, (ii) the flush definition, and (iii) the **mutable, identity-free trigger set** (Section 4.6): a subscriber present at original delivery *and still present at redelivery* is guaranteed to be retried until it flushes or the budget is exhausted. A subscriber that departs permanently is **not** retried (it is gone from the trigger); the message burns its redelivery budget then `Term`s. This is the precise, honest scope of "closes bug #3."
- **Exactly-once?** No. Redelivery produces duplicates (Section 4.6). Clients/resolvers must be idempotent.

**Duplicates.** Guaranteed possible on the Nak/redelivery path, especially with shared triggers: when subscriber B fails, the Nak redelivers to A who already had it, and to any new C that joined since.

**Ordering.** Per-subscriber ordering is **preserved on JetStream with `policy: all` and serial redelivery**, *within one event*. It can be **violated** by:
- a Nak'd message redelivering *after* later messages from the same `FetchNoWait(300)` batch already acked (an inherent at-least-once reorder; see Section 4.4 — this is *not* fixable by a prefix-floor at the `Update` seam, because each message is acked independently in loop order);
- `policy: any/quorum`, which acks before the slowest subscriber, so the slow subscriber's redelivery (if it comes back) interleaves.
We do **not** claim global ordering — Cosmo never had it (ordering is partition/stream-scoped, dossier §6.1).

**Exact failure windows that remain (be precise):**

1. **Flush ≠ receipt (bug #1, narrowed not closed).** A client that crashes after the router's `Flush()` buffered bytes into the kernel/TCP but before the client app processed them: acked, lost. Closing this requires a client ack (Pattern A).
2. **Router crash between flush and ack.** The router flushes successfully, then dies before `msg.Ack()`. The broker redelivers → a **duplicate**, not a loss (acceptable).
3. **Permanently-departed required subscriber.** Under `policy: all`, a subscriber that leaves uncleanly mid-event can never satisfy the policy; the message redelivers (duplicating to healthy co-subscribers) until `MaxDeliver`, then `Term`s. The departed subscriber's event is lost to it — but it is *gone*, so this is delivery to a set that no longer includes it. Made visible via `delivery_exhausted_total`.
4. **Minority loss under `quorum`/`any`.** A `Failed` subscriber when the policy still Acks silently misses the event (Section 8.3). Made visible via `delivery_subscriber_dropped_total` (Section 8.8).
5. **Cross-instance / cross-restart of in-flight handles.** A different router instance after failover does not inherit in-flight handles; with JetStream's per-instance durable naming (`nats/adapter.go:69-83`), cross-instance failover still drops in-flight events. **Pattern C territory**, out of scope.

---

## 8. Cross-cutting concerns

### 8.1 Router HA / horizontal scaling & sticky sessions

Pattern D does **not** add HA durability. In-flight (held, un-acked) broker handles live in the reader goroutine of the process that read them; a crash before ack → broker redelivers to whichever instance next consumes (JetStream redelivers to the same per-instance durable, dossier §2.3). Sticky sessions are **not required** — the redelivery target is decided by the broker, not by client affinity. The known limitation: JetStream's per-instance durable naming means failover to a *new* instance doesn't resume the old instance's un-acked set (failure window #5). Documented; Pattern C fixes it.

### 8.2 Per-subscription state / memory cost

Near-zero new persistent state. The `DeliveryReport` is a transient, stack-scoped value (counts + per-sub outcome during fan-out) that exists only for the duration of one `Update` call. No per-subscriber durable map, no external store. This is the cheapest of the durable-ish patterns (dossier §6.7).

### 8.3 Multi-tenant shared-trigger fan-out (the central tension)

One broker subscription fans to N subscribers (dossier §1.4, §6.5); one broker ack must now reflect N heterogeneous outcomes. We make the coupling **explicit and configurable** via `delivery.policy`:

- **`all`** (default when durability is requested): ack only when no subscriber's flush failed. The only policy giving a real per-subscriber at-least-once guarantee — at the cost of duplicates and the serialization-gate stall to co-subscribers (Section 4.6).
- **`quorum`**: ack when a majority flushed. Bounds blast radius; **the failed minority silently misses the event — this is bug #3 for the minority** and is made observable by `delivery_subscriber_dropped_total`.
- **`any`**: ack if *anyone* flushed. Closes bug #2 (no longer ack on total failure) but **explicitly re-creates bug #3** (a single success acks for all). The cheapest upgrade; same metric makes the loss visible.

We are blunt: `quorum` and `any` **reintroduce silent per-subscriber loss under a config flag.** They are offered because some operators rationally prefer bounded blast radius over universal redelivery, but the RFC's non-silence mandate (dossier) requires the dropped-subscriber metric (Section 8.8) so the loss is *observable*, never invisible.

Pattern D **does not break trigger dedup** (unlike C): the shared trigger and single broker subscription are preserved.

### 8.4 Backpressure

Unchanged in shape, improved in correctness, with one new *worse* case made explicit. The reader goroutine already blocks on `updater.Update` until all subscribers flush (dossier §2.2). Pattern D adds the ack-decision branch after that point — and, on Nak, the `nak_backoff` stall (Section 4.6 (b)) which *is* new backpressure with teeth: a slow subscriber now correctly stalls the consumer and triggers redelivery rather than silently dropping, but the stall propagates to healthy co-subscribers on the trigger. `MaxSubscriptionFetchTimeout` (30s, `config.go:454`) remains the per-update liveness guard; a subscriber whose flush times out is `DeliveryFailed`.

### 8.5 Security / authz

- **Replay re-runs authz per event — but against the *current* subscriber set (critique #10).** Redelivery flows through the same `handleTriggerUpdate` → `filterSubscriptions` → resolve path, so per-event authorization (declarative filters, dossier §6.8) runs again on the redelivered event. Because the trigger set is mutable (Section 4.6), the re-authz runs against whatever subscribers exist *now* — which can *expose a pre-join event to a newly-joined, fully-authorized subscriber C*. The authz itself is correct (C is authorized); the **product question** is whether C should logically see an event that predates its subscription. This RFC flags it as a decision to make, not a bug to hide: for most event streams a recently-redelivered event is acceptable; for strictly time-windowed/entitlement-scoped streams it may not be. Default v1 behavior is the engine's existing semantics (no special suppression), documented.
- **No new tokens, no cursors, no replay window.** Pattern D introduces no client-presented position, so Pattern B's cursor-forgery surface **does not exist** here.
- **Drop ≠ failure.** A filter/authz decision *not* to deliver is `DeliverySkipped`, not `DeliveryFailed` (Section 4.3) — a correctly-filtered event still Acks, not an endless Nak. This is the reconciliation dossier §6.8 demands.

### 8.6 Interaction with existing Cosmo Streams hooks — DEFERRED in v1 (critique #4)

The prior draft sketched mapping hook abandonment-on-timeout to `DeliveryFailed` → Nak. **That is unimplementable as sketched and would reintroduce the very duplicate+reorder it claims to fix.** The actual hooks path (`subscription_event_updater.go:36-78`):

```
go func() { for sub { semaphore.Acquire; go updateSubscription(...) }; wg.Wait(); close(done) }()
select {
case <-done:            // all finished
case <-updaterCtx.Done(): // TIMEOUT: return immediately, goroutines still running detached
    log.Warn("...Events may arrive out of order.")
}
```

On timeout, the updater **returns while the per-subscription goroutines are still running detached** (the code comment is explicit: "we will also not wait for them, basically abandoning them"). At the moment of timeout there are **no results to aggregate** — you cannot synchronously produce a report that says "these subs failed" when the determination is "we stopped waiting." Worse: those abandoned goroutines later call `s.eventUpdater.UpdateSubscription(...)` → `subscriptionUpdater.UpdateSubscription` → `s.mu.Lock()` (`resolve.go:1500`), racing the *next* event's `Update` for the serialization mutex and flushing **late**. If Pattern D had already Nak'd based on "timeout = failed" and *then* an abandoned goroutine flushes successfully, you get a Nak-redelivery duplicate **plus** the late original — two copies and a reorder.

**Therefore, v1:**
- **Rejects `mode: at_least_once` together with any `on_receive_events` hook at startup validation.** A clear error: "at_least_once delivery is not supported with on_receive_events hooks in this release; the hook timeout-abandonment path must be reworked to be synchronous first."
- The reconciliation is a **follow-up**: rework the hooks path to be *synchronous* (no detached goroutines; bound each subscription's hook execution and wait for or hard-cancel it deterministically) so it can produce a real per-subscriber report. Only then can abandonment-on-timeout map to a Nak, and a hook that *intentionally drops* an event map to `DeliverySkipped` (ack-able). This is its own design problem and is graded separately (Section 12).

This is the most important honesty correction versus the prior draft, which advertised bug #4 as "Closed."

### 8.7 JetStream consumer config

`mode: at_least_once` sets `MaxDeliver = max_redeliveries` (finite, default 5) on the consumer config (`nats/adapter.go:422-431`). It does **not** change `AckPolicy` (already `AckExplicit` by default) or `AckWait` (server default 30s). `nak_backoff` is applied via `msg.NakWithDelay`, independent of `AckWait`. Startup validation rejects `policy: all` with effectively-unlimited `MaxDeliver` (Section 4.7).

### 8.8 Observability — first-class, because the guarantee depends on it (critique #8, #13)

The metrics are load-bearing: under `quorum`/`any` they are the *only* thing that makes silent minority loss visible, and under `all` they expose the stall blast radius. They extend `metric.StreamsEvent` (`pkg/metric/stream_metric_store.go:25`).

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `router_streams_delivery_nak_total` | counter | `provider_id`, `destination` | Messages Nak'd (redelivery triggered). |
| `router_streams_delivery_redelivered_total` | counter | `provider_id`, `destination` | Redelivered messages observed (duplicates emitted). |
| `router_streams_delivery_exhausted_total` | counter | `provider_id`, `destination` | Messages `Term`'d after `MaxDeliver` (a never-satisfiable required subscriber). |
| `router_streams_delivery_subscriber_dropped_total` | counter | `provider_id`, `destination`, `policy` | A subscriber was `Failed` but the policy still Acked → that subscriber **silently missed the event**. Incremented in the engine where per-subscriber identity is still in scope. The non-silence guarantee for `quorum`/`any`. |
| `router_streams_delivery_trigger_stall_seconds` | histogram | `provider_id`, `destination` | Time a trigger's reader was stalled in a Nak/backoff/redelivery cycle (Section 4.6 (b)). |
| `router_streams_delivery_policy_unsupported_total` | counter | `provider_id` | `at_least_once` requested on a no-ack backend; emitted once with the startup warning. |

**Cardinality.** Labels are bounded: `provider_id` is operator-defined (small), `destination` is the subject/topic (bounded by config), `policy` is one of three. We deliberately **do not** label per-trigger or per-subscriber (unbounded — per-trigger is a hash of input+headers, effectively unbounded under high-cardinality variables). Per-subscriber detail, when needed for debugging, goes to a debug log line gated behind a sampling flag, not a metric label.

---

## 9. Configuration surface

All new config is **router-local YAML**, opt-in, default-off. No schema directives, no proto, no composition changes.

### 9.1 Per-provider default

```yaml
version: "1"

events:
  providers:
    nats:
      - id: my-nats
        url: "nats://localhost:4222"
        # NEW: default delivery behavior for all JetStream-backed subscribes on this provider.
        delivery:
          # off (default): today's behavior exactly — ack after attempt, byte-for-byte unchanged.
          # at_least_once: map DeliveryReport → Ack/Nak.  (JetStream only in v1.)
          mode: at_least_once
          # all | quorum | any  — how a shared trigger's N outcomes collapse to one ack.
          # NOTE: quorum/any silently drop the failed minority (see delivery_subscriber_dropped_total).
          policy: all
          # what to do when the backend can't honor `mode` (NATS core):
          #   warn  (default): log once at startup, run fire-and-forget.
          #   error: refuse to start.
          on_unsupported: warn
          # Nak backoff before redelivery. Worst-case trigger stall ≈ nak_backoff × max_redeliveries.
          nak_backoff: 5s
          # MaxDeliver budget. MUST be finite when policy: all (0 = unlimited is REJECTED at startup).
          max_redeliveries: 5
```

### 9.2 Defaults, invariants & startup validation

- `delivery.mode` defaults to **`off`** everywhere → zero behavioral change until explicitly enabled.
- `policy` defaults to `all` when `mode: at_least_once`.
- `max_redeliveries` defaults to **5** when `mode: at_least_once`. **Startup rejects** `policy: all` + `max_redeliveries: 0` (unlimited) — unsafe (Section 4.7).
- `mode: at_least_once` on a **Kafka** provider is **rejected at startup** in v1 (Section 6 ‡): "at_least_once is not supported on Kafka in this release."
- `mode: at_least_once` together with any **`on_receive_events`** hook is **rejected at startup** (Section 8.6).
- `mode: at_least_once` on a **no-ack backend** (NATS core, Redis Pub/Sub): `on_unsupported` governs (`warn` runs fire-and-forget + logs once; `error` refuses to start). **Never silent** (dossier mandate).
- No per-field/per-operation knob in v1 — delivery policy is per-provider, keeping the schema/proto clean.

### 9.3 What is *not* added

- No `wsproto` capability, no `connection_init` payload field (Section 5).
- No `@edfs__*` directive argument, no `DataSourceCustomEvents` proto field (`node.proto:430-434` untouched).
- No external state store config (Pattern C).

---

## 10. Migration, backward compatibility & live recovery

- **Opt-in, default-off.** With no `delivery` block, every code path is behaviorally identical to today: the engine computes a `DeliveryReport`, the adapter ignores it and acks unconditionally as before. The engine interface change (`Update` now returns `DeliveryReport`) is source-compatible for the router (its only consumer); existing tests that call `Update` and ignore the return compile unchanged.
- **Rollout.**
  1. Land the engine signature change (graphql-go-tools `v2.4.x+1`) — additive return, no behavior change when ignored.
  2. Land the router `datasource` plumbing + NATS adapter branch behind `delivery.mode: off` default.
  3. Enable `at_least_once` per-provider in staging on JetStream, validate redelivery + idempotency + the stall metric, then opt-in production.
- **Backward compatibility with clients:** total — no wire change (Section 5). The only observable difference for an enabled provider is *duplicate events on redelivery*.
- **Downgrade:** set `mode: off` (or remove the block). New events revert to today's behavior immediately.
- **Live recovery from a stuck trigger (runbook — critique #13).** `mode: off` does **not** drain messages already Nak'd and in JetStream's redelivery rotation; those keep redelivering on their `AckWait`/`nak_backoff` schedule until `MaxDeliver` `Term`s them. To recover a trigger stuck in a Nak loop *live*:
  1. Confirm via `delivery_nak_total` rate + `delivery_trigger_stall_seconds` which `destination` is stuck.
  2. Set `mode: off` for the provider and reload — this stops *new* Naks; in-flight Nak'd messages still drain.
  3. To drain immediately rather than waiting out `MaxDeliver`: lower `max_redeliveries` (forces faster `Term`) or, operationally, purge/age-out the affected stream sequences on the broker side (a NATS admin action, outside the router). Because `MaxDeliver` is now finite (Section 4.7), the worst case is bounded at `nak_backoff × max_redeliveries` even without intervention.
  4. The departed-subscriber root cause is visible in `delivery_exhausted_total`; chronic exhaustion on a `destination` is the signal to move that trigger to Pattern C (per-subscriber isolation) or `policy: quorum`.
- **Engine-version coupling:** requires the `SubscriptionUpdater` change to land in the pinned `graphql-go-tools/v2` version (currently `v2.4.1`); re-verify the `executeSubscriptionUpdate`/`handleTriggerUpdate` lines against the exact target tag at implementation time.

---

## 11. Testing strategy (critique #13)

These behaviors are not unit-testable in isolation — they require **deterministic broker integration tests** (a real or embedded JetStream) plus engine-level unit tests for the report plumbing.

**Engine unit tests (graphql-go-tools, no broker):**
- `executeSubscriptionUpdate` returns the correct `DeliveryOutcome` for each of the five branches — including the **bug-#1 regression test**: a `Resolve` error that produces a flushed error response classifies as `DeliveredError`/ack-able (option a) or `DeliveryFailed`-but-nothing-delivered (option b), and is asserted explicitly so no future change silently reverts to "Nak a delivered error."
- `handleTriggerUpdate` aggregates N subscriber outcomes into the right counts, including the all-skipped case.
- `DeliveryPolicy.Decide`: a table test with one row per `(flushed, failed, skipped) × {all, quorum, any}` cell, **including the `0 flushed / 0 failed / N skipped` row → Ack for all three policies** (critique #11), asserting the full `Decision` value with `assert.Equal`.

**JetStream integration tests (deterministic redelivery):**
- *Bug #2*: single subscriber whose flush fails → `msg` is Nak'd, redelivered, then acked once the subscriber recovers. Assert exact ack/nak call sequence.
- *Bug #3 under `all`*: two shared subscribers, one fails → Nak; healthy subscriber receives a **duplicate** on redelivery (assert the duplicate). Then a third subscriber joins before redelivery → assert it receives the pre-join event (documents Section 4.6 (a) as tested behavior, not accident).
- *Permanently-departed subscriber*: subscriber leaves uncleanly → message redelivers exactly `max_redeliveries` times then `Term`s; `delivery_exhausted_total` increments. Assert the stall is bounded by `nak_backoff × max_redeliveries`.
- *Quorum/any minority loss*: under `any`, one of two flushes → Ack; `delivery_subscriber_dropped_total` increments for the failed subscriber. Assert the metric (the non-silence contract).
- *Serialization-gate stall*: with one stuck subscriber under `all`, assert a *new* live event for the same trigger is delayed by the in-flight Nak cycle (Section 4.6 (b)).

**Startup-validation tests:**
- `at_least_once` + Kafka provider → startup error.
- `at_least_once` + `on_receive_events` hook → startup error.
- `at_least_once` + `policy: all` + `max_redeliveries: 0` → startup error.
- `at_least_once` + NATS core + `on_unsupported: error` → startup error; `: warn` → starts + single warning.

All response/metric/decision assertions use full-value `assert.Equal` (not `Contains`), per house testing rules.

---

## 12. Risks, open questions, and a complexity/effort estimate

### Where this pattern is weakest (be honest)

1. **Flush ≠ receipt — the hard ceiling.** A client that crashes after the kernel buffered the bytes but before the app processed them is *acked and lost*. Pattern D narrows bug #1 but cannot close it without a client ack (Pattern A). If true end-to-end at-least-once is the requirement, Pattern D is *necessary but not sufficient*.
2. **Shared-trigger coupling is genuinely worse for healthy co-subscribers.** `policy: all` makes the slowest/dead subscriber inflict duplicates *and* a `nak_backoff × max_redeliveries` stall on everyone on the trigger (Section 4.6 (b)). This is not hidden: it is the inherent cost of one ack covering N clients, and the strongest argument for Pattern C (per-subscriber durability, at the cost of N broker consumers + broken dedup).
3. **The mutable, identity-free trigger set bounds the guarantee.** "Closes bug #3" is only true for subscribers present *across* a redelivery; departed subscribers can never be satisfied, and newly-joined ones may see pre-join events (Section 4.6 (a), 8.5). The guarantee is scoped, not absolute.
4. **Hooks and Kafka are deferred for real reasons, not convenience.** The hooks abandonment path cannot synchronously report failure (Section 8.6) and Kafka has no offset commit at all (Section 6 ‡). v1 rejects both at startup rather than ship a guarantee it can't keep.
5. **No cross-instance / cross-restart durability of in-flight handles** (failure window #5). Pattern C.

### Open questions

- **Branch 1/2/4 flush behavior (option a vs b — Section 4.2).** Should the engine *flush* the buffered error on init/load/resolve failure (option a: makes them `DeliveredError`/ack-able and incidentally fixes the latent "buffered error never delivered to client" bug) or leave them non-flushing (option b: classify as `DeliveryFailed`, Nak because nothing was delivered)? Option (b) is the simpler v1 default; option (a) is the recommended follow-up but is a behavior change to error delivery that deserves its own review. **This is the single most consequential open question.**
- **Pre-join event exposure (Section 4.6 (a), 8.5).** Is it acceptable for a newly-joined, authorized subscriber to receive a redelivered event that predates its subscription? Default v1: yes (engine's existing semantics). Some entitlement-scoped streams may want suppression — needs a product call before adding a knob.
- **`policy` granularity.** Per-provider in v1. Per-subscribe-config (per subject) likely eventually; deferred to stay surgical.
- **Hooks synchronous rework (Section 8.6).** What is the right deterministic timeout semantics for a synchronous hooks path — hard-cancel the hook goroutine (risky if it holds resources) vs. bound it and treat overrun as `DeliveryFailed`? This is the gating design for re-enabling hooks under `at_least_once`.

### Complexity / effort estimate (re-graded — critique #15)

**JetStream-only, no-hooks v1 slice: M.** **Full pattern (with hooks rework + Kafka cursor): L.**

| Area | Effort | Notes |
|---|---|---|
| Engine: thread `DeliveryReport` through `executeSubscriptionUpdate` / `handleTriggerUpdate` / `Update` | **S–M** | Mechanical; the `wg.Wait()` sync point exists. The bug-#1 fix (split `DeliveredError`/`DeliveryFailed` on *flush* result, not resolve result) is the subtle part. |
| NATS adapter: branch on report → `Ack`/`Nak`/`Term`; set finite `MaxDeliver` | **S** | Ack site exists (`nats/adapter.go:145-157`); consumer config edit (`:422-431`). |
| Config + startup validation + metrics + docs | **M** | New `DeliveryConfiguration`; the validation matrix (Section 9.2) and six metrics (Section 8.8) are real work; "duplicates expected" docs. |
| Serialization-gate stall analysis + bounded-stall tests | **S–M** | Analysis done (Section 4.6); deterministic integration tests are the cost. |
| **— v1 subtotal —** | **M** | JetStream + no-hooks only. |
| Hooks path: synchronous rework so abandonment can report (Section 8.6) | **L (follow-up)** | Its own design problem; v1 rejects the combination at startup instead. |
| Kafka: groupless → committed cursor / consumer group (Section 6 ‡) | **L (follow-up)** | Pattern C territory; v1 rejects at startup instead. |

The cost in v1 is concentrated in the bug-#1-correct outcome classification and the validation/observability surface; everything else is plumbing a return value through layers that already synchronize. Carving out hooks and Kafka is what keeps v1 honest at **M**; pretending they were "M" too is what made the prior draft's grade not credible. This remains the **highest correctness-per-effort** of the seven patterns and the prerequisite substrate for A, B, and C — which is why the dossier's sequencing recommends shipping it first.
