# RFC: At-Least-Once for GraphQL Subscriptions — Tiered Capability Negotiation (Pattern G)

**Status:** Draft

**TL;DR.**
Today EDFS delivery is fire-and-forget by construction:
the broker reader goroutine drives resolve + socket flush in one synchronous call stack,
and only NATS JetStream attempts any durability — and even that acks on flush *attempt*, not client receipt
(`router/pkg/pubsub/nats/adapter.go:154`).
Different backends can offer wildly different guarantees,
and customers reasonably want to keep the broker they already run.
Pattern G is the policy/routing layer that turns this into an *honest* system:
a subscription declares a *desired* delivery class (`at-most-once`, `at-least-once`, `exactly-once`),
the client advertises what it can do (`supports: [ack, resume]`) in `connection_init`,
and the router selects the **strongest mechanism the chosen backend and client can jointly satisfy**,
degrades transparently, and reports the **actual class achieved** in `extensions.delivery`.
It does not invent durability — it composes Patterns A/B/C/D/E/F per backend and refuses to *silently* pretend.
This is the direct answer to "let me pick my backend even if that means a weaker guarantee — just tell me the truth about what I get."

---

## 1. Problem & Context

The research dossier states the gap precisely:

> Today, **only NATS JetStream achieves any durability, and only because its adapter independently calls `msg.Ack()`** after a *flush attempt*.
> There is no client acknowledgement, no resume token, no replay, and no per-subscriber delivery accounting anywhere in EDFS.
> Everywhere else delivery is at-most-once by construction.

An application frequently *already has* at-least-once in its backend:
Kafka with committed offsets, JetStream with durable consumers, Redis Streams with consumer groups and a Pending Entries List.
But the moment those events cross the EDFS boundary into Cosmo,
the guarantee evaporates,
because the framework abstraction itself is fire-and-forget:
`datasource.Adapter` (`router/pkg/pubsub/datasource/provider.go:22-28`)
and the engine's `SubscriptionUpdater.Update(data)` return **no error and expose no ack hook back to the broker**.
Durability is therefore a per-adapter property, not a property of EDFS,
and only one adapter even tries.

Concretely, the loss windows are:

- **Hop A — Broker → router read.**
  Only JetStream consumes durably (durable pull consumer, explicit ack).
  Kafka is groupless and resets to "now" (`ConsumeResetOffset(AfterMilli(now))`, `router/pkg/pubsub/kafka/adapter.go:32-34, 51-122`),
  NATS core uses an unbuffered channel that drops on slow-consumer overflow (`router/pkg/pubsub/nats/adapter.go:168`),
  and Redis uses **Pub/Sub, not Streams** (`router/pkg/pubsub/redis/adapter.go:88-152, 191`) — no ack primitive at all.

- **Hop B — Router resolve → client flush.**
  Even on JetStream, ack timing is wrong:
  `msg.Ack()` (`nats/adapter.go:154`) runs *after* `updater.Update()` returns,
  but `updater.Update()` only ran resolve + `writer.Flush()`,
  and `Flush()` is a single socket write under a write deadline — bytes handed to the kernel, not an application ack from the client
  (`router/core/websocket.go:704-736`, `router/core/flushwriter.go:116-167`).
  A client that crashes after TCP-buffering but before processing loses the message, yet it is acked → **lost-but-acked**.
  The no-hooks path also ignores the result of delivery entirely (`router/pkg/pubsub/datasource/subscription_event_updater.go:36-129`),
  and the hooks path can *abandon* in-flight deliveries on timeout while the JetStream loop still proceeds to `msg.Ack()`
  ("Events may arrive out of order," `subscription_event_updater.go:69-79`).

- **Hop C — No client ack anywhere.**
  The recognized inbound WS message set is `Ping`, `Pong`, `Subscribe`, `Complete`, `Terminate`
  (`router/internal/wsproto/proto.go:88-94`) — there is no "ack received next" concept.
  `connection_init`/`connection_ack` is a one-time *connection* handshake, not a data ack.

- **Hop D — No resume / replay.**
  A reconnecting client always starts a brand-new subscription from "now":
  it gets a new `ConnectionID` (`router/core/websocket.go:367`) and a brand-new subscription id (`websocket.go:1160-1185`).
  The SSE writer never emits an `id:` field (`flushwriter.go:116-167`),
  so even native browser SSE auto-resume cannot work,
  and the delivered event structs carry only `Data`/`Headers`/`Key` — **no sequence/offset cursor is ever surfaced**
  (`nats/engine_datasource.go:39-42`, `kafka/engine_datasource.go:58-63`); JetStream `msg.Metadata()` is never read.

The dossier enumerates six concrete patterns to close these hops (A–F),
each with a different cost, a different backend footprint, and a different protocol requirement.
The trouble is that **no single pattern is right for every backend**:
B (cursor replay) is excellent on Kafka but *impossible* on NATS core;
A (client ack) is natural on SQS but degrades to a cursor-advance on Kafka;
E (router buffer) is the only thing that works on Redis Pub/Sub.
A customer who runs three different brokers behind one router should not have to pick one guarantee for all of them,
nor should they be silently downgraded without knowing it.

**Pattern G is the layer that resolves this.**
It does not add a new durability mechanism.
It adds the *negotiation, selection, and honesty* layer that sits atop whichever of A–F have shipped,
chooses the best feasible mechanism per `(backend, client, requested class)` triple,
and reports the truth back to the client.

This builds directly on the existing Cosmo Streams v1 hooks where relevant:
the v1 `SubscriptionOnStart` hook (`cosmo-streams-v1.md`) is the natural place to surface and override a negotiated class,
and the v1 `StreamBatchEventHook` / `OnStreamEvents` batch contract is where per-event idempotency keys and replay-time authz re-checks must run.
Pattern G does not replace those hooks; it threads a delivery policy through them.

---

## 2. Goals & Non-Goals

### Goals

1. **Honest delivery.**
   The router must never report or imply a guarantee it cannot meet for a given subscription.
   The *actual* achieved class is always reported back to the client (`extensions.delivery`), and observable in logs/metrics/traces.
2. **Backend choice without lock-in to a guarantee.**
   A user can keep any supported backend and still get the *strongest feasible* class on it, with explicit, non-silent degradation when the backend cannot reach the requested class.
3. **Composition, not reinvention.**
   G selects among already-implemented mechanisms (A/B/C/D/E/F).
   It is a pure routing/policy layer; it adds no new broker integration of its own.
4. **Graceful client fallback.**
   Stock clients (Apollo, urql, Relay, plain SSE) that cannot ack or resume must still work, degrading to a clearly reported `at-most-once` (or whatever floor is feasible without their participation).
5. **Per-field and per-client control.**
   The desired class can be expressed per subscription field (schema directive at composition time) and/or per client (capability handshake at connection time), with a deterministic precedence rule.
6. **Opt-in and backward compatible.**
   With no configuration and no client capabilities advertised, behavior is byte-for-byte identical to today.

### Non-Goals

1. **Implementing A–F.**
   This RFC specifies the negotiation contract and the selection algorithm,
   plus the minimal hooks each underlying pattern must expose to be selectable.
   It assumes A–F (or a subset) are delivered by their own RFCs.
   Where a pattern is absent, G simply has fewer rungs on the ladder and degrades accordingly.
2. **A new wire protocol.**
   G reuses graphql-ws / graphql-transport-ws / graphql-sse and adds only the minimal handshake fields and an `ack`/`resume` extension. It does not invent a fourth subprotocol.
3. **Guaranteeing ordering as a side effect.**
   Ordering remains a separate, per-mechanism property (§7). G reports it but does not strengthen it.
4. **Cross-backend global ordering or cross-backend exactly-once.**
   Out of scope — exactly-once is per-backend, per-stream, and only where the backend supports it.
5. **Solving HA durable state on its own.**
   G's selection depends on the HA story of the pattern it selects (e.g. C's checkpoint store). G surfaces the constraint; it does not fix it.

---

## 3. Design — the mechanism in depth

### 3.1 The core idea: a delivery class is the *output* of a negotiation, not an input

There are three delivery classes, ordered:

```
at-most-once  <  at-least-once  <  exactly-once
```

A subscription has a **requested class** (a ceiling the user asks for) and an **achieved class** (the floor the system can prove it will meet).
The router computes:

```
achieved = min( requested,
                backendCeiling(provider, backendStreamConfig),
                clientCeiling(negotiatedClientCapabilities),
                transportCeiling(transport),
                routerCeiling(enabledPatterns, haTopology) )
```

`min` over the partial order. Each term is the strongest class that *that dimension* can support:

- **`backendCeiling`** — the strongest class the chosen broker primitive supports given how it is consumed
  (e.g. JetStream durable consumer → up to `exactly-once`; Kafka → `at-least-once` via cursor; NATS core → `at-most-once`).
- **`clientCeiling`** — derived from the capabilities the client advertised: `supports:[ack]` enables A; `supports:[resume]` enables B; neither → `at-most-once` unless a router-side mechanism (E) can carry it without client help, in which case it is `at-least-once`-within-window.
- **`transportCeiling`** — WS full-duplex can carry `ack`; SSE/multipart are one-directional and need the out-of-band ack channel (§5) or resume-only.
- **`routerCeiling`** — which of A–F are actually compiled/enabled, plus whether the HA topology supports the state the chosen mechanism needs (sticky routing, external checkpoint store).

The achieved class then **selects the concrete mechanism** to wire up (the "selection table," §3.4),
and that selection is reported in `extensions.delivery` (§5.3).

This is the whole pattern: a `min` over capability ceilings, a deterministic mechanism selection, and an honest report.

### 3.2 Components touched

Pattern G is deliberately thin. It introduces one new package and threads a small amount of state through existing seams.

- **New: `router/pkg/pubsub/delivery/` (the policy engine).**
  - `Negotiator` — pure function `(Request) → Decision` computing `achieved` and the selected mechanism.
  - `CapabilityRegistry` — per-provider declared ceilings, populated at provider build time.
  - `Decision` — the negotiated outcome (class, mechanism, idempotency-key source, replay window, ordering guarantee) carried for the life of the subscription.

- **Provider adapters (`router/pkg/pubsub/{nats,kafka,redis}`).**
  Each adapter gains a `Capabilities()` method declaring what classes/mechanisms it can support for a given resolved stream config
  (e.g. NATS reports `exactly-once` only when a JetStream `streamConfiguration` is present *and* double-ack + dedup are enabled;
  it reports `at-most-once` for core NATS subjects).
  Each adapter's `Subscribe`/`Update` path is parameterized by the selected mechanism so the *same* adapter can run fire-and-forget (today) or ack-gated / cursor-bearing.

- **`datasource.SubscriptionEventUpdater` (`router/pkg/pubsub/datasource/subscription_event_updater.go:19-24`).**
  This is the central seam. Today it is fire-and-forget.
  G requires it to carry a `Decision` and to return a per-event/per-subscriber `DeliveryOutcome` upward,
  so the adapter can ack/commit/`XACK` correctly (this is exactly the Pattern D contract change — D is the substrate G stands on).
  When the decision is `at-most-once`, this collapses to today's void-returning behavior with zero overhead.

- **graphql-go-tools `resolve.SubscriptionUpdater` contract.**
  For any class above `at-most-once`, the engine must surface a delivery result rather than `void`,
  and must attach the router-assigned (or backend-derived) sequence/cursor to each `Next` so the writers can emit it.
  This is the single change that lives outside the Cosmo repo;
  if the engine cannot be changed in a given release, G caps `routerCeiling` at `at-most-once` and says so — honestly.

- **`router/core/websocket.go` + `router/internal/wsproto/proto.go`.**
  Parse the capability payload in `connection_init`; add the `ack` inbound message and the `resume` field on `Subscribe`;
  emit `id` (sequence/cursor) on each `Next`; emit the negotiated `extensions.delivery` on the first frame.

- **`router/core/flushwriter.go` (SSE/multipart).**
  Emit `id:` on SSE so native `Last-Event-ID` auto-resume works;
  honor `Last-Event-ID` on (re)connect;
  wire the out-of-band `POST /graphql/ack` back-channel for ack-class subscriptions on one-directional transports.

- **Config (`router/pkg/config/config.go`).**
  A new `events.delivery` block (defaults, per-provider caps, enabled mechanisms, replay window, ack window). See §9.

- **Composition / proto (optional).**
  An optional `@edfs__delivery(class: AT_LEAST_ONCE)` directive on subscription fields, serialized into `DataSourceCustomEvents` so the per-field *requested* class travels in the execution config.
  Without it, the requested class comes from config/handshake only.

### 3.3 Lifecycle diagram

```
                         CONNECTION (once per socket)
 client ── connection_init { payload.cosmo.delivery.supports:[ack,resume] } ──▶ router
 client ◀── connection_ack { payload.cosmo.delivery.accepted:[ack,resume] } ──── router
                         (router stores negotiatedClientCapabilities on the connection)

                         SUBSCRIPTION (once per operation)
 client ── Subscribe { id, payload:{query,...}, extensions.delivery.request: at-least-once,
                                              extensions.delivery.resume: <cursor?> } ──▶ router
                                                          │
                                  ┌───────────────────────┴───────────────────────┐
                                  ▼                                                 │
                    delivery.Negotiator.Negotiate(Request{                         │
                        requested  = field-directive ∧ Subscribe.request ∧ cfg     │
                        client     = negotiatedClientCapabilities                  │
                        transport  = WS | SSE | multipart                          │
                        backend    = adapter.Capabilities(resolvedStreamConfig)    │
                        router     = enabledPatterns ∧ haTopology })               │
                                  │                                                 │
                                  ▼                                                 │
                    Decision{ achieved=at-least-once,                              │
                              mechanism=CURSOR (Pattern B),                        │
                              idempotencyKeySource=Nats-Msg-Id,                    │
                              replayWindow=stream-retention,                       │
                              ordering=per-stream }                                │
                                  │                                                 │
 client ◀── Next #0 (first frame) extensions.delivery = Decision (reported) ───────┘
                                  │
            adapter.Subscribe(ctx, updater[Decision], resume=<cursor>)
                                  │  (B: seek backend to cursor, replay missed, then live)
                                  ▼
            broker ── event ──▶ adapter ──▶ updater.Update([]StreamEvent, Decision)
                                  │            │ (D substrate: returns DeliveryOutcome)
                                  │            ▼
                                  │      engine resolve + Flush, sequence/cursor attached
                                  │            │
 client ◀── Next #n { ..., id:<cursor_n> } ───┘
                                  │
   (A only) client ── ack { id:<cursor_n> } ──▶ router ──▶ adapter.Confirm(cursor_n)
                                  │                          │ JetStream Ack / Kafka commit / XACK / SQS delete
                                  ▼
                          broker ack / commit / checkpoint advances
```

The two negotiation points are the **connection handshake** (capabilities, once)
and the **subscription start** (requested class ∧ resume cursor, per operation).
Everything after that is the selected mechanism running with the `Decision` as its policy object.

### 3.4 The selection algorithm

`Negotiate` is a pure, deterministic function. In prose:

1. **Compute the requested class.**
   `requested = min(fieldDirectiveClass, subscribeRequestClass, configDefaultClass)`.
   If none is set, `requested = at-most-once` (today's behavior — no change unless asked).
   *Precedence note:* we take the `min`, not "most specific wins."
   A field annotated `at-least-once` cannot be forced down by a client asking for `at-most-once` unless the client genuinely cannot do better — but a client *can* voluntarily ask for less.
   Conversely a field annotated `at-most-once` is a hard ceiling the client cannot exceed.
   This makes the directive a *guarantee floor authored by the schema owner* and the handshake a *capability statement by the client*; the achieved class is their intersection with the backend.

2. **Compute each ceiling** (`backendCeiling`, `clientCeiling`, `transportCeiling`, `routerCeiling`) as in §3.1.

3. **`achieved = min(requested, all ceilings)`.**

4. **Select the mechanism for `achieved` on this backend** via the selection table:

   | achieved | backend family | mechanism selected |
   |---|---|---|
   | `at-most-once` | any | fire-and-forget (today) |
   | `at-least-once` | log/cursor store (Kafka, Redis Streams, Kinesis, Event Hubs, JetStream, Pub/Sub) + client `resume` | **B** (cursor replay) |
   | `at-least-once` | ack/redelivery queue (SQS, RabbitMQ, JetStream) + client `ack` | **A** (client-ack, broker redelivery) |
   | `at-least-once` | no native durability (NATS core, Redis Pub/Sub) + any client | **E** (router replay buffer, window-bounded) |
   | `at-least-once` | any, no client participation, but D enabled | **D** (correct broker ack on flush — "at-least-once relative to flush") |
   | `exactly-once` | JetStream (double-ack + `Nats-Msg-Id` dedup) / Pub/Sub EOS / Kafka EOS + client `ack` + idempotent client | **A + C** + dedup |
   | cross-restart `at-least-once` | durable per-sub state available | **C** (durable consumer per subscription) under A or B |

   When more than one mechanism qualifies (e.g. Kafka with both `ack` and `resume` clients), prefer the one with the lower router cost: B (≈O(1) router state) over A (per-in-flight state) over C/E (per-subscriber state). This preference is configurable per provider.

5. **Fill in the rest of the `Decision`:** idempotency-key source (§8.2), replay window, ordering guarantee, and a human-readable `reason` string explaining any degradation (e.g. `"requested exactly-once, backend redis(pubsub) ceiling at-most-once: no durable position"`).

6. **Report.** The `Decision` is emitted to the client (§5.3) and recorded on the span.

Because every term is a `min` over a fixed partial order and the selection table is total,
the algorithm is deterministic and explainable — for any subscription you can answer
"why did I get this class?" by printing the four ceilings and the winning table row.

### 3.5 Where the `at-most-once` fast path stays free

If `achieved == at-most-once` (no directive, no capabilities, no config, or an at-most-once backend),
the `Decision` carries `mechanism = FireAndForget` and the updater path is the *existing* void path
(`subscription_event_updater.go:36-129`) with no sequence attachment, no ack channel, no buffer.
The negotiation is a few comparisons at subscription start and nothing per event.
This is the property that makes G safe to ship as on-by-default-but-inert.

---

## 4. (folded into §3) — design depth lives in §3; see §5 for the wire.

---

## 5. Wire protocol & client changes

G adds the minimum to existing protocols. Three pieces: a capability handshake, a per-message id + resume token, and a reported-class field. Plus an out-of-band ack channel for one-directional transports.

### 5.1 Capability handshake (connection scope)

**graphql-ws / graphql-transport-ws.** The client adds a namespaced object to the `connection_init` payload (the payload is already free-form and ignored by stock servers, so this is backward compatible):

```jsonc
// client → server
{ "type": "connection_init",
  "payload": { "cosmo": { "delivery": { "supports": ["ack", "resume"] } } } }
```

The server replies in `connection_ack` with the subset it accepts (intersection of client capabilities and enabled router mechanisms):

```jsonc
// server → client
{ "type": "connection_ack",
  "payload": { "cosmo": { "delivery": { "accepted": ["resume"] } } } }
```

If the client sends no `cosmo.delivery` block, `negotiatedClientCapabilities = {}` and every subscription on the connection is capped at the no-client-participation rung (D if enabled, else at-most-once). This is the **stock-client fallback** and requires zero client changes.

**graphql-sse.** SSE has no init frame; capabilities are advertised via a request header on the subscription request:

```
X-Cosmo-Delivery-Supports: resume
```

A browser using the native `EventSource` cannot set headers and cannot ack; it advertises nothing and relies purely on native `Last-Event-ID` resume (see §5.2) — which works *for free* once the server emits `id:`.

### 5.2 Per-message id and resume token (subscription scope)

**WS.** On `Subscribe`, the client may request a class and present a resume cursor:

```jsonc
{ "type": "subscribe", "id": "1",
  "payload": { "query": "subscription { employeeUpdates { id } }" },
  "extensions": { "delivery": { "request": "at-least-once", "resume": "<opaque-cursor>" } } }
```

Each `Next` carries the cursor as the message `id` extension so the client can store it and present it on reconnect:

```jsonc
{ "type": "next", "id": "1",
  "payload": { "data": { "employeeUpdates": { "id": "100" } },
               "extensions": { "delivery": { "id": "<opaque-cursor-n>" } } } }
```

**SSE.** The writer emits the cursor as the SSE `id:` field (today it emits only `event:`/`data:`, `flushwriter.go:116-167`):

```
id: <opaque-cursor-n>
event: next
data: {"data":{"employeeUpdates":{"id":"100"}}}
```

The browser stores it and sends `Last-Event-ID: <opaque-cursor-n>` automatically on auto-reconnect; the router treats that header exactly like the WS `resume` field. This is the cheapest at-least-once on the planet for SSE clients: emit `id:`, honor `Last-Event-ID`, replay, done.

The cursor is **always opaque and signed** (§8.5): it encodes `(providerId, streamConfigHash, backendPosition, tenantClaimHash)` in a router-signed token. A client cannot forge a position to read data it is not entitled to; the router rejects a cursor whose signature or tenant scope does not match the reconnecting principal and replies with a `delivery.resumeRejected` error, restarting the subscription from live.

### 5.3 Reported class (`extensions.delivery`)

The first frame of every subscription (whether `Next #0` carries data or the router synthesizes an empty leading frame) reports the negotiated `Decision`:

```jsonc
"extensions": {
  "delivery": {
    "requested": "exactly-once",
    "achieved":  "at-least-once",
    "mechanism": "cursor",
    "ordering":  "per-stream",
    "replayWindow": "retention",
    "idempotencyKey": "Nats-Msg-Id",
    "reason": "requested exactly-once; backend nats(jetstream) without double-ack/dedup ceiling at-least-once"
  }
}
```

`requested != achieved` is the honesty contract made visible.
The same object is attached to the OpenTelemetry span (`cosmo.delivery.achieved`, `cosmo.delivery.mechanism`, `cosmo.delivery.degraded=true`) and incremented on a Prometheus counter `router_delivery_negotiations_total{achieved,mechanism,degraded}` so operators can alert on silent-looking degradation.

### 5.4 Out-of-band ack for one-directional transports

SSE and multipart are write-only; an `ack`-class subscription on them cannot use an inline ack message. For these, G exposes a back-channel:

```
POST /graphql/ack
Content-Type: application/json
{ "subscription": "<server-issued-subscription-token>", "id": "<opaque-cursor-n>" }
```

The subscription token is minted at subscription start and returned in `extensions.delivery.ackEndpoint`/`extensions.delivery.ackToken`. The router maps it to the in-flight broker ack handle. This is only offered when the backend supports per-message ack (A) and the client advertised `ack`; otherwise SSE/multipart fall back to **resume-only** (B) which needs no back-channel. Most SSE deployments will use resume-only; the ack endpoint exists for SQS/RabbitMQ-over-SSE corner cases where there is no durable position to resume from.

### 5.5 Fallback when a client/transport cannot participate

This is the heart of the pattern, so it is explicit:

| client/transport situation | what G does |
|---|---|
| stock graphql-ws client, no `cosmo.delivery` block | cap at D (if enabled) else at-most-once; report it |
| client advertises `resume` only | select B on log backends; A is unavailable; report achieved |
| client advertises `ack` only | select A on ack backends; on log backends, map ack→cursor-advance (still B-shaped); report it |
| native browser `EventSource` (no headers, no ack) | resume-only via `Last-Event-ID`; works automatically once server emits `id:` |
| multipart `subscriptionSpec=1.0` client | same as SSE: resume-only or at-most-once; no inline ack |
| legacy `subscriptions-transport-ws` | no capabilities possible; at-most-once; report via `extensions` if the client surfaces them, else silent floor |
| absinthe (Phoenix) | at-most-once unless extended; not a priority |

In every row the rule is identical: **degrade to the strongest feasible class and report it.** The router never pretends.

---

## 6. Per-backend adaptability & degradation matrix

This is the pattern's reason to exist: it lets a user **pick any backend** and get the strongest honest guarantee on it, with explicit, non-silent degradation. Columns: how G supports it, the best class achievable, and what the degradation/fallback is when the request exceeds it.

| Backend | Supported? How | Best achievable class | Mechanism G selects | Degradation / fallback (non-silent) |
|---|---|---|---|---|
| **NATS core** | Yes (today, fire-and-forget) | `at-most-once` | FireAndForget; **E** if router buffer enabled | Request `at-least-once`/`exactly-once` → `reason: "nats(core) has no durable position or ack"`; with E enabled → `at-least-once`-within-buffer-window; else reported `at-most-once` |
| **NATS JetStream** | Yes; durable pull consumer, `msg.Metadata()` cursor, double-ack + `Nats-Msg-Id` dedup | `exactly-once` (with double-ack + dedup + idempotent client) | **A** (ack) or **B** (stream-seq cursor); **C** for cross-restart; **A+C+dedup** for EOS | Without double-ack/dedup → caps at `at-least-once`; without durable name fix (`nats/adapter.go:69-83`) cross-restart caps at in-instance only; all reported |
| **Kafka** | Yes; surface `(partition,offset)` cursor; `seek`/`offsetsForTimes` | `at-least-once` | **B** (cursor) | No per-message ack → A unavailable, ack maps to in-order cursor-advance; cursor evicted by `offsets.retention.minutes` (7d) or `retention.ms` → `reason: "cursor expired"`, restart from live; EOS only with read-committed (LSO stall risk surfaced) |
| **Redis Pub/Sub** | Yes (today, fire-and-forget) | `at-most-once` | FireAndForget; **E** if router buffer enabled | Same as NATS core: no durable position/ack. Request higher → reported degrade; recommend migrating to Redis Streams |
| **Redis Streams** | Requires a Streams adapter (not the current Pub/Sub one) | `at-least-once` | **A** (PEL + `XACK`/`XCLAIM`) or **B** (entry-id cursor) | Entry trimmed by `MAXLEN`/`MINID` → cursor expired, restart from live; no native dedup → client must be idempotent |
| **SQS (Standard)** | Requires an SQS adapter | `at-least-once` (with dupes) | **A** (visibility timeout + `DeleteMessage`) or **E** | No cursor → B unavailable; resume-only clients get **E** (router buffer) or at-most-once; dupes inherent → idempotent client required |
| **SQS (FIFO)** | Requires an SQS adapter | `exactly-once`-processing | **A** + native 5-min dedup | No cursor → B unavailable; replay beyond visibility window not possible |
| **Google Pub/Sub** | Requires a Pub/Sub adapter | `exactly-once` (EOS subscription) or `at-least-once` | **A** (`ack`/`modifyAckDeadline`) or **B** (snapshot/seek-by-time) | Without EOS subscription → `at-least-once`; snapshot retention 7d / message retention 31d bound replay |
| **Kinesis** | Requires a Kinesis adapter | `at-least-once` | **B** (shard iterator + sequence number, KCL/external checkpoint) | Iterator expires 5 min → re-derive from sequence; retention 24h→7d→365d bounds replay; no native dedup |
| **Event Hubs** | Requires an Event Hubs adapter | `at-least-once` | **B** (offset + sequence, external checkpoint store) | Checkpoint store is external (HA dependency); retention 7d (std) / 90d (premium) bounds replay; no native dedup |
| **RabbitMQ / AMQP** | Requires an AMQP adapter | `at-least-once` | **A** (`basic.ack`/`nack`, requeue) | No durable position → B unavailable; requeue breaks FIFO → `ordering: best-effort`; no replay beyond unacked |

Two structural facts drive every row (from the dossier):

- **Delete-on-ack queues** (SQS, RabbitMQ, NATS core) have **no cursor** → B is impossible; they get A (if the client can ack) or E (router buffer) or honest at-most-once.
- **Log/cursor stores** (Kafka, Redis Streams, Kinesis, Event Hubs, JetStream, Pub/Sub) have a position primitive → B is the cheap default; A/C layer on for stronger guarantees.

The non-EDFS backends (SQS, Pub/Sub, Kinesis, Event Hubs, RabbitMQ, Redis Streams) are **listed for completeness of the policy table** — G can route to them the day their adapters exist; until then `adapter.Capabilities()` simply does not register them and `backendCeiling` is "unsupported," which G reports as a config error at startup rather than a silent runtime surprise.

---

## 7. Delivery semantics achieved

Pattern G's own guarantee is **honesty**: the achieved class is always `≤ requested`, always correct, and always reported. The concrete semantics are inherited from the selected mechanism:

- **`at-most-once` (FireAndForget).**
  Exactly today's behavior. No duplicates, no replay. Loss windows: client disconnect, slow-consumer drop (NATS core unbuffered channel `nats/adapter.go:168`, Redis Pub/Sub overflow), router restart, broker gap. This is the honest floor, not a failure.

- **`at-least-once` via D (correct broker ack).**
  Closes the §2 bugs (ack-on-failure, fan-out-all-acked, abandon-but-acked) by acking only on flush success.
  **Ceiling: flush ≠ receipt** — bytes-to-kernel, not client-processed. A client crashing between TCP-buffer and processing still loses that event (and it is *not* acked, so a durable backend redelivers on reconnect — which is the point). No client change needed.

- **`at-least-once` via B (cursor replay).**
  At-least-once across disconnect gaps **within the backend replay window**. Duplicates on reconnect (the event in flight when the socket dropped is replayed) → **client must be idempotent**. Ordering: per-stream/per-partition (the cursor *is* the order; gaps are contiguous). Remaining failure window: gap longer than retention → `cursor expired` → restart from live (events in the gap are lost, reported).

- **`at-least-once` via A (client ack + broker redelivery).**
  True at-least-once to client *receipt* (the client acked it). Duplicates on redelivery → idempotent client required. Ordering: preserved only with `MaxAckPending=1` (throughput cost) or in-order ack processing; otherwise reordering on redelivery (RabbitMQ requeue is worst — reinserts near head). Remaining window: router restart loses in-flight unacked-to-client ack handles unless the backend redelivers (JetStream/SQS/Rabbit do; Kafka-by-offset does not per-message).

- **`at-least-once` via E (router buffer).**
  At-least-once for disconnects **shorter than the buffer window**; beyond it → at-most-once (reported). The only option that gives *any* guarantee on NATS core / Redis Pub/Sub / SQS-standard. In-process buffer is lost on router restart unless an external buffer store is configured. Ordering: router-assigned, preserved within the buffer.

- **`exactly-once`.**
  Only a *composition*: publisher dedup (`Nats-Msg-Id` / Kafka idempotent producer) + confirmed consumer ack (JetStream double-ack / Pub/Sub EOS / store-cursor-with-data) + client ack (A) + idempotent client.
  G will report `exactly-once` only when every link is present; otherwise it reports `at-least-once` with a `reason`. Realistically, **at-least-once + idempotent client = effective exactly-once**, and G says so in the `reason` when it cannot prove true broker EOS. Read-committed consumption can stall the cursor at the LSO on an open upstream transaction — a head-of-line failure mode G surfaces as a metric, not a hang.

**Cross-cutting semantic note (ordering vs at-least-once).**
These conflict on every backend. Redelivery (Nak, AckWait, requeue) can reorder. G never claims global ordering; `Decision.ordering` is one of `per-stream`, `per-partition`, `per-group`, or `best-effort`, and it is reported. If a subscriber needs strict order *and* at-least-once, the only honest answer on most backends is `MaxAckPending=1` (B/C with single in-flight), which G will select only when the field is annotated `ordering: STRICT` — and it will report the throughput implication.

---

## 8. Cross-cutting concerns

### 8.1 Router HA / horizontal scaling & sticky sessions

This is the single biggest design axis, and G's honesty contract makes it *visible* rather than fixing it:

- **B (cursor)** needs reconnect **stickiness** to a replica/partition holding the position, *or* a shared external cursor view. The cursor is backend-scoped, so any replica that can `seek` the backend can resume — B is the most HA-friendly because durability lives in the broker. `routerCeiling` for B is `at-least-once` even across instances *if* the backend is seekable from any replica (Kafka, JetStream by stream-seq).
- **A (client ack)** holds ack handles per-process. A router restart loses unacked-to-client handles unless the backend redelivers. `routerCeiling` for A is therefore "as good as the backend's redelivery," and G caps it accordingly.
- **C (durable per-sub)** needs the durable consumer name keyed on the *subscription* identity, not the router instance — the current JetStream naming (`hostname-listenAddr` hash, `nats/adapter.go:69-83`) must be fixed, and then coordinated (queue group / `WorkQueuePolicy` / Kafka static membership) so two instances don't double-consume. G will only offer C's cross-restart guarantee when the HA topology declares it can satisfy this (`events.delivery.ha.durableState: true` in config); otherwise it degrades and reports.

The negotiator takes `haTopology` as an input precisely so the `routerCeiling` reflects reality. A single-instance dev router and a 5-replica HA deployment will *honestly* report different achieved classes for the same subscription.

### 8.2 Per-subscription state / memory cost

G itself adds ~O(1) per subscription (the `Decision` struct, a few pointers). The cost is whatever the selected mechanism carries:

- B: ≈O(1) router (durability in broker) — cheapest.
- A: O(in-flight per client) ack handles + a map, capped by `MaxAckPending`.
- E: O(window × subscribers) RAM — the explicit tunable knob.
- C: O(active subscriptions) broker consumers + external checkpoint store — most expensive, and it **breaks shared-trigger dedup** (§8.3).

The negotiator's cost-preference tie-break (§3.4 step 4) exists so G defaults to the cheapest mechanism that meets the class.

### 8.3 Multi-tenant shared-trigger fan-out

Cosmo shares one broker subscription per unique input+headers hash across N clients (`kafka/adapter.go:124-125`, the engine dedups identical triggers).
This is the central tension:

- **B and E preserve sharing well.** B is stateless per client (each client carries its own cursor; the *shared* broker read continues; a reconnecting client replays from its own cursor against the same shared stream — or a short-lived per-client seek). E's buffer is per-trigger and fanned out.
- **A and C fight sharing.** Per-subscriber ack (A) means one broker message has N heterogeneous client outcomes; the single `msg.Ack()` can't represent "3 of 5 acked." C needs a consumer per subscription → N broker consumers, killing dedup.

G's policy: when `achieved` selects A or C on a *shared* trigger, the negotiator must decide between two honest options, controlled by config:
(a) **split the trigger** into per-subscriber consumption (correct, expensive — `events.delivery.fanout: isolate`), or
(b) **ack-on-slowest** / **ack-on-quorum** within the shared trigger (cheap, couples subscribers — Pattern D's policy) and report `ordering`/`mechanism` accordingly.
The chosen fan-out policy is reflected in `Decision` and reported. There is no silent third option.

### 8.4 Backpressure

Today backpressure is synchronous and per-trigger-serial (the broker reader blocks until all subscribers flush). G keeps this for at-most-once and D. For A/E it adds explicit caps (`MaxAckPending`, buffer size) that become the memory/guarantee knob. A slow client either backpressures the shared trigger (penalizing co-subscribers) or is isolated (C, at consumer-count cost) — the negotiator's fan-out policy (§8.3) decides which, and reports it. The per-update timeout (`MaxSubscriptionFetchTimeout`, 30s, `config.go:454`) and write deadlines remain the liveness guards.

### 8.5 Security / authz

- **Cursors/resume tokens are opaque, signed, and tenant-scoped.** A raw `(partition, offset)` or stream-seq would let a client seek to data it shouldn't see, especially with replay. The cursor embeds a tenant-claim hash; on reconnect the router verifies the reconnecting principal's claims hash against the cursor and rejects mismatches (`delivery.resumeRejected`).
- **Replay re-runs authz per event.** Replayed events pass through the *same* authorization as live delivery — and critically, with the **current** authorization, not the authorization at original publish time. A revoked tenant/user must not receive replayed history. This is enforced by running replay through the existing Cosmo Streams `StreamBatchEventHook` / `OnStreamEvents` path (which is where filtering/authz already lives, `cosmo-streams-v1.md`) for every replayed batch, exactly as for live batches.
- **Ack endpoint authz.** The out-of-band `POST /graphql/ack` (§5.4) requires the server-issued subscription token, which is bound to the connection's authentication; a stolen token cannot ack another tenant's subscription.

### 8.6 Interaction with existing Cosmo Streams hooks

G is designed to *thread through* v1 hooks, not bypass them:

- **`SubscriptionOnStart`** is the natural override point: a module can inspect `ctx.Delivery()` (new accessor exposing the `Decision`) and *lower* the requested class for a given principal (e.g. force `at-most-once` for an untrusted client) — it must not be able to raise above the computed ceilings (that would be dishonest).
- **`StreamBatchEventHook` / `OnStreamEvents`** is where idempotency keys are assigned/validated and where replayed batches are re-authorized. A hook that **drops** an event (returns a shorter slice) must result in a correct broker ack — drop ≠ delivery failure. G makes this explicit: the `DeliveryOutcome` distinguishes `Dropped` (ack/commit — intentional filter) from `Failed` (nak/redeliver — transient). This reconciles the §2.1 "abandon-on-timeout" hazard: a hook-dropped event is *acked*, a hook-errored or flush-failed event is *redelivered*.
- **`StreamPublishEventHook`** is unaffected, but G suggests an *idempotent ingest* companion (publish with `Nats-Msg-Id` / Kafka idempotent producer) so the publish side can also be at-least-once — currently publish errors are swallowed (`redis/engine_datasource.go:205-209`). That is a separate publish-durability concern noted here for completeness.

---

## 9. Configuration surface

### 9.1 Router YAML — new `events.delivery` block

```yaml
version: "1"

events:
  # NEW: global delivery policy. Absent → behaves exactly as today (at-most-once everywhere).
  delivery:
    enabled: true
    default_class: at-most-once        # requested class when neither directive nor handshake sets one
    enabled_mechanisms: [ack, cursor, buffer, durable]   # which of A/B/E/C are compiled in & allowed
    report_extensions: true            # emit extensions.delivery to clients
    fanout: ack-on-slowest             # ack-on-slowest | ack-on-quorum | isolate (see §8.3)
    ack:
      window: 30s                      # client-ack timeout before nak/redeliver (Pattern A)
      max_ack_pending: 1024            # backpressure cap; 1 => strict ordering, low throughput
    buffer:                            # Pattern E
      window: 30s
      max_events_per_trigger: 1000
      store: memory                    # memory | redis://... (external => survives restart)
    ha:
      durable_state: false             # true only if durable consumer/checkpoint coordination is configured (enables C cross-restart)

  providers:
    nats:
      - id: my-jetstream
        url: "nats://localhost:4222"
        # NEW: per-provider cap & JetStream durability knobs
        delivery:
          max_class: exactly-once      # ceiling for this provider; negotiator never exceeds it
          jetstream:
            ack_policy: explicit
            ack_wait: 30s
            max_deliver: -1
            double_ack: true           # required to reach exactly-once
            dedup_window: 2m           # Nats-Msg-Id duplicate window
    kafka:
      - id: my-kafka
        brokers: ["localhost:9092"]
        delivery:
          max_class: at-least-once     # log store; B
          group_instance_id_prefix: cosmo-router   # static membership for stable cursors under churn
    redis:
      - id: my-redis
        urls: ["redis://localhost:6379"]
        delivery:
          max_class: at-most-once      # Pub/Sub; raise only after a Streams adapter exists
```

Validation at startup: if `default_class` or any field directive exceeds a provider's `max_class` and no degradation path exists, the router logs a warning per field (not an error — degradation is allowed and is the whole point), unless `events.delivery.strict: true`, in which case the router refuses to start so misconfiguration is caught loudly.

### 9.2 Schema directive (optional, composition + proto)

A new directive lets the schema owner author a *requested* class per subscription field:

```graphql
directive @edfs__delivery(
  class: edfs__DeliveryClass! = AT_LEAST_ONCE
  ordering: edfs__Ordering = BEST_EFFORT
) on FIELD_DEFINITION

enum edfs__DeliveryClass { AT_MOST_ONCE AT_LEAST_ONCE EXACTLY_ONCE }
enum edfs__Ordering { BEST_EFFORT STRICT }

type Subscription {
  employeeUpdates: Employee!
    @edfs__natsSubscribe(subjects: ["employeeUpdates"], providerId: "my-jetstream")
    @edfs__delivery(class: EXACTLY_ONCE, ordering: STRICT)
}
```

Composition parses `@edfs__delivery` alongside the existing `@edfs__*` directives (`composition/src/v1/normalization/normalization-factory.ts:2804-3169`) and serializes the requested class + ordering into `DataSourceCustomEvents` (`proto/wg/cosmo/node/v1/node.proto:430-434`), so the per-field request travels in the execution config. The directive is optional; without it the request comes from config default and/or the client handshake.

---

## 10. Migration & backward compatibility

- **Default off / inert.**
  With no `events.delivery` block, no `@edfs__delivery` directive, and no client capability handshake, every subscription negotiates to `at-most-once` / `FireAndForget` and the code path is byte-for-byte today's. No behavior change, no overhead beyond a few comparisons at subscription start.
- **Server-first rollout.**
  Ship the negotiator + reporting first (it can report `at-most-once` honestly before any of A–F land). Operators immediately gain `extensions.delivery` visibility and the `router_delivery_negotiations_total` metric — they learn what they *would* get if mechanisms were enabled.
- **Incremental mechanism enablement.**
  As each underlying pattern ships (the dossier's suggested order: D → B → A → C/E), add it to `enabled_mechanisms`. The negotiator automatically starts selecting it where feasible. No client change is forced — a stock client simply stays on the no-participation rung.
- **Client adoption is opt-in and gradual.**
  A client that adds `supports:[resume]` immediately gets B on log backends; one that adds `supports:[ack]` gets A on ack backends. Clients that never change keep working at the honest floor.
- **Directive adoption is additive.**
  `@edfs__delivery` is a new optional directive; existing schemas compose unchanged. Adding it raises the *requested* ceiling for a field but never breaks composition.
- **Strict mode for safety-critical deployments.**
  `events.delivery.strict: true` flips degradation from "warn and proceed" to "refuse to start," for shops that would rather fail closed than silently run at a lower class.

---

## 11. Appendix: new/changed Go types

```go
// Package router/pkg/pubsub/delivery

// DeliveryClass is a totally ordered guarantee level.
// AtMostOnce < AtLeastOnce < ExactlyOnce.
type DeliveryClass uint8

const (
    AtMostOnce DeliveryClass = iota
    AtLeastOnce
    ExactlyOnce
)

func (c DeliveryClass) String() string { /* "at-most-once" | ... */ return "" }

// Min returns the weaker of two classes (the partial-order meet).
func Min(a, b DeliveryClass) DeliveryClass { if a < b { return a }; return b }

// Mechanism is the concrete pattern selected to realize a class on a backend.
type Mechanism uint8

const (
    FireAndForget Mechanism = iota // today's path (Pattern none / D-off)
    BrokerAck                      // Pattern D: ack on flush success
    ClientAck                      // Pattern A: client ack + broker redelivery
    Cursor                         // Pattern B: cursor replay on reconnect
    DurableConsumer               // Pattern C: per-subscription durable state
    RouterBuffer                  // Pattern E: bounded router-side replay buffer
)

// Ordering is the order guarantee G will report (never global).
type Ordering uint8

const (
    BestEffort Ordering = iota
    PerStream
    PerPartition
    PerGroup
    Strict // only with single in-flight; throughput cost
)

// Capabilities is what a provider adapter can offer for a resolved stream config.
// Each adapter implements Capabilities(); the registry aggregates them.
type Capabilities struct {
    MaxClass          DeliveryClass     // ceiling this backend+config can reach
    HasCursor         bool              // log/cursor store => Pattern B feasible
    HasPerMessageAck  bool              // ack/redelivery queue => Pattern A feasible
    HasNativeDedup    bool              // SQS FIFO, Pub/Sub EOS, JetStream Nats-Msg-Id
    DurablePerSub     bool              // can host a durable consumer per subscription (C)
    ReplayWindow      ReplayWindow      // retention-bound | none | buffer
    IdempotencyKey    IdempotencyKeySource // where the dedup key comes from
    DefaultOrdering   Ordering
}

type IdempotencyKeySource uint8

const (
    KeyNone IdempotencyKeySource = iota
    KeyNatsMsgID      // Nats-Msg-Id header
    KeyKafkaKey       // record key
    KeyEntryID        // Redis Streams entry id
    KeyContentHash    // fallback: hash of payload
)

type ReplayWindow struct {
    Kind  string        // "retention" | "buffer" | "none"
    Bound time.Duration // best-effort bound for reporting (0 = unbounded/unknown)
}

// CapabilityProvider is implemented by each pubsub adapter (nats, kafka, redis, …).
// It is the only new method adapters must add for G to route to them.
type CapabilityProvider interface {
    // Capabilities reports what this adapter can guarantee for the given resolved
    // stream configuration (e.g. JetStream-backed subject vs core NATS subject).
    Capabilities(cfg datasource.SubscriptionEventConfiguration) Capabilities
}

// Request is the full input to negotiation, assembled at subscription start.
type Request struct {
    Requested   DeliveryClass     // min(field directive, Subscribe.request, config default)
    OrderingReq Ordering          // from @edfs__delivery(ordering:)
    Client      ClientCapabilities
    Transport   Transport         // WS | SSE | Multipart
    Backend     Capabilities
    Router      RouterCapabilities
}

type ClientCapabilities struct {
    Ack    bool // advertised supports:[ack]
    Resume bool // advertised supports:[resume]
}

type Transport uint8

const (
    TransportWS Transport = iota
    TransportSSE
    TransportMultipart
)

// RouterCapabilities reflects which mechanisms are enabled AND whether the HA
// topology can satisfy the state a mechanism needs.
type RouterCapabilities struct {
    Enabled       map[Mechanism]bool
    DurableState  bool          // events.delivery.ha.durable_state (enables C cross-restart)
    BufferStore   string        // "" | "memory" | external => E restart-survival
    Fanout        FanoutPolicy
}

type FanoutPolicy uint8

const (
    AckOnSlowest FanoutPolicy = iota
    AckOnQuorum
    Isolate // split shared trigger into per-subscriber consumption (breaks dedup)
)

// Decision is the negotiated outcome, carried for the life of the subscription
// and reported to the client via extensions.delivery.
type Decision struct {
    Requested      DeliveryClass
    Achieved       DeliveryClass // <= Requested, always
    Mechanism      Mechanism
    Ordering       Ordering
    IdempotencyKey IdempotencyKeySource
    ReplayWindow   ReplayWindow
    Fanout         FanoutPolicy
    Degraded       bool   // Achieved < Requested
    Reason         string // human-readable explanation of any degradation
}

// Negotiator is a pure function: same input => same Decision. No I/O.
type Negotiator interface {
    Negotiate(req Request) Decision
}

// --- Substrate contract changes (Pattern D), required for any class > at-most-once ---

// DeliveryOutcome is returned per delivered event/subscriber so the adapter can
// ack/commit correctly. Distinguishes intentional drop (ack) from failure (redeliver).
type DeliveryOutcome uint8

const (
    Delivered DeliveryOutcome = iota // flushed successfully => ack/commit/XACK
    Dropped                          // hook filtered it out  => ack/commit (NOT a failure)
    Failed                           // flush/resolve failed  => nak/redeliver
)

// SubscriptionEventUpdater changes from fire-and-forget to outcome-returning.
// When Decision.Mechanism == FireAndForget the return is ignored and the path
// is identical to today (zero overhead).
//
// CHANGED from: Update(events []datasource.StreamEvent)
type SubscriptionEventUpdater interface {
    UpdateWithDecision(
        events []datasource.StreamEvent,
        d Decision,
    ) []DeliveryOutcome // one per event; len == len(events)

    // Confirm is invoked by the transport when a client ack arrives (Pattern A)
    // or when a cursor is durably advanced (Pattern B/C).
    Confirm(cursor Cursor) error
}

// Cursor is the opaque, signed, tenant-scoped resume token on the wire.
type Cursor struct {
    ProviderID      string
    StreamConfigHash string
    Position        []byte // backend-specific: stream-seq | (partition,offset) | entry-id | …
    TenantClaimHash string // bound to the principal; verified on resume
    Sig             []byte // router HMAC over the above
}

func (c Cursor) Encode() string { /* base64url(signed) */ return "" }
func DecodeCursor(s string, key []byte) (Cursor, error) { return Cursor{}, nil }
```

```go
// Package router/core — hook accessor so v1 modules can read/lower the Decision.

// Added to SubscriptionOnStartHookContext (v1).
type SubscriptionOnStartHookContext interface {
    RequestContext() RequestContext
    SubscriptionEventConfiguration() SubscriptionEventConfiguration
    WriteEvent(event StreamEvent)

    // NEW: read the negotiated decision; LowerDelivery may only weaken it.
    Delivery() delivery.Decision
    LowerDelivery(to delivery.DeliveryClass) // ignored if `to` >= achieved
}
```

```go
// Engine contract delta (graphql-go-tools resolve), conditional on class > at-most-once.
//
// CHANGED: Update must surface a result and attach a cursor/sequence to each Next.
// If the engine version in a release cannot provide this, the router caps
// routerCeiling at at-most-once and reports it (honesty preserved).
type SubscriptionUpdater interface {
    Update(data []byte) // existing, at-most-once path

    // NEW (optional capability, feature-detected at startup):
    UpdateSeq(data []byte, cursor delivery.Cursor) delivery.DeliveryOutcome
}
```

---

## 12. Risks, open questions, and complexity/effort estimate

### Where this pattern is weakest (honest self-assessment)

1. **It is only as good as the patterns beneath it.**
   G adds no durability of its own. If D/B/A/E/C are not shipped, G is a very elaborate way to report `at-most-once`. Its value is *entirely* derivative — it is the meta-pattern, not a mechanism. Compared to B (which directly buys at-least-once on log backends with minimal state) or D (which fixes the actual ack bugs with no client change), G ships *no guarantee on its own*. **This is its single biggest weakness:** it cannot be the first thing built, and on its own it changes nothing about delivery.

2. **The negotiation matrix is a comprehension and support burden.**
   "What do I actually get?" becomes a function of five inputs (requested, backend, client, transport, router HA). Even with `extensions.delivery.reason`, customers will be surprised by degradations, and support will field "why is this at-most-once?" tickets. The matrix in §6 must be documented exhaustively and the `reason` strings must be excellent, or the honesty becomes noise.

3. **Reporting honesty depends on every mechanism reporting honestly.**
   A bug in B's "cursor expired" detection, or in A's "router restart lost the handle" accounting, makes G *confidently report a guarantee it isn't meeting* — which is worse than today's silent at-most-once, because customers will trust the label. G's correctness is the union of all its mechanisms' correctness.

4. **Shared-trigger fan-out forces an uncomfortable choice (§8.3).**
   For A/C on a shared trigger, G must either split the trigger (expensive, kills dedup) or couple subscribers (ack-on-slowest). Neither is great; G just makes the choice explicit and configurable. It does not dissolve the tension.

5. **HA-dependent ceilings are hard to compute correctly.**
   `routerCeiling` must reflect whether the *deployment* can satisfy a mechanism's state needs. Getting this wrong in either direction is bad: too optimistic → dishonest report; too pessimistic → needless degradation. This requires the deployment to declare its topology truthfully (`events.delivery.ha.*`), which is itself error-prone.

### Open questions

- **Precedence semantics.** §3.4 takes `min(directive, handshake, config)`. Is "schema author sets a floor, client states capability, achieved = intersection" the right mental model, or should a field directive be a *hard* requirement that *fails* the subscription if unmet (fail-closed per field) rather than degrading? Probably configurable per field (`@edfs__delivery(class:, required: true)`), but that adds matrix surface.
- **Should `at-most-once` ever auto-upgrade?** If a backend+client *could* do at-least-once for free (e.g. SSE client + Kafka, just emit `id:`), should G silently give the stronger guarantee, or only when requested? Leaning: report the *capability* but only *activate* the stronger mechanism when requested, to keep behavior predictable and costs opt-in.
- **Cursor format stability across router versions.** A signed cursor minted by v1 must be decodable by v2 (rolling deploys). Needs a version byte and a key-rotation story.
- **Per-event vs per-batch outcomes with v1 hooks.** `OnStreamEvents` operates on batches and may grow/shrink/reorder; mapping `[]DeliveryOutcome` back to original broker messages after a hook reshapes the batch needs a stable per-source-message identity (the idempotency key) — confirm this round-trips for all providers.
- **Multipart and the ack back-channel.** Is the out-of-band `POST /graphql/ack` worth building, or should multipart/SSE be resume-only forever (and ack-class simply unavailable on them)? Leaning resume-only; build the ack endpoint only if an ack-only backend (SQS) + SSE combo is a real customer need.

### Complexity / effort estimate

**Overall: L** — a thin policy layer, but it sits atop and must integrate with every one of A–F, and its honesty contract demands rigorous per-mechanism reporting.

| Component | Effort | Notes |
|---|---|---|
| `delivery` package: `Negotiator`, `Decision`, registry | S | Pure functions; heavily unit-testable (the selection table is the spec). |
| Adapter `Capabilities()` for nats/kafka/redis | S–M | Mostly declarative; the logic is "what does this resolved config support." |
| Capability handshake in `connection_init` + `wsproto` ack/resume + SSE `id:`/`Last-Event-ID` | M | Wire changes; backward-compatible by construction (free-form payload). |
| `extensions.delivery` reporting + OTel + Prometheus | S | High value, low cost; ship first. |
| Threading `Decision` through `SubscriptionEventUpdater` + engine `UpdateSeq` | M–L | Depends on the engine change landing; feature-detected fallback if not. |
| Signed cursor mint/verify + tenant scoping + key rotation | M | Security-sensitive; needs careful review. |
| Shared-trigger fanout policy (ack-on-slowest/quorum/isolate) | M | Couples with Pattern D/C decisions. |
| Strict-mode startup validation + docs of the full matrix | M | The matrix docs are real work and gate adoption. |
| **Underlying mechanisms A/B/C/D/E** | *(separate RFCs)* | **Not counted here** — G's L assumes these exist; without them G is L-of-reporting only. |

**Recommended sequencing (matches the dossier):**
ship the negotiator + reporting against an at-most-once-only world first (instant observability win),
then enable mechanisms as their RFCs land — **D** (correctness, no client change) → **B** (cursor, emit `id:`) → **A** (client ack) → **C/E** (backend reinforcements).
G is the product framing that ties them together; it should be *designed* now and *fully valuable* last.
