# RFC: At-Least-Once for GraphQL Subscriptions — Outbox / Dedup-on-Client, Reconnect-Backfill (Pattern F)

**Status:** Draft

**TL;DR.**
Cosmo's EDFS pushes broker events to clients fire-and-forget,
so a disconnect, a router restart, or a slow consumer silently drops events.
This pattern does **not** try to make the stream itself durable.
Instead, for subscriptions whose events are **also rows in a queryable backing store** (an outbox / changelog / entity table),
it pairs the subscription with a normal **catch-up query** the client runs on (re)connect,
queues live deltas that arrive while the query is in flight,
merges them in `since`-order, and **dedups by an application-owned idempotency key**.
The guarantee is *state convergence on reconnect* for state-convergent, outbox-backed subscriptions:
you may miss intermediate transitions, but the final state converges and no persisted state is lost
as long as the outbox is queryable and retains the backfill window.

**Two hard scope gates, stated up front (see §2, §6):**
1. **F recovers nothing for subscriptions whose events are not also rows in a queryable store.**
   Pure notification / transient / presence streams ("a message was posted", "user is typing", presence pings)
   have no current-state to converge to. For those, F is **at-most-once with extra steps** — exactly today's behavior.
2. **F is for state-convergent payloads only** (the event carries the *current* state of an entity, not a delta-op like "increment by 3").
   For delta/CRDT payloads the merge produces wrong results; use Pattern A or B.

The idempotency key and the `since` cursor are **owned and surfaced by the application's own schema**
(on the subscription type and the catch-up query), *not* stamped by the router into a side-channel —
because, as the revised design explains (§3, §4), no router-only side-channel to the client exists in the current engine.
The router's contribution is **documentation, observability config, an optional composition lint, and an SDK helper** for the backfill-merge-dedup loop.
A fully router-stamped key (the original proposal) is possible only with an engine change and is re-scoped as an **L-effort alternative** in §3.5 and §11.
There are **no changes to the subscription wire protocol**.
Router-side complexity is **S** for the documented/SDK path, **L** for the engine-stamped alternative;
the real cost is the application outbox and the client.

---

## 1. Problem & Context

Cosmo's EDFS gives an application *at-least-once into the broker* but *at-most-once out to the client*.
A team that has carefully configured Kafka offset commits or a JetStream durable consumer on the producer side
discovers that none of that durability survives the last hop:
the router reads an event and pushes it down the socket fire-and-forget,
and any disconnect, restart, or slow consumer drops it on the floor.

The dossier (`00-research-dossier.md` §2) traces exactly where the guarantee evaporates.
The framework abstraction is fire-and-forget *by construction*:
the engine's `SubscriptionUpdater.Update(data)` returns no error and has no ack hook back to the broker
(`router/pkg/pubsub/datasource/provider.go:22-28`),
so durability is a per-adapter property, not a property of EDFS.

Four concrete behaviors make the gap real:

1. **No client ack, no resume, anywhere.**
   The recognized inbound WebSocket message set is exactly `Ping`, `Pong`, `Subscribe`, `Complete`, `Terminate`
   (`router/internal/wsproto/proto.go:88-94`) — there is no "ack received next" concept and no cursor.
   `connection_init` / `connection_ack` is a one-time *connection* handshake, not a per-message data ack.
   A reconnecting client always gets a brand-new `ConnectionID` (`resolve.NewConnectionID()`, `websocket.go:367`)
   and a brand-new subscription id (`websocket.go:1160-1185`),
   and the new trigger starts from "now."

2. **Acks (where they exist) are gated on flush attempt, not receipt.**
   On the one durable path, JetStream, the adapter calls `msg.Ack()` *after* `updater.Update()` returns
   (`router/pkg/pubsub/nats/adapter.go:146` then the `msg.Ack()` immediately following).
   But `Update` only ran a single socket write under a deadline — a successful flush means bytes handed to the kernel,
   not an application ack from the client.
   A client that crashes after TCP-buffering but before processing loses the message, yet it is acked → **lost**.

3. **The non-log backends drop silently under load.**
   NATS core uses an unbuffered Go channel (`nats/adapter.go:168`) and the nats.go client drops on overflow with `nats.ErrSlowConsumer`
   (`provider_builder.go:96-105`);
   Redis Pub/Sub drops on go-redis channel overflow.
   Kafka re-subscribes with `ConsumeResetOffset(AfterMilli(now))`, so a router restart **skips everything produced during downtime**
   (`kafka/adapter.go:32-34, 51-122`).

4. **No cursor is ever surfaced to the client.**
   The delivered event structs carry only `Data`, `Headers`, and (Kafka) `Key`
   (`nats/engine_datasource.go:39-42`, `kafka/engine_datasource.go:59-63`);
   JetStream `msg.Metadata()` (stream/consumer sequence) is never read,
   and the SSE writer never emits an `id:` field (`flushwriter.go:307-312`).

The other six patterns in this series close this gap by adding durability *to the stream*:
client acks (A), backend cursors (B), per-subscription durable consumers (C), ack-timing fixes (D), a router replay buffer (E),
or a negotiation layer over all of them (G).

Pattern F takes the opposite stance.
It accepts that the *stream* is lossy and instead makes the *application state* the source of truth.
This is not a workaround invented for this RFC —
it is the pattern Cosmo already recommends to clients today (dossier §4.2):
> on reconnect, run a catch-up query, queue incoming live deltas while it's in flight, then merge (query first, then deltas), deduping with idempotency keys.

What Pattern F adds is **the scaffolding to make that recommendation safe and turnkey, without lying about what the router can do**:
a documented contract for an application-owned idempotency key that is identical across the live stream and the backfill query,
a `since`-cursor convention backed by an outbox,
a composition-time lint that catches the most common misuses,
and an SDK helper that implements the backfill-merge-dedup loop so application teams do not each reinvent it (and get it subtly wrong).

**What changed since the prior draft (and why).**
The earlier draft claimed the router could stamp a per-event idempotency key into `extensions.cosmo` via a `DeliveryMeta` side-channel that "travels with the event to the writer," with a universal content-hash fallback.
Verification against the pinned engine (`graphql-go-tools v2.4.1`) and the router shows that mechanism **does not work as described**:

- The adapter hands the engine only `event.GetData()` — raw `[]byte` — and `GetData()` returns *only* `e.Data`; `Key`/`Headers`/any added field are dropped at this boundary (`subscription_event_updater.go:39, 122`; `nats/engine_datasource.go:21-26, 44-49`; `kafka/engine_datasource.go:22-27, 65-67`).
- The engine interface is literally `Update(data []byte)` / `UpdateSubscription(id, data []byte)` with **no metadata parameter** (`resolve.go:1586-1590`).
- `executeSubscriptionUpdate(resolveCtx, sub, sharedInput []byte)` runs `InitSubscription` → `LoadGraphQLResponseData` (federated/nested fetches) → `Resolve` into `sub.writer` (`resolve.go:616-675`). The writer receives the **resolved** GraphQL payload, not the broker event body.
- `websocketResponseWriter.Flush()` builds `extensions` *solely* from `rw.header` (response headers); it has **zero** access to the originating broker event or any key (`websocket.go:704-736`).

So there is no router-only path to attach a per-event key at the writer, and a content hash taken at the adapter cannot match anything the client can recompute (the bytes are different after resolve — see §3.2).
The honest, shippable design therefore moves key/`since` ownership into the **application schema** (§3), where it already has to live for the backfill query to align anyway, and re-scopes the "router stamps it for you" variant as an explicit engine-change alternative (§3.5).

This pattern composes cleanly with the existing Cosmo Streams v1 hooks (`cosmo-streams-v1.md`):
the catch-up query is an ordinary federated query that needs no streams machinery,
and where a hook transforms event bodies, it is also the right place for the application to (re)assert its key into the resolved shape (§7).

---

## 2. Goals & Non-Goals

**Goals.**

- For **state-convergent, outbox-backed** subscriptions, guarantee that no persisted application **state** is permanently lost
  across a disconnect, router restart, or slow-consumer drop — provided the outbox is queryable and retains the backfill window.
- Work on **every** EDFS backend for that class of subscription, including NATS core and Redis Pub/Sub, with no backend feature dependency,
  *because the durability that matters lives in the application's datastore, not in the stream.*
- Require **zero** changes to the graphql-ws / graphql-transport-ws / graphql-sse wire protocols.
- Make client-side dedup *correct* by defining a precise, testable contract for an **application-owned** idempotency key
  that is identical across the live subscription payload and the backfill query result — and by **proving the contract end-to-end with a test** (§12).
- Provide a documented, opinionated client recipe (and an SDK helper) for the backfill-merge-dedup loop.
- Keep router state at exactly O(1) per subscription — no per-subscriber durable consumers, no held broker acks, no replay buffer.
- Add a composition-time **lint** that flags the two footguns (non-state-convergent payload; missing key/since on a field that opts into F).

**Non-Goals.**

- **Recovering anything for non-outbox subscriptions.** If the event is not also a row in a queryable store, F recovers nothing.
  Pure notification / transient / presence streams get **at-most-once** under F — identical to today. (This is the dominant applicability gate, not a footnote; see §6.)
- **True at-least-once delivery of every discrete event.** F does not promise every intermediate transition is delivered.
  If an entity goes `A → B → C` during a disconnect and the backfill returns the current state, the client sees `A → C` and never observes `B`.
  Teams that need every transition want Pattern A, B, or E.
- **Delta/CRDT payloads.** If the event is an operation (`"increment by 3"`) rather than current state, F's merge is wrong. Out of scope.
- **A router-stamped, content-hash idempotency key.** The prior draft's router-stamps-`extensions` mechanism is **withdrawn** as the primary design (it cannot work without an engine change; see §1, §3.2). It survives only as the §3.5 alternative.
- **Replacing the broker ack-timing fix (Pattern D).** F does not fix the `msg.Ack()`-on-flush-attempt bug; it routes around the consequence. D and F are complementary.
- **A generic event store inside the router.** The router does not persist events. The outbox is the application's responsibility.
- **Exactly-once delivery.** With idempotent client merge the *effective* result is exactly-once *state convergence*, but discrete-event exactly-once is out of scope (see §6).
- **Changing the publish path.** Publish-side idempotency (idempotent ingest with `Nats-Msg-Id`) is orthogonal and out of scope here.

---

## 3. Design — the mechanism in depth

The mechanism has one client-side loop and a small amount of application-schema convention.
The router's role is documentation, an optional lint, observability config, and an SDK helper.
Crucially, none of it touches the synchronous fire-and-forget data path (dossier §1.3) — that path keeps working exactly as today; F decorates it from the application schema outward.

### 3.1 The contract: an application-owned idempotency key, surfaced in the typed schema

The dedup join key and the `since` cursor are **fields of the application's GraphQL types**, present in *both* the subscription payload and the backfill query result.
They are part of the typed `data`, not a router side-channel — because (a) that is the only place the client can reliably read them without an engine change (§3.2), and (b) the backfill query has to expose them anyway for the merge to work.

```graphql
type Subscription {
  employeeUpdated(id: ID!): EmployeeUpdate!
    @edfs__natsSubscribe(subjects: ["employee.{{ args.id }}.updated"], providerId: "my-nats")
}

type Query {
  # Backfill: everything that changed for this entity since the client's high-water mark,
  # in the SAME shape and key space as the subscription. Backed by an outbox / changelog table.
  employeeUpdatesSince(id: ID!, since: String): [EmployeeUpdate!]!
}

type EmployeeUpdate {
  # The dedup join key. Application-owned, opaque, stable, identical across
  # the live subscription and the backfill query for the SAME logical event.
  idempotencyKey: ID!
  # The high-water mark cursor. Monotonic per (entity, stream). See §3.4.
  since: String!
  employee: Employee!
}
```

**The contract, stated precisely (this is the whole correctness mechanism):**

1. For one logical state transition, the `idempotencyKey` value emitted on the live subscription **equals** the `idempotencyKey` value the backfill query returns for that same transition.
   Because both are typed fields the application populates from the *same* source (the outbox row's id, the `Nats-Msg-Id`, the Kafka key — whatever the application chose), the application controls this directly. The router does not synthesize it.
2. The key is **opaque and non-enumerable** when surfaced to the client (§7 security). Do not expose a raw primary-key sequence: it leaks row counts/ordering, and on a shared trigger (dossier §6.5) a co-subscriber sees its shape.
3. The payload is **state-convergent**: `employee` is the current entity state, not a delta.
4. `since` is **per (entity, stream) monotonic** and is the event's own position label — **not** a shared resume cursor (see §3.3).

There is no content-hash fallback. As §3.2 proves, a content hash cannot be made to match across the resolve boundary, so it would silently break dedup. **If the application cannot supply a stable, schema-surfaced key for a subscription, that subscription is not a candidate for F.**

### 3.2 Why the router cannot synthesize the key (and why content-hash is withdrawn)

Two independent code facts, verified against the router and `graphql-go-tools v2.4.1`:

- **There is no side-channel from the adapter to the writer.** The adapter calls `updater.Update(event.GetData())` (`subscription_event_updater.go:39`) or `UpdateSubscription(subID, event.GetData())` (`:122`). `GetData()` returns *only* `e.Data` (`nats/engine_datasource.go:21-26`, `:44-49`; `kafka/engine_datasource.go:22-27`, `:65-67`) — `Key`, `Headers`, and any new struct field are dropped here. The engine interface is `Update(data []byte)` / `UpdateSubscription(id, data []byte)` with no metadata parameter (`resolve.go:1586-1590`). `executeSubscriptionUpdate(ctx, sub, sharedInput []byte)` (`:616`) hands `sub.writer` the *resolved* response only; `websocketResponseWriter.Flush()` constructs `extensions` purely from `rw.header` (`websocket.go:704-736`). The writer therefore has no access to the broker event or any per-event key. Attaching `extensions.cosmo.idempotencyKey` at the writer is **impossible without modifying the engine** (see §3.5).
- **A content hash cannot match across resolve.** Even if the router hashed `event.Data` at the adapter, the client never sees those bytes. The broker `input` flows through `InitSubscription` → `LoadGraphQLResponseData` (federated / nested subgraph fetches) → `Resolve` into the writer (`resolve.go:627-664`). The final GraphQL payload has a different field set, ordering, enrichment, and federation joins. `hash(adapter Data) ≠ hash(resolved payload)`, so a client-side or outbox-side content hash would *never* equal the router's — every event would look unique, and on the deliberate reconnect overlap (§3.3) **every overlapped event would leak as a duplicate**. That is worse than no dedup. Content-hash dedup is therefore **withdrawn**.

Consequence for the guarantee: **F does not "guarantee a key always exists."** A stable key exists only when the application supplies one (an explicit app-set id: outbox row id, `Nats-Msg-Id`, Kafka key, `x-idempotency-key`) and surfaces it through the schema per §3.1. For any backend/subscription lacking an app-set id, F provides no dedup and therefore no safe backfill — it degrades to at-most-once.

### 3.3 `since` is a per-event position label, not a shared resume cursor — and the client owns resume state

`since` is the event's **own** position label (a monotonic per-(entity, stream) value: an outbox sequence, a ULID, a timestamp — §3.4). It is the same for all N fan-out recipients of one event, which is correct *because it labels the event, not a client's progress.*

The **resume cursor is the client's responsibility, and the client's alone.** Each client tracks its own *last-successfully-applied* `since` locally. On reconnect, the client passes *its own* last-applied `since` to the backfill query. One event fanned to N clients carries one `since`, but client A may have durably applied up to `since=50` and client B only up to `since=10`; each resumes from its own watermark. The router holds none of this. (This corrects the prior draft, which described `since` as a shared per-event "high-water mark the client should resume from" — meaningless across fan-out.)

This is also why the SSE `Last-Event-ID` "free resume" story from the prior draft does not hold: a per-event `id:` line is the wrong thing to echo for a per-client resume cursor, and graphql-sse does not implement `Last-Event-ID` resumption anyway (dossier §4.1). See §4 — that claim is withdrawn.

### 3.4 `since` ordering and the lower-boundary gap (the commit-ordering contract)

The merge is **"apply in `since` order, dedup by key"** — *not* "backfill-first, then live" (the prior draft's rule applied stale-over-fresh when state changed again between the outbox snapshot and the query; see §15-equivalent in §6). For that to be correct, `since` must be a **total order per (entity, stream)**:

- **Required: monotonic sequence or ULID, not bare timestamps.** A monotonic outbox sequence (or a ULID) gives an unambiguous total order. Wall-clock timestamps are clock-skew-prone and ambiguous at equal resolution; the SDK helper (§10) **requires** monotonic `since` and rejects timestamp cursors unless the application explicitly opts into the escape hatch and accepts the ambiguity.
- **Required: the live event's `since` and the outbox row's `since` are assigned by the *same authority* (publish-side).** If the live stream and the outbox can disagree on an event's position, backfill is unsound. Concretely: the publisher assigns `since` once, writes it to the outbox row, and stamps it on the published event body. The router never assigns `since`.

**The lower-boundary gap (a real lost-event window, added to §6).** If the client's `lastSeen` advanced from a *live* event whose outbox row had not yet committed (async/lagging outbox write), then `WHERE since > lastSeen` would *skip* in-flight events that landed in the outbox with `since ≤ lastSeen`. Mitigations, both required by the contract:

1. **Commit-then-publish (or same-transaction outbox).** The outbox row must be durably committed *before* the event is published to the broker, or written transactionally with the producing mutation (a true transactional outbox). Then any `since` a client could have seen live is already present in the outbox.
2. **Resume with a safety margin.** The SDK helper resumes from `lastSeen − margin` (a small number of sequence steps, or a short time window for the timestamp escape hatch), accepting extra duplicates (which dedup collapses) to close the gap. The application documents its outbox write-ordering guarantee so the margin can be sized to zero where commit-then-publish is strict.

### 3.5 Alternative: router-stamped key via an engine change (re-scoped to L)

For teams that want the router to surface the key so unmodified clients get dedup metadata without schema changes, the only correct implementation is an **engine modification**, scoped honestly here as a separate, larger effort:

- Extend the engine `SubscriptionUpdater` interface (`resolve.go:1586-1590`) and `Update`/`UpdateSubscription`/`executeSubscriptionUpdate`/`subscriptionState`/the `SubscriptionResponseWriter` to carry a **per-event metadata struct** alongside `data []byte`, so the originating key/`since` survive to `Flush()` and can be merged into `extensions.cosmo`.
- Propagate that struct through `subscription_event_updater.go` (a real `Update` signature change, not the additive-struct-field trick the prior draft assumed — `GetData()` would also need a sibling `GetDelivery()` that the adapter populates and the engine forwards).
- This is **multi-repo** (it modifies the pinned `graphql-go-tools` and the router) and is therefore an **L** effort. It is listed under "Hidden engine changes" in §11. Even then, the *content-hash fallback stays withdrawn* (§3.2): the key must still be an app-set id assigned pre-resolve, because the engine cannot hash the post-resolve payload back into the matching adapter-side value either. The engine change only changes *who carries the app-set key to the wire*, not whether a key can be synthesized.

The RFC recommends the §3.1 schema-surfaced approach as the default and treats §3.5 as opt-in for a later milestone.

### 3.6 Lifecycle diagram

```
                         ┌──────────────────── application owns ────────────────────┐
   publisher ──► broker  │   outbox / changelog table  (durable, queryable)          │
       │   (commit-then- │        ▲   assigns `since` + idempotencyKey ONCE           │
       │    publish, §3.4)└────────┼──────────────────────────────────────────────────┘
       ▼                          │
   ┌─────────┐   live event        │  Query.employeeUpdatesSince(since)
   │ adapter │  (body carries      │            ▲
   └────┬────┘   idempotencyKey    │            │ (HTTP query on (re)connect)
        │        + since in data)  │            │
        ▼                          │            │
   engine resolve ─► writer ─► Next (typed data incl. idempotencyKey, since)
        │                          │            │
   ─────┼──────────────────────────┼────────────┼───────────────────────────────────
        │     C L I E N T          │            │
        ▼                          │            │
   steady state:  receive Next ─► apply, dedup by key ─► advance OWN lastSeen=since
                                   │
   ─── DISCONNECT ─────────────────┘
                                   │
   reconnect (client owns resume): │
     1. Subscribe (fresh, from "now")  ─────►  live deltas start flowing
        └─ buffer live deltas in a queue
     2. run Query.employeeUpdatesSince(since = OWN lastSeen − margin)  ◄── backfill
     3. merge ALL (backfill ∪ buffered live) and apply in `since` order, dedup by key
     4. resume steady state
```

The reconnect window is deliberately overlapped (lower margin in step 2, plus live buffering) so the union covers the gap; dedup-by-key collapses the overlap. Apply order is decided by `since`, never by arrival order or "backfill-first."

---

## 4. Wire protocol & client changes

**Subscription protocol changes: none.**
This is the defining property of Pattern F and the reason it pairs with stock clients on any transport.

Justification, point by point against dossier §4.4:

- We do **not** add an `ack` inbound message (option 1) — no `wsproto` change (`proto.go:88-94`).
- We do **not** require a resume token in the `Subscribe` payload (option 2) — the router still subscribes from "now."
- We take option 3 (client-side dedup/backfill) explicitly, and accept its ceiling: *state-convergent on reconnect, for outbox-backed subscriptions only.*

What rides on existing fields:

- **graphql-ws / graphql-transport-ws / graphql-sse.** The `idempotencyKey` and `since` ride as **ordinary typed fields in the `data`** (§3.1). Any spec-compliant client reads them with no transport change. A client that ignores them behaves exactly as today (at-most-once). This is the fallback for non-participating clients: silent, safe, no negotiation.
- **No `extensions.cosmo` block, no SSE `id:` line.** The prior draft proposed both; both are **withdrawn**. The `extensions` route requires the engine change (§3.5). The SSE `id:` "free resume" claim is incorrect: `flushwriter.go:307-312` hardcodes `event: next\ndata: ` (adding `id:` is a real writer change, not free), the echoed `Last-Event-ID` would carry the wrong value for a per-client cursor (§3.3), and graphql-sse does not implement `Last-Event-ID` resumption (dossier §4.1). **SSE clients run the catch-up query like everyone else.**
- **Capability negotiation.** None. A client opts in purely by *reading the two typed fields* and *running the catch-up query*.

The companion catch-up query is **not** a protocol change — it is an ordinary GraphQL query over the existing HTTP path (`graphql_handler.go`), defined in the application's schema. The "client change" is application code (or the SDK helper, §10), not a transport change.

This remains the cheapest client-integration story of the seven patterns, and the only one fully transparent to unmodified Apollo / Relay / urql clients — at the cost that the application must surface the two fields itself.

---

## 5. Per-backend adaptability & degradation matrix

The headline, corrected: **the durability that matters lives in the application outbox, not the stream — so "state-convergent on reconnect" is a property of the application's outbox, not of the backend.** The backend's only contributions are (a) whether a *native stable id* exists that the application can copy into its key, and (b) whether the live stream can suggest a `since` (the outbox always provides the authoritative one).

The columns are split to stop the prior draft's misattribution:

| Backend | Supported by F? | Backend's contribution (key id quality) | Guarantee **given a complete, queryable outbox** | What is **lost if the outbox does NOT contain the event** |
|---|---|---|---|---|
| **NATS core** | Yes | `Nats-Msg-Id` if publisher set it; else **none** (no usable key from the stream) | State-convergent on reconnect | **Everything** — live event dropped, no replay, no row → permanent loss |
| **NATS JetStream** | Yes | `Nats-Msg-Id` (publisher dedup id); stream seq available | State-convergent on reconnect | The event survives in the *stream* (JetStream is a log) → prefer Pattern B if you want it without an outbox; under F, lost unless in outbox |
| **Kafka** | Yes | record `Key` (already surfaced) or app header | State-convergent on reconnect | Survives in the *topic* within retention → Pattern B recovers it; under F, lost unless in outbox |
| **Redis Pub/Sub** | Yes | app header key if present; else none | State-convergent on reconnect | **Everything** — drop on overflow, no replay, no row → permanent loss |
| **Redis Streams** | Yes | stream entry ID (stable, sortable) | State-convergent on reconnect | Survives in the *stream* (PEL/entry IDs) → Pattern B works; under F, lost unless in outbox |
| **AWS SQS (Standard)** | Yes (when wired) | FIFO → `MessageDeduplicationId`; Standard → none | State-convergent on reconnect | **Everything** — delete-on-ack, no replay → permanent loss. NB: F is *not* using SQS for durability; it relies entirely on the outbox, and would work identically with **no broker at all** |
| **Google Pub/Sub** | Yes | `messageId` (stable) | State-convergent on reconnect | Possibly recoverable via snapshot/seek (B); under F, lost unless in outbox |
| **AWS Kinesis** | Yes | partition key + sequence number | State-convergent on reconnect | Survives in shard within retention (iterator expiry 5 min makes B fragile); under F, lost unless in outbox |
| **Azure Event Hubs** | Yes | partition key + offset | State-convergent on reconnect | Survives in partition within retention; under F, lost unless in outbox |
| **RabbitMQ / AMQP** | Yes | `message-id` property if set; else none | State-convergent on reconnect | **Everything** — delete-on-ack, no replay → permanent loss |

Read the table honestly: for the at-most-once backends F is *sold* as the answer for (**NATS core, Redis Pub/Sub, SQS Standard, RabbitMQ**), the "guarantee achieved" column is *entirely* an application-outbox property. If the application does not independently write the event to the queryable store, **F recovers nothing** on those rows — they are at-most-once. The "F is the only viable durable-feel pattern on SQS Standard" framing from the prior draft was misleading and is removed: F isn't using SQS for durability at all.

Degradation is surfaced non-silently in two ways: the composition lint (§8) flags fields that opt into F without a schema-surfaced key/since or with a delta-shaped payload, and the application's own observability reports key-source and outbox hit/miss. The router cannot stamp `keySource` (no side-channel; §3.2), so this observability lives in the application resolver / SDK helper, not the router.

---

## 6. Delivery semantics achieved

Be precise about what F does and does not promise.

**Applicability gate (the dominant one).** F applies only to subscriptions that are **(a) state-convergent** and **(b) backed by a queryable outbox/changelog/entity store**. For everything else — pure notification, presence, "typed", "new message arrived" event streams that are never persisted as current state — **F is at-most-once, identical to today.** A large fraction of real GraphQL subscriptions are exactly this kind of transient stream; for them F adds nothing. Do not present F as a universal floor for them.

**For discrete events (the live stream): at-most-once.**
F changes nothing about the live push path. A disconnect, restart, or slow-consumer overflow still drops live events exactly as today (dossier §2). F does not redeliver them.

**For application state (across a reconnect, in-scope subscriptions): state-convergent.**
After the client completes the backfill-merge-dedup loop (§3.6), its view of every entity in scope of the catch-up query equals the authoritative store. No state is permanently lost as long as the outbox is queryable and retains the window the client must backfill.

**Duplicates: expected and required to be tolerated.**
The reconnect window deliberately overlaps the live stream, so the same logical update arrives twice. The application-owned key collapses them. The client *must* be idempotent; this is the contract, not a bug (dossier §6.2).

**Ordering: not guaranteed for intermediates; final state converges.**
The merge rule is "apply in `since` order, dedup by key" (§3.4). For state-convergent payloads, last-writer-by-`since` is correct by construction. For delta/CRDT payloads F is the **wrong** pattern — use A or B. This must be loud in the docs and is enforced by the lint (§8).

**Exact failure windows that remain:**

1. **Non-outbox events.** Any event not persisted as a queryable row is unrecoverable. (The applicability gate, restated as a failure mode.)
2. **Intermediate-transition loss.** `A → B → C` during a disconnect; backfill returns `C` → `B` never observed. Acceptable for last-writer-wins state; unacceptable for event-sourced / audit consumers.
3. **Outbox retention gap.** If the disconnect outlasts outbox retention for the `since` window, the backfill returns a truncated set. The application must either retain long enough or signal **"snapshot reset"** (return full current state, drop `since`) as a *defined* error, not a silent short read (analogue of "cursor expired", dossier §5b).
4. **Lower-boundary gap.** In-flight live events whose outbox row committed late can be skipped by `WHERE since > lastSeen`. Closed by commit-then-publish + safety-margin resume (§3.4).
5. **Key misalignment.** If the subscription's `idempotencyKey` and the backfill's `idempotencyKey` for the same transition differ, dedup silently fails (duplicates leak, or — worse — distinct events collapse). Caught only by the end-to-end test (§12); this is why that test is mandatory.
6. **Backfill-vs-live merge bug in client code.** Applying live deltas before backfill, or out of `since` order, can apply stale over fresh. The SDK helper (§10) makes apply-in-`since`-order a library invariant.

**Net: at-least-once redelivery via the outbox + idempotent, `since`-ordered client merge = effective exactly-once *state convergence* for in-scope subscriptions, never exactly-once *event delivery*, and nothing at all for out-of-scope subscriptions.**

---

## 7. Cross-cutting concerns

**Router HA / horizontal scaling & sticky sessions.**
This is F's quiet superpower (dossier §6.6). The router holds **no per-subscription durable state** and durability lives in the application outbox, so a reconnect can land on *any* router instance. No sticky sessions, no consumer-name coordination, no external checkpoint store. The per-instance JetStream durable-naming tension (`nats/adapter.go:69-83`) is irrelevant to F. Cheapest pattern to operate at scale and under churn.

**Per-subscription state / memory cost.**
Router-side: **exactly O(1)** — F adds *nothing* to the router data path (no key derivation, no hash, since the router does not synthesize the key; §3.2). No buffer, no held ack, no per-subscriber consumer. Lowest-memory pattern of the seven (dossier §6.7).

**Multi-tenant shared-trigger fan-out.**
F **preserves** the shared-trigger optimization (dossier §1.4, §6.5): one broker subscription still fans out to N subscribers, each receiving the same typed payload (including the same `idempotencyKey`/`since`, which the *application* put in the body — correct, since the key labels the event). F does not force per-subscriber consumers (C) or per-subscriber ack (A). The catch-up query is per-client and stateless on the router, scaling as ordinary query traffic. **Caveat (security):** because the same key value is visible to every co-subscriber on a shared trigger, the application must keep keys opaque/non-enumerable (§3.1) — a key derived from a primary-key sequence would leak one tenant's row counts/ordering to co-subscribers.

**Where the key is asserted vs. the hooks pipeline.**
Correcting the prior draft: the `OnReceiveEvents` hook runs **per subscription, after fan-out** (`subscription_event_updater.go:52` iterates `subscriptions`, then `:95-129` runs per `subID`), not "once at the adapter before fan-out." Because F's key lives in the *application schema body*, hook transforms are simply part of producing that body: if a hook rewrites the payload, the application must ensure the rewritten body still carries the agreed `idempotencyKey`/`since`. The **post-hook re-derivation rule** (was OQ#5): if a hook *splits* one event into N output events, each output event must carry its **own** key (the application assigns one per output row in the outbox too) — never one shared key across the three (that would collapse them on dedup). A hook that **drops** an event is fine: the dropped event is simply not delivered live and, if it was real state, is recovered via backfill. Drop ≠ loss under F. Since there is no content hash anywhere (§3.2), there is no "pre- vs post-hook hashing" question to resolve.

**Backpressure.**
Unchanged. F adds no buffer and holds no ack, so no new backpressure coupling. The existing per-trigger-serial backpressure and silent-drop behavior (dossier §2.2) still apply to the *live* stream — but for in-scope subscriptions a drop is no longer permanent loss, because the next reconnect's backfill recovers the state. This is the conceptual shift: F makes the existing lossy backpressure *tolerable* for in-scope subscriptions, not fixed.

**Reconnect thundering herd (new).**
Because every reconnect fires a backfill query, a synchronized reconnect storm (router restart, LB failover, a mobile-network flap across thousands of clients) becomes a **thundering herd of `*Since` queries** hitting the outbox/DB precisely when the system is already stressed. Worse, the backfill re-runs full per-event authz (the security feature below) — for a wide `since` window that is N× the per-event authz cost of normal delivery, per reconnecting client. Mitigations the RFC requires the SDK helper and docs to implement:
- **Jittered backfill** — randomized delay before the catch-up query on reconnect, to de-synchronize the herd.
- **Bounded / paginated `*Since`** — the catch-up query must paginate and the application should rate-limit / cost-bound it; an unbounded `since` window must page rather than return an unbounded set.
- **Snapshot-reset short-circuit** — if a client's window exceeds retention, return current state once (§6 failure #3) instead of replaying a huge span per event.

**Security / authz.**
- The catch-up query runs through the **normal** query authz path — same resolver, field-level auth, tenant scoping as any federated query. No new "replay" surface bypassing authz, unlike raw cursor-replay (Pattern B). Backfill *is* a query, so it re-runs *current* authz per event by construction (dossier §6.8) — at the cost amplification noted above.
- `since` is opaque to the router; the application's `*Since` resolver validates it and enforces tenant scope. The router never seeks a broker by it.
- **Key opacity is mandatory, not advisory.** The key is in the client-visible body and (shared trigger) visible to co-subscribers. It **must** be opaque/non-enumerable and must not encode sensitive data or enumerable ordering. The lint (§8) cannot prove opacity, so this is a documented requirement plus a review checklist item.

---

## 8. Configuration & composition surface

F's primary path needs **no router YAML and no proto change** — the key and `since` are application schema fields (§3.1), and the router does not read them. This is a deliberate simplification over the prior draft's `delivery` block and `DataSourceCustomEvents` additions, which existed only to feed the withdrawn router-stamping mechanism.

What the router *does* add is **optional and additive**:

**A composition-time lint / advisory directive `@edfs__backfill` (optional).**
Purely a marker that lets composition validate the contract and emit a warning — it does **not** change runtime behavior and is **not** required to use F.

```graphql
type Subscription {
  employeeUpdated(id: ID!): EmployeeUpdate!
    @edfs__natsSubscribe(subjects: ["employee.{{ args.id }}.updated"], providerId: "my-nats")
    @edfs__backfill(query: "employeeUpdatesSince", keyField: "idempotencyKey", sinceField: "since")
}
```

Composition (parsed alongside the other `@edfs__*` directives in `normalization-factory.ts:2804-3169`) then lints:
- the named backfill query exists and returns a list of the **same** object type as the subscription;
- both the subscription payload type and the backfill element type expose `keyField` and `sinceField`;
- a best-effort heuristic flag when the payload looks delta-shaped (e.g. field names like `delta`, `increment`, `op`) — advisory, since the router cannot know payload semantics.

If `@edfs__backfill` is absent, F still works (it is pure application + client convention); the lint simply does not run. This keeps the composition footprint to *one optional directive definition* and a validation pass — no proto field, no config plumbing across the three planes.

**Engine-stamped variant config (§3.5, deferred).** Only the L-effort alternative would need a `delivery` block and proto fields; it is out of scope for the first milestone and not specified here.

---

## 9. Migration & backward compatibility

**Opt-in, additive, and safe by default.**

- **Nothing is always-on, and nothing changes for existing clients.** Because the primary path is application-schema convention, the router behaves identically until an application adds the key/since fields and a `*Since` query. Apollo/Relay/urql clients that do not read the new fields behave exactly as today (at-most-once). No client breaks.
- **No router schema/proto/YAML change required** for the primary path. `@edfs__backfill` is an optional lint marker (§8).
- **Rollout in three stages:**
  1. **Application adds the outbox + the two schema fields + the catch-up query** (`Query.*Since(since:)`), assigning `since`/`idempotencyKey` publish-side with commit-then-publish (§3.4). No Cosmo change required (optionally add `@edfs__backfill` for the lint).
  2. **Add the end-to-end alignment test (§12)** to CI before any client ships dedup — this is the gate that catches key misalignment (§6 failure #5).
  3. **Clients adopt the SDK helper** (§10) or hand-roll the backfill-merge-dedup loop. Stock clients keep working throughout.
- **Reversible.** Removing the fields/query reverts to today's behavior with no residual state (F is stateless on the router).
- **Composes forward.** F is the right baseline to ship first for state-convergent, outbox-backed subscriptions because it is cheap and backend-agnostic; teams that later need intermediate-event delivery can layer Pattern B (cursor resume) on log backends or Pattern A (client ack) on any backend, without removing F.

---

## 10. Appendix: SDK helper contract and (optional) engine-change types

The primary deliverable on Cosmo's side is the **client SDK helper**, not router Go types — the router does not synthesize anything.

```ts
// ── client SDK helper (TypeScript) ──
// Encapsulates the backfill-merge-dedup invariant so applications don't get
// step ordering wrong (§6 failure #6) or the lower-boundary margin wrong (§3.4).
//
// Invariants the helper enforces:
//  - apply in `since` order (NOT arrival order, NOT backfill-first)         (§3.4)
//  - dedup by application-owned idempotencyKey                              (§3.1)
//  - resume from (own lastSeen − margin), with jitter before the query     (§3.4, §7)
//  - require monotonic `since`; reject timestamp cursors unless opted in    (§3.4)
//  - bounded LRU `seen` set sized to cover the overlap window
//
// onReconnect:
//   liveBuf = []                         // buffer live deltas during backfill
//   subscribe(); route each Next -> liveBuf.push(next)   // each Next is typed: { idempotencyKey, since, ...data }
//   await jitter()                       // de-synchronize the herd (§7)
//   backfill = await paginate(SinceQuery, { since: max(lastSeen - margin, floor) })  // (§7 pagination)
//   merged = mergeBySinceOrder(backfill, drain(liveBuf))   // total order by `since`
//   for ev of merged:
//     if seen.has(ev.idempotencyKey) continue              // DEDUP
//     apply(ev); seen.add(ev.idempotencyKey); lastSeen = max(lastSeen, ev.since)
//   // steady state: apply live in `since` order, dedup by key, advance lastSeen
interface BackfillMerger<T> {
  // returns false for a duplicate (skip); advances lastSeen on apply
  onEvent(ev: { idempotencyKey: string; since: string; data: T }): boolean;
  // returns the `since` argument to query with (lastSeen − margin)
  onReconnect(): { sinceArg: string; jitterMs: number };
}
```

```graphql
# ── composition: the one OPTIONAL lint directive (§8) ──
directive @edfs__backfill(
  query: String!        # the catch-up Query field name, e.g. "employeeUpdatesSince"
  keyField: String!     # the idempotency key field on the payload, e.g. "idempotencyKey"
  sinceField: String!   # the since cursor field on the payload, e.g. "since"
) on FIELD_DEFINITION
```

```go
// ── DEFERRED (§3.5): engine-change types, only for the L-effort router-stamped variant ──
// Shown to scope the alternative honestly; NOT part of the primary milestone.
//
// Would require modifying graphql-go-tools (multi-repo):
//   type SubscriptionUpdater interface {
//       Update(data []byte, meta *DeliveryMeta)                          // signature change
//       UpdateSubscription(id SubscriptionIdentifier, data []byte, meta *DeliveryMeta)
//   }
// plus threading *DeliveryMeta through executeSubscriptionUpdate / subscriptionState /
// the SubscriptionResponseWriter so Flush() can merge it into extensions.cosmo.
// Even then, IdempotencyKey MUST be an app-set id assigned pre-resolve (no content hash; §3.2).
type DeliveryMeta struct {
    IdempotencyKey string // app-set id forwarded from the broker event body/header
    Since          string // app-set monotonic position label
}
```

---

## 11. Risks, open questions, and a complexity/effort estimate

**Where this pattern is weakest (be honest):**

- **It only helps state-convergent, outbox-backed subscriptions.** This is the single biggest limitation, now stated as a gate (§2, §6), not a footnote. For pure notification/event streams F is at-most-once. Quantify against your own EDFS usage before calling F a "floor."
- **It is not at-least-once for events.** F delivers *state convergence*, not *every transition*. Audit-trail / event-sourcing consumers must use A, B, or E.
- **It pushes real cost to the application.** Outbox table, the `*Since` query, commit-then-publish `since` assignment, and — critically — keeping the subscription key field and the query key field in the *same key space*. A misaligned key silently breaks dedup (§6 #5). This is why the end-to-end test (§12) is mandatory, not optional.
- **No content-hash safety net.** The universal fallback is withdrawn (§3.2). A subscription with no app-set stable key is simply not a candidate for F.
- **Reconnect thundering herd.** Backfill-on-reconnect amplifies load and authz cost at the worst moment (§7); mitigations are required, not nice-to-have.

**Alternatives considered:**

- **Router-stamped `extensions.cosmo` key (prior draft's primary design).** Rejected as primary: requires an engine change (§3.2, §3.5); content-hash variant cannot match across resolve. Retained as the §3.5 L-effort alternative.
- **Content-hash universal key.** Rejected outright: cannot match across the resolve boundary (§3.2).
- **SSE `Last-Event-ID` free resume.** Rejected: wrong value to echo for a per-client cursor (§3.3), graphql-sse does not implement it, and emitting `id:` is a real writer change (§4).
- **Other patterns (A/B/C/D/E/G).** Cross-referenced in the dossier §5; F is deliberately the weakest-but-cheapest, chosen for at-most-once backends and state-convergent use cases. D is the recommended correctness-first companion.

**Open questions:**

1. **Should the router ship a reference outbox?** Stance: stay out (the application owns durability). A `wgc` template + a Postgres transactional-outbox pattern + a generated `*Since` resolver would lower adoption cost dramatically. Follow-up, not core.
2. **Ship the §3.5 engine-stamped variant at all?** It buys dedup metadata for clients that won't change their schema, at L effort and a pinned-engine modification. Lean: defer until the schema-surfaced path has adoption data.

(The prior draft's OQ on `since` timestamp-vs-sequence is now *resolved* in §3.4 — monotonic required, timestamps as an explicit escape hatch. The OQ on `OnStreamEvents` split/grow is now *specified* in §7 — per-output-event key. The OQ on SSE `Last-Event-ID` wiring is *withdrawn* with the SSE claim, §4.)

**Complexity / effort estimate.**

- **Router-side, primary path: S.** No engine change, no proto change, no YAML change, no router data-path change. Deliverables are: one optional composition lint directive + validation pass (`composition/`), an SDK helper (client repo), and documentation. The router itself is essentially untouched. This is *smaller* than the prior draft claimed — because the parts that made it M (the `delivery` block, `DataSourceCustomEvents` fields, writer touch-points) were feeding the withdrawn stamping mechanism and are gone.
- **Router-side, §3.5 engine-stamped alternative: L (deferred).** Multi-repo: a `SubscriptionUpdater`/`Update` signature change in pinned `graphql-go-tools`, threading `*DeliveryMeta` through `executeSubscriptionUpdate`/`subscriptionState`/the writer, plus the SSE writer change and `delivery` config/proto plumbing across the three planes. Listed here as "Hidden engine changes" so it is not under-estimated.
- **Application-side: M (recurring, per app).** Transactional outbox + `*Since` query + commit-then-publish + key/since alignment. Not Cosmo's code, but it is the gate to the guarantee and where teams will get it wrong.
- **Client-side: S–M.** Hand-rolled it is the pattern teams already use (dossier §4.2); the SDK helper turns it into S.

**Honest positioning vs the other six:**
F is the cheapest, most portable, lowest-risk pattern to *operate*, and the best (often only) answer for at-most-once backends (NATS core, Redis Pub/Sub, SQS Standard) — **but only for state-convergent, outbox-backed subscriptions, and only because the durability lives in the app's datastore.** It is the *weakest* on the actual problem statement — restoring at-least-once delivery of every event — because it deliberately does not try, and it provides nothing for transient/notification streams. The right framing: **F is the floor for state-convergent, outbox-backed subscriptions, and irrelevant for everything else.** Ship the S-effort schema-surfaced path first as that baseline; layer B/A where intermediate-event fidelity is required; consider the §3.5 engine variant later if client-transparent metadata proves worth the L.

---

## 12. Testing & verification plan

The correctness of F lives entirely in the **key-alignment contract across the resolve boundary** (§3.1, §3.2) and the **`since`-ordered merge** (§3.4). The test plan exists to catch exactly the failure (§6 #5) that the prior draft's design hid.

**Mandatory gate (blocks Draft → Proposed):**

1. **End-to-end key equality through resolve.** A test that drives a real subscription event through the engine (`InitSubscription` → `LoadGraphQLResponseData` → `Resolve`) to the writer, captures the `idempotencyKey` the client receives on the live `Next`, then runs the companion `*Since` query for the same logical transition and asserts the two `idempotencyKey` values are **byte-for-byte equal**. Assert the *full* typed payload of both (per house style: `assert.Equal` on the entire object, never `Contains`), so a renamed/added field is caught. This is the test whose absence let the resolve-boundary mismatch (§3.2) go unnoticed.
2. **`since`-ordered merge correctness.** Given a backfill set and a buffered live set that overlap, assert the merged applied sequence equals the expected `since`-ordered, key-deduped sequence — including the case where the same entity changed again server-side (different key, higher `since`) between snapshot and query (assert newest-by-`since` wins, not backfill-first).
3. **Lower-boundary gap.** Simulate a late outbox commit; assert that commit-then-publish + `lastSeen − margin` resume recovers the in-flight event and that, without the margin, it would be skipped (negative control).
4. **Non-state-convergent / delta payload.** Assert the lint (§8) flags a delta-shaped payload field opting into `@edfs__backfill`.
5. **Duplicate tolerance.** Assert that replaying the overlap window applies each transition exactly once (dedup by key).

**Observability / rollback:**
- Application-side metrics (in the resolver / SDK helper, since the router has no side-channel): backfill query rate, `*Since` window size distribution, outbox hit/miss, dedup-collapse count.
- Rollback is removal of the schema fields + query; no router state to clean up.
