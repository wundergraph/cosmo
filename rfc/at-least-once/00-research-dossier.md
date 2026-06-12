# DOSSIER: At-Least-Once Delivery for GraphQL Subscriptions on Cosmo Streams / EDFS

> **Purpose.** Single source of truth for the next phase: writing competing RFCs that restore end-to-end at-least-once delivery (broker → router → client) on top of Cosmo's existing EDFS / Cosmo Streams capability, adaptable across heterogeneous backends with explicit, documented degradation when a backend cannot meet the bar.
>
> **Version pins (as researched).** Router pubsub layer `router/pkg/pubsub/`; engine `graphql-go-tools/v2` (datapath agent verified against `v2.4.1`; transport agent verified against the router's pinned `v2.1.1-0.20260504064838-5a00844995b5`). Broker clients: `nats.go v1.50.0`, `franz-go v1.16.1`, `go-redis/v9 v9.7.3`.
>
> **Note on engine version.** The two codebase agents read two different pinned engine snapshots. Both describe the *same synchronous, fire-and-forget* model; minor line-number drift between them (`v2.4.1` vs the router go.mod pin) is noted inline where it matters. Treat the architectural conclusions as stable; re-verify exact line numbers against the engine version the RFC will target.

---

## 1. Current EDFS / Cosmo Streams Architecture

### 1.1 The two configuration planes

EDFS wiring is split across two planes that join only at router runtime:

1. **Control-plane / execution config (proto).** Composition (TypeScript) parses `@edfs__*` directives and serializes *per-field event routing only*: which field publishes/subscribes to which subject/topic/channel, on which logical `providerId`, and whether it is `PUBLISH` / `REQUEST` / `SUBSCRIBE`. It does **not** store broker URLs or credentials. Carrier: `DataSourceCustomEvents { nats, kafka, redis }` (`proto/wg/cosmo/node/v1/node.proto:430-434`), built in `shared/src/router-config/graphql-configuration.ts:113-219`, attached in `shared/src/router-config/builder.ts:257-314`.
2. **Router YAML — provider connection details.** Local to the router, never in the control plane. `EventsConfiguration { Providers, Handlers }` (`router/pkg/config/config.go:779-782`), `EventProviders { Nats, Kafka, Redis }` (`config.go:773-777`).

They join in `router/core/factoryresolver.go:531-538` → `pubsub.BuildProvidersAndDataSources` (`router/pkg/pubsub/pubsub.go:56-128`), which matches each event's `providerId` (from proto) against a provider defined in YAML, erroring with `ProviderNotDefinedError` (`pubsub.go:166-173`) if missing. `routerEngineConfig.Events` is supplied via `WithEvents(config.Events)` (`router/core/router.go:2128`).

### 1.2 Directive surface (composition layer)

All `@edfs__*` parsing/validation is in `composition/`, never in the router. Name constants: `composition/src/utils/string-constants.ts:33-41`.

- **NATS** (`demo/.../schema.graphqls:1-3`): `@edfs__natsRequest(subject, providerId="default")`, `@edfs__natsPublish(subject, providerId="default")`, `@edfs__natsSubscribe(subjects: [String!]!, providerId="default", streamConfiguration: edfs__NatsStreamConfiguration)`. Parsed in `composition/src/v1/normalization/normalization-factory.ts:2887-3081`.
  - `edfs__NatsStreamConfiguration { consumerInactiveThreshold: Int! = 30, consumerName: String!, streamName: String! }` (`schema.graphqls:115-119`). A `streamConfiguration` block is only emitted when **both** `consumerName` and `streamName` are present (`normalization-factory.ts:3076-3081`). `DEFAULT_CONSUMER_INACTIVE_THRESHOLD = 30` (`composition/src/v1/constants/integers.ts:1`).
- **Kafka**: `@edfs__kafkaPublish(topic, providerId="default")`, `@edfs__kafkaSubscribe(topics: [String!]!, providerId="default")` (`composition/src/v1/constants/directive-definitions.ts:274-298`). Parsed in `normalization-factory.ts:2804-2885`.
- **Redis**: `@edfs__redisPublish(channel, providerId="default")`, `@edfs__redisSubscribe(channels: [String!]!, providerId="default")` (`directive-definitions.ts:424-475`). Parsed in `normalization-factory.ts:3088-3169`.

### 1.3 End-to-end data path (one subscription event)

The entire chain from broker callback to client socket write is **one synchronous call stack**. The engine in this generation has **no internal buffered events channel** — the broker-reader goroutine drives resolution and the socket write directly and synchronously.

1. **Broker delivers to the provider adapter's reader goroutine** (spawned inside `Adapter.Subscribe`):
   - NATS JetStream: `consumer.FetchNoWait(300)` then `for msg := range msgBatch.Messages()` — `router/pkg/pubsub/nats/adapter.go:130-159`.
   - NATS core: `case msg := <-msgChan:` — `nats/adapter.go:186`.
   - Kafka: `client.PollRecords(p.ctx, 10_000)` then `iter.Next()` — `router/pkg/pubsub/kafka/adapter.go:61-119`.
   - Redis: `case msg, ok := <-msgChan:` — `router/pkg/pubsub/redis/adapter.go:116-136`.
2. **Adapter calls `updater.Update([]datasource.StreamEvent{...})`** (`nats/adapter.go:146`, `kafka/adapter.go:110`, `redis/adapter.go:132`). `updater` is a `datasource.SubscriptionEventUpdater` (interface `router/pkg/pubsub/datasource/subscription_event_updater.go:19-24`).
3. **`subscriptionEventUpdater.Update`** (`subscription_event_updater.go:36-129`):
   - No hooks → directly `s.eventUpdater.Update(event.GetData())` per event (`:37-42`).
   - With `on_receive_events` hooks → per-subscription fan-out under a `semaphore.Weighted` with a deadline, then `s.eventUpdater.UpdateSubscription(subID, data)` (`:44-129`).
4. **Engine `subscriptionUpdater.Update` → `resolver.handleTriggerUpdate`** (graphql-go-tools `pkg/engine/resolve/resolve.go`).
5. **`handleTriggerUpdate`** filters subscriptions and, **synchronously (`wg.Wait()`)**, runs `executeSubscriptionUpdate` for each subscriber.
6. **`executeSubscriptionUpdate`** does the full GraphQL resolve (`InitSubscription` + `LoadGraphQLResponseData`, fetching federated/nested data) then `sub.writer.Flush()`.
7. **`Flush()` writes directly to the client socket**:
   - WebSocket: `websocketResponseWriter.Flush` → `protocol.WriteGraphQLData` → `wsConnectionWrapper.WriteText/WriteJSON` → `wsutil.WriteServerText` under a write deadline (`router/core/websocket.go:704-736`, `187-217`).
   - SSE/multipart: `HttpFlushWriter.Flush` → `f.writer.Write(...)` then `f.flusher.Flush()` (`router/core/flushwriter.go:116-167`).

The engine interface docs say delivery is "not guaranteed immediate," but the v2.4.1 implementation is in fact fully synchronous.

### 1.4 Trigger sharing / deduplication

Triggers are keyed by a hash of rendered input + subgraph headers (`prepareTrigger`/`prepareTrigger` keying in `resolve.go`). Multiple clients with identical subscriptions share **one trigger and one broker subscription**; `handleTriggerUpdate` fans the single event out to every subscriber. The Kafka adapter comment confirms: "The engine already deduplicates subscriptions with the same topics…" (`kafka/adapter.go:124-125`). The trigger is keyed by data, **not by client identity** — a reconnecting client gets a new `ConnectionID` (`resolve.NewConnectionID()`, `websocket.go:367`) and a brand-new subscription id (`websocket.go:1160-1185`).

### 1.5 Publish path (GraphQL mutation → broker)

Identical in shape for all three providers; only the adapter's broker call differs:

- Plan time: `router/pkg/pubsub/datasource/planner.go:45-88` (`ConfigureFetch`) → for `EventTypePublish` returns a `PublishDataSource`.
- Execution: engine calls `PublishDataSource.Load` → `PubSubProvider.Publish` (`datasource/pubsubprovider.go:81-94`, runs any `OnPublishEvents` hooks) → adapter `Publish`.
- **GraphQL-layer result is always synthetic**: `{"__typename":"edfs__PublishResult","success":true}` on success, `success:false` on failure. A **broker error is swallowed** (logged, not returned) to avoid an "unable to fetch from subgraph" error (e.g. `redis/engine_datasource.go:205-209`). The `edfs__PublishResult!` type is `NON_NULLABLE_EDFS_PUBLISH_EVENT_RESULT` (`composition/src/utils/string-constants.ts:103`).
- Broker-confirmation strength differs: **Kafka** waits for the produce callback + `wg.Wait()` (`kafka/adapter.go:234-249`) and flushes on shutdown; **NATS Publish** always uses **core NATS** `p.client.Publish` (`nats/adapter.go:254`) — even when the subject is stream-backed; **Redis** `PUBLISH` (`redis/adapter.go:191`) returns only the subscriber-count int, not a delivery confirmation, so `success:true` can mean "zero subscribers, message dropped."

### 1.6 Transport layer to the client

- **WebSocket** (3 subprotocols, negotiated at upgrade): `graphql-transport-ws` (modern graphql-ws), `graphql-ws` (legacy subscriptions-transport-ws / Apollo), `absinthe` (Phoenix, opt-in). Supported set: `router/internal/wsproto/proto.go:102-112`. WS path → `AsyncResolveGraphQLSubscription` (`websocket.go:1141-1149`).
- **HTTP streaming**: SSE (`text/event-stream` or `?wg_sse`), `multipart/mixed` (`subscriptionSpec=1.0; boundary=graphql`), and "subscribe once" (`?wg_subscribe_once`). Handled by `HttpFlushWriter` (`router/core/flushwriter.go`), negotiated in `NegotiateSubscriptionParams` (`flushwriter.go:252-299`). HTTP path → `Resolver.ResolveGraphQLSubscription` (`graphql_handler.go:265-293`).
- **Heartbeats**: SSE/multipart get server heartbeats (default `DefaultHeartbeatInterval = 5s`, suppressed while data flows; SSE writes `:heartbeat\n\n`, multipart writes `{}`). WS heartbeat is an explicit **no-op** (`websocket.go:659-662`); the router never proactively pings the downstream WS client. A failed heartbeat tears down the subscription (this is how SSE/multipart disconnects are detected).
- **Lifecycle / teardown**: client drop → read error → `handler.Close(unsubscribe=true)` → `UnsubscribeClient(connectionID)` → removes every subscription for that connection; the last subscriber on a trigger cancels the trigger context, stopping the adapter goroutine (which unsubscribes from the broker). A failed `Flush` mid-update also calls `UnsubscribeSubscription`.

---

## 2. Where At-Least-Once Is Lost — "The GraphQL Subscription Gap"

The framework abstraction is **fire-and-forget by construction**: `datasource.Adapter` (`router/pkg/pubsub/datasource/provider.go:22-28`) and the engine's `SubscriptionUpdater.Update(data)` return **no error and have no ack hook back to the broker**. The generic glue never reports delivery success back to the adapter. Therefore **durability is a per-adapter property, not a property of EDFS** — and today only one adapter (NATS JetStream) attempts it.

### 2.1 The exact hops where guarantees evaporate

**Hop A — Broker → router read.** Only NATS JetStream consumes durably (durable consumer, explicit ack). Kafka, NATS core, and Redis Pub/Sub never commit/ack — see §3.

**Hop B — Router resolve → client flush.** Even on the durable JetStream path, ack timing is wrong:

1. **Ack is gated on flush *attempt*, not client receipt.** JetStream `msg.Ack()` (`nats/adapter.go:154`) runs *after* `updater.Update()` returns, which (synchronously, with `wg.Wait()`) ran resolve + `writer.Flush()`. But `Flush()` is a single socket write under a write deadline — a successful flush only means **bytes handed to the kernel/TCP buffer**, not an application ack from the client. A client that crashes after TCP-buffering but before processing loses the message, yet it is acked → **lost**.
2. **Ack fires even when delivery failed.** The no-hooks path ignores the result of `executeSubscriptionUpdate` (`subscription_event_updater.go:37-42`); the engine's `Update` returns void. If resolve/flush fails (client mid-disconnect), the subscription is dropped but `msg.Ack()` still runs → **acked despite non-delivery**.
3. **Multi-subscriber fan-out is acked-anyway.** One JetStream message fans out to N shared subscribers; some succeed, some fail; the single `msg.Ack()` acks the whole trigger → failed subscribers silently miss the event.
4. **Hooks path can abandon and reorder.** With `on_receive_events` hooks, on timeout the updater **abandons** in-flight deliveries and proceeds (explicit warning "Events may arrive out of order," `subscription_event_updater.go:69-79`), while the JetStream loop still proceeds to `msg.Ack()` → abandoned-but-acked = **lost** + reordered.

**Hop C — No client ack anywhere.** Neither WS writers (`websocket.go`) nor the SSE/multipart writer (`flushwriter.go`) implement a per-message client ACK. The recognized inbound WS message set is `Ping`, `Pong`, `Subscribe`, `Complete`, `Terminate` (`wsproto/proto.go:88-94`) — there is **no "ack received next" concept**. `connection_init`/`connection_ack` is a one-time *connection* handshake, not a data ack. (Note: the `AckTimeout` in config is for the *upstream* router→subgraph WS client, unrelated to downstream delivery.)

**Hop D — No resume / replay.** A reconnecting client always starts a brand-new subscription from "now." No `Last-Event-ID` handling anywhere (grep of `core/` + `internal/wsproto/` for `Last-Event-ID`/`LastEventID`/`resume`/`cursor`/`resumeToken` returns nothing). The SSE writer never emits an `id:` field (only `event:`/`data:`), so even SSE auto-resume cannot work. The delivered event structs carry only `Data`, `Headers` (and Kafka `Key`) — **no sequence/offset cursor is ever surfaced** (`nats/engine_datasource.go:39-42`, `kafka/engine_datasource.go:58-63`). JetStream `msg.Metadata()` (which carries stream/consumer sequence) is never read.

### 2.2 Buffering, backpressure, and slow-consumer behavior

There is **no application-level queue** in the engine; the only channel (`maxConcurrency`) is explicitly excluded from subscription updates. Flow control is whatever the broker-client library provides plus the synchronous backpressure of the call stack:

- Because `updater.Update` blocks until resolve+flush completes for all subscribers, **a slow client blocks the broker-reading goroutine for that trigger** (per-trigger-serial backpressure). JetStream delays the next `FetchNoWait` and the `msg.Ack()`; Kafka delays the next `PollRecords`; Redis/NATS-core stall the channel read.
- **NATS core uses an unbuffered Go channel** (`make(chan *nats.Msg)`, `nats/adapter.go:168`); on overflow the nats.go client **drops events** and logs `nats.ErrSlowConsumer`: "NATS slow consumer detected. Events are being dropped." (`provider_builder.go:96-105`).
- **Kafka**: franz-go internal fetch buffering; poll caps at 10k records.
- **Redis Pub/Sub**: go-redis internal channel; on overflow messages are **dropped** by the client.
- **Per-update resolve timeout**: `context.WithTimeout(ctx, r.maxSubscriptionFetchTimeout)`; `MaxSubscriptionFetchTimeout` defaults to **30s** (`router/pkg/config/config.go:454`, wired `router/core/executor.go:89`). A failed flush → `UnsubscribeSubscription`.

### 2.3 Restart / disconnect / broker-drop behavior

| Event | NATS JetStream | NATS core | Kafka | Redis Pub/Sub |
|---|---|---|---|---|
| **Client disconnects mid-stream** | In-flight event's flush fails & is discarded; if disconnect precedes `msg.Ack()`, message redelivered after AckWait (~30s) — but to the *same* per-instance durable consumer | In-flight + subsequent events lost | Same — lost | Same — lost |
| **Router restarts** | Durable consumer survives **only if** instance identity (`hostname + listenAddr + subjects`) is stable; un-acked redelivered. Lost if `deleteConsumersOnShutdown` set or `ConsumerInactiveThreshold` expires | No persistence — anything published during downtime lost | Re-subscribes with `ConsumeResetOffset(AfterMilli(now))` → **skips everything produced during downtime** | No backlog — lost |
| **Broker connection drops** | Auto-reconnect (jitter); un-acked redelivered after AckWait | Messages during gap lost; slow-consumer overflow dropped | franz-go internal reconnect continues from in-memory position (no re-skip mid-subscription) | Messages during gap lost |

**Durable consumer naming caveat (NATS):** the user-supplied `consumerName` is **advisory only** — it is a prefix to a hash of `hostname-routerListenAddr` + subjects (`getDurableConsumerName`, `nats/adapter.go:69-83`). This deliberately makes the consumer unique per router instance + subject set so multiple routers don't fight over one consumer — but it also means HA / horizontal scaling and durable resume are at odds (see §6).

### 2.4 One-line summary of the gap

> Today, **only NATS JetStream achieves any durability, and only because its adapter independently calls `msg.Ack()`** after a *flush attempt*. There is no client acknowledgement, no resume token, no replay, and no per-subscriber delivery accounting anywhere in EDFS. Everywhere else delivery is at-most-once by construction.

---

## 3. Per-Backend Capability Matrix

### 3.1 Cosmo's current support & semantics (from the codebase)

| Backend | Cosmo client lib | Cosmo transport used | Ack/commit in Cosmo today | Cursor surfaced? | Effective Cosmo guarantee | Cross-restart durability |
|---|---|---|---|---|---|---|
| **NATS core** | nats.go v1.50.0 | `ChanSubscribe` (core pub/sub) | None | No | At-most-once; drops on slow consumer | None |
| **NATS JetStream** | nats.go v1.50.0 | Durable pull consumer, `FetchNoWait(300)`, `msg.Ack()` after delivery attempt | `AckExplicit` (default), default 30s `AckWait`, unlimited `MaxDeliver` | No (`Metadata()` never read) | "Close to" at-least-once *relative to router read*, with loss windows | Only if consumer survives (instance-stable, not deleted/expired) |
| **Kafka** | franz-go v1.16.1 | Groupless direct consumer, `ConsumeResetOffset(AfterMilli(now))` | **None** (no group, no commit) | No (`r.Offset` never read) | At-most-once / fire-and-forget | None — skips downtime backlog |
| **Redis** | go-redis/v9 v9.7.3 | **Pub/Sub** (`PSubscribe`/`PUBLISH`) — **not Streams** | None (Pub/Sub has no ack) | No | At-most-once / fire-and-forget | None |
| **SQS, Google Pub/Sub, Kinesis, Event Hubs, RabbitMQ** | — | **Not supported in EDFS today** | — | — | — | — |

**Cosmo-side knobs exposed today:** NATS — `consumerName`, `streamName`, `consumerInactiveThreshold` (schema), plus `experiment_delete_durable_consumers_on_shutdown`, auth, TLS (router YAML). No `AckPolicy`/`AckWait`/`MaxDeliver`/`DeliverPolicy`/`replicas` surfaced. Kafka — `brokers`, auth (SASL plain/SCRAM), TLS, `fetch_max_wait`; **no** consumer-group/offset-reset/commit config. Redis — `urls`, `cluster_enabled`.

### 3.2 Backend-native capability matrix (what's *possible*, from external research)

| Backend | Default guarantee | Ack/commit mechanism | Cursor/offset primitive | Replay window | Ordering | Native dedup |
|---|---|---|---|---|---|---|
| **NATS core** | At-most-once | None | None | None | Per-subject best-effort | No |
| **NATS JetStream** | At-least-once (exactly-once optional) | `AckAck`/`AckNak`/`AckProgress`(+WPI)/`AckTerm`(+TERM)/`AckNext`; double-ack | **Stream sequence** (canonical) + **consumer sequence** + **ack floor** `(cons,stream)` | Retention-bound (`LimitsPolicy`); `DeliverByStartSequence`/`ByStartTime` resume | Linearizable writes; single global order per stream | **Yes** — `Nats-Msg-Id` + duplicate window (default **2 min**) |
| **Kafka** | At-least-once | Offset commit (`commitSync`/`commitAsync`), manual or auto; commit = *next* offset to read | **`(partition, offset)`**; `seek`, `offsetsForTimes` (timestamp cursor) | `retention.ms` (data) — note `__consumer_offsets` evicts at `offsets.retention.minutes`, **7d default** | Strict **within a partition** | Idempotent producer (PID+seq) dedups producer retries; consumer dedup = app's job |
| **AWS SQS (Standard)** | At-least-once (dupes) | `DeleteMessage` after processing; visibility timeout (default 30s) | None — ephemeral receipt handle | **None** | Best-effort (none) | No |
| **AWS SQS (FIFO)** | Exactly-once *processing* | `DeleteMessage`; visibility timeout | None — receipt handle | **None** | Strict FIFO per **message group ID** | **Yes** — 5-min dedup via `MessageDeduplicationId` |
| **Redis Streams** (vs Pub/Sub) | At-least-once (consumer groups + PEL) | `XACK` clears the Pending Entries List; `XREADGROUP` adds to PEL | **Entry ID** `<ms>-<seq>`; group `last-delivered-id`; `XPENDING`/`XCLAIM`/`XAUTOCLAIM` | Bounded by `MAXLEN`/`MINID` trimming | Total order by entry ID per stream | No (PEL prevents loss, not dupes) |
| **Google Cloud Pub/Sub** | At-least-once | `ack`/`nack`; ack deadline default 10s (60s for EOS), `modifyAckDeadline` | Server-managed ack state; **snapshots** | `seek` to timestamp/snapshot; retention up to **31d**, snapshots **7d** | Optional per **ordering key** (same region) | **Yes** when exactly-once subscription enabled (opt-in) |
| **AWS Kinesis Data Streams** | At-least-once | No per-msg ack — consumer **checkpoints** sequence number (KCL/DynamoDB) | **Shard iterator** + **sequence number** (`AT_/AFTER_SEQUENCE_NUMBER`, `TRIM_HORIZON`, `LATEST`; iterator expires 5 min) | Retention **24h** default → **7d** → up to **365d** | Strict **within a shard** | No |
| **Azure Event Hubs** | At-least-once | No broker ack — consumer **checkpoints** offset (external store, e.g. blob) per partition/group | **Offset** + **sequence number** per partition | Standard **7d** max / Premium & Dedicated **90d** max; rewind by offset/timestamp | Ordered **within a partition** | No |
| **RabbitMQ / AMQP** | At-least-once (manual ack) | `basic.ack` / `basic.nack` / `basic.reject` (optional requeue); unacked auto-requeued on channel/connection loss | None — `redelivered=true` flag only | **None built-in** | FIFO per queue, **broken by requeue** | No |

### 3.3 Two architectural families (decisive for replay)

- **Delete-on-ack queues** (SQS, RabbitMQ, NATS core): no cursor, no historical replay. Durability = redelivery of un-acked messages only. **Cannot support cursor/resume patterns** (§5b).
- **Log/cursor stores** (Kafka, Redis Streams, Kinesis, Event Hubs, NATS JetStream): retained append-only log addressable by a position primitive → any consumer can re-read within retention. **Natural fit for cursor/resume.**
- **Hybrid** (Google Pub/Sub): queue + retention + snapshots + `seek`.

**Universal caveat: native dedup is rare** (only SQS FIFO and Pub/Sub EOS). Everywhere else, at-least-once means **consumers must be idempotent**, and **ordering is partition/group-scoped, never global**.

---

## 4. Client-Side Landscape

**Bottom line:** the mainstream GraphQL subscription stack is **at-most-once**. On reconnect, clients resubscribe from "now" and do **not** replay missed events. At-least-once exists only where an explicit mechanism is bolted on (app-level acks, cursor/offset resume, or client dedup).

### 4.1 Protocols — current capability

| Protocol | Per-message ack? | Resume/cursor? | Notes |
|---|---|---|---|
| **graphql-ws** (`graphql-transport-ws`) | **No** | **No** | Message set: `ConnectionInit/Ack`, `Ping/Pong`, `Subscribe`, `Next`, `Error`, `Complete`. `ConnectionAck` acks the *connection*; `Ping/Pong` are liveness only. Dropped socket → must `Subscribe` again from "now." |
| **subscriptions-transport-ws** (legacy `graphql-ws`) | **No** | **No** | Deprecated/unmaintained. Has keep-alive only. |
| **graphql-sse** | **No** | **No** | Event types `next`/`complete`. Does **not** implement SSE `Last-Event-ID` resumption; the operation `id` is correlation, not an SSE event id. |
| **Plain SSE `Last-Event-ID`** | No | **Yes (wire primitive only)** | WHATWG: browser tracks `id:` and sends `Last-Event-ID` on auto-reconnect. **Replay is entirely the server's responsibility** (persist a log keyed by id; reconnect must land on a replica that has it). Server-tunable `retry:` backoff; `204` stops reconnection. The only protocol-native resume primitive in this space. |

### 4.2 Client libraries — current behavior

- **Apollo Client**: subscriptions on graphql-ws (or legacy). On reconnect, active subscriptions are **re-established from scratch — no replay**. Supports subscription *deduplication* (identical concurrent subscriptions share a stream) but this dedups *subscriptions*, not *messages*. Reconnect-after-error historically fiddly.
- **Relay**: behavior **inherited from the transport**; Relay adds no offset/cursor resume.
- **urql**: non-fatal close → auto-reconnect and **all active subscriptions resubscribe** (restart, not resume). Explicitly disclaims delivery guarantees ("it's up to you to define a system that ensures … don't lose events").
- **Mobile (iOS/Android)**: OS suspends/closes long-lived sockets on background; standard pattern is silent/background push (APNs/PushKit) to wake the app and re-establish + re-fetch. No transport-level replay. Notable SDK exception: AWS AppSync **Android** SDK v2.6.27 set MQTT **QoS 1** for at-least-once on that client.

**Recommended app-level pattern across all three libraries (none does it for you):** on reconnect, run a catch-up *query*, queue incoming live deltas while it's in flight, then merge (query first, then deltas), deduping with idempotency keys. This is "eventually consistent on reconnect," **not** true at-least-once.

### 4.3 Comparable systems — which give at-least-once / resume, and how

| System | Guarantee | Mechanism |
|---|---|---|
| **Hasura streaming subscriptions** | **Exactly-once** | Per-subscription **cursor** over an append-only, unique+sortable column; client resumes `stream(cursor: lastSeen)`. Client-driven catch-up + live. |
| **MQTT QoS 1 / QoS 2** | At-least-once / exactly-once | App-level **ACK + redelivery** (`PUBACK`); QoS 2 = 4-way handshake + packet-id dedup. The only mainstream client transport with native per-message ack. |
| **AWS AppSync** | Best-effort / at-most-once (general) | No ack/retry; expects re-pull on reconnect. (Android SDK exception above.) |
| **Phoenix Channels / Supabase Realtime** | At-most-once default | No persistence; rejoin resumes *live*, no replay. Stronger = DIY `last_seen_id` on `join` + server-side replay. |
| **Meteor DDP** | At-least-once for method calls | Reconnect re-establishes **same session id**, re-runs subs, retries methods (use idempotency key). Data is state reconciliation, not replay. |
| **Custom GraphQL-over-SSE replay proxy** | At-least-once / resumable | Reconnect with a cursor, server replays missed events then switches to live. The `Last-Event-ID` idea done properly. (e.g. Platformatic "WebSocket Recovery for GraphQL Subscriptions.") |

### 4.4 Protocol extensions Cosmo would need

To support genuine at-least-once on the client wire, **at least one** of:

1. **Per-message id + client ack** (new inbound WS message type, e.g. `ack {id}`; new SSE/multipart back-channel). Requires extending `wsproto` (`proto.go:88-94`) and the writers — currently impossible since SSE/multipart are one-directional.
2. **Resume token / cursor on (re)subscribe** (carry a `cursor`/`lastEventId` in the `Subscribe` payload; emit `id:` on SSE; honor `Last-Event-ID`). Lighter on the client; server does the heavy lifting (persist + replay).
3. **No protocol change — client-side dedup/backfill** (§5f). Works with stock clients but only achieves "eventually consistent on reconnect."

---

## 5. Distinct Architectural Patterns for At-Least-Once GraphQL Subscriptions

Each pattern below is a candidate RFC. Complexity scale: **S** (config/adapter tweak) → **M** (new adapter state, no protocol change) → **L** (new wire protocol + server state) → **XL** (durable per-subscriber state + protocol + HA).

---

### Pattern A — End-to-End Client-Ack Protocol Extension
**Mechanism.** Every delivered message carries a monotonic `id`. The client sends an explicit `ack {id}` back. The router holds the broker ack (e.g. JetStream `msg.Ack()`, Kafka offset commit, Redis `XACK`, SQS `DeleteMessage`) **until the client ack arrives**, with a window/timeout that triggers `nak`/redelivery. Mirrors MQTT QoS 1.

**Guarantee.** True end-to-end at-least-once (broker → client *receipt*). Duplicates possible (client must be idempotent). With double-ack + dedup → exactly-once on capable backends.

**Backends + degradation.** Natural on backends with per-message ack/redelivery: **JetStream** (`AckWait`/`AckNak`/`MaxAckPending`/double-ack), **SQS** (visibility timeout + `DeleteMessage`), **RabbitMQ** (`basic.ack`/`nack`), **Redis Streams** (PEL + `XACK`/`XCLAIM`), **Google Pub/Sub** (`ack`/`modifyAckDeadline`). Degrades on **Kafka/Kinesis/Event Hubs** (no per-message ack — only offset/sequence commit) → must map client-ack onto *cursor advance*, which only works in-order (becomes Pattern B-ish). **No** support on NATS core / Redis Pub/Sub (no ack primitive) → falls back to at-most-once.

**Client protocol changes.** New `ack` inbound message in graphql-ws; SSE/multipart need a back-channel (a separate HTTP `POST /ack` keyed by stream id, since SSE is one-way). Stock clients won't ack → must negotiate capability and fall back.

**Server/state.** Per in-flight message: `(client, messageId) → broker ack handle` map, plus `MaxAckPending`-style cap. Held broker handles bound memory and stall the broker reader (backpressure). Router HA: ack handles are per-process — a router restart loses un-acked-to-client handles unless the broker redelivers (JetStream/SQS/Rabbit do; Kafka-by-offset doesn't per-message).

**Ordering.** Preserved if acks are processed in order and `MaxAckPending=1` (kills throughput) — otherwise out-of-order acks are fine for non-ordered backends but break the "cursor = ack" mapping on log backends.

**Pros.** Strongest, most general guarantee; matches the problem statement directly. **Cons.** Requires client protocol changes (adoption cost); per-message state; SSE/multipart awkward. **Complexity: L–XL.**

---

### Pattern B — Cursor / Resume-Token Replay on Reconnect
**Mechanism.** The router surfaces an opaque **cursor** with every message (encoding backend position: JetStream stream-seq, Kafka `(partition,offset)`, Redis entry-id, Kinesis seq, Event Hubs offset, Pub/Sub snapshot/time). On (re)subscribe the client sends its last cursor; the router seeks the backend to that position, **replays missed events, then switches to live**. This is the Hasura / `Last-Event-ID`-done-properly model.

**Guarantee.** At-least-once across disconnect gaps **if the gap is within the backend's replay window**; reduces to at-most-once for events evicted by retention/trimming (surface "cursor expired" — Kafka `auto.offset.reset=none`).

**Backends + degradation.** Excellent on **log/cursor stores** (Kafka, Redis Streams, Kinesis, Event Hubs, JetStream, Pub/Sub-with-retention). **Impossible** on delete-on-ack queues (SQS, RabbitMQ) and NATS core / Redis Pub/Sub — no durable position to seek → degrade to at-most-once or to Pattern A.

**Client protocol changes.** Lightest of the durable patterns: emit `id:` on SSE (honor `Last-Event-ID`), carry `cursor` in `Subscribe` payload + each `Next` for WS. No per-message ack needed. Stock SSE browsers get auto-resume *for free* once the server emits `id:` and replays.

**Server/state.** Mostly **stateless on the router** — durability lives in the broker; the router only translates cursor ↔ backend seek (`DeliverByStartSequence`, `seek`, `XREAD from id`, `GetShardIterator`). Must read & surface the sequence the code ignores today (`msg.Metadata()`, `r.Offset`). Watch: Kafka `offsets.retention.minutes` 7d eviction; iterator/snapshot expiry.

**Ordering.** Naturally ordered within a partition/stream (the cursor *is* the order). Gaps are contiguous by construction.

**Pros.** Minimal router state; leverages existing broker durability; works with near-stock SSE; clean degradation story. **Cons.** Only as good as the replay window; cursor must be opaque + signed (security); reconnect must be sticky to a replica/partition that has the data; per-client cursor handoff needs per-client (not shared) consumption on some backends (Kafka per-session group). **Complexity: M–L.**

---

### Pattern C — Durable-Consumer-Per-Subscription + Router-Side Checkpoint Store
**Mechanism.** Each logical client subscription is backed by its **own durable consumer / checkpoint** (JetStream durable consumer, Kafka per-session group + committed offset, Kinesis/Event Hubs checkpoint, Redis Streams consumer group). The router persists the per-subscriber checkpoint (in the broker where possible, else an external store — Redis/DynamoDB/Postgres) and only advances it after delivery is confirmed.

**Guarantee.** At-least-once across router restart *and* client reconnect, bounded by retention. Strongest cross-restart story.

**Backends + degradation.** Works wherever durable per-consumer state exists: JetStream (durable consumer — but **must fix the per-instance-hash naming**, `nats/adapter.go:69-83`, so the name is per-*subscription* not per-*router-process*), Kafka (per-session `group.id` + `group.instance.id` static membership + `CooperativeStickyAssignor`), Redis Streams (consumer group), Kinesis/Event Hubs (external checkpoint), Google Pub/Sub (per-subscription). Degrades to Pattern B's window or at-most-once on queues without per-consumer durable state.

**Client protocol changes.** None strictly required if checkpoint advance is gated on flush — but flush ≠ receipt (today's exact bug, §2.1). For real guarantees, combine with A (client ack) or B (cursor). Best as the *server-side substrate* under A or B.

**Server/state.** Heaviest: one durable consumer/checkpoint per active subscription (not per shared trigger — this **breaks trigger dedup**, §1.4, since fan-out currently shares one broker subscription). Memory/connection cost scales with subscriber count; multi-tenant fan-out becomes N broker consumers. Checkpoint store is a new dependency + HA concern.

**Ordering.** Per-consumer ordered. **Pros.** Survives router restarts; per-client isolation; precise redelivery. **Cons.** Explodes broker consumer count; kills the shared-trigger optimization; external state store; consumer lifecycle/GC (inactive cleanup) is fiddly. **Complexity: XL.**

---

### Pattern D — Broker-Native Ack Mapped to Client Delivery Confirmation (Fix the Ack Timing)
**Mechanism.** Keep today's shared-trigger model but **fix the ack so it reflects real delivery**: make `SubscriptionUpdater.Update` return a per-subscriber delivery result, propagate it back through the `datasource.Adapter` boundary, and only `Ack()`/commit when *all* (or a quorum/policy of) subscribers flushed successfully — `Nak`/redeliver otherwise. This is the minimal correctness fix to the four bugs in §2.1.

**Guarantee.** At-least-once *relative to flush success* (bytes to kernel), still not client-receipt — but closes bugs #2/#3/#4 (ack-on-failure, fan-out-all-acked, abandon-but-acked). A strict upgrade over today.

**Backends + degradation.** JetStream gets correct `Ack`/`Nak`; Redis Streams `XACK`/no-ack; SQS delete/no-delete; Rabbit ack/nack. Kafka/Kinesis (offset-based) can only "commit up to the lowest successfully-delivered offset across shared subscribers" → head-of-line blocking on a slow subscriber. NATS core / Redis Pub/Sub: nothing to map → unchanged.

**Client protocol changes.** **None.** Pure server-side. **Server/state.** Requires changing the framework's fire-and-forget contract: `Adapter` interface + `SubscriptionUpdater` must carry a delivery result (touches `provider.go:22-28`, `subscription_event_updater.go`, and the engine `resolve.go` `Update` signature). Shared-trigger fan-out forces an "ack only when the slowest subscriber flushed" policy, coupling subscribers.

**Ordering.** Unchanged. **Pros.** No client changes; biggest correctness-per-effort; foundation for A/B/C. **Cons.** Flush≠receipt ceiling; couples shared subscribers; cross-process restart still drops un-acked-to-client (no per-subscriber durable state). **Complexity: M.**

---

### Pattern E — Hybrid Buffered-with-Redelivery (Router-Side Replay Buffer)
**Mechanism.** The router keeps a bounded, ordered **per-trigger (or per-subscriber) ring buffer** of recently delivered events keyed by a router-assigned sequence. On reconnect within a short window the client presents its last seq and the router replays from the buffer, then resumes live. Broker ack is held until the event leaves the buffer (or a TTL). Effectively a small router-side log in front of backends that have none.

**Guarantee.** At-least-once for disconnects **shorter than the buffer window**; degrades to at-most-once beyond it. Bridges backends that lack native replay (NATS core, Redis Pub/Sub, SQS, RabbitMQ).

**Backends + degradation.** **Backend-agnostic** — this is its whole point: it manufactures a replay window for non-log backends. For log backends it's redundant with B (prefer B there). Cross-router-restart durability requires an external buffer store (else buffer is in-process, lost on restart).

**Client protocol changes.** Router-assigned `id` + resume token on reconnect (like B but router-scoped, not backend-scoped). **Server/state.** Bounded memory per trigger/subscriber (the explicit cost knob); eviction policy; the *only* pattern that gives any guarantee on NATS core / Redis Pub/Sub / SQS-standard without changing the backend.

**Ordering.** Router assigns the order; preserved within the buffer. **Pros.** Works everywhere, including the at-most-once backends; tunable memory/guarantee tradeoff; no broker feature needed. **Cons.** Memory cost under fan-out; short window only; in-process buffer lost on restart (needs external store for XL guarantee); duplicates the broker's job where the broker already has a log. **Complexity: M (in-process) → L (durable buffer).**

---

### Pattern F — Outbox / Dedup-on-Client (Reconnect-Backfill)
**Mechanism.** No durable delivery; instead each event carries a stable **idempotency key** (e.g. `Nats-Msg-Id`, Kafka key, or a content hash). On reconnect the client runs a normal **catch-up query**, queues live deltas, merges, and dedups by key. The router optionally exposes a "since" query argument backed by an application outbox/table.

**Guarantee.** "Eventually consistent on reconnect," **not** true at-least-once delivery of every event — but no permanent loss of *state* if the backing store is queryable. Matches today's recommended client pattern.

**Backends + degradation.** **Fully backend-agnostic** (works even on NATS core / Redis Pub/Sub) because durability lives in the application's own datastore, not the stream. Degradation is about *event* delivery (you may miss intermediate events) vs *state* convergence (final state is correct).

**Client protocol changes.** None to the subscription protocol; needs a companion catch-up query + client dedup logic (or an SDK helper). Pairs with mobile silent-push to trigger the backfill.

**Server/state.** Minimal in the router; pushes responsibility to the application schema (a `since`/`cursor` query + outbox). **Ordering.** Not guaranteed for intermediate events; final state converges. **Pros.** Cheapest server-side; works with stock clients + any backend; great for mobile. **Cons.** Not real at-least-once for discrete events (loses intermediate transitions); requires app cooperation (outbox + idempotency keys); double the surface (query + subscription). **Complexity: S–M (router) but pushes cost to the app/client.**

---

### Pattern G — Tiered Capability Negotiation (Meta-Pattern / "Policy Engine")
**Mechanism.** A subscription declares (per field, via directive, or per client via protocol capability) a *desired* delivery class — `at-most-once` (today), `at-least-once`, `exactly-once` — and the router selects the strongest mechanism the **chosen backend + client** can satisfy, transparently degrading and reporting the *actual* class delivered (e.g. via an `extensions.delivery` field). Composes A/B/C/D/E/F per backend.

**Guarantee.** Whatever the negotiated floor is; the value is *honesty* — the system never silently pretends. Directly answers the problem statement's "pick a backend even if degraded."

**Backends + degradation.** All — this is the routing layer. Maps: JetStream/Pub/Sub → A or B+C; Kafka/Kinesis/Event Hubs → B (cursor); Redis Streams → A/B; SQS/Rabbit → A (ack, no replay) or E (buffer); NATS core / Redis Pub/Sub → E or F only.

**Client protocol changes.** Capability handshake in `connection_init` payload (advertise `supports: [ack, resume]`); server replies with negotiated class. **Server/state.** A policy/registry layer plus whichever underlying pattern(s) are enabled. **Ordering.** Per chosen mechanism. **Pros.** The product-level answer; lets one router serve heterogeneous backends with explicit guarantees; future-proof. **Cons.** Only as good as the patterns beneath it; negotiation + observability surface; risk of confusing matrix of "what you actually get." **Complexity: L (as a layer) on top of whichever of A–F ship.**

---

### 5.x Pattern selection guide

- **Strongest, most general, willing to change the client:** A (+ C substrate, + double-ack for EOS).
- **Lightest durable win on log backends, near-stock SSE clients:** B.
- **Cross-restart survival, per-client isolation:** C (accept broker-consumer fan-out cost).
- **Cheapest correctness fix, no client change, ship first:** **D** (fixes the actual bugs in §2.1 and is the substrate for everything else).
- **Make at-most-once backends usable:** E (router buffer) or F (client backfill).
- **The product framing that ties it together:** G.

A plausible RFC sequencing: **D** (correctness) → **B** (cursor resume on log backends, emit `id:`/expose sequence) → **A** (client ack for true end-to-end) → **G** (negotiation) → **C/E** as backend-specific reinforcements.

---

## 6. Cross-Cutting Concerns

### 6.1 Ordering vs at-least-once
These conflict. At-least-once via redelivery (Nak, AckWait, requeue) can **reorder** unless `MaxAckPending=1` / single in-flight, which destroys throughput. RabbitMQ requeue reinserts near the head, breaking FIFO. Cosmo's hooks path *already* warns about reordering on timeout (`subscription_event_updater.go:77-79`). **Ordering is partition/group/stream-scoped on every backend, never global** — any pattern that fans one stream to many clients (Cosmo's shared trigger) preserves per-partition order at best. Decide per RFC whether ordering is a guarantee or best-effort.

### 6.2 Dedup / idempotency keys
At-least-once ⇒ duplicates ⇒ the client (or a router dedup layer) **must be idempotent**. Native broker dedup exists only on **SQS FIFO** (5-min window) and **Google Pub/Sub EOS**; **JetStream** offers publisher-side dedup via `Nats-Msg-Id` + 2-min duplicate window. For everything else Cosmo must define a **stable idempotency key** (Kafka record key, `Nats-Msg-Id`, content hash) and surface it to the client so it can dedup — this is also the join key for Pattern F backfill.

### 6.3 Exactly-once feasibility
Exactly-once is a *composition*, not a switch: publisher dedup (`Nats-Msg-Id` / Kafka idempotent producer + transactions) **plus** consumer-side confirmed ack (JetStream double-ack; Kafka offset-in-same-transaction; or "store cursor in the same store as the delivered data" — the strongest, broker-independent trick). End-to-end EOS to a *GraphQL client* additionally needs client-ack (A) + client dedup. Realistically: **at-least-once + idempotent client = effective exactly-once**; true broker-level EOS only on JetStream / Pub/Sub / Kafka-EOS, and only with `read_committed`-style consumption (which can stall the cursor at the LSO on an open upstream transaction — a head-of-line failure mode to surface).

### 6.4 Backpressure
Today: synchronous, per-trigger-serial backpressure into the broker reader (good — it doesn't lose data on JetStream) but **silent drops** on NATS core / Redis Pub/Sub overflow. Patterns A/C/E add explicit caps (`MaxAckPending`, buffer size) — these become the **memory/guarantee tradeoff knob**. A slow client must either backpressure the shared trigger (penalizing co-subscribers) or be isolated (Pattern C, at consumer-count cost). Per-update timeout (`MaxSubscriptionFetchTimeout`, 30s) and write deadlines remain the liveness guards.

### 6.5 Multi-tenant fan-out
Cosmo's **shared trigger** (one broker subscription per unique input+headers hash, fanned to N clients) is the central tension: it is great for scale but means **one broker ack covers N heterogeneous client outcomes** (§2.1 #3). Per-subscriber durability (C) or per-subscriber ack (A) **breaks dedup** → N broker consumers. Patterns B (cursor, stateless router) and E (router buffer) preserve sharing better. Any RFC must state explicitly what it does to trigger dedup.

### 6.6 Router HA / horizontal scaling & sticky sessions
- **JetStream durable naming today is per-router-instance** (`hostname-listenAddr` hash, `nats/adapter.go:69-83`) — deliberately so instances don't fight, but it means a *different* router instance after failover gets a *different* consumer and **does not resume** un-acked state. For HA at-least-once the durable name must key on the *subscription* (stable identity), which then needs coordination so two instances don't double-consume (queue group / `WorkQueuePolicy` / Kafka group).
- **Kafka** offers `group.instance.id` (static membership) + `CooperativeStickyAssignor` for stable cursors under churn; a `ConsumerRebalanceListener` must flush cursors before revocation.
- **Cursor patterns (B)** need reconnect **stickiness** to a replica/partition that holds the position (or a shared external cursor store). **Client-ack patterns (A/E)** need either sticky routing (in-process ack state) or an external ack/state store survivable across instances. This is the single biggest HA design axis for every pattern.

### 6.7 Memory / state cost
- A (client ack): O(in-flight per client) held broker handles + map.
- B (cursor): ~O(1) router state (durability in broker) — cheapest.
- C (durable per-sub): O(active subscriptions) broker consumers + external checkpoint store — most expensive.
- E (router buffer): O(window × triggers/subscribers) RAM (the tunable knob), + external store for restart-survival.
- F (backfill): ~O(1) router, cost pushed to app datastore + client.

### 6.8 Security / authz interplay with existing Cosmo Streams hooks
- **Cursors/resume tokens must be opaque, signed, and tenant-scoped** — a raw `(partition, offset)` or stream-seq lets a client seek to data it shouldn't see (especially with `DeliverAll`/replay). Replay must re-run the same authz as live delivery, per event.
- **Existing hooks** (`on_receive_events` / `OnReceiveEvents`, `OnPublishEvents`) are the natural enforcement points but today the receive-hook path is also where **abandon-on-timeout reordering/loss** happens (§2.1 #4) — any durability RFC must reconcile hook execution with ack/redelivery so a hook that drops/filters an event still results in a correct broker ack (drop ≠ failure). 
- Publish errors are currently **swallowed** (`success:false`, logged not returned) — an at-least-once *publish* story (idempotent ingest with `Nats-Msg-Id`) should reconsider whether the client learns about broker failures.
- Replay across a long window can resurface data whose authz has since changed (revoked tenant/user) — replayed events need **current** authorization, not the authorization at original publish time.

---

### Appendix — Key file:line index (codebase touchpoints for the RFCs)

- Generic fire-and-forget updater (sync fan-out, hooks, abandon-on-timeout): `router/pkg/pubsub/datasource/subscription_event_updater.go:19-24, 36-129, 142-164`
- Adapter interface (no ack hook, no error): `router/pkg/pubsub/datasource/provider.go:22-28`
- Engine entry from router: `router/pkg/pubsub/datasource/subscription_datasource.go:35-54`
- NATS JetStream durable + ack-after-delivery (ack `:154`); consumer config (no AckPolicy/AckWait override) `:413-442`; per-instance durable naming `:61-83`; core NATS unbuffered chan `:168`: `router/pkg/pubsub/nats/adapter.go`
- NATS reconnect + slow-consumer drop log: `router/pkg/pubsub/nats/provider_builder.go:79-110`
- Kafka stateless, groupless, reset-to-now, no commit: `router/pkg/pubsub/kafka/adapter.go:32-34, 51-122, 142-153`
- Redis **Pub/Sub** (not Streams) fire-and-forget: `router/pkg/pubsub/redis/adapter.go:88-152, 191`
- Synchronous fan-out + resolve + flush; per-update timeout; no internal events queue: graphql-go-tools `pkg/engine/resolve/resolve.go` (`handleTriggerUpdate`, `executeSubscriptionUpdate`, flush, `MaxSubscriptionFetchTimeout` wiring)
- WS writer (direct socket write, write deadline; WS heartbeat no-op): `router/core/websocket.go:187-217, 659-662, 704-736`
- SSE/multipart writer (direct write+flush, no `id:` field): `router/core/flushwriter.go:116-167, 252-299`
- Inbound WS message set (no client ack): `router/internal/wsproto/proto.go:88-94, 102-112`
- Default `MaxSubscriptionFetchTimeout` = 30s: `router/pkg/config/config.go:454`; wired `router/core/executor.go:89`
- Router config event sources (NATS/Kafka/Redis): `router/pkg/config/config.go:704-710, 751-757, 763-767, 773-782`
- Proto event config: `proto/wg/cosmo/node/v1/node.proto:395-434`
- Composition directive parsing: `composition/src/v1/normalization/normalization-factory.ts:2804-3169`
- Two-plane join at runtime: `router/core/factoryresolver.go:531-538`, `router/pkg/pubsub/pubsub.go:56-128, 166-173`
