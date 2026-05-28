# At-Least-Once Delivery for Cosmo Streams / EDFS — Competing RFCs

- **Author:** automated RFC workflow
- **Status:** Draft / for discussion
- **Date:** 2026-05-28

This directory contains **four competing RFCs** that each propose a different
way to add **at-least-once delivery guarantees** to Cosmo's Event-Driven
Federated Subscriptions (EDFS, a.k.a. "Cosmo Streams"). They are deliberately
opinionated and mutually exclusive in their *core bet* about **where the
delivery guarantee should live**. They are written to be evaluated head-to-head,
not merged wholesale.

This README is the entry point: it states the shared problem, summarizes each
proposal, and scores them against a common rubric so the team can pick a
direction (or a sequenced combination).

---

## The shared problem

Today every EDFS provider is **at-most-once** (fire-and-forget). The three
sibling adapters confirm this:

- **NATS:** on the JetStream path, `msg.Ack()` is called *immediately after*
  `updater.Update()` and *before* the event is confirmed delivered to any
  client (`router/pkg/pubsub/nats/adapter.go:154`). Core NATS has no durability
  at all. So even the "durable" path is effectively at-most-once from the
  client's perspective.
- **Kafka:** the poller consumes from `ConsumeResetOffset(NewOffset().AfterMilli(now))`
  with no consumer group and no offset commit
  (`router/pkg/pubsub/kafka/adapter.go`) — only messages published *after* the
  subscription starts are seen, and nothing is tracked or replayable.
- **Redis:** uses ephemeral `PSubscribe` (`router/pkg/pubsub/redis/adapter.go`)
  — no persistence, no IDs, no acknowledgment.

The delivery path `broker → adapter → SubscriptionEventUpdater.Update()
(router/pkg/pubsub/datasource/subscription_event_updater.go) → per-subscription
hooks → resolve.SubscriptionUpdater.UpdateSubscription() → WS/SSE write` has
**no acknowledgment, no checkpoint, no replay, and no deduplication** anywhere.

Events are silently lost on:

1. **Hook timeout / error** — the updater may drop events for a subscription
   (`subscription_event_updater.go:69-80`).
2. **Client disconnect / reconnect** — context cancels, in-flight events vanish;
   Kafka/Redis resubscribe from "now", missing the gap.
3. **Router restart** — Kafka/Redis lose all in-flight state; only JetStream
   durable consumers survive (but ack-before-deliver means pending ≠ undelivered).
4. **Slow consumers** — backpressure has no durable spillover.

There are **four distinct failure domains** — *broker→router*, *router internal
(restart)*, *router→client (last mile)*, and *cross-replica reconnect* — and the
central design question is which layer should be made responsible for closing
them. That is exactly what the four RFCs disagree about.

> **Non-goal for all four:** exactly-once. Every proposal is *at-least-once* and
> therefore requires **consumer idempotency**. RFC D additionally adds edge
> deduplication to approximate effectively-once, but none claim true
> exactly-once end-to-end.

---

## The four proposals at a glance

| RFC | Core bet — *where durability lives* | One-line thesis |
|-----|-------------------------------------|-----------------|
| **[A — Broker-native durable consumers](./edfs-at-least-once-a-broker-native-durable-consumers.md)** | **The broker** | Make the broker the durable log; the router defers its upstream ack/commit until a frame is flushed to the client. |
| **[B — Client-ack protocol + resumable cursors](./edfs-at-least-once-b-client-ack-resumable-cursors.md)** | **The transport / protocol** | Give each delivered event a signed monotonic cursor; the client acks and, on reconnect, resumes from its last cursor. |
| **[C — Router-side durable WAL + checkpoints](./edfs-at-least-once-c-router-durable-wal.md)** | **The router (disk)** | Persist every event to a router-owned write-ahead log before delivery; advance per-subscription checkpoints on confirm. |
| **[D — Unified delivery-manager layer](./edfs-at-least-once-d-delivery-manager-layer.md)** | **A new cross-cutting layer** | Introduce one delivery state machine parameterized by pluggable durability/ack/dedup/routing strategies; the other three become strategies under it. |

---

## Summaries

### RFC A — Broker-Native Durable Consumers (commit-on-deliver)

Lean on each broker's native durability and move the upstream acknowledgment to
*after* the client frame is flushed (delivery boundary = transport write).

- **NATS:** `AckExplicit` + `AckWait`/`MaxAckPending`/`MaxDeliver`/`Term`; move
  `msg.Ack()` to post-delivery; redelivery on `AckWait` expiry.
- **Kafka:** introduce consumer groups + manual commit of the longest contiguous
  delivered-offset prefix (handles the out-of-order "gap" problem).
- **Redis:** migrate PubSub → **Streams + consumer groups** (`XADD`/`XREADGROUP`/
  `XACK`/`XAUTOCLAIM` + PEL). *This is a behavior change for the Redis provider.*
- **Fan-out policy:** default `ack_after_all_live` (broker consumers scale with
  distinct subscriptions, not clients) with an opt-in `per_subscription` mode.
- Router stays **stateless**; opt-in via `deliveryGuarantee: at_least_once`.

**Best at:** broker→router and router restart (for brokers with native
durability). **Blind to:** the last mile (once flushed to the socket, a dropped
client is not recovered) and Redis/core-NATS gain durability only by changing
provider semantics.

### RFC B — Client-Ack Protocol + Resumable Cursors

Put the guarantee at the router→client transport, because loss frequently
happens *after* the broker is acked and only the client knows what it received.

- Opaque, **HMAC-signed, monotonic per-subscription cursor** embedding the
  provider-native position (Kafka offset / JetStream seq / Redis Stream ID) so
  any replica can re-seek.
- New client→server **`ack`** message (cumulative, windowed by default) over
  `graphql-transport-ws`; cursors ride the existing `extensions` field of `next`
  frames. SSE gets resumability nearly free via `id:` + `Last-Event-ID`.
- Bounded per-subscription **RAM ring buffer** of unacked events; replay from
  buffer, fall back to broker re-seek, and signal `aged_out` honestly past
  retention.
- Gated by a `cosmo.ack` capability on `connection_init`; non-ack/legacy clients
  **degrade byte-for-byte to today's at-most-once**.

**Best at:** the last-mile (router→client) gap and reconnect resume — the only
proposal that closes it. **Blind to:** router restart on its own (RAM buffer is
lost unless paired with broker re-seek), and cross-replica reconnect needs a
shared cursor authority. **Composes** with A (commit upstream only on client-ack).

### RFC C — Router-Side Durable WAL + Per-Subscription Checkpoints

Make durability the router's own responsibility, uniform across all providers.

- A persistent append-only **DeliveryLog (WAL)** records every event *before*
  delivery; a **checkpoint store** tracks per-subscription confirmed progress.
- Router commits upstream only *after* the event is durably in the WAL; delivery
  is a read from the WAL; checkpoints advance on client confirm.
- Default **embedded** segment-file WAL + bbolt checkpoints (zero new infra, off
  by default); `per_batch` fsync as the durability/throughput dial.
- Adds a **transactional outbox** for publish-after-commit (mutations).
- Subscription identity via client `durableId` with a derived-fingerprint
  fallback; restart-survival needs no protocol change.

**Best at:** a *uniform, provider-independent* guarantee (identical for Kafka,
JetStream, **and** Redis PubSub / core NATS that have zero native durability) and
router-restart survival independent of broker retention. **Cost:** the router
becomes **stateful** — disk, fsync, retention/compaction, write amplification,
recovery-time duplicates, and sticky-routing or shared-store leader election for
multi-replica.

### RFC D — Unified Delivery-Manager Layer

Introduce one cross-cutting **Subscription Delivery Manager (SDM)** that wraps
`SubscriptionEventUpdater` and owns a per-message state machine
(`RECEIVED→BUFFERED→DISPATCHED→ACKED | TIMED_OUT→REDELIVERED | DEAD_LETTERED`),
parameterized by four pluggable interfaces: `DurabilityStrategy`, `AckTransport`,
`DedupStore`, `RoutingStrategy`.

- The other three RFCs become **strategies** under one contract (broker-offset
  and WAL are `DurabilityStrategy` impls; WS-ack is an `AckTransport`).
- Makes the two problems the others skip **first-class**: **multi-replica
  resume** (sticky hashing vs. shared lease-fenced store, with CAP trade-offs)
  and **dedup-to-effectively-once-at-edge**, plus a unified delivery-metrics
  surface (in-flight, redeliveries, dead-letters, ack latency).
- Ships **inert by default** (no-op strategies = byte-identical to today),
  rolled out incrementally over six stages with multi-replica last.

**Best at:** a single coherent contract, dedup, observability, and the only
serious answer to multi-replica reconnection. **Cost:** the **heaviest lift**;
genuine over-engineering risk if the org never needs more than one strategy.

---

## Scorecard

Scores are **1 (poor) – 5 (excellent)** for the dimension as *delivered by that
RFC's core bet*, not after combining with others. They are judgment calls to
drive discussion, not measurements.

| Dimension | A — Broker | B — Client-ack | C — Router WAL | D — Manager layer |
|---|:---:|:---:|:---:|:---:|
| Closes **broker→router** loss | 5 | 3 | 5 | 5 |
| Survives **router restart** | 4¹ | 2 | 5 | 4² |
| Closes **router→client (last mile)** | 1 | 5 | 2³ | 5 |
| **Cross-replica** reconnect | 2 | 3 | 3 | 5 |
| **Provider uniformity** (incl. Redis/core-NATS) | 2⁴ | 3 | 5 | 4 |
| **Deduplication / toward effectively-once** | 1 | 2 | 2 | 5 |
| **Backward compatibility** (opt-in, no regression) | 5 | 5 | 5 | 5 |
| Keeps router **stateless / low ops** | 5 | 4 | 1 | 2 |
| **Throughput / latency** overhead | 3⁵ | 4 | 2⁶ | 2 |
| **Implementation cost** (higher = cheaper/smaller) | 4 | 3 | 2 | 1 |
| **Observability** of delivery | 3 | 3 | 3 | 5 |
| **Standards alignment** (SSE `Last-Event-ID`, broker norms) | 4 | 5 | 3 | 4 |

**Footnotes**
1. A survives restart only for brokers with native durability (JetStream/Kafka
   groups/Redis Streams); not for core NATS.
2. D inherits restart survival from whichever `DurabilityStrategy` is selected.
3. C survives restart but, without the optional ack, cannot detect last-mile
   client loss; pair with an ack transport to reach 5.
4. A makes Redis/core-NATS durable only by *changing provider semantics*
   (PubSub→Streams), which is a behavioral break, not a transparent add.
5. A's ceiling is `MaxAckPending`/PEL depth and head-of-line blocking under the
   `ack_after_all_live` policy.
6. C adds fsync write-amplification; `per_batch` vs interval fsync is the dial.

---

## How they relate (they are not all mutually exclusive)

The bets differ, but several **compose**:

- **A + B** is the natural strong pairing: B closes the last mile and gives
  resumable cursors; A lets the router commit upstream *only when the client
  acks that cursor*, yielding end-to-end at-least-once with a stateless router
  and no new infra. This is the lowest-risk path to a real guarantee.
- **C** is the right answer if the guarantee must be **uniform across all
  providers** (especially Redis PubSub / core NATS) or must hold **without
  depending on broker retention** — at the cost of making the router stateful.
- **D** is the right answer if the org expects to need **several** of these
  strategies, cares about **multi-replica** and **dedup/observability** as
  first-class concerns, and is willing to pay for a heavier abstraction. Its key
  insight — that A/B/C are *strategies*, not rivals — is worth weighing even if D
  itself is deferred.

---

## A suggested decision framework

1. **What is the dominant failure mode customers actually hit?**
   - Flaky clients / mobile reconnects → last mile dominates → **B** (or A+B).
   - Router deploys/crashes losing events → **C** (or A on durable brokers).
   - "Some events just never arrive under load" (hook timeout/backpressure) →
     **A** or **C**.
2. **Is a stateful router acceptable operationally?** If no → prefer **A/B**
   (stateless); if yes → **C/D** are on the table.
3. **Must Redis PubSub / core NATS also be at-least-once without changing their
   semantics?** If yes → only **C** (or **D** with a WAL strategy) qualifies.
4. **Is multi-replica subscription resume a hard requirement now?** If yes →
   **D**, or **B/C** with an explicit shared cursor/checkpoint store bolted on.
5. **Appetite for scope?** Smallest → **A**; standards-friendly client UX →
   **B**; uniform infra-light durability → **C**; platform investment → **D**.

> **Workflow recommendation (non-binding):** start with **A + B** as a phased
> delivery (A first for broker-side hardening, B for the last mile), and keep
> **D's strategy-interface framing** as the north star so A and B are built as
> swappable strategies rather than one-offs — leaving the door open to **C** for
> providers without native durability. Decide per the framework above.

---

## Index

| File | RFC |
|------|-----|
| [`edfs-at-least-once-a-broker-native-durable-consumers.md`](./edfs-at-least-once-a-broker-native-durable-consumers.md) | A — Broker-native durable consumers |
| [`edfs-at-least-once-b-client-ack-resumable-cursors.md`](./edfs-at-least-once-b-client-ack-resumable-cursors.md) | B — Client-ack protocol + resumable cursors |
| [`edfs-at-least-once-c-router-durable-wal.md`](./edfs-at-least-once-c-router-durable-wal.md) | C — Router-side durable WAL + checkpoints |
| [`edfs-at-least-once-d-delivery-manager-layer.md`](./edfs-at-least-once-d-delivery-manager-layer.md) | D — Unified delivery-manager layer |

*Background on the current EDFS hook architecture these RFCs build on:
[`cosmo-streams-v1.md`](./cosmo-streams-v1.md) and
[`../adr/cosmo-streams-v1.md`](../adr/cosmo-streams-v1.md).*
