# RFC Unified Delivery-Manager Layer for EDFS At-Least-Once Delivery

- **Author:** automated RFC workflow
- **Status:** Draft
- **Date:** 2026-05-28
- **RFC Variant:** D — "Unified Delivery-Manager Layer (transport-agnostic, pluggable-durability)"

## Abstract

Cosmo's EDFS / Cosmo Streams today delivers events to subscribers with an **at-most-once**, fire-and-forget guarantee. A message read from a broker is pushed through the hook pipeline and written to the client's WebSocket/SSE connection; if the write fails, the client is slow, the connection drops, or the router replica crashes between read and write, the event is silently lost. There is no acknowledgement, no redelivery, no cursor, and no notion of per-subscription delivery state anywhere in the codebase.

This RFC proposes the most architecturally ambitious of the four candidate designs: instead of bolting durability onto one layer (the broker adapter, the WS protocol, or a router-side WAL), we introduce a **single cross-cutting abstraction — the Subscription Delivery Manager (SDM)** — that owns the end-to-end at-least-once state machine for every in-flight message. The SDM sits between the broker adapters and the transport, wrapping today's `subscription_event_updater.go` orchestration. It is parameterized by four pluggable interfaces: a `DurabilityStrategy` (where unacked state and cursors live), an `AckTransport` (how delivery is confirmed), a `DedupStore` (idempotency / seen-set), and a `RoutingStrategy` (how a reconnecting client lands on or recovers its delivery state across replicas).

The thesis: the other three RFCs are not really competing designs — they are each *one implementation of one of these interfaces*. Broker-native ack is a `DurabilityStrategy`. Client-ack/resume is an `AckTransport`. A router WAL is another `DurabilityStrategy`. None of them, on their own, gives a unified contract, and crucially **none of them addresses the multi-replica reconnection problem or deduplication**, which is where at-least-once delivery actually breaks in production. This RFC makes those first-class concerns.

We are honest up front: this is the heaviest lift of the four. Section 12 ("Considerations and Risks") calls out the over-engineering risk explicitly, and Section 13 describes an incremental rollout that ships the manager with a no-op strategy so the default behavior is byte-for-byte identical to today.

---

## 1. Problem Statement

### 1.1 The status quo is at-most-once

The current delivery path is, end to end:

```
Broker → provider adapter goroutine → updater.Update(events)
       → SubscriptionEventUpdater.Update()
       → (per-subscription) OnReceiveEvents hooks  (semaphore-bounded, 5s timeout)
       → resolve.SubscriptionUpdater.UpdateSubscription(subID, data)
       → WS / SSE / multipart write
```

Concretely, in `router/pkg/pubsub/datasource/subscription_event_updater.go`:

- `Update()` (line 36) fans an event batch out to every active subscription. With no hooks it calls `s.eventUpdater.Update(event.GetData())` directly (line 39); with hooks it spawns one bounded goroutine per subscription (`updateSubscription`, line 95).
- `updateSubscription` runs the hooks, then loops `s.eventUpdater.UpdateSubscription(subID, event.GetData())` (line 122) — a one-way write. There is **no return value, no ack, no retry, no record that the message was in flight.**
- On timeout (line 69) the code explicitly *abandons* in-flight updaters and logs "Events may arrive out of order." This is a candid admission that the current layer has no delivery contract at all.

The brokers reinforce at-most-once:

- **NATS JetStream** (`router/pkg/pubsub/nats/adapter.go`, line 154): `msg.Ack()` is called **immediately after** `updater.Update(...)` returns — i.e. *before* the event is confirmed delivered to any client. The broker considers the message done the moment the router has *read* it. A crash one line later loses the event with no redelivery.
- **NATS core / Kafka / Redis** are pure pub/sub with no ack semantics at all (`kafka/adapter.go` uses `FetchNoWait` with no consumer group/offset commit; `redis/adapter.go` is ephemeral PubSub).

So every transport, every broker, and the orchestration layer all assume at-most-once. There is no single place that even *could* track delivery today.

### 1.2 The meta-problem: point fixes each cover one failure domain

The three sibling RFCs each pick one layer and harden it:

- **RFC A (broker-native ack):** move `msg.Ack()` to *after* the client write; use JetStream `AckWait` + `MaxDeliver` for redelivery. Solves the broker→router gap. But it is **NATS-JetStream-specific** (Kafka/Redis/core-NATS get nothing), it conflates "router received it" with "client received it" unless the ack is plumbed all the way to the transport, and it says nothing about reconnection or dedup.
- **RFC B (protocol-level client ack / resume):** add WS application-level acks and SSE `Last-Event-ID`. Solves the router→client gap and reconnection *to the same replica*. But it has **no durable store** — if the replica holding the in-flight buffer dies, the buffer dies with it — and it does not integrate with broker offsets, so redelivery semantics differ per transport.
- **RFC C (router-side WAL):** persist events to a router-local write-ahead log and replay on reconnect. Solves durability across a single router restart. But a **WAL on one replica is invisible to another replica**; in a horizontally-scaled deployment (the normal case) a reconnecting client routed to a different pod cannot find its WAL.

Each is correct *within its failure domain* and silent outside it. The deeper problem is that **at-least-once delivery is an end-to-end property** spanning broker→router→client, and it must survive **replica churn**. You cannot get an end-to-end guarantee by independently hardening three layers that do not share a delivery-state object, a cursor model, a dedup contract, or a reconnection story. You get three half-solutions that disagree at the seams — and you still have not solved multi-replica.

### 1.3 What is missing everywhere

1. **A delivery-state object.** Nothing in the code models "message M is in-flight to subscription S, dispatched at T, not yet acked."
2. **A unified contract.** Each broker/transport pair would grow its own ad-hoc retry code.
3. **Deduplication.** Redelivery without dedup turns "at-least-once" into "client gets the same event twice and double-renders." None of A/B/C address this.
4. **Multi-replica reconnection.** The single hardest problem, under-addressed by all three.
5. **Observability.** No in-flight / redelivery / dead-letter / ack-latency metrics, because there is no layer that owns the concepts.

This RFC introduces exactly one new thing — the SDM — and routes all five of those concerns through it.

---

## 2. Definitions

- **At-most-once (today):** every event is delivered zero or one times. Loss is possible; duplication is not.
- **At-least-once (goal):** every event is delivered one or more times to the **delivery boundary**. Loss is eliminated (modulo total durable-store loss); duplication is possible.
- **Delivery boundary:** the point at which the SDM considers a message "delivered" and stops redelivering it. **The boundary is defined by the active `AckTransport`:**
  - `TCPWriteOnlyTransport`: boundary = the WS/SSE write returned without error (weak; "the kernel accepted the bytes"). This is the closest thing to today's behavior plus a record.
  - `WebSocketAckTransport`: boundary = the client sent an application-level `ack` frame referencing the message id (strong; "the client's JS handler ran").
  - `SSEResumeTransport`: boundary = the client's next request carried a `Last-Event-ID` ≥ the message id (strong-ish; advanced on reconnect/poll).
- **Effectively-once-at-edge:** at-least-once redelivery **plus** a `DedupStore` that suppresses re-emission of a message id the client already received. This does not give true exactly-once (impossible across an unreliable network without a transaction protocol the client participates in), but it makes duplicates invisible at the client edge in the common cases — the practical target for GraphQL subscriptions.
- **Idempotency key:** the stable identity of an event used for dedup — provider message id, content hash, or a producer-supplied key (Section 7).
- **In-flight message:** a message that has been dispatched to a transport but not yet reached the delivery boundary. The SDM tracks the full set per subscription.
- **AckWait:** the timer after which an unacked in-flight message is redelivered.
- **MaxDeliver:** the maximum number of delivery attempts before a message is dead-lettered.

---

## 3. The Delivery Manager

### 3.1 Responsibilities

The SDM owns, per subscription:

1. **Sequencing** — assign each event a monotonic `DeliverySeq` and a stable `MessageID` (Section 7).
2. **Buffering** — hold events that are dispatched-but-unacked in the `DurabilityStrategy`.
3. **Dispatch** — hand events to the `AckTransport` for delivery, after the existing hook pipeline.
4. **Ack tracking** — record acks from the transport; advance the cursor.
5. **Redelivery** — run `AckWait` timers with backoff; re-dispatch timed-out messages up to `MaxDeliver`; dead-letter beyond.
6. **Dedup** — consult the `DedupStore` so a redelivery is suppressed if the client already got it.
7. **Ordering policy** — enforce in-order or relaxed delivery per config.
8. **Recovery** — on (re)connect, replay unacked messages via the `DurabilityStrategy`, routed by the `RoutingStrategy`.
9. **Observability** — emit delivery metrics (Section 9).

### 3.2 Where it sits

The SDM **wraps** `SubscriptionEventUpdater`. Today `Adapter.Subscribe` is handed a `SubscriptionEventUpdater` (see `provider.go` line 26 and `subscription_datasource.go` line 53). We interpose the SDM so the adapter is unaware durability exists:

```
                    BEFORE (today)                         AFTER (this RFC)

 broker adapter                                broker adapter
      │  updater.Update(events)                     │  updater.Update(events)
      ▼                                             ▼
 SubscriptionEventUpdater                     ┌─────────────────────────────────────┐
      │  per-sub hooks + write                │  Subscription Delivery Manager (SDM) │
      ▼                                       │   - seq + msgID                      │
 resolve.SubscriptionUpdater                  │   - DurabilityStrategy (buffer/cursor)│
      │                                       │   - DedupStore                        │
      ▼                                       │   - state machine + timers            │
   WS / SSE write                             └───────────────┬─────────────────────┘
                                                              │  decorates the *same*
                                                              │  SubscriptionEventUpdater
                                                              ▼
                                                  SubscriptionEventUpdater (hooks unchanged)
                                                              │
                                                              ▼
                                                  AckTransport ── resolve.SubscriptionUpdater
                                                              │        + ack/resume channel
                                                              ▼
                                                       WS / SSE write
```

The SDM is **between the adapter's `Update()` call and the hook fan-out**. It does *not* replace the hook lifecycle (`SubscriptionOnStart`, `OnReceiveEvents`, `OnPublishEvents` from `adr/cosmo-streams-v1.md`). It calls into the existing `SubscriptionEventUpdater` so `OnReceiveEvents` still runs per subscription exactly as documented, and the `StreamEvent` / `MutableStreamEvent` model is preserved end to end. The SDM operates on the **post-hook** event for delivery accounting: an event dropped by a filter hook is never tracked as in-flight (it was never meant to reach this client), which is the correct semantics.

### 3.3 The per-message state machine

Each in-flight message, *per (subscription, message)*, moves through:

```
                         ┌───────────────────────────────────────────────────────────┐
                         │                                                             │
   broker batch          │                                                            (dedup hit:
       │                 │                                                             already seen)
       ▼                 ▼                                                                 │
  ┌──────────┐  hooks  ┌──────────┐  AckTransport   ┌────────────┐                         │
  │ RECEIVED │───run──▶│ BUFFERED │──────send──────▶│ DISPATCHED │                         │
  └──────────┘  ok     └──────────┘  (persist in    └─────┬──────┘                         │
       │                    │         Durability)         │                                │
       │ hook drops         │ persist fails               │                                │
       │ event              │ (back-pressure)             │                                │
       ▼                    ▼                  ┌──────────┼───────────────┐                 │
  ┌──────────┐         ┌──────────┐            │ ack       │ AckWait       │                │
  │ DROPPED  │         │  ERRORED │            ▼ received   ▼ elapsed       ▼ write err      │
  └──────────┘         └──────────┘     ┌──────────┐  ┌──────────────┐  ┌──────────────┐   │
   (never tracked)                      │  ACKED   │  │  TIMED_OUT   │  │  TIMED_OUT   │   │
                                        └────┬─────┘  └──────┬───────┘  └──────┬───────┘   │
                                             │               │                 │           │
                                  cursor advances;           ▼                 ▼           │
                                  evict from buffer;   deliveries < MaxDeliver?            │
                                  mark seen in Dedup    │ yes              │ no            │
                                             │          ▼                  ▼               │
                                            done   ┌────────────┐   ┌──────────────┐       │
                                                   │ REDELIVERED│   │ DEAD_LETTERED│       │
                                                   └─────┬──────┘   └──────────────┘       │
                                                         │ (backoff delay)                  │
                                                         └──────────────────────────────────┘
                                                            re-enter DISPATCHED (dedup-checked)
```

State semantics:

| State | Meaning | Exit |
|---|---|---|
| `RECEIVED` | event arrived from broker, hooks not yet run for this sub | → `BUFFERED` (hooks ok) / `DROPPED` (hook filtered) |
| `BUFFERED` | post-hook, persisted in `DurabilityStrategy`, awaiting dispatch | → `DISPATCHED` / `ERRORED` (persist failed → back-pressure broker) |
| `DISPATCHED` | handed to `AckTransport`, `AckWait` timer armed | → `ACKED` / `TIMED_OUT` |
| `ACKED` | delivery boundary reached | terminal — advance cursor, evict, mark seen |
| `TIMED_OUT` | `AckWait` elapsed or write error | → `REDELIVERED` (attempts < MaxDeliver) / `DEAD_LETTERED` |
| `REDELIVERED` | scheduled for re-dispatch after backoff, dedup-checked | → `DISPATCHED` |
| `DEAD_LETTERED` | gave up after MaxDeliver | terminal — emit to DLQ, evict, alert |
| `DROPPED` | filtered by a hook for this subscription | terminal — never counted as in-flight |
| `ERRORED` | durable persist failed | terminal for this attempt — surfaced as back-pressure |

The dashed return path on the right shows dedup short-circuiting: when a `REDELIVERED` message re-enters dispatch, the SDM checks the `DedupStore`; if the client already acked an equal `MessageID` out-of-band (e.g. it reconnected and resumed past this point), the message transitions straight to `ACKED` without re-emitting.

---

## 4. Pluggable Interfaces

All four interfaces live in a new package `router/pkg/pubsub/delivery`. The SDM is the only consumer; concrete strategies are selected by config (Section 10).

### 4.1 Core SDM types

```go
package delivery

import (
	"context"
	"time"

	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

// MessageID is the stable identity of an event used for ordering, ack, dedup.
type MessageID string

// DeliveryState is the per-(subscription,message) record the SDM tracks.
type DeliveryState struct {
	SubID        resolve.SubscriptionIdentifier
	MessageID    MessageID
	Seq          uint64        // monotonic per-subscription delivery sequence
	State        MessageState  // RECEIVED..DEAD_LETTERED
	Attempts     int
	FirstSeenAt  time.Time
	DispatchedAt time.Time
	Cursor       Cursor        // opaque, owned by the DurabilityStrategy (e.g. broker offset, WAL LSN)
}

type MessageState uint8

const (
	StateReceived MessageState = iota
	StateBuffered
	StateDispatched
	StateAcked
	StateTimedOut
	StateRedelivered
	StateDeadLettered
	StateDropped
	StateErrored
)

// Cursor is an opaque, DurabilityStrategy-defined position. For broker-offset it
// wraps a partition/offset or JetStream stream sequence; for the WAL it is an LSN;
// for in-memory it is the in-process Seq. It must be encodable for the session store.
type Cursor interface {
	Encode() []byte
	// Less reports whether this cursor precedes other in the delivery order.
	Less(other Cursor) bool
}

// SubscriptionDeliveryManager wraps the existing SubscriptionEventUpdater and owns
// the at-least-once state machine for one subscription stream (one provider Subscribe call,
// which may fan out to many resolve subscriptions).
type SubscriptionDeliveryManager interface {
	// Update is the drop-in replacement for SubscriptionEventUpdater.Update. The adapter
	// calls it unchanged; the SDM sequences, persists, dispatches and tracks the batch.
	Update(events []datasource.StreamEvent)

	// Attach binds a (re)connecting client transport to a subscription, triggering replay
	// of unacked messages from the DurabilityStrategy. Called by the transport layer on
	// connect and on reconnect (possibly on a different replica via the RoutingStrategy).
	Attach(ctx context.Context, subID resolve.SubscriptionIdentifier, resume ResumeToken) error

	Complete()
	Done()
	SetHooks(hooks datasource.Hooks)
}

// ResumeToken is what a reconnecting client presents (WS resume frame or SSE Last-Event-ID).
type ResumeToken struct {
	LastAckedMessageID MessageID
	LastAckedCursor    []byte // encoded Cursor, if the client/store carries one
}
```

### 4.2 DurabilityStrategy — *where unacked state and cursors live*

This is the interface that **RFC A (broker-offset)** and **RFC C (router-WAL)** become implementations of.

```go
// DurabilityStrategy owns persistence of in-flight (unacked) messages and the
// per-subscription delivery cursor. It is the single place that decides what
// "durable" means for a given provider.
type DurabilityStrategy interface {
	// Persist records a post-hook message as in-flight before dispatch. Returns the
	// Cursor assigned to it. May block / return ErrBackpressure if the buffer is full.
	Persist(ctx context.Context, st *DeliveryState, payload []byte) (Cursor, error)

	// Ack durably marks a message delivered and advances the cursor. After Ack the
	// payload may be evicted. For broker-offset this commits the offset / JetStream ack;
	// for WAL it advances the checkpoint; for in-memory it just frees the slot.
	Ack(ctx context.Context, subID resolve.SubscriptionIdentifier, id MessageID) error

	// Unacked returns the ordered set of messages dispatched-but-not-acked for a
	// subscription, used for replay on (re)connect.
	Unacked(ctx context.Context, subID resolve.SubscriptionIdentifier, from ResumeToken) ([]InFlight, error)

	// DeadLetter records a message that exceeded MaxDeliver.
	DeadLetter(ctx context.Context, st *DeliveryState, payload []byte) error

	// Name is used for metrics labels and config validation.
	Name() string
}

type InFlight struct {
	State   DeliveryState
	Payload []byte
}

var ErrBackpressure = errors.New("durability buffer full")
```

Shipped concrete implementations:

| Impl | Durability | Notes |
|---|---|---|
| `NoOpDurability` | none | **default.** `Persist` returns an in-memory monotonic cursor and stores nothing; `Ack`/`Unacked` are no-ops. Reproduces today's at-most-once behavior exactly. |
| `InMemoryDurability` | process lifetime | ring buffer of unacked per sub; survives client reconnect to the *same* replica, lost on crash. This is what **RFC B** implicitly needs. |
| `BrokerOffsetDurability` | broker | **RFC A.** Holds the broker as the store: defers NATS JetStream `msg.Ack()` until SDM `Ack`; for Kafka switches to a consumer group and commits offsets on ack. Cursor = stream seq / partition offset. |
| `WALDurability` | disk (router-local) | **RFC C.** Append-only segment log + checkpoint; replay on restart. Cursor = LSN. |
| `ExternalStoreDurability` | shared (Redis/Postgres) | the multi-replica enabler: unacked set + cursor in a shared store keyed by subscription identity, so any replica can replay (Section 8). |

### 4.3 AckTransport — *how delivery is confirmed*

This is the interface that **RFC B (client ack / resume)** becomes an implementation of.

```go
// AckTransport abstracts how a delivery is confirmed and defines the delivery boundary.
type AckTransport interface {
	// Dispatch writes one message toward the client. For WS-ack it frames the message with
	// its MessageID; for SSE it writes an `id:` field. It MUST be non-blocking beyond the
	// transport write; ack arrival is reported asynchronously via Acks().
	Dispatch(ctx context.Context, subID resolve.SubscriptionIdentifier, id MessageID, payload []byte) error

	// Acks returns a channel of inbound acks (MessageID the client confirmed). For
	// TCPWriteOnly this fires synthetically right after a successful Dispatch.
	Acks() <-chan Ack

	// Boundary describes the guarantee strength, for metrics/logging.
	Boundary() DeliveryBoundary

	Name() string
}

type Ack struct {
	SubID resolve.SubscriptionIdentifier
	ID    MessageID
}

type DeliveryBoundary uint8

const (
	BoundaryKernelWrite DeliveryBoundary = iota // TCP write returned (weak)
	BoundaryClientAck                           // client app-level ack (strong)
	BoundaryClientResume                        // advanced via Last-Event-ID on poll/reconnect
)
```

Shipped concrete implementations:

| Impl | Boundary | Wire change |
|---|---|---|
| `TCPWriteOnlyTransport` | `BoundaryKernelWrite` | **default.** Wraps `resolve.SubscriptionUpdater.UpdateSubscription`; synthesizes an ack the moment the write succeeds. Equivalent to today plus accounting. |
| `WebSocketAckTransport` | `BoundaryClientAck` | adds an app-level `ack` message type over `graphql-ws` / `graphql-transport-ws` (extension), and a `resume` frame on reconnect. Touches `router/core/websocket.go` (today unidirectional push, no app-level ack). |
| `SSEResumeTransport` | `BoundaryClientResume` | writes the SSE `id:` field = `MessageID`; reads `Last-Event-ID` header on reconnect to derive the `ResumeToken`. No client-library change required (native EventSource behavior). |

### 4.4 DedupStore — *idempotency / seen-set*

```go
// DedupStore suppresses re-emission of an already-delivered MessageID to a client,
// turning at-least-once toward effectively-once-at-edge.
type DedupStore interface {
	// Seen reports whether id was already delivered to subID and, atomically, records it
	// if record is true. TTL-bounded so the set stays small.
	Seen(ctx context.Context, subID resolve.SubscriptionIdentifier, id MessageID, record bool) (bool, error)
	Name() string
}
```

Shipped: `NoOpDedup` (default — allows duplicates, pure at-least-once), `InMemoryLRUDedup` (per-sub bounded LRU + TTL), `SharedDedup` (Redis `SETNX`+TTL, required when `RoutingStrategy` can move a client between replicas).

### 4.5 RoutingStrategy — *sticky session / shared store*

```go
// RoutingStrategy decides where a (re)connecting subscription's delivery state lives
// and whether a client can resume on a different replica than it started on.
type RoutingStrategy interface {
	// ReplicaFor returns the replica that should own a subscription identity, for
	// affinity-based routing (consistent hashing). Empty string => "any replica" (shared store).
	ReplicaFor(identity SubscriptionIdentity) (replicaID string, sticky bool)

	// Claim attempts to take ownership of a subscription's delivery state for this replica,
	// used with a shared store to fence against two replicas serving the same sub.
	Claim(ctx context.Context, identity SubscriptionIdentity) (Lease, error)

	Name() string
}

// SubscriptionIdentity is the stable key for a logical subscription across reconnects:
// derived from client/operation identity, NOT the per-connection resolve.SubscriptionIdentifier
// (which changes on every reconnect).
type SubscriptionIdentity struct {
	ClientID    string // from auth claims / client header
	OperationID string // normalized operation hash + variables hash
	ProviderID  string
}

type Lease interface {
	Release(ctx context.Context) error
	// Done fires if the lease is lost (TTL expiry / preemption) so the replica can stop.
	Done() <-chan struct{}
}
```

Shipped: `LocalRouting` (default — no affinity, no shared state; reconnect lands wherever the LB sends it and starts fresh, i.e. today's behavior), `StickyHashRouting` (consistent-hash advisory header for the LB), `SharedStoreRouting` (lease-based, pairs with `ExternalStoreDurability`).

---

## 5. Redelivery, Timers, Backoff, MaxDeliver, Dead-Letter

The SDM runs one timer wheel per replica (not one goroutine per message) to keep overhead bounded at high subscription counts.

- **AckWait:** when a message enters `DISPATCHED`, the SDM arms a timer for `AckWait` (default `30s`). If the matching `Ack` arrives first, the timer is cancelled and the message is `ACKED`. Otherwise it fires → `TIMED_OUT`.
- **Backoff:** redelivery delay grows per attempt: `delay(n) = min(AckWait * backoffFactor^(n-1), maxBackoff)` with jitter. Defaults: `backoffFactor = 2.0`, `maxBackoff = 5m`, full jitter.
- **MaxDeliver:** default `5`. On the `MaxDeliver`-th failure the message goes to `DEAD_LETTERED` instead of `REDELIVERED`.
- **Dead-letter:** `DurabilityStrategy.DeadLetter` is invoked. For `BrokerOffsetDurability` this can route to a NATS DLQ subject / Kafka DLQ topic; for others to a configured DLQ provider; minimally it logs + increments a metric + advances the cursor so the stream is not blocked by one poison message.
- **Ordering policy:**
  - `strict`: the cursor only advances contiguously; a timed-out message blocks delivery of later messages to that subscription until it is acked or dead-lettered (head-of-line blocking, but in-order). Required for correctness-sensitive streams.
  - `relaxed` (default): later messages may be delivered while an earlier one is being redelivered; the cursor advances over a "lowest contiguous acked" watermark while tracking out-of-order acks in a small bitmap. Lower latency, possible reordering on redelivery (which is exactly today's behavior under the timeout path, so no regression).

```
AckWait timer wheel (per replica)
   tick ─▶ for each DISPATCHED msg whose deadline passed:
             attempts++
             if attempts >= MaxDeliver:  state=DEAD_LETTERED; durability.DeadLetter(); advance cursor
             else:                        state=TIMED_OUT → schedule REDELIVER at now+delay(attempts)
   redeliver ─▶ if dedup.Seen(id): state=ACKED (skip)   // client already has it
               else:               state=DISPATCHED; transport.Dispatch(); re-arm AckWait
```

---

## 6. Deduplication / Idempotency Keys

Redelivery without dedup is actively harmful for subscriptions: a client that *did* receive the event but whose ack was lost (or which reconnected past it) would re-render it.

**Event identity (`MessageID`) is resolved in priority order:**

1. **Producer-supplied key** — a header/metadata field (configurable name, e.g. NATS header `Nats-Msg-Id`, Kafka header `idempotency-key`). The existing `StreamEvent` model already carries provider headers/metadata (see `nats.MutableEvent.Headers`, Kafka `Headers`/`Key`), so we read it without schema changes.
2. **Provider message id** — JetStream stream sequence, Kafka `topic/partition/offset`, NATS reply/seq. Stable and free where available.
3. **Content hash** — `xxhash64(providerID || subject || payload)` fallback when neither of the above exists (core NATS, Redis PubSub). Note: identical payloads sent twice legitimately would hash-collide; documented caveat, opt-in.

**Seen-set:** the `DedupStore` keeps a TTL-bounded set per subscription. The TTL must exceed `MaxDeliver * maxBackoff` so a message cannot be redelivered after its dedup record expired. The set is bounded (LRU) so memory is `O(maxInFlight)` not `O(stream length)`.

**Where dedup runs:**

- On **redelivery** (Section 5): suppress re-emit if already acked.
- On **replay after reconnect** (Section 8): when a client resumes, the SDM replays `Unacked` from the cursor; any message the client already acked but whose ack was not yet persisted is suppressed by the seen-set, preventing reconnection-induced duplicates.

This is what nudges the guarantee toward **effectively-once-at-edge**. We explicitly do *not* claim exactly-once: a duplicate is still possible if the dedup record is lost (e.g. `NoOpDedup`, or a shared-store outage) — by design the system fails toward *delivery* (at-least-once), never toward *loss*.

---

## 7. Multi-Replica & Session Affinity (the centerpiece)

This is the problem A/B/C under-address and the strongest reason to centralize delivery in one layer. In any real deployment the router runs N replicas behind a load balancer. A subscription's in-flight buffer and cursor live wherever the broker-consuming goroutine and the client connection happen to be. When a client's WS/SSE connection drops and reconnects, the LB may route it to a **different replica** that has none of its delivery state.

We offer two composable mechanisms via `RoutingStrategy`, and they trade off along CAP lines.

### 7.1 Option 1 — Session affinity (sticky routing)

Consistent-hash the `SubscriptionIdentity` (client + normalized operation) to a replica. The LB (or an ingress with hash-on-header support) routes reconnects back to the owning replica, where `InMemoryDurability` / `WALDurability` still hold the unacked buffer.

```
                 ┌─────────────┐
   client ──────▶│ LB (hash on │──── h(identity)=R2 ──▶ Replica R2 (owns sub state, WAL/in-mem)
   reconnect ───▶│  identity)  │──── always R2 ──────▶ Replica R2 (buffer still here → replay)
                 └─────────────┘
```

- **Pros:** no shared store; lowest latency (state is local); WAL/in-memory durability "just works" across reconnects. **CP-leaning:** strong consistency of one owner, but availability suffers if R2 is down.
- **Cons:** if R2 **crashes**, the buffer is gone unless durability was also `WAL` (survives R2 *restart* but not R2 *replacement* in a new pod), and reconnects to R2 fail until it returns. Rebalancing on scale-up/down reshuffles ownership and can strand buffers. Requires LB support for stable hashing on an app-level key (header/cookie), which is real operational cost (Section 12).

### 7.2 Option 2 — Shared session/checkpoint store

`ExternalStoreDurability` + `SharedStoreRouting`: the unacked set, cursor, and dedup set live in Redis/Postgres keyed by `SubscriptionIdentity`. Any replica can `Claim` a lease, consume the broker, and serve the client. On reconnect to *any* replica, that replica reads the cursor + unacked set from the shared store and replays.

```
   client ──▶ LB (any) ──▶ Replica Rk ──┐
                                         │  Claim(identity) lease (fence)
                                         ▼
                              ┌──────────────────────┐
                              │ Shared store (Redis)  │  cursor, unacked[], seen-set
                              └──────────────────────┘
   reconnect ▶ LB (any) ──▶ Replica Rj ──┘  reads same keys → replays from cursor
```

- **Pros:** survives replica crash/replacement; reconnect to any replica recovers; horizontal scale without sticky LB config. The only option that gives durable at-least-once in the face of pod churn.
- **Cons:** **AP-vs-CP tension.** A lease (fence) is needed so two replicas do not both consume the broker and double-deliver — but a network partition between a replica and the store forces a choice: keep serving (risk split-brain double-delivery, mitigated by `SharedDedup`) or stop (availability hit). We choose **CP for the cursor/lease** (a replica that loses its lease via `Lease.Done()` stops consuming) and lean on `SharedDedup` to make any residual duplicate invisible. Extra latency: every `Persist`/`Ack` touches the store (mitigated by batching acks and async cursor checkpointing with a bounded window of potential re-delivery on crash).

### 7.3 Reconnect-to-different-replica recovery flow

```
1. Client WS drops (was on R2, last acked MessageID = m_42, cursor c_42).
2. Client reconnects; LB → R5 (LocalRouting would start fresh = today's loss window).
3. AckTransport derives ResumeToken{LastAckedMessageID: m_42, LastAckedCursor: c_42}
   (WS resume frame, or SSE Last-Event-ID: m_42).
4. SDM on R5: RoutingStrategy.Claim(identity) → lease acquired (fences R2 if still alive).
5. DurabilityStrategy.Unacked(subID, from=c_42) → [m_43, m_44] from shared store.
6. For each: DedupStore.Seen? no → AckTransport.Dispatch → arm AckWait.
7. Steady state resumes on R5.
```

With `LocalRouting` + `NoOpDurability` (the default), step 5 returns nothing and the client simply continues from "now" — identical to today. The guarantee scales up exactly as far as the operator opts into routing + durability.

### 7.4 Trade-off summary

| | Sticky (affinity) | Shared store |
|---|---|---|
| Survives replica crash | only with WAL + same pod identity | yes |
| Reconnect to any replica | no | yes |
| Extra per-message latency | none | store round-trips (batchable) |
| Infra dependency | LB hashing config | Redis/Postgres + lease |
| Failure mode | unavailability of owner | partition → CP stop or dedup-masked dup |
| Best for | single-region, stable fleet | autoscaled / multi-AZ |

---

## 8. Observability / Metrics Surface

Because the SDM is the one place that *knows* about delivery state, it is the natural home for delivery metrics. We extend the existing `metric.StreamMetricStore` (already used in the adapters, e.g. `nats/adapter.go` line 139) with a delivery-metrics facet. All metrics carry labels `{provider_id, provider_type, root_field, durability, transport, ordering}`.

```go
type DeliveryMetricStore interface {
	InFlight(ctx context.Context, subID resolve.SubscriptionIdentifier, n int)        // gauge
	Dispatched(ctx context.Context, m DeliveryMeta)                                    // counter
	Acked(ctx context.Context, m DeliveryMeta, latency time.Duration)                  // counter + histogram
	Redelivered(ctx context.Context, m DeliveryMeta, attempt int)                      // counter
	DeadLettered(ctx context.Context, m DeliveryMeta)                                  // counter
	DedupSuppressed(ctx context.Context, m DeliveryMeta)                               // counter
	Backpressure(ctx context.Context, m DeliveryMeta)                                  // counter
	DurabilityOp(ctx context.Context, op string, latency time.Duration, err bool)      // histogram
	ReplayOnReconnect(ctx context.Context, m DeliveryMeta, count int)                  // counter
}
```

Surfaced as OTEL/Prometheus:

- `router.edfs.delivery.inflight` (gauge) — current unacked per sub/provider.
- `router.edfs.delivery.acked_total`, `...redelivered_total`, `...dead_lettered_total`, `...dedup_suppressed_total`.
- `router.edfs.delivery.ack_latency_seconds` (histogram) — dispatch→ack; the key SLO.
- `router.edfs.delivery.durability_op_seconds` — store latency, to catch a slow shared store before it becomes back-pressure.
- `router.edfs.delivery.replay_total` — reconnect replays, with `count` of replayed messages.

These directly answer the questions operators cannot ask today: "are we redelivering?", "are messages being dropped (dead-lettered)?", "how far behind is the slowest subscriber?", "is the durable store the bottleneck?".

---

## 9. Configuration & Schema Surface

Delivery is configured per provider, with optional per-subscription (per root field) override. **The default for every knob reproduces today's behavior** via the no-op strategies, so an existing config gets byte-identical at-most-once delivery.

```yaml
version: "1"

events:
  # Optional global defaults for all providers.
  delivery:
    enabled: false            # master switch; false => NoOp everything (today's behavior)
    durability: noop          # noop | in_memory | broker_offset | wal | external_store
    transport: tcp_write_only # tcp_write_only | ws_ack | sse_resume
    dedup: noop               # noop | in_memory_lru | shared
    routing: local            # local | sticky_hash | shared_store
    ordering: relaxed         # relaxed | strict
    ack_wait: 30s
    max_deliver: 5
    backoff:
      factor: 2.0
      max: 5m
      jitter: full
    dedup_settings:
      id_source: auto         # auto | header | provider_id | content_hash
      id_header: ""           # used when id_source=header (e.g. "Nats-Msg-Id")
      ttl: 30m
      max_entries: 10000
    external_store:           # used when durability/dedup/routing need a shared store
      kind: redis             # redis | postgres
      url: "redis://localhost:6379"
      checkpoint_interval: 1s # async cursor checkpoint window
    wal:
      dir: "/var/lib/cosmo/edfs-wal"
      segment_bytes: 67108864
      fsync: interval         # always | interval | os
      fsync_interval: 200ms

  providers:
    nats:
      - id: my-nats
        url: "nats://localhost:4222"
        delivery:                 # provider-level override
          enabled: true
          durability: broker_offset   # RFC A, using JetStream durable ack
          transport: ws_ack           # RFC B boundary
          dedup: in_memory_lru
          # JetStream is required for broker_offset; validated at startup.
        subscriptions:               # per-root-field override (most specific wins)
          - root_field: employeeUpdates
            delivery:
              ordering: strict
              max_deliver: 10
```

**Config resolution order:** subscription override > provider `delivery` > global `events.delivery` > built-in no-op defaults.

**Validation at startup:** incompatible combinations are rejected with a clear error, e.g. `durability: broker_offset` on a non-JetStream NATS provider, or `routing: shared_store` without `external_store` configured, or `dedup: shared` with `routing: shared_store` but no store (shared routing *requires* shared dedup to mask cross-replica duplicates).

**Schema/directive surface:** no new GraphQL directives are required for v1 — delivery is an operational concern keyed by provider/root-field, not schema semantics. (A future `@edfs__delivery(...)` directive in `composition/src/v1/constants/directive-definitions.ts` and `shared/src/router-config/graphql-configuration.ts` could let schema authors pin `ordering: strict` for a field; explicitly out of scope here to avoid coupling delivery policy to the published schema.)

---

## 10. Architecture Diagram

```
                                  ┌──────────────────────────────────────────────────────────┐
   ┌─────────┐                    │                        ROUTER REPLICA                       │
   │ Broker  │  poll / consume    │                                                            │
   │ (NATS/  │───────────────────▶│  provider adapter goroutine (nats/kafka/redis)             │
   │ Kafka/  │                    │        │  updater.Update(events)   [adapter unchanged]      │
   │ Redis)  │◀───ack/offset──────│        ▼                                                   │
   └─────────┘   (BrokerOffset    │  ┌─────────────────────────────────────────────────────┐  │
                  Durability)     │  │  Subscription Delivery Manager (SDM)                  │  │
                                  │  │   seq + MessageID                                     │  │
   ┌──────────────┐               │  │   ┌───────────────┐  ┌────────────┐  ┌────────────┐  │  │
   │ Shared store │◀──Persist/────│  │   │ DurabilityStr.│  │ DedupStore │  │ RoutingStr.│  │  │
   │ (Redis/PG)   │   Ack/Unacked │  │   └───────┬───────┘  └─────┬──────┘  └─────┬──────┘  │  │
   │  cursor,     │               │  │           │  state machine + AckWait wheel │         │  │
   │  unacked[],  │               │  │           ▼          (Section 3.3 / 5)      │         │  │
   │  seen-set,   │               │  │   wraps SubscriptionEventUpdater (hooks: OnReceiveEvents)│
   │  leases      │               │  │           │  post-hook events                │         │  │
   └──────────────┘               │  │           ▼                                            │  │
                                  │  │      ┌────────────┐   Dispatch(id,payload)             │  │
                                  │  │      │ AckTransport│──────────────────────────────────┐│  │
                                  │  │      └─────┬──────┘   ◀───── Acks() ◀──────────────┐  ││  │
                                  │  └────────────┼──────────────────────────────────────┼──┘│  │
                                  │               ▼   resolve.SubscriptionUpdater         │   │  │
                                  │           WS / SSE write  + ack/resume channel ───────┘   │  │
                                  │               │  DeliveryMetricStore (OTEL/Prom) ◀────────│  │
                                  └───────────────┼────────────────────────────────────────────┘
                                                  │
                          ┌───────────────────────┴────────────────────────┐
                          │  LB (LocalRouting | StickyHashRouting | shared) │
                          └───────────────────────┬────────────────────────┘
                                                   ▼
                                              client (WS / SSE)
                                       sends ack frames / Last-Event-ID on resume
```

---

## 11. Considerations and Risks

We are deliberately frank here: this is the heaviest of the four RFCs and the over-engineering risk is real.

- **Complexity / over-engineering.** We are introducing a new package, four interfaces, a state machine, a timer wheel, and ~five concrete strategies. For a customer who only wants "don't lose events when my single-replica router restarts," RFC C (a WAL) alone is dramatically less code. The SDM only pays off if (a) multiple durability/transport combinations are actually needed across customers, and (b) multi-replica matters. If neither holds, this is a generalization tax. **Mitigation:** the manager is *inert by default* (no-op strategies = today's behavior, Section 13), and a single concrete combination (e.g. `in_memory` + `ws_ack`) is a small, shippable slice; we do not have to build all strategies at once.
- **Latency from the extra layer.** Even with no-op strategies, every event now flows through the SDM's sequencing/tracking. We must ensure the no-op fast path is allocation-free and adds only a few ns (a sequence increment), matching the current direct `eventUpdater.Update` path (line 39). Durable strategies add real latency (store round-trips); `BrokerOffsetDurability`/`ExternalStoreDurability` move us from microseconds to potentially milliseconds per ack — must be batched and benchmarked, and gated behind opt-in config.
- **State-store dependency.** `ExternalStoreDurability` / `SharedDedup` / `SharedStoreRouting` introduce Redis/Postgres as a hard dependency on the subscription hot path. A slow or partitioned store becomes back-pressure or unavailability. This is a new operational surface (sizing, HA, monitoring) that EDFS does not have today. We surface `durability_op_seconds` precisely to make this visible.
- **Sticky-routing operational cost.** Affinity requires LB/ingress support for stable hashing on an app-level key, plus a rebalancing story on scale events. Many managed LBs do this awkwardly. This pushes complexity into infra that the team may not control.
- **Partial-failure semantics.** The hardest correctness territory: a lease lost mid-stream, an ack persisted but the offset commit failing, a crash between `transport.Dispatch` and `durability.Persist`. We define the invariant **"persist-before-dispatch, ack-before-cursor-advance"** so the worst case is *redelivery* (at-least-once), never loss — but every strategy must be audited against it, and the bitmap/watermark cursor logic in `relaxed` ordering is subtle.
- **Coexistence with existing hooks.** The SDM must not change `OnReceiveEvents` semantics (per-sub invocation, immutable `StreamEvent`, `Clone()` for mutation — see `adr/cosmo-streams-v1.md`). Tracking post-hook events is correct but means a hook that *mutates* an event changes its content hash; if `id_source: content_hash`, dedup identity shifts. Documented: producer-supplied keys are strongly recommended when hooks rewrite payloads.
- **WS protocol extension risk.** `WebSocketAckTransport` adds app-level acks on top of `graphql-ws`/`graphql-transport-ws`, which do not define one. We must negotiate it as an optional extension and fall back to `tcp_write_only` for clients that do not support it, or we break existing clients (`router/core/websocket.go` is push-only today).
- **Migration risk.** Switching a live provider from `noop` to `broker_offset` changes broker consumption (e.g. NATS ephemeral → durable consumer, Kafka → consumer group), which has its own redelivery/offset-retention implications. This is a config-flag change but a behavioral cliff; it needs a documented runbook.

---

## 12. Migration / Rollout & Backward Compatibility

Incremental, each stage independently shippable and reversible:

1. **Stage 0 — inert manager.** Ship the SDM wrapping `SubscriptionEventUpdater` with `NoOpDurability` + `TCPWriteOnlyTransport` + `NoOpDedup` + `LocalRouting`. With `events.delivery.enabled: false` (default) the behavior is byte-identical to today; the only observable change is new (zero-valued) metrics. Validate via the existing `subscription_event_updater_test.go` suite plus golden output comparison. This de-risks the abstraction *before* any durability is added.
2. **Stage 1 — in-memory + write-confirm.** Enable `in_memory` durability + `tcp_write_only` per provider. Gains: reconnect-to-same-replica replay, in-flight/ack-latency metrics. No external dependency. Low risk, useful immediately.
3. **Stage 2 — one strong transport.** Add `ws_ack` (negotiated extension) and/or `sse_resume`. Now the delivery boundary is the client, not the kernel. Backward-compatible fallback to `tcp_write_only` for non-supporting clients.
4. **Stage 3 — broker-offset durability.** Implement `BrokerOffsetDurability` (NATS JetStream deferred ack — moving the `msg.Ack()` at `nats/adapter.go` line 154 to SDM `Ack`; Kafka consumer-group offsets). This is "RFC A" delivered as a strategy.
5. **Stage 4 — WAL durability.** Implement `WALDurability` ("RFC C" as a strategy) for cross-restart durability without an external store.
6. **Stage 5 — multi-replica.** Implement `ExternalStoreDurability` + `SharedDedup` + `SharedStoreRouting` (and/or `StickyHashRouting`). This is the capstone and the only stage that requires new infra; ship it last, behind explicit config, with a runbook.

At every stage, setting the relevant knob back to its no-op value reverts behavior, so rollback is a config change, not a redeploy.

---

## 13. Why This Over the Alternatives

The other three RFCs are not wrong — they are **incomplete in the same way**: each hardens one layer and is silent about the others and about multi-replica.

- **They are strategies, not architectures.** RFC A is `BrokerOffsetDurability`. RFC B is `WebSocketAckTransport`/`SSEResumeTransport` (an `AckTransport`). RFC C is `WALDurability`. In this design they *coexist as selectable implementations of one contract* instead of being three forks of the delivery path that must each independently re-derive sequencing, redelivery, backoff, dead-lettering, and metrics. Shipping them separately guarantees three subtly different redelivery semantics and three metric surfaces; shipping them as strategies guarantees one.
- **Only this design solves multi-replica.** A WAL on replica R2 is invisible to R5. A broker offset gives the router *re-read* but not *resume to a specific client on a different pod* (the broker does not know which of N replicas a reconnecting client landed on, nor which messages that client already acked). A WS ack with no durable store dies with its replica. The `RoutingStrategy` + shared `DurabilityStrategy`/`DedupStore` is the only proposal that lets a client reconnect to *any* replica and resume — and in a horizontally-scaled router that is the **normal** path, not an edge case.
- **Only this design makes dedup first-class.** At-least-once without dedup is a footgun for subscriptions (double-render). The `DedupStore` pushes us to effectively-once-at-edge; none of A/B/C mention it.
- **One observability surface.** Operators get a single, consistent set of delivery metrics regardless of which durability/transport they chose.

**The honest counter-argument:** if Cosmo's realistic deployment is single-replica or sticky-by-default, and only NATS JetStream needs durability, then RFC A or C alone delivers 80% of the value at 20% of the cost, and the SDM's generality is unearned. We mitigate that risk structurally — the manager is inert by default and the strategies ship incrementally — so even if multi-replica is never adopted, Stages 0–4 still leave Cosmo with a cleaner, observable, single-contract delivery layer rather than three bolt-ons. The bet of this RFC is that a unified contract is worth building *once*, and that EDFS will, sooner or later, have to answer the multi-replica reconnection question that the other three defer.
