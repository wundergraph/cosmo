# RFC: At-Least-Once for GraphQL Subscriptions — Hybrid Buffered-with-Redelivery / Router-Side Replay Buffer (Pattern E)

**Status:** Draft (revised after adversarial review)

**TL;DR.**
Cosmo's EDFS subscription path is fire-and-forget end-to-end (broker → resolve → socket write),
so any disconnect, router restart, or slow consumer silently drops events —
and only NATS JetStream has *any* durability, and even that is broken (it acks on flush attempt, not client receipt).
This RFC proposes a **router-side replay buffer**:
a bounded, ordered, in-memory log of **already-resolved response frames**, keyed by a **router-assigned monotonic sequence**,
that lets a reconnecting client replay the tail it missed before resuming live.
The whole point is that it is **backend-agnostic**:
it manufactures a replay window even for backends that have none (NATS core, Redis Pub/Sub),
turning at-most-once into at-least-once *for disconnects shorter than the window*.
Beyond the window it degrades — explicitly, never silently — to at-most-once.

The first revision of this RFC placed the buffer between the broker adapter and the engine and claimed "no engine change."
That was **wrong**, and the adversarial review was right to reject it:
the events flowing there are *raw broker bytes*, the channel is *all-subscribers*, and the wire `id` must be stamped on
the *resolved* payload on the far side of the engine boundary.
This revision corrects the layering, **admits the required graphql-go-tools engine change**, re-derives the effort estimate (now **L** for the in-process variant alone),
and tightens every guarantee claim. Where a weakness is inherent to the pattern, it is documented in §12, not hidden.

---

## 1. Problem & Context

The research dossier (`rfc/at-least-once/00-research-dossier.md`) establishes the gap precisely,
so I will only restate the parts this pattern attacks.

An application very often *already has* at-least-once in its backend:
Kafka offsets, JetStream durable consumers, Redis Streams consumer groups.
The durability is sitting right there in the broker.
But Cosmo's EDFS layer throws it away on the last hop.
The entire chain from broker callback to client socket write is **one synchronous call stack with no buffer**:
the broker-reader goroutine calls `updater.Update([]datasource.StreamEvent{...})`
(`router/pkg/pubsub/nats/adapter.go:146`, `router/pkg/pubsub/kafka/adapter.go:110`, `router/pkg/pubsub/redis/adapter.go:132`),
which drives `subscriptionEventUpdater.Update` (`router/pkg/pubsub/datasource/subscription_event_updater.go:36-129`),
which drives the engine's `handleTriggerUpdate`, the full GraphQL resolve (including federated subgraph fetches), and finally `sub.writer.Flush()` —
a single socket write under a write deadline
(`router/core/websocket.go:704-736` for WS, `router/core/flushwriter.go:116-167` for SSE/multipart).

The consequences, from the dossier's §2.1:

- **Ack is gated on flush *attempt*, not client receipt.**
  JetStream `msg.Ack()` (`router/pkg/pubsub/nats/adapter.go:154`) runs *after* `updater.Update()` returns.
  A successful `Flush()` only means bytes were handed to the kernel/TCP buffer,
  not that the client processed them.
  A client that crashes after TCP-buffering but before processing loses the message, yet it is acked → **lost**.
- **No resume / replay anywhere.**
  A reconnecting client always starts a brand-new subscription from "now".
  There is no `Last-Event-ID` handling
  (a grep of `router/core/` + `router/internal/wsproto/` for `Last-Event-ID`/`resume`/`cursor`/`resumeToken` returns nothing),
  the SSE writer never emits an `id:` field (`router/core/flushwriter.go:116-167`),
  the recognized inbound WS message set is only `Ping`, `Pong`, `Subscribe`, `Complete`, `Terminate`
  (`router/internal/wsproto/proto.go:88-94`),
  and a reconnecting client gets a fresh `ConnectionID` (`resolve.NewConnectionID()`, `router/core/websocket.go:367`)
  plus a brand-new subscription id (`router/core/websocket.go:1160-1185`).
- **Slow consumers drop events at the broker client layer.**
  NATS core uses an unbuffered channel (`make(chan *nats.Msg)`, `router/pkg/pubsub/nats/adapter.go:168`);
  on overflow the nats.go client drops events and logs `nats.ErrSlowConsumer`
  ("NATS slow consumer detected. Events are being dropped.", `router/pkg/pubsub/nats/provider_builder.go:96-105`).
  Redis Pub/Sub drops on go-redis channel overflow.
- **The backends that hurt most have no native replay at all.**
  From the dossier's §3.3,
  NATS core and Redis Pub/Sub are "delete-on-ack queues" with no cursor and no historical replay.
  Pattern B (cursor/resume) is **impossible** on those backends —
  there is no durable position to seek to.
- **WS half-open connections are not detected.**
  The WS heartbeat is an explicit **no-op** (dossier §1.6, `router/core/websocket.go:659-662`);
  the router never proactively pings downstream WS clients.
  A client that vanishes without a TCP FIN stays attached to its trigger until the *next write to it fails*.
  This is load-bearing for §3.5 below and is a hard prerequisite this RFC must address.

This is exactly the gap Pattern E exists to bridge.

If the backend is a log (Kafka, Redis Streams, Kinesis, Event Hubs, JetStream),
Pattern B (broker-cursor resume) is the right tool and Pattern E is redundant.
But the moment the chosen backend is a queue or a core pub/sub system,
the *only* way to give a reconnecting client the events it missed is for the **router itself** to have remembered them.
Pattern E is that memory:
a small, bounded, router-side log placed in front of backends that lack one.

This RFC builds directly on the **Cosmo Streams v1 hooks** (`rfc/cosmo-streams-v1.md`).
The replay buffer captures events *after* resolve, downstream of the inbound `OnStreamEvents` hook chain,
so the events it stores have already passed through data-mapping and filtering — but note carefully (§3.4) that what it stores
is the **resolved response frame**, not the raw broker event, which is what makes the layering work.

---

## 2. Goals & Non-Goals

### Goals

1. Deliver **at-least-once** to a reconnecting GraphQL subscription client
   for any disconnect **shorter than a configured buffer window**,
   on **any** EDFS backend — including the ones with no native replay.
2. Be **backend-agnostic** for the replay window itself.
   No new broker feature is required for the in-process window; broker ack-hold integration is per-backend and optional.
3. Make degradation **explicit and non-silent.**
   When the gap exceeds the window, the client learns via a typed gap signal,
   not by silently missing events.
4. Preserve the **shared-trigger broker fan-out optimization** (`rfc/at-least-once/00-research-dossier.md` §1.4) for the *broker read*:
   one broker subscription, N subscribers. (The *replay* ring is per-subscriber — see §3.4 for why this is forced, and §12 for the honest cost.)
5. Keep the memory cost an **explicit, tunable knob**, with a hard cap and a documented eviction policy.
6. Provide a clean **upgrade path** to cross-restart durability via a pluggable external buffer store,
   without changing the wire protocol — while being honest (§12) that this path largely re-implements a log backend.

### Non-Goals

1. **True end-to-end client-receipt acknowledgement.**
   That is Pattern A.
   Pattern E gives at-least-once *across reconnect within a window*, not per-message client confirmation.
   A client that stays connected but silently fails to process a flushed message is still not covered —
   the buffer can only help a client that *reconnects and asks*.
2. **Durability beyond the window.**
   We do not attempt to reconstruct arbitrarily old history.
   That is what a log backend (Pattern B) or a durable per-subscriber consumer (Pattern C) is for.
3. **Exactly-once.**
   Replay can deliver duplicates. Clients must be idempotent (dossier §6.2).
4. **Cross-router cursor portability without a shared store.**
   The router-assigned sequence is scoped to a router instance + trigger generation.
   A reconnect that lands on a different router instance (without the shared external store) cannot replay; it degrades.
5. **Changing the publish path.**
   This RFC is about the subscribe/deliver side only.
6. **Replaying *byte-identical* federated data.**
   See §3.4 and §8.5: a replayed frame is the *captured resolved output* from when the event was delivered,
   not a re-resolution. This is a deliberate design choice that avoids the thundering-herd re-fetch problem — at the cost of storing resolved bytes.

---

## 3. Design — the mechanism in depth

### 3.1 The core idea in one paragraph

Capture the **resolved response frame** that the engine produces for each subscriber, *as it is flushed*, into a bounded ring keyed by a **router-assigned monotonic sequence** (`uint64`).
Each subscriber's ring retains the last N frames (and/or the last T seconds).
On the first `Subscribe`, the subscriber starts at the live head.
On a `Subscribe` carrying a **resume token** whose `(triggerEpoch, seq)` is still inside that subscriber's ring lineage,
the router replays the stored frames from `seq+1` to the head — *without re-resolving* — then attaches the subscriber to live.
The broker ack for an event is held until the event has aged out of a short in-flight retention zone,
so the broker remains the durability backstop while the event is still "fresh".

### 3.2 The layering decision (the thing the first revision got wrong)

The first revision placed the ring between the adapter and the engine, storing the **raw broker event** and claiming the engine was untouched.
The adversarial review correctly demolished this. The two facts that force a different layering:

- **What flows pre-engine is raw broker bytes, fanned to *all* subscribers.**
  `SubscriptionUpdater.Update(data []byte)` (graphql-go-tools `resolve.go:1598`) takes the raw event payload
  (NATS `msg.Data`, Redis `msg.Payload`, Kafka record value) and fans it to *every* subscriber on the trigger.
  Resolution — `InitSubscription` + `LoadGraphQLResponseData` + `Resolve`, **including federated subgraph fetches for nested/`@requires` fields** — happens *per subscriber, per event, inside the engine* (`resolve.go:579-606`).
  A ring of raw events would therefore have to **re-run the full federated resolve on every replayed event**: a 1024-event replay on one reconnect = up to 1024× subgraph fan-out (a thundering herd), and worse, the replay would resolve against **current** subgraph state, not the state at buffer time — silently delivering *different data* under the banner of "replay". That is a correctness hole, not just a cost.

- **The wire `id` must be stamped on the *resolved* payload, downstream of resolve.**
  The resolved JSON is assembled inside the engine and written by `sub.writer.Flush()` (`resolve.go:604`, `flushwriter.go:116`).
  The seq is a router concept. There is no way to inject `extensions.cosmo.seq` into a payload the router never assembles
  unless the router sits **downstream of resolve, at the writer**.

**Conclusion: the ring stores post-resolve response frames, captured at the writer in `router/core`, per subscriber.**
This is what makes replay cheap and correct (no re-fetch, byte-stable), and it is what lets the seq be stamped at the same point it is captured.
It costs us the "one ring per trigger" memory story — resolved output is inherently per-subscriber. We accept and document that (§8.2, §12-#5).

The broker-read fan-out optimization (one broker subscription, N subscribers) is **untouched** — that lives upstream of resolve and we do not move it. Only the *replay memory* is per-subscriber.

### 3.3 Where it sits in the pipeline

```
                 ┌──────────────────────── one trigger: ONE broker subscription, N subscribers ───────────────────────┐
                 │                                                                                                      │
 broker ──msg──▶ adapter reader goroutine                                                                               │
 (nats/kafka/    │                                                                                                      │
  redis/...)     ▼                                                                                                      │
            updater.Update(rawData)   ── unchanged shared fan-out (raw bytes to all subs) ──┐                           │
                 │                                                                           │                          │
                 ▼                                                                           ▼                          │
        ┌──────────────────┐   (Cosmo Streams v1)                                  (engine fans the SAME raw event     │
        │ OnStreamEvents    │   inbound hook chain: data-map, filter, drop          to every subscriber on the trigger) │
        └──────────────────┘                                                                                            │
                 │  mapped+filtered raw event                                                                           │
                 ▼                                                                                                       │
   engine handleTriggerUpdate ──▶ executeSubscriptionUpdate ──▶ resolve (incl. subgraph fetches) ──▶ writer            │
                 │                                                                       │                              │
                 │            ┌────────── ENGINE CHANGE (graphql-go-tools) ──────────────┤                              │
                 │            │ per-subscriber writer is wrapped; engine threads an       │                              │
                 │            │ opaque per-event seq token to the writer (§3.6).          │                              │
                 │            │ New SubscriptionUpdater.Replay(id, fromSeq) entry point   │                              │
                 │            │ addresses ONE subscriber for replay (§3.6).               │                              │
                 │            └───────────────────────────────────────────────────────────────────────────────────────┘
                 ▼
        ┌────────────────────────────────────────────────────────────────────────────┐
        │ REPLAY RING (NEW, per subscriber, in router/core)                             │
        │  - on flush: capture resolved frame bytes, assign/stamp seq, store in ring    │
        │  - stamp extensions.cosmo.seq (WS/multipart) / id: line (SSE) at this point    │
        │  - on reconnect: serve stored frames seq+1..head, THEN attach to live          │
        └────────────────────────────────────────────────────────────────────────────┘
                                                                  │
                                                                  ▼
                                                       client socket (WS / SSE / multipart)
```

### 3.4 What the ring stores, and why replay is cheap

Each ring slot stores the **already-resolved, already-stamped response frame** (the exact bytes that were flushed), plus its seq and timestamp.
On replay the router writes those stored bytes back out verbatim, in seq order, then attaches the subscriber to live.

Consequences, stated honestly:

- **No re-resolve on replay, no subgraph re-fetch.** This is now *true* (the first revision's §8.6 claimed it falsely while storing raw events). Because we store post-resolve bytes, replay is a memcpy-and-write, not a federated query. The thundering-herd problem the review identified is eliminated by construction.
- **Replay is byte-stable.** The client receives exactly what it would have received live, not a re-resolution against drifted subgraph state.
- **Authorization on replay is *not* re-run by default** (changed from the prior revision; see §8.5 for the security trade-off and the opt-in re-check).
- **Memory cost is per-subscriber.** Resolved frames are subscriber-specific (different subscribers may have different `@skip`/`@include`, variables, or hook-filtered fields), so they cannot be shared across a trigger. This is the real cost of correct replay and is the dominant term in §8.2.

### 3.5 The sequence and the resume token

The router-assigned sequence is a `uint64` that monotonically increases per (trigger-epoch, subscriber-lineage).
It is **not** the broker's position; it is the router's own counter.

A resume token must survive a reconnect and be tamper-evident. It encodes:

```go
// ResumeToken is what the client echoes back on reconnect. Opaque + signed on the wire.
type ResumeToken struct {
    RouterID     string `json:"r"` // mints the token; detects cross-instance reconnect
    TriggerEpoch uint64 `json:"e"` // bumped on (re)create; detects restart / trigger rebuild
    TriggerKey   string `json:"k"` // hash of (tenant ∥ namespace ∥ rendered input ∥ headers); re-binds to authorized trigger
    Seq          uint64 `json:"s"` // last router seq the client confirms it received
}
```

On the wire the token is an opaque base64url string: the JSON above, signed (HMAC) with a router secret,
so a client cannot forge a `Seq`/`TriggerKey` to seek into another tenant's buffer (dossier §6.8).

**Token issuance is throttled, not per-event (addresses review #5).**
HMAC + JSON-marshal on *every* delivered frame at subscription fan-out rate is unbudgeted CPU and a per-event payload tax.
Instead the router stamps a full resume token at most every `token_interval` (default 1s) or every `token_every_n` frames (default 32), whichever comes first, and **always** on the last frame before a heartbeat.
Between token boundaries, frames carry only a cheap bare `seq` integer (no HMAC) under `extensions.cosmo.seq`; the signed token (`extensions.cosmo.resumeToken`) is what the client persists and echoes back.
This bounds HMAC cost to O(token_interval) regardless of event rate, and the client always has a recent signed token to resume from. The cost of throttling is a slightly larger duplicate window on reconnect (the client resumes from the last *token* boundary, replaying a few already-seen frames — safe, idempotent). This trade-off is budgeted in §12.

**TriggerKey includes a tenant/namespace discriminator (addresses review #14).**
`TriggerKey = hash(tenantID ∥ namespace ∥ providerId ∥ renderedInput ∥ subgraphHeaderSubset)`.
The tenant/namespace prefix guarantees two tenants that happen to render identical input + headers do **not** collide on the same key, closing the cross-tenant token-replay hole.

### 3.6 Components touched — including the graphql-go-tools engine change (corrects the prior "no engine change" claim)

This RFC **does** require a graphql-go-tools change. The first revision's "Cosmo-repo-only, no engine change" framing was wrong:
replay to a *single* reconnecting subscriber while co-subscribers stay live, and stamping a per-event seq onto the *resolved* frame, both live on the engine side of the boundary.

| Component | File:line anchor | Change |
|---|---|---|
| **Engine: `SubscriptionUpdater`** | graphql-go-tools `pkg/engine/resolve/resolve.go:1598` | **NEW.** Add `Replay(id SubscriptionIdentifier, frames [][]byte)` (write pre-rendered frames to one subscriber, bypassing resolve) and a way for the router to obtain the engine-minted `SubscriptionIdentifier` for a freshly (re)attached subscription. New `subscriptionEventKind` for replay frames so `handleTriggerUpdate` routes them to a single sub, not the trigger fan-out. |
| **Engine: writer seq threading** | graphql-go-tools `resolve.go:579-606`, writer interface | **NEW.** Thread an opaque per-event token from `Update`/resolve to the `SubscriptionResponseWriter`, so the router's wrapping writer (below) can stamp the correct seq onto *this* flush. |
| **Router: subscriber writer wrapper** | `router/core/websocket.go:704-736`, `router/core/flushwriter.go:116-167` | **NEW.** Wrap the per-subscriber `SubscriptionResponseWriter`. On `Flush`: assign/read the seq for this frame, stamp `extensions.cosmo.seq` (+ throttled `resumeToken`) for WS/multipart or prepend an `id:` line for SSE, capture the (post-stamp) frame into the subscriber's ring, then write to the socket. |
| **Router: WS server keepalive** | `router/core/websocket.go:659-662` | **NEW (hard prerequisite, addresses review #2/#4).** Replace the no-op WS heartbeat with a real server→client ping on `ws_keepalive_interval`; a missed pong within `ws_keepalive_timeout` tears the subscription down, marking the subscriber detached so the ack-release predicate is not pinned by a dead-but-attached client. |
| **Router: reconnect / token plumbing** | `router/core/websocket.go:1141-1185`, `router/internal/wsproto/proto.go:88-94` | Read `resumeToken` from `Subscribe` payload `extensions`; on a valid token, call the engine `Replay` path for this subscription's identifier before attaching live. No new inbound WS message type. |
| **Router: SSE/multipart** | `router/core/flushwriter.go:116-167,252-299`, `router/core/graphql_handler.go:265-293` | Emit `id:` line per SSE event; read `Last-Event-ID` request header on reconnect; map it to a resume token; replay then go live. |
| **Router: ack-hold integration** | `router/pkg/pubsub/nats/adapter.go:146,154`, `kafka/adapter.go:110`, `redis/adapter.go:132,191` | Optional, per backend. Move `msg.Ack()` out of the reader loop; register the ack handle; release on the §3.5 predicate. Groupless Kafka / Redis Pub/Sub → no-op (nothing to hold). |
| **Router: config** | `router/pkg/config/config.go:773-782` (`EventsConfiguration`) | New `delivery.replay_buffer` block (§9). |
| **Composition / proto** | `proto/wg/cosmo/node/v1/node.proto:430-434` | **No change.** Delivery semantics are router-local. |

The honest summary: **engine change + router change + new wire stamping.** This is why §12 re-estimates the in-process variant as **L**, not M, and adds a graphql-go-tools PR as an explicit work item.

### 3.7 Lifecycle — happy path and reconnect

```
T0  Client subscribes (no resume token)
       router: resolve trigger T (shared broker sub). engine mints SubscriptionIdentifier for subscriber S.
       router: per-subscriber ring created for S at head H=seq 0.
       seq 1 ─▶ resolve ─▶ stamp+capture ─▶ flush to S   (ring[S] = {1})
       seq 2 ─▶ resolve ─▶ stamp+capture ─▶ flush to S   (ring[S] = {1,2})
       seq 3 ─▶ ...                                         (ring[S] = {1,2,3}; token stamped at boundary)

T1  ── client network drops between seq 3 and seq 4 ──
       WS keepalive (§3.6) detects the dead socket within ws_keepalive_timeout and marks S detached.
       seq 4,5,6 still resolve+fan-out to OTHER live subs; for S there is no live socket.
       S's ring is held warm for warm_keep (§6 failure #3). S's seq cursor stays at 3.
       (Note: events 4..6 are NOT in S's ring unless S was the one resolving them; see §6 / §12-#6.)

T2  Client reconnects, sends Subscribe { extensions:{ cosmo:{ resume: token(epoch,T,seq=3) } } }
       router: verify signature + epoch + triggerKey == hash(tenant∥ns∥input∥headers) → OK.
       router: re-attach to trigger T; engine mints a NEW SubscriptionIdentifier S'.
       router: re-associate S' with S's warm ring via TriggerKey (§8.3).
       router: REPLAY stored frames 4,5,6 (if present) via engine Replay(S', frames) — verbatim bytes, no re-resolve.
       router: attach S' to live at head.
       seq 7 ─▶ S'   (live again)

T2' Alternate: gap too large / warm ring expired / different tenant-keyed trigger.
       seq 3 not in ring (evicted, or warm_keep elapsed, or TriggerKey differs).
       router emits typed GAP signal (extensions.cosmo.delivery.gap = {from:3,to:<head-1>, reason}) then goes live.
       NON-SILENT degradation.
```

A subtlety the review surfaced and §6 / §12-#6 make explicit: for a *single* dropped subscriber, frames 4..6 only exist in its ring if the router kept resolving them for that detached subscriber during the gap. Doing so would mean resolving (and paying subgraph cost) for a client that is gone. The design therefore offers two warm-keep modes (§6 failure #3): **frame-capture warm-keep** (keep resolving for the absent subscriber, capturing frames — costs subgraph fetches for a gone client) and **cursor-only warm-keep** (cheaper; only replays what was already in the ring at drop time, which for a sole subscriber on a trigger is just the pre-drop tail). This is an inherent tension and is documented, not hidden.

### 3.8 When does the broker ack fire? (reconciled with backpressure, addresses review #4)

The first revision's predicate ("delivered to all current subscribers AND aged past grace") deadlocks against undetectable half-open WS clients and re-couples ack to the slowest consumer — contradicting the backpressure claim in §8.4. Both are fixed here.

We define a per-event **ack-release predicate that does *not* depend on per-subscriber delivery**:

```
release broker ack for event e  ⟺  (now - e.firstSeenAt) >= AckHoldGrace
```

That is the whole predicate. Rationale and the honest trade-off:

- **Why drop the "delivered to all subscribers" clause.** The review showed two fatal interactions with it:
  (a) a half-open WS client that is dead-but-attached (no proactive ping, dossier §1.6) is never observed to "fail to deliver",
  so "delivered to all" never becomes true and the ack is pinned forever (until grace anyway);
  (b) a slow subscriber on a shared trigger pins the broker ack for the *whole* trigger, re-introducing the head-of-line coupling §8.4 claims to remove.
  Releasing purely on age decouples the broker ack from any individual subscriber's fate — the broker reader writes the raw event to the engine and the ack timer starts; it is never blocked by a slow or dead consumer. **This is what makes the §8.4 backpressure improvement real.**
- **The cost of dropping it.** The ack no longer reflects "everyone got it"; it reflects "this event has had its grace window". Recovery within grace relies on (i) the router ring for clients that reconnect, and (ii) broker redelivery for backends that have it. A subscriber that drops *just before* an event arrives, on a no-redelivery backend, past grace, gets a gap signal. That is the inherent ceiling of this pattern and is stated in §6.
- **WS keepalive is a hard prerequisite** (§3.6). Without proactive server pings, a half-open WS client is never detached and keeps consuming a ring slot and (under frame-capture warm-keep) keeps triggering resolves. The keepalive bounds half-open detection to `ws_keepalive_timeout` rather than "next failed write, possibly never".

`AckHoldGrace` is bounded by the backend's ack-wait budget to avoid the broker *also* redelivering (a duplicate source):
default `min(ack_hold_grace_config, backendAckWait/2)`. **Caveat (review #16):** EDFS does not surface JetStream `AckWait` today (dossier §3.1), so `backendAckWait` is read from `msg.Metadata()`/consumer info if available (a new read) and otherwise falls back to a static `30s` assumption — documented as a guess, with the `duplicates_suspected` metric (§10) as the canary.

Slow-consumer / backpressure interaction:
because the broker ack releases on age (not on subscriber delivery), **a slow subscriber no longer head-of-line-blocks the broker reader or pins the ack**.
A subscriber whose ring fills (it cannot keep up) falls off its own ring tail → typed gap signal, then jump to live.
This converts today's *silent* slow-consumer drop (NATS core / Redis) into an *explicit, observable* one — without coupling co-subscribers.

---

## 4. Wire protocol & client changes

The router hands the client a stable, monotonic `seq` per delivered frame (cheap integer) and a periodically-refreshed signed `resumeToken` (§3.5); the client echoes the last token on reconnect.

### 4.1 graphql-transport-ws (modern graphql-ws) and graphql-ws (legacy subscriptions-transport-ws)

No new message types (`Ping/Pong/Subscribe/Complete/Terminate` at `proto.go:88-94` unchanged). Two existing extension points:

**Server → client: stamp inside `Next` (at the writer, post-resolve — §3.6).**

```jsonc
{
  "id": "sub-1", "type": "next",
  "payload": {
    "data": { "employeeUpdates": { "id": 100 } },
    "extensions": {
      "cosmo": {
        "seq": 42,                                 // cheap per-frame integer
        "resumeToken": "AAAB...signed"             // present only at token boundaries (§3.5)
      }
    }
  }
}
```

**Client → server: carry the resume token on (re)`Subscribe`.**

```jsonc
{
  "id": "sub-1", "type": "subscribe",
  "payload": {
    "query": "subscription { employeeUpdates { id } }",
    "variables": {},
    "extensions": { "cosmo": { "resume": "AAAB...signed" } }   // last token the client persisted
  }
}
```

Backward-compatible: a stock graphql-ws client that ignores `extensions.cosmo` and never sends `resume` behaves exactly as today (at-most-once). A Cosmo-aware client (or the Cosmo TS SDK helper) persists the latest `resumeToken` and echoes it.

**Legacy `subscriptions-transport-ws` and `absinthe` (addresses review #15).** The dossier (§1.6) lists three WS subprotocols. The `extensions.cosmo` stamping is harmless on the legacy `graphql-ws` and `absinthe` subprotocols, but those client libraries do not persist/echo a resume token. **Behavior on those two subprotocols: no resume, always at-most-once**, negotiation reports `class: "at-most-once"`. We do not invest in resume for the deprecated subprotocols.

**Client token-persistence durability (addresses review #5).** Resume across a *hard* client crash requires the client to have persisted the latest `resumeToken` to durable storage (localStorage/IndexedDB/disk). Browsers and mobile frequently lose in-memory state on crash. The SDK helper persists tokens to durable storage on a debounce; clients that do not persist simply resume from wherever they last durably recorded, replaying a slightly larger (idempotent) duplicate tail. This is documented as a client responsibility, not a router guarantee.

### 4.2 graphql-sse and plain SSE

SSE is the happy case: the resume primitive is native (dossier §4.1). Today `flushwriter.go:116-167` writes only `event:`/`data:`. We add the `id:` line (the value is the signed resume token, emitted at every token boundary; bare frames between boundaries reuse the last id, which browsers tolerate):

```
id: AAAB...signed
event: next
data: {"data":{"employeeUpdates":{"id":100}}}

```

The browser's `EventSource` tracks the last `id:` and sends it as `Last-Event-ID` on auto-reconnect. The router reads it (new path in the SSE handler), maps it to a `ResumeToken`, replays, then goes live. **Stock browsers get reconnect-replay for free** once the server emits `id:` and honors the header.
`multipart/mixed` has no native id; the token rides in the body `extensions.cosmo` (same as WS) and the SDK echoes it on resubscribe.

### 4.3 Capability negotiation (corrected: connection-level vs operation-level — addresses review #6)

The first revision reported the concrete `class`/`windowSeconds` in `connection_ack`. That is an **ordering bug**: `connection_init`/`connection_ack` is a *connection-level* handshake that completes *before* any `Subscribe`, so before the operation is parsed and the trigger/provider (and thus the class/window) is known. A single connection can also multiplex subscriptions hitting different providers with different classes.

The corrected split:

- **`connection_ack` advertises only the capability**, not the concrete class:

  ```jsonc
  // connection_ack (server → client) — connection level
  { "type": "connection_ack", "payload": { "cosmo": { "delivery": { "supportsResume": true } } } }
  ```

- **The concrete class/window is reported *per subscription*, on the first `Next` of that operation** (after the trigger is resolved):

  ```jsonc
  // first Next for sub-1 (server → client) — operation level
  { "id": "sub-1", "type": "next",
    "payload": { "data": { ... },
      "extensions": { "cosmo": { "delivery": { "class": "at-least-once-window", "windowSeconds": 60, "windowEvents": 1024 }, "seq": 1, "resumeToken": "..." } } } }
  ```

For SSE, the per-operation class is emitted as a leading comment frame (`: cosmo-delivery {...}`) before the first data event. The client thus learns the *actual* per-operation guarantee once the backend is known — and can decide whether to also run an app-level catch-up (Pattern F) as a backstop for long disconnects.

### 4.4 Fallback when a client/transport cannot participate

Never silent:

- **Stock client / no resume token**: at-most-once exactly as today; per-operation `class: "at-most-once"`.
- **Legacy `graphql-ws` / `absinthe` / non-SDK multipart**: at-most-once (§4.1).
- **Buffer disabled in config**: `class: "at-most-once"`; `seq`/`id` still emitted (harmless); resume tokens rejected with a typed `delivery.unsupported` extension.

---

## 5. Per-backend adaptability & degradation matrix

Pattern E's thesis: **you can pick any *currently-supported* backend and still get a window of at-least-once**, with degradation made explicit. The matrix is split (addresses review #9) into backends EDFS supports today and a clearly-labelled *unverified design sketch* for backends EDFS does not yet have. Presenting speculative adapters as "Yes, supported" was misleading; the dossier (§3.1) is explicit that SQS/Pub-Sub/Kinesis/Event Hubs/RabbitMQ are **not supported in EDFS today**.

### 5.1 Supported today

| Backend | How | Guarantee with Pattern E | Degradation / fallback |
|---|---|---|---|
| **NATS core** | Buffer is the *only* net. Ack handle = no-op. | **At-least-once within window, *while the trigger and broker read stay continuously alive*** (see qualifier below). Flagship case: today silently drops on slow-consumer (`provider_builder.go:96-105`); Pattern E gives a real reconnect window + explicit overflow. | Beyond window → at-most-once (gap signal). No broker-redelivery backstop. Trigger teardown loses the window (qualifier below). |
| **NATS JetStream** | Redundant with B/D. Ack handle = `msg.Ack()` under the §3.8 predicate. | At-least-once within window **plus** broker-redelivery backstop within `AckWait`. | **Prefer Pattern B** (true broker cursor) for gaps beyond the window. Pattern E here mainly fixes the ack timing (dossier bugs #1–#4). |
| **Kafka** | Groupless (today's default): ack handle = no-op; buffer-only. See the hard qualifier below. | At-least-once within window **only while the trigger stays alive and reading**; the broker backlog is *not* recoverable (see below). | **Prefer Pattern B** (native `(partition,offset)` cursor) for long gaps. |
| **Redis Pub/Sub** | Buffer is the only net. Ack handle = no-op. | **At-least-once within window** (same continuity qualifier as NATS core). Turns silent go-redis overflow drops into explicit window + gap. | Beyond window → at-most-once (gap). No redelivery backstop. |
| **Redis Streams** (if/when adapter adds Streams mode) | Ack handle = `XACK`. | At-least-once within window + PEL backstop within grace. | **Prefer Pattern B** (entry-id cursor) for long gaps. |

**Hard qualifier for no-replay / reset-to-now backends (addresses review #8).**
For **NATS core**, **Redis Pub/Sub**, and **groupless Kafka**, the window holds **only while the trigger and its broker read are continuously alive**.
The router ring can only contain events the broker read *delivered to the engine*. Cross the warm-keep boundary or any trigger rebuild and:
- NATS core / Redis Pub/Sub: events published during the gap were never read → not in the ring → gone.
- **Kafka groupless re-subscribes with `ConsumeResetOffset(AfterMilli(now))` (dossier §2.3): on any trigger rebuild or router restart it *skips the entire downtime backlog at the broker* — before the ring can ever see those events.**
So the matrix's "at-least-once within window" for these backends means: *for a disconnect during which the trigger stayed up and kept reading*. It does **not** survive a trigger teardown or restart. This narrows the real-world guarantee substantially and is restated in §6.

### 5.2 Unverified design sketch (NOT supported in EDFS today)

These backends do **not** exist in EDFS (dossier §3.1). The rows below are *design sketches*, not validated behavior, and must not be read as "supported".

| Backend | Sketched ack handle | Sketched guarantee | Known concern |
|---|---|---|---|
| **AWS SQS (Std/FIFO)** | `DeleteMessage`, grace ≤ visibility timeout | window + SQS redelivery backstop | Unverified; no adapter exists. |
| **Google Pub/Sub** | `ack`, grace ≤ ack deadline | window + redelivery backstop | Has native `seek`/snapshots → prefer B. Unverified. |
| **AWS Kinesis** | checkpoint on release | window only | **Coarse checkpointing:** KCL checkpoints are sequence-number high-water marks, *not* per-message. "Release ack for event e" cannot be expressed: advancing the checkpoint past e abandons any unreleased e' < e. Per-event ack-hold does **not** map. Sketch is likely unworkable as drawn. |
| **Azure Event Hubs** | checkpoint on release | window only | Same coarse-checkpoint problem as Kinesis. |
| **RabbitMQ / AMQP** | `basic.ack`, requeue-on-channel-loss backstop | window + requeue backstop | Requeue may reorder (dossier §6.1). Unverified. |

**The decision rule, stated plainly:**
on **no-cursor / delete-on-ack backends (NATS core, Redis Pub/Sub)**, Pattern E is the *primary and only* in-router mechanism for reconnect-replay — use it, subject to the continuity qualifier.
On **log/cursor backends (Kafka, Redis Streams, JetStream)**, Pattern E is *redundant* with Pattern B and B is strictly better for long gaps — use E there only for a single uniform short-window code path or to fix JetStream's ack timing.

---

## 6. Delivery semantics achieved

Stated precisely, with the failure windows that remain.

**Within the buffer window** (disconnect duration < `windowSeconds`, missed events < `windowEvents`, reconnect lands on the same router instance with the trigger epoch intact, **and the trigger/broker read stayed continuously alive throughout the gap** — see §5.1 qualifier):

- **At-least-once.** Every event the client missed during the gap that the router captured into the ring is replayed verbatim.
- **Duplicates are possible** → at-least-once, not exactly-once. Sources:
  (a) a frame flushed to the client's TCP buffer right before the drop, that the client *did* process, but whose seq it had not yet durably recorded → replayed again;
  (b) token throttling (§3.5) means the client resumes from the last *token boundary*, replaying a few already-seen frames;
  (c) on redelivery-capable backends, a misconfigured `AckHoldGrace` above the broker ack-wait makes the broker also redeliver.
  **Clients must be idempotent** (dossier §6.2). The router surfaces a stable idempotency key (the router `seq`, and where available the broker key/`Nats-Msg-Id`) for client dedup.
- **Ordering** is preserved **within a trigger**: the router assigns `seq` in arrival order and replay walks stored frames in `seq` order before attaching to live. **Strict serialization point (addresses review #11):** because the engine dispatches each event to a per-subscriber `workChan` and resolve is async per subscriber (`resolve.go:1037`), the router must serialize at the *writer*: the wrapping writer holds a per-subscriber gate that flushes all replay frames (already resolved, just bytes) before releasing the first live frame for that subscriber. Replay frames are pre-resolved bytes, so they cannot race subgraph fetches against live frames — but the gate is still required so a live frame that finishes resolving first does not jump ahead of a not-yet-written replay frame. This gate is specified as part of the §3.6 writer wrapper.
- Ordering is *not* global across triggers (it never was — dossier §6.1) and is only as good as the order the backend delivered to the adapter (partition/subject-scoped).

**Beyond the buffer window** (gap too long, too many events, fell off the ring tail, trigger torn down, or backend reset-to-now skipped the backlog):

- **At-most-once**, *explicitly signalled*. The router emits a typed `extensions.cosmo.delivery.gap = { from, to, reason }` (or SSE `: gap {...}`) then attaches to live. The client knows it has a hole and can run an app-level catch-up query (Pattern F). This is the deliberate, non-silent degradation that satisfies Goal 3.

**Across router restart (in-process buffer):**

- The in-process ring is **lost**; the `TriggerEpoch` in every minted token no longer matches → epoch mismatch → gap → at-most-once. This is the headline limitation; the durable store variant (§9, §12) fixes it at the cost of an external dependency and hot-path write amplification.

**Across router HA / multi-instance:**

- A reconnect landing on a *different* instance than the one that minted the token cannot replay (`RouterID` mismatch) → gap. Mitigations: sticky sessions, or the durable shared store.

**Failure windows that remain even within the window:**

1. **Client processes a flushed frame but never durably records its seq** — gets a *duplicate* on reconnect (safe, idempotent), not a loss. Pattern E has no per-message client ack (that is Pattern A).
2. **Event arrives during the exact instant of disconnect** — captured if the router was still resolving for that subscriber; otherwise subject to the warm-keep mode (failure #3).
3. **Trigger torn down between disconnect and reconnect** (last subscriber left → trigger context cancelled → adapter goroutine stopped → broker subscription dropped) — the ring is freed, epoch gone on rebuild → gap. To hold the window open we keep a subscriber's ring **warm** for `warm_keep` after it detaches, in one of two modes:
   - **cursor-only warm-keep (default, cheap):** keep the already-captured ring tail; do *not* keep resolving for the absent subscriber. For a *sole* subscriber on a trigger this means only the pre-drop tail is replayable; events published during the gap are not captured. Honest and cheap.
   - **frame-capture warm-keep (opt-in, costly):** keep resolving and capturing frames for the absent subscriber during the gap, so the gap tail is replayable — at the cost of running subgraph fetches for a client that is gone, and pinning the trigger to one instance.
   This is an inherent tension (you cannot capture resolved frames for an absent subscriber without resolving for it) and is documented, not papered over.
4. **Half-open WS not detected** before keepalive timeout (§3.6) — the subscriber holds a ring slot (and, under frame-capture mode, triggers resolves) until `ws_keepalive_timeout`. The keepalive bounds this; without it (the prior revision's assumption) it would be unbounded.

---

## 7. (folded into §6)

*Delivery semantics are covered in §6; §8 is Cross-cutting concerns. This stub preserves the required template numbering; §6 is the authoritative semantics section.*

---

## 8. Cross-cutting concerns

### 8.1 Router HA / horizontal scaling & sticky sessions

The single biggest design axis (dossier §6.6) and Pattern E's softest spot. The in-process ring is bound to one instance. Three modes:

1. **Single instance / sticky sessions (recommended default for in-process).** Reconnects of a given connection route back to the same instance (cookie/consistent-hash at the LB). Ring is in RAM; replay is local and fast. Restart still loses the ring (epoch bump → gap).
2. **Multi-instance, no stickiness, in-process buffer.** Reconnect may land anywhere; `RouterID` mismatch → gap → at-most-once. Honest but weak. Negotiation reports a shorter effective window (or `at-most-once`) when the deployment advertises >1 instance without stickiness.
3. **Durable shared buffer store (the +L variant, §12).** Ring persisted to an external store (Redis sorted set keyed by `(routerFleetId, triggerKey, epoch)`, score = `seq`) shared by the fleet. Any instance can replay; survives restart. Cost: external dependency on the hot path, write amplification of *resolved frames* (larger than raw events), and the store becomes the ordering authority. **Warm-keep tension (addresses review #19):** keeping a trigger warm pins its broker subscription and ring to one instance, which conflicts with mode 2's no-stickiness; warm-keep is only meaningful under stickiness (mode 1) or when the ring lives in the shared store (mode 3). Stated explicitly so operators do not enable warm-keep expecting it to help under mode 2.

### 8.2 Per-subscription state / memory cost

The explicit cost knob (Goal 5) — and, post-layering-correction, larger than the prior revision implied because the ring is **per subscriber** and stores **resolved frames** (typically bigger than raw events):
`Memory ≈ Σ_subscribers (windowEvents × avgResolvedFrameSize)`.
There is no per-trigger sharing of replay memory (resolved output is subscriber-specific, §3.4). This is the honest cost of correct, no-re-resolve replay.
Hard caps: `windowEvents` (count) and `windowBytes` (per subscriber), whichever binds first, plus a global ceiling `maxTotalBytes` across all subscribers (LRU-evict whole subscriber rings under global pressure, downgrading those subscribers to at-most-once with a gap on next reconnect). The buffer never grows unbounded; backpressure on a slow consumer is "fall off the tail", never "grow the ring".

### 8.3 Multi-tenant shared-trigger fan-out and reconnect re-association (addresses review #7)

Cosmo's shared trigger (one broker subscription per input+headers hash, fanned to N clients — dossier §1.4) is **preserved for the broker read** (§3.2). What is *not* shared is replay memory (§8.2).

On reconnect, the engine mints a **new** `ConnectionID` + `SubscriptionIdentifier` (dossier §1.4, `websocket.go:367,1168`). The router must re-associate the new subscription with the prior warm ring. The mechanism:

- The resume token carries `TriggerKey = hash(tenant ∥ namespace ∥ providerId ∥ renderedInput ∥ headerSubset)`.
- On reconnect, the router computes the *current* subscription's `TriggerKey` from its (freshly authenticated) operation and headers, and looks up a warm ring under `(RouterID, TriggerKey, TriggerEpoch)`.
- If found and seq is in range → replay; else → gap signal.

**Header-sensitive keying is an inherent limitation (documented, not hidden).** Because `TriggerKey` includes the subgraph header subset, a client that reconnects with a *rotated* auth token or a changed locale header computes a *different* `TriggerKey` → no warm ring match → gap signal. For deployments where per-request headers vary across a connection's lifetime (auth token rotation is common), this materially narrows same-trigger resume. Two responses:
- Configure the `headerSubset` to exclude volatile headers (auth tokens) from the key where the operation's *data* does not depend on them — operator's call, with the security caveat that the ring then spans header values.
- Accept the gap and pair with Pattern F for those deployments.
This is called out so nobody discovers it in production.

The one wrinkle on **subscriber-specific inbound filtering**: if an `OnStreamEvents` hook filters events differently per subscriber, the per-subscriber resolved-frame ring is *already* correct by construction — each subscriber's ring holds only the frames that subscriber actually received. (This is a side benefit of per-subscriber resolved-frame storage over the prior shared-raw-ring design.)

### 8.4 Backpressure

Pattern E **improves** backpressure relative to today, and this is now consistent with the §3.8 ack predicate (the prior revision contradicted itself here). Currently a slow client blocks the broker reader for the whole shared trigger (per-trigger-serial backpressure, dossier §2.2). With the per-subscriber ring **and an age-based (not delivery-based) ack release**, the broker reader fans the raw event to the engine and the ack timer starts immediately — it is never blocked by a slow or dead subscriber. Each subscriber's flush proceeds at its own pace; a subscriber that cannot keep up falls off its own ring tail → explicit gap, not a stall and not a silent drop, and not a pinned broker ack. The bounded cost is held broker acks (capped by `AckHoldGrace` and a `max_in_flight_acks` per trigger); when the in-flight cap is reached the broker reader pauses (restoring backpressure to the broker, the safe direction).

### 8.5 Security / authz

- **Resume tokens are opaque + HMAC-signed + tenant/namespace-scoped** (§3.5, dossier §6.8). `TriggerKey` includes a tenant∥namespace discriminator (review #14), closing the cross-tenant collision hole. The token only selects a position *within* a trigger the *current, freshly-authenticated* subscription resolves to; a mismatch is "no resume", never a cross-trigger seek.
- **Replay serves *captured resolved frames*, not a re-resolution (changed from the prior revision; addresses review #18).** Because the ring stores the bytes that were already authorized and resolved at delivery time, replay re-emits *exactly* those bytes. The security trade-off, stated honestly: an event that was authorized when captured but whose authz has since been **revoked** would, on naive replay, be re-emitted to the (re-authenticated) client. Two mitigations:
  - **Short window by design** bounds the staleness exposure (seconds-to-minutes, vs Pattern B over multi-day retention).
  - **Opt-in `revalidate_on_replay`** (config, default off): on replay the router re-runs the subscription's authz hook (`SubscriptionOnStart` / claim check) once per reconnect, and if the *current* auth no longer satisfies the subscription, it suppresses replay and emits a gap. This does **not** re-resolve field data (no subgraph re-fetch); it only re-gates the whole replay. Operators who need per-field revocation precision must use Pattern B/C with current-authz re-resolution and accept its cost.
  The prior revision claimed replay "re-runs authz per event with current authentication"; that was only true if replay re-resolved, which it must not (review #2). This revision is precise about the trade-off instead.

### 8.6 Interaction with existing Cosmo Streams hooks

- The ring is populated **at the writer, after resolve**, so it holds fully-resolved per-subscriber frames. Data-mapping and resolve are **never** re-run on replay (now *true*, because we store resolved bytes — the prior revision claimed this while storing raw events, which was false).
- `SubscriptionOnStart` runs on every (re)subscribe, including reconnects, before any replay — so the initial-message hook and authz hook fire as normal, and the replay tail follows the initial message. A reconnect that wants to suppress a duplicate initial message can inspect the resume token via the hook context.
- **The abandon-on-timeout reorder path (`subscription_event_updater.go:69-79`) is *upstream* of the ring and is NOT resolved by Pattern E (corrects the prior revision's false claim, review #11).** That path runs before resolve, in the inbound hooks fan-out; a hook that abandons in-flight delivery still produces out-of-order or dropped events *into* the resolve stage, and the ring faithfully captures whatever order it was flushed in. Pattern E removes the *post-resolve* slow-subscriber stall (that subscriber just falls behind its own cursor), but it does not touch the hooks-path reorder warning. Honest scope.

---

## 9. Configuration surface

Router YAML, under the existing `events` block (`router/pkg/config/config.go:773-782`). A new `delivery` sub-block, off by default:

```yaml
version: "1"

events:
  providers:
    nats:
      - id: my-nats
        url: "nats://localhost:4222"

  # NEW: router-side replay buffer (Pattern E). Off by default.
  delivery:
    replay_buffer:
      enabled: true                 # default false → today's at-most-once behavior, unchanged

      # The window — guarantee holds for gaps smaller than BOTH limits. Per subscriber.
      window_events: 1024           # max resolved frames retained per subscriber ring
      window_seconds: 60            # max age retained per subscriber ring
      window_bytes: 8MiB            # hard byte cap per subscriber ring (whichever binds first)

      # Resume-token issuance throttle (§3.5) — bounds HMAC cost on the hot path.
      token_interval: 1s
      token_every_n: 32

      # Warm-keep after a subscriber detaches (§6 failure #3).
      warm_keep: 60s
      warm_keep_mode: cursor_only   # cursor_only (cheap, default) | frame_capture (costly)

      # WS server keepalive (§3.6) — hard prerequisite for half-open detection.
      ws_keepalive_interval: 15s
      ws_keepalive_timeout: 30s

      # Ack-hold (§3.8). Clamped to backendAckWait/2 when readable, else static guess.
      ack_hold_grace: 30s
      max_in_flight_acks: 4096      # per trigger; broker reader pauses when reached

      # Security (§8.5).
      revalidate_on_replay: false   # re-gate the whole replay against current authz on reconnect

      # Global safety ceiling across all subscriber rings; LRU-evict whole rings under pressure.
      max_total_bytes: 1GiB

      # Cross-restart / HA durability. Default in_process (lost on restart).
      store:
        type: in_process           # in_process | redis
        # redis:
        #   provider_id: my-redis
        #   key_prefix: cosmo:replay:
        #   ttl: 120s
```

**Per-provider override** (a backend with a native log may want the buffer off, deferring to Pattern B):

```yaml
events:
  providers:
    kafka:
      - id: my-kafka
        brokers: ["localhost:9092"]
        delivery:
          replay_buffer:
            enabled: false         # prefer Pattern B (native offset cursor) here
```

**Schema-directive / proto additions: none required.** Delivery semantics are a router-local operational concern; the same composed graph should be deployable with or without a buffer. *Future extension (out of scope for v1):* a per-field `@edfs__delivery(class: ...)` directive — that is Pattern G territory and would require the proto/composition changes this RFC avoids.

---

## 10. Migration & backward compatibility

- **Opt-in.** `events.delivery.replay_buffer.enabled` defaults to `false`. Off → byte-for-byte today's behavior: no `seq`/`id` stamping, no token reading, at-most-once, shared trigger as-is.
- **Default behavior unchanged.** Existing graphs/clients/brokers continue exactly as before.
- **Stock clients keep working when enabled.** A client that ignores `extensions.cosmo` / `Last-Event-ID` gets at-most-once (negotiation reports it). The stamping is additive and ignored by spec-compliant clients.
- **Rollout sequence.**
  1. Land the graphql-go-tools change (`Replay` entry point + writer seq threading) and the router WS keepalive — these are prerequisites and the keepalive is independently valuable.
  2. Ship the writer wrapper + ring + token plumbing behind the flag (in-process), targeting **NATS core / Redis Pub/Sub first** where it delivers the most net-new value.
  3. Ship the SSE `Last-Event-ID` path (free reconnect-replay for browsers).
  4. Ship the JetStream ack-timing fix (move `msg.Ack()` under the §3.8 predicate) — a correctness win even without resume.
  5. Ship the `redis` durable store for cross-restart/HA, gated separately (see §12 for the "why not just use a log backend" argument before building this).
- **Interop with other patterns.** On log backends, recommend Pattern B over E (per-provider `enabled: false`). Pattern E is the substrate that makes the *non-log* backends reach parity, composing cleanly under a future Pattern G negotiation layer.
- **Observability for migration.** Emit metrics from day one (§10 list below). The gap-signal and duplicates counters are the canaries.

---

## 11. Appendix: new/changed Go types

Sketches, in the style of `rfc/cosmo-streams-v1.md` Appendix 1. Partial, illustrative.

```go
package replay

import (
    "sync"
    "time"
)

// SeqNum is the router-assigned monotonic sequence, scoped per (triggerEpoch, subscriber lineage).
type SeqNum uint64

// CapturedFrame is one slot in a subscriber's ring: the EXACT post-resolve, post-stamp bytes
// that were flushed to the client. Replay re-emits these verbatim — no re-resolve, no subgraph fetch.
type CapturedFrame struct {
    Seq      SeqNum
    Bytes    []byte    // resolved + stamped response frame
    StoredAt time.Time
}

// SubscriberRing is per subscriber (NOT per trigger): resolved frames are subscriber-specific.
type SubscriberRing struct {
    mu         sync.Mutex
    epoch      uint64
    triggerKey string            // hash(tenant ∥ ns ∥ provider ∥ input ∥ headerSubset)
    head       SeqNum
    frames     []CapturedFrame   // bounded by window_events / window_bytes
    oldestSeq  SeqNum
    bytes      int
    detachedAt time.Time         // warm-keep clock; zero while live
    cfg        ReplayBufferConfig
}

// Capture stamps seq onto the frame (caller did the JSON/SSE stamping), stores it, evicts the tail.
func (r *SubscriberRing) Capture(seq SeqNum, stamped []byte, now time.Time)

// Replay returns stored frames (seq+1..head) for verbatim re-emit via the engine Replay entry point.
// ok=false means fromSeq fell off the tail / warm-keep expired → caller emits a Gap signal.
func (r *SubscriberRing) Replay(fromSeq SeqNum) (frames []CapturedFrame, ok bool)
```

```go
// ResumeToken — base64url(JSON)+HMAC on the wire. Issued at throttled boundaries (§3.5), not per event.
type ResumeToken struct {
    RouterID     string `json:"r"`
    TriggerEpoch uint64 `json:"e"`
    TriggerKey   string `json:"k"` // tenant/namespace-scoped (§8.5)
    Seq          SeqNum `json:"s"`
}

func Encode(t ResumeToken, secret []byte) string
func Decode(s string, secret []byte) (ResumeToken, error) // verifies HMAC

type GapSignal struct {
    From   SeqNum `json:"from"`
    To     SeqNum `json:"to"`
    Reason string `json:"reason"` // "window_exceeded"|"epoch_mismatch"|"tail_eviction"|"cross_instance"|"warm_keep_expired"|"trigger_rebuilt"|"trigger_key_changed"|"authz_revoked"
}
```

```go
// ENGINE-SIDE (graphql-go-tools) — the change the prior revision wrongly denied.
// Added to resolve.SubscriptionUpdater (pkg/engine/resolve/resolve.go:1598).
type SubscriptionUpdater interface {
    Update(data []byte)                                   // existing: raw event → resolve → fan-out
    UpdateSubscription(id SubscriptionIdentifier, data []byte) // existing
    // NEW: write pre-rendered frames to ONE subscriber, bypassing resolve entirely.
    Replay(id SubscriptionIdentifier, frames [][]byte)
}
```

The honest delta vs the prior revision: this is **not** an additive Cosmo-only change. It adds an engine method (`Replay`), a new `subscriptionEventKind` so `handleTriggerUpdate` routes replay frames to a single subscriber, engine→writer seq threading, and a router-side writer wrapper. The engine's existing `Update(data)` is unchanged for the live path.

```go
type ReplayBufferConfig struct {
    Enabled            bool          `yaml:"enabled"`
    WindowEvents       int           `yaml:"window_events"`
    WindowSeconds      time.Duration `yaml:"window_seconds"`
    WindowBytes        int64         `yaml:"window_bytes"`
    TokenInterval      time.Duration `yaml:"token_interval"`
    TokenEveryN        int           `yaml:"token_every_n"`
    WarmKeep           time.Duration `yaml:"warm_keep"`
    WarmKeepMode       string        `yaml:"warm_keep_mode"` // cursor_only | frame_capture
    WSKeepaliveInterval time.Duration `yaml:"ws_keepalive_interval"`
    WSKeepaliveTimeout  time.Duration `yaml:"ws_keepalive_timeout"`
    AckHoldGrace       time.Duration `yaml:"ack_hold_grace"`
    MaxInFlightAcks    int           `yaml:"max_in_flight_acks"`
    RevalidateOnReplay bool          `yaml:"revalidate_on_replay"`
    MaxTotalBytes      int64         `yaml:"max_total_bytes"`
    Store              BufferStoreConfig `yaml:"store"`
}
```

---

## 12. Risks, open questions, and complexity/effort estimate

### Where this pattern is weakest (be honest)

1. **The required engine change kills the "M, no-engine-change" framing.** Replay to a single subscriber and post-resolve seq stamping live in graphql-go-tools (§3.6). This is a graphql-go-tools PR + a router bump + a writer wrapper + WS keepalive, on top of the ring/token/eviction/concurrency test surface. **Re-estimated as L for the in-process variant alone** (see below).

2. **Cross-restart durability is the headline weakness.** An in-process ring is lost on every restart/deploy; in a rolling-deploy world the window resets to zero each rollout, so clients reconnecting right after a deploy get at-most-once-with-gap. **Versus B/C, strictly weaker on restart.**

3. **Why durable-store Pattern E instead of just switching to a log backend? (addresses review #10).** The durable variant writes *every resolved frame* to Redis on the hot path — write amplification on a backend the customer chose *because it is non-durable*. If you are willing to run a durable store, the honest question is "why not run a log backend (Redis Streams / JetStream) and use Pattern B?" The only defensible answers: (a) the customer **cannot** change the backend (org constraint, existing NATS-core infrastructure), and wants a router-side window without touching the broker; (b) a heterogeneous fleet wants one uniform replay code path. If neither holds, **recommend Pattern B and scope the durable store out of v1.** The durable store is therefore deferred, not part of the v1 recommendation.

4. **The window is short and the failure mode is a cliff.** Below the window: at-least-once. One second beyond: at-most-once for the *entire* tail (gap signal, jump to live). No graceful "degraded but partial" middle. For long-disconnect profiles (mobile backgrounding for minutes/hours), Pattern F (app-level backfill) is the better fit; use E *with* it, not instead.

5. **Memory under fan-out is now per-subscriber and stores resolved frames (review acknowledged).** The layering correction (§3.4) means replay memory does **not** share across a trigger and stores resolved frames (bigger than raw events): `Σ_subscribers (windowEvents × frameSize)`. This is materially more memory than the prior revision implied. The global ceiling protects the process but downgrades whole subscriber rings to at-most-once on next reconnect under pressure — an operational surprise if not watched.

6. **The reset-to-now / no-replay backends only hold the window while the trigger stays alive (review #8).** NATS core, Redis Pub/Sub, and groupless Kafka lose the backlog *at the broker* across any trigger teardown or restart, before the ring can see it. The real-world guarantee on exactly the backends this pattern targets is narrower than "at-least-once within window": it is "at-least-once within window, for a disconnect during which the trigger kept reading".

7. **Sole-subscriber gaps need frame-capture warm-keep, which resolves for an absent client (§3.7, §6 failure #3).** Capturing the gap tail for a lone subscriber means running subgraph fetches for a client that is gone. The cheap default (cursor-only) cannot capture gap events for a sole subscriber. Inherent tension.

### Open questions

1. **Warm-keep mode default & broker subscription lifecycle.** Is `cursor_only` the right default for all backends, or should redelivery-capable backends (JetStream) default to relying on broker redelivery + cursor-only, while no-redelivery backends offer `frame_capture` more prominently? Needs validation against real reconnect timing.

2. **Engine `Replay` API shape and ownership of `SubscriptionIdentifier`.** The router must obtain the engine-minted identifier for a freshly re-attached subscription to call `Replay(id, frames)`. Exact API (return the id from attach? a callback?) must be designed with the graphql-go-tools maintainers — this is the load-bearing engine-side design decision and gates the whole effort.

3. **Confirmation model & token throttling interaction.** With throttled tokens (§3.5), the client resumes from the last token boundary, not the last frame. Is the resulting duplicate tail (≤ `token_every_n` frames) acceptable for all use cases, or do we need an optional explicit per-token client confirm to tighten it? Keeping E confirm-free is simpler and duplicates are idempotent-safe.

4. **Durable store consistency / epoch fencing.** The Redis-backed ring makes the store the ordering authority; a trigger migrating instances mid-stream needs an epoch fencing token to prevent two instances appending to the same `(triggerKey, epoch)`. Spec before building the (deferred) L variant.

5. **`revalidate_on_replay` granularity.** Re-gating the *whole* replay on current authz (§8.5) is coarse — it cannot redact individual stale fields without re-resolving (which we refuse, review #2). Is whole-replay suppression the right behavior, or do some customers need field-level precision (→ Pattern B/C)? Document loudly either way.

### Complexity / effort estimate (re-derived after admitting the engine change)

- **In-process, no proto change, *with* the graphql-go-tools engine change: L.**
  - graphql-go-tools: `Replay(id, frames)` entry point + new replay `subscriptionEventKind` + engine→writer seq threading. A non-trivial engine PR with its own review cycle and a router bump.
  - Router: writer wrapper (stamp + capture + replay-then-live serialization gate), per-subscriber ring, token codec with throttling, reconnect re-association, **WS server keepalive** (independently valuable), ack-hold integration (NATS/JetStream), config, metrics.
  - Biggest test surface: reconnect/replay/eviction/fan-out concurrency, the replay-then-live serialization gate, and half-open-WS detection.
  - Estimate: **~6–8 weeks** for one engineer including the engine PR, to a shippable, flagged, tested state.

- **Durable buffer store (redis) for cross-restart/HA: +L/XL, deferred.** `BufferStore` redis impl, epoch fencing, key lifecycle/TTL, hot-path write amplification of *resolved frames* + its perf work, HA reconnect routing. Estimate: **+4–6 weeks**, and per §12-#3 it should not ship unless the "can't switch backends" justification holds.

### Metrics (§10, expanded — addresses review #17)

`cosmo_replay_buffer_events_buffered`, `_replayed`, `_evicted`, `_gap_signals_total{reason}`, `_ring_bytes`, `_ack_hold_seconds`, `_in_flight_acks`,
**`_duplicates_suspected_total`** (canary for `AckHoldGrace` > broker ack-wait, the duplicate source in §6),
**`_ack_pin_age_seconds` (per-trigger gauge)** (canary for the half-open-WS / slow-consumer ack pinning in §3.8),
**`_ws_keepalive_timeouts_total`** (half-open detections),
**`_replay_serialization_wait_seconds`** (replay-then-live gate health).

### One-line honest placement (vs. the other six patterns)

Pattern E is the *only* pattern that gives any reconnect-replay guarantee on at-most-once backends (NATS core, Redis Pub/Sub) without changing the backend or the client beyond a resume token — but it **requires a graphql-go-tools engine change** (single-subscriber replay + post-resolve seq stamping), stores **per-subscriber resolved frames** (not a cheap shared per-trigger ring), holds the window **only while the trigger stays alive** on the very backends it targets, and is the *weakest* on restart/HA. It is *redundant* on log backends where Pattern B is simpler and durable for far longer. Ship it for the no-cursor backends with sticky sessions; defer the durable store; defer to B/C/D elsewhere.
