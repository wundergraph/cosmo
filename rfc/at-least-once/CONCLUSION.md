# At-Least-Once for GraphQL Subscriptions — Conclusion & Recommended Pick

> **Decision document.**
> Summarizes the seven competing RFCs,
> the combined evaluation (adversarial critique + independent codex review),
> my recommended pick,
> codex's independent pick,
> the discussion between us,
> and the final jointly-locked conclusion with sequencing and honest per-piece guarantees.

## TL;DR

The problem: an application may already have at-least-once in its event-driven backend (Kafka offsets, NATS JetStream durable consumers),
but the moment a GraphQL Subscription is layered on top via Cosmo's EDFS / Cosmo Streams,
that guarantee is lost —
the router consumes the event and pushes it to the client fire-and-forget,
so a client disconnect, a router restart, or a slow consumer silently drops events.

We wrote **seven competing RFCs** (patterns A–G),
adversarially critiqued each,
had **codex independently review all seven**,
then reconciled.

**The seven collapse into one coherent layered architecture, not seven alternatives.**
Both my analysis and codex's independent pick converged on the same answer:

- **Build `D` first** — a server-only fix to broker-ack timing that creates the missing engine contract.
- **`B` (cursor / resume) is the product flagship** — the best default for heterogeneous backends.
- **A thin "delivery-class core" ships *with* D+B** — so "pick any backend, get an explicit, honest guarantee (degrade on purpose)" is true from v1.
- **`B + batched cursor-ack`** ("checkpointed cursor resume") reaches the client-*processed* boundary on log backends cheaply, subsuming most of `A`'s value.
- **`A` (per-message client ack) is a selective premium add-on**, mainly for delete-on-ack queues (SQS, RabbitMQ) and in-flight redelivery.
- **`G` (tiered negotiation) comes last**, as the dynamic policy/handshake layer on top of real mechanisms.
- **`C`, `E`, `F` are folded in as supporting components**, not shipped as first-class answers.

**Primary pick: `B` (cursor/resume), anchored on the `D` foundation.**
Single most important first milestone: **the coordinated `graphql-go-tools` engine contract**, then **`D`**.

---

## The seven candidate RFCs

| ID | RFC | Mechanism (one line) | File |
|----|-----|----------------------|------|
| A | End-to-End Client-Ack | Per-message id + client `ack`; hold broker ack until client acks (MQTT QoS-1). | [`rfc-A-client-ack-protocol.md`](./rfc-A-client-ack-protocol.md) |
| B | Cursor / Resume Replay | Opaque per-event cursor; on reconnect client sends last cursor, router seeks + replays then goes live. | [`rfc-B-cursor-resume.md`](./rfc-B-cursor-resume.md) |
| C | Durable-Consumer + Checkpoint | One durable consumer/checkpoint per subscription; advance only after delivery confirmed. | [`rfc-C-durable-consumer-checkpoint.md`](./rfc-C-durable-consumer-checkpoint.md) |
| D | Broker Ack-Timing Fix | Server-only: per-subscriber delivery result flows back; ack/commit only after flush. | [`rfc-D-broker-ack-timing.md`](./rfc-D-broker-ack-timing.md) |
| E | Router Replay Buffer | Bounded router-side ring buffer; replay on short reconnects; backend-agnostic. | [`rfc-E-router-replay-buffer.md`](./rfc-E-router-replay-buffer.md) |
| F | Outbox / Dedup-on-Client | Stable idempotency keys + reconnect catch-up query + client dedup; state convergence. | [`rfc-F-outbox-client-dedup.md`](./rfc-F-outbox-client-dedup.md) |
| G | Tiered Capability Negotiation | Declare desired delivery class; router picks strongest the backend+client support; report achieved class. | [`rfc-G-tiered-capability-negotiation.md`](./rfc-G-tiered-capability-negotiation.md) |

Shared factual ground truth (current architecture, code anchors, per-backend matrix): [`00-research-dossier.md`](./00-research-dossier.md).

## Where the guarantee is lost today (from the dossier)

- **Hop A (broker → router read):** only NATS JetStream consumes durably; Kafka is groupless + reset-to-now, NATS core and Redis Pub/Sub never ack/commit.
- **Hop B (resolve → flush):** JetStream ack is mistimed — it acks on flush *attempt* not receipt, acks even when delivery failed, a single `msg.Ack()` covers a whole multi-subscriber fan-out, and the hooks path can abandon/reorder yet still ack.
- **Hop C (client):** no per-message client ack exists in the WS protocol (`Ping/Pong/Subscribe/Complete/Terminate` only).
- **Hop D (resume):** reconnect always starts from "now"; no `Last-Event-ID`, no cursor; events carry no position.
- **Slow consumers:** NATS core unbuffered channel and Redis Pub/Sub overflow drop events silently.

## Combined evaluation

Adversarial critique (in-workflow) + independent codex review (`codex exec`, read-only).
Codex scores are 1–5.

| ID | Corr | Feas | Adapt | V/E | Codex verdict | Why |
|----|:----:|:----:|:-----:|:---:|---------------|-----|
| **D** | 3 | 4 | 2 | **4** | **KEEP** | Necessary server-side foundation; ships now; fixes real bugs. Only "at-least-once to flush". |
| **B** | 3 | 3 | 4 | **4** | **KEEP** | Distinct, high-value durable mechanism; best multi-backend fit; low router state. |
| A | 3 | 2 | 3 | 3 | MERGE→D | Strongest semantics (true client receipt) but not standalone; rides D's contract. |
| F | 3 | 4 | 4 | 3 | MERGE→D | Cheap reconnect state-convergence; not stream durability. |
| G | 3 | 3 | 4 | 3 | MERGE→B | Policy/reporting layer; "G first is an elaborate way to say at-most-once." |
| E | 3 | 3 | 3 | 3 | MERGE→G | Bounded best-effort replay for no-log backends; redundant with B on log backends. |
| C | 3 | 2 | 3 | **2** | MERGE→A | Most expensive; breaks trigger dedup; still needs A to close flush-vs-processing. |

**Merge graph collapses to two anchors (`D`, `B`) + two layers (`A`, `G`) + three components (`C`, `E`, `F`).**

## My recommended pick

`D` (foundation) → `B` (flagship) → `G` (policy),
with `A` as an opt-in premium layer and `C`/`E`/`F` folded in as components.

Rationale:
`B` is the highest value-for-effort *user-facing* mechanism and the best fit for Cosmo's multi-backend future,
because it leans on the broker's own retained log instead of turning the router into a database —
but it can only be correct if it sits on `D`,
because today the engine's fire-and-forget boundary cannot report whether a flush actually succeeded.
`G` makes "pick a backend even if degraded" honest,
but only has value once real mechanisms exist underneath it.

## Codex's independent pick

Asked fresh and decisively, codex returned:

> **PRIMARY PICK:** `B` cursor/resume replay.
> **SEQUENCE:** D → B → G → selective A → optional C/E → F as SDK/docs.
> **DROP/FOLD:** drop standalone-C-first and durable-E-generalization; fold D/G/F/E into substrate/policy/docs/degraded-mode components.
> First engineering milestone should still be `D`, because the engine boundary is currently too fire-and-forget to support the rest cleanly.

This matched the independent conclusion above almost exactly.
Full text: [`codex/codex-pick-round1.md`](./codex/codex-pick-round1.md).

## The discussion (reconciliation)

Given the strong convergence, I pressure-tested three refinements with codex; it agreed on all three (one with a modification).
Full text: [`codex/codex-pick-round2.md`](./codex/codex-pick-round2.md).

**1. A thin "delivery-class core" ships with D+B (not deferred to G).**
Agreed — *with a modification*: do not hard-error every mismatch.
Separate **policy intent** from **capability truth**:
`required_delivery: at_least_once` → hard startup error if unmet;
`preferred_delivery: at_least_once` → start and report degradation.
The contract is `{ requested_class, achieved_class, boundary, mechanism, degraded_reason }`,
emitted in `extensions.delivery`.
Boundary labels must be brutally precise:
`socket_write` (D), `cursor_resume` (B), `client_receipt`/`client_processed` (ack modes), `state_converged` (F).

**2. `B + batched cursor-ack` = "checkpointed cursor resume", the 80/20.**
Agreed strongly.
The client advances a high-water mark only *after processing*, batched (per N events / per window, not per message),
and resumes from the last *acknowledged* cursor, not merely the last received cursor —
so `B` reaches the **client-processed boundary** on log backends without classic per-message `A`.
Correctness traps documented:
it works cleanly only for **ordered prefixes per partition/stream** (a sparse ack set becomes A-like complexity);
multi-partition Kafka cursors are **vectors**, so batched ack must advance per partition;
adding *server-side* committed cursor state means you have introduced a checkpoint store (that is scoped `C`);
and it does **not** help delete-on-ack queues (SQS/RabbitMQ) — those still need `A` or `E`.

**3. One coordinated engine contract, shipped in phases.**
Agreed — do not pay the cross-repo `graphql-go-tools` coordination tax twice.
Design a single resolve-layer contract that serves both `D` and `B`, then turn router behavior on incrementally.

## Final, locked conclusion

**Kept as RFCs:** `D`, `B`, the thin delivery-class core, and (later) `G`.
**Kept as a selective premium add-on:** `A`.
**Folded into supporting roles:** `C` (durable checkpoint substrate), `E` (degraded no-log replay window), `F` (SDK/docs state-convergence).

### The one coordinated `graphql-go-tools` engine contract

Land once; carries everything D and B need:

- per-event **opaque metadata forward** to the writer (cursor / position / idempotency key) — opaque bytes, no broker-specific types in the engine;
- per-subscriber **delivery outcome back** from fan-out (`flushed | failed | skipped | filtered | closed`);
- **post-filter** subscriber accounting;
- a **resume / start-from** position path (`SubscribeFrom`, at the datasource/source-config level);
- writer support to emit metadata into **WS `extensions`** and **SSE `id:`**.
- Keep the at-most-once **fast path cheap and stable** as an internal optimization beneath the single new semantic contract.

### Sequence

1. **Engine contract PR** — delivery metadata forward, delivery outcomes back, resume-capable source path.
2. **`D` in the router** — JetStream / no-hooks first; ack/nak on the delivery outcome; flush GraphQL error payloads in v1 to avoid deterministic redelivery loops; metrics for stall/redelivery/dropped-subscriber.
3. **Thin delivery-class core (with D)** — declared/achieved class, boundary, mechanism, degradation reason; `required_` vs `preferred_` enforcement.
4. **`B` flagship** — signed opaque cursors, SSE `id:` / `Last-Event-ID`, WS resume extension, backend seek/replay, `CURSOR_EXPIRED`.
5. **`B + cursor-ack`** — client-processed checkpoint mode for log backends (ordered-prefix, per-partition vectors).
6. **`G` later** — dynamic negotiation, client capability handshake, policy selection matrix.
7. **`A` selectively** — SQS / RabbitMQ / Pub/Sub / JetStream cases needing explicit client ack over broker ack handles.
8. **`C` / `E` / `F` folded** — C as checkpoint substrate (premium isolation/HA), E as degraded no-log replay window, F as SDK/docs for state convergence.

### Honest guarantee each kept piece delivers

| Piece | Guarantee (precise) |
|-------|---------------------|
| **D** | At-least-once to **successful socket write** (bytes accepted by the kernel), not client receipt. |
| **B** | At-least-once **replay across reconnect/restart within retention**; boundary depends on when the client persists the cursor. |
| **B + cursor-ack** | At-least-once to the **client-processed prefix**, within retention, per partition/stream. |
| **A** | At-least-once to **explicit client acknowledgement** (receipt; or processing if the client acks after processing). |
| **G** | No durability itself — **honest selection and reporting** of the achieved class. |
| **C** | Durable **checkpoint substrate** (cross-restart), not a standalone answer. |
| **E** | **Window-bounded degraded replay** for non-log backends (NATS core, Redis Pub/Sub). |
| **F** | **State convergence** on reconnect, not event delivery. |

### "Pick a backend even if degraded" — the explicit answer

- **Log / cursor backends** (Kafka, NATS JetStream stream-backed, Redis Streams; future Kinesis, Event Hubs, Google Pub/Sub): full `B` and `B + cursor-ack` → at-least-once within retention, up to client-processed boundary.
- **Delete-on-ack queues** (SQS, RabbitMQ — not in EDFS today): `A` (ack/delete/nack) or `E` (short router buffer); no cursor replay.
- **Fire-and-forget** (NATS core, Redis Pub/Sub): `E` bounded best-effort replay or `F` state convergence; otherwise **explicit at-most-once**, reported via `extensions.delivery`, never silent.

## Residual open questions

- Multi-partition Kafka cursors as vectors vs the single-value SSE `Last-Event-ID` header — needs an envelope/encoding decision.
- JetStream replay requires replayable retention; current Cosmo config exposes `streamName` but not the retention/ack policy — must validate and surface `WorkQueuePolicy` / interest-based deletion conflicts.
- Whether `B + cursor-ack` with a *server-side* committed cursor (scoped `C`) is worth it for clients that cannot persist a cursor (e.g. some mobile/web cases), vs leaving cursor ownership with the client.
- Shared-trigger interaction: resuming/acking clients may need their own trigger; reclaiming shared fan-out for long-lived resumed subscriptions is an engine-side state-machine question.
- Exact `MaxDeliver` / poison-message handling under `ack_policy: all` to avoid one slow/failing subscriber stalling co-subscribers.

## Artifacts

- Research dossier: [`00-research-dossier.md`](./00-research-dossier.md)
- RFCs: [`rfc-A`](./rfc-A-client-ack-protocol.md) · [`rfc-B`](./rfc-B-cursor-resume.md) · [`rfc-C`](./rfc-C-durable-consumer-checkpoint.md) · [`rfc-D`](./rfc-D-broker-ack-timing.md) · [`rfc-E`](./rfc-E-router-replay-buffer.md) · [`rfc-F`](./rfc-F-outbox-client-dedup.md) · [`rfc-G`](./rfc-G-tiered-capability-negotiation.md)
- Per-RFC codex reviews: [`codex/codex-review-{A..G}.md`](./codex/)
- Codex independent pick + discussion: [`codex/codex-pick-round1.md`](./codex/codex-pick-round1.md) · [`codex/codex-pick-round2.md`](./codex/codex-pick-round2.md)
