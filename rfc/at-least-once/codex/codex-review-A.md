## Pattern A Review

**1. Does the claimed guarantee hold?**

Mostly, but only in a narrow envelope: ack-capable client, `graphql-transport-ws`, native per-message-ack backend, same router instance or broker redelivery independent of instance identity, and `ack_policy: all`. In that envelope, the design does close the current flush-vs-receipt gap by moving broker ack behind a client ack.

The RFC correctly admits major remaining windows: lost client ack before router broker-ack causes duplicates; router crash relies on broker redelivery; shared triggers cannot selectively ack one subscriber and redeliver to another; JetStream failover is broken by today’s per-instance durable naming. The biggest overclaim is “per-subscriber at-least-once” as a general statement. Under `quorum`/`any`, slow subscribers can be sacrificed. Under `silent_downgrade_after`, a buggy ack-capable client can be downgraded to at-most-once after already negotiating stronger delivery; that is not “never silently” unless the client receives an explicit terminal downgrade/error and the field policy permits it. “Client receipt” also means only “client sent ack”; Cosmo cannot prove application processing unless the client library defines ack-after-processing semantics.

The “effectively exactly-once” language is too optimistic. JetStream double-ack confirms the broker observed the ack; `Nats-Msg-Id` dedups publisher retries, not arbitrary consumer redelivery outside the window. SQS FIFO and Pub/Sub EOS still require careful client dedup and bounded windows. I would phrase this as at-least-once plus idempotency support, not exactly-once.

**2. Backend adaptability / degradation**

The matrix is unusually honest, but several entries are more “future ecosystem roadmap” than Pattern A support. SQS, Google Pub/Sub, RabbitMQ, Redis Streams, Kinesis, and Event Hubs are not supported by EDFS today, so their rows imply new adapters, auth/config surfaces, local/integration test infrastructure, and operational docs. The RFC calls this out, which is good, but the product claim should not read as “Pattern A supports these” until those adapters exist.

Kafka/Kinesis/Event Hubs are correctly downgraded into cursor/checkpoint behavior, effectively Pattern B with ack-driven commits. Kafka in particular is not realistic as a simple adaptation: today Cosmo is groupless and reset-to-now; switching to consumer groups changes restart semantics, rebalance behavior, and instance ownership. With shared triggers, one slow subscriber pins the committed offset for all.

NATS core and Redis Pub/Sub are correctly marked at-most-once only. JetStream is a native fit only for single-instance or stable durable identity; today’s per-router durable consumer naming defeats cross-instance recovery.

**3. Engine / protocol / client feasibility**

The RFC is correct that this cannot be done in `router/pkg/pubsub` alone. It requires cross-repo `graphql-go-tools` work: delivery id threading, post-filter subscriber reporting, and per-subscriber delivery results. That is the real critical path and a major feasibility risk.

The WebSocket extension is feasible for modern `graphql-transport-ws`, but it needs client-library changes or a Cosmo-specific client layer. SSE/multipart ack via side-channel POST is much less attractive: sticky routing, signed stream keys, replayed affinity cookies, and peer routing/shared ack bus are all nontrivial. The RFC’s XL estimate is honest for the minimum viable path; full backend matrix is XL+.

**Top strengths**

1. Correctly identifies the engine contract as load-bearing rather than pretending this is an adapter tweak.
2. Gives a concrete non-silent degradation model with negotiated classes, `REJECT` vs `DOWNGRADE`, and observability.
3. Faces the shared-trigger impossibility: one broker handle cannot be acked for A and nacked for B.

**Top weaknesses**

1. Highest adoption cost: no stock client gets the guarantee without protocol/client changes.
2. Shared-trigger coupling makes the strongest mode vulnerable to one slow subscriber causing duplicates/backpressure for all.
3. HA story is incomplete, especially JetStream with current durable naming and SSE side-channel routing.

**Relationship To Other Patterns**

Pattern A is not standalone. It depends on Pattern D’s engine delivery-result contract. On Kafka/Kinesis/Event Hubs it collapses into a Pattern B-style cursor/checkpoint scheme. For cross-router restart and per-subscriber isolation it needs Pattern C. Pattern G should wrap it as one negotiated capability, but A itself should be sequenced after D.

**Verdict**

Scores: correctness **3/5**, feasibility **2/5**, backend_adaptability **3/5**, value_for_effort **3/5**.

Recommendation: **MERGE-WITH-D**

Pattern A is the strongest semantic model for true client-receipt acknowledgement, but it is not independently shippable and its minimum viable implementation is already Pattern D plus protocol, ledger, and client work. Keep the client-ack design as an optional layer after D lands, preferably WebSocket + JetStream first. Do not advance it as the primary RFC until the engine contract is accepted and the downgrade/downgrade-after-timeout semantics are tightened.