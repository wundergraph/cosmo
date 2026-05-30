## Review: Pattern G

Pattern G is directionally valuable, but it should not be accepted as an at-least-once delivery mechanism. It is a capability-reporting and routing framework whose correctness depends entirely on A/B/C/D/E/F. That is mostly admitted by the RFC, but several rows still overclaim the achieved class.

1. **Does the guarantee hold?**

Not by itself. G’s real guarantee is “honest negotiation,” not delivery. That is useful, but the RFC sometimes lets “selected mechanism says at-least-once” bleed into “end-to-end at-least-once holds.”

The biggest correctness problem is Pattern D. The RFC classifies “correct broker ack on flush” as `at-least-once` with no client participation. That is not end-to-end at-least-once. A successful `Flush()` only proves bytes were written to the socket/kernel buffer. If the client crashes after the write and before application processing, the broker message is acked/committed and the event is lost. The RFC even contradicts itself in §7 by saying this event “is not acked,” but D’s whole mechanism is ack-on-flush-success. G must never report D as `achieved: at-least-once` for broker-to-client semantics. It needs a weaker reported class, or a separate dimension like `deliveryBoundary: socket-write`.

B is stronger, but only if the client persists and resumes from the last processed cursor. Native SSE `Last-Event-ID` is not “at-least-once for free” across browser/tab/app restarts; it is mainly automatic reconnect state for the active EventSource. Without application-level durable cursor storage, there is still a client crash window.

E is also overstated for NATS core / Redis Pub/Sub. A router buffer can replay only events that reached the router and survived the buffer window/store. It cannot recover broker-side drops, slow-consumer drops before adapter receipt, router restart with memory store, or gaps while no router instance is subscribed. It should be reported as bounded best-effort replay, not generic `at-least-once`.

2. **Backend adaptability / degradation**

The matrix is useful and mostly honest about current Cosmo support: NATS core and Redis Pub/Sub are at-most-once; Redis Streams, SQS, Pub/Sub, Kinesis, Event Hubs, RabbitMQ require new adapters.

Problematic claims:

- **JetStream exactly-once** is too strong. Double-ack confirms the server processed the ack; `Nats-Msg-Id` dedups publishes within a bounded window. It does not prove exactly-once client processing unless the client participates transactionally/idempotently. Report “at-least-once with bounded producer dedup,” not hard EOS.
- **Kafka EOS** is hand-wavy. Kafka exactly-once is producer/transaction/read-process-write scoped. GraphQL subscription delivery to arbitrary clients cannot inherit Kafka EOS unless cursor advancement and client side effects are in one transaction, which they are not.
- **SQS FIFO exactly-once-processing** is misleading. FIFO has deduplication windows and ordering constraints, but consumers can still receive duplicates; client idempotency remains required.
- **Google Pub/Sub EOS** applies to supported pull subscriptions and ack semantics, not arbitrary downstream GraphQL client processing.
- **NATS core listed as delete-on-ack queue** in the structural note is wrong; core NATS has no ack/delete primitive.

The non-silent degradation idea is strong, but only if labels are more precise than `at-least-once` / `exactly-once`.

3. **Engine / protocol / client feasibility**

Feasible, but not “thin” in practice. Required work crosses router, composition, proto, graphql-go-tools, WS/SSE writers, client libraries, metrics, config validation, cursor signing/key rotation, and adapter contracts. Changing `SubscriptionEventUpdater` and engine `SubscriptionUpdater` from void fire-and-forget to outcome-bearing delivery is a real cross-repo contract change. Shared-trigger fanout with per-subscriber outcomes is especially invasive.

Wire changes are plausible for `graphql-transport-ws` because payload/extensions are flexible. Legacy clients may ignore `extensions.delivery`, so “non-silent” is only true for observability/logs unless clients surface extensions. The out-of-band ack endpoint for SSE/multipart is conceptually feasible but large enough to deserve its own RFC.

4. **Top strengths**

- Establishes an honest negotiation model instead of pretending one mechanism fits all brokers.
- Cleanly separates backend capability, client capability, transport capability, and router HA capability.
- Makes degradation observable through `extensions`, metrics, traces, and strict-mode startup validation.

5. **Top weaknesses**

- Does not itself restore delivery; it can only route to mechanisms implemented elsewhere.
- Overclaims D, E, and several “exactly-once” backend rows.
- Underestimates cross-repo complexity, especially engine outcome propagation, shared-trigger fanout, and client cursor/ack behavior.

6. **Relationship to A-F**

G is not standalone. It is a foundation/meta-pattern over A-F. It is best merged with Pattern B as the first practical implementation path: B gives real value on Kafka/JetStream/log backends, while G supplies negotiation and reporting. D can be a substrate fix, but must not be advertised as end-to-end at-least-once.

**Scores**

- correctness: 3/5
- feasibility: 3/5
- backend_adaptability: 4/5
- value_for_effort: 3/5

**Recommendation: MERGE-WITH-B**

Merge G with Pattern B as the negotiation/reporting layer for cursor-capable backends, and downgrade D/E/exactly-once claims before acceptance. As written, G is a good product and policy framework, but not a delivery guarantee. Its value becomes concrete when paired with cursor replay, where the backend durability model actually supports reconnect backfill with bounded, explainable degradation.