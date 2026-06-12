## Review: Pattern C

Pattern C is much more honest than the naive version of this design, but it still should not be accepted as a standalone answer to “end-to-end at-least-once.” It is a durable server-side substrate. The real end-to-end guarantee only exists when combined with Pattern A-style client acknowledgements and careful client ack semantics.

### 1. Does The Guarantee Hold?

Partially.

The RFC correctly admits that stock Pattern C advances checkpoints on writer flush, not client receipt. That means the core silent-loss window remains: router flush succeeds, checkpoint advances, client crashes before reading or before application processing. This is not end-to-end at-least-once.

The stronger claim holds only under all of these conditions:

- `per-subscriber` isolation is enabled.
- The client is patched to send per-message acks.
- The client sends the ack only after the application has processed or durably accepted the event, not merely after the transport library decoded it.
- Checkpoint commits are fenced and monotonic under failover.
- Hook timeout delivery is cancellable, not abandoned.
- Resume identity is stable or token-carried.
- Retention and checkpoint TTL outlive the promised resume window.

The default `shared` mode is not at-least-once per client. The RFC admits the mid-batch disconnect hole: the router eventually drops the stuck subscriber so the shared prefix can advance, and that subscriber loses the unconfirmed suffix. That is explicit, but it means the default class should not be marketed as at-least-once, even with qualifiers.

One concrete bug: the startup validation says `inactive_ttl >= resume_window` should warn, but the earlier failure-mode text says the dangerous case is `inactive_ttl < resume_window`. The latter is the correctness risk, especially for broker-native checkpoints whose durable consumer may be the only stored position.

### 2. Backend Adaptability

Mostly realistic, with two caveats.

The RFC is strong on separating log/cursor systems from delete-on-ack queues. It correctly rejects durable mode for NATS core and Redis Pub/Sub, requires Redis Streams plus `XADD`, rejects Kafka per-client consumer groups, and treats Kafka/Kinesis/Event Hubs as prefix-commit systems with head-of-line blocking.

But several “Pattern C supports this” cases are really Pattern B or Pattern A:

- Kafka, Kinesis, and Event Hubs with external checkpoints are cursor replay systems. That is Pattern B with a router-owned checkpoint store.
- SQS and RabbitMQ do not have historical replay; they are Pattern A-style ack/delete windows, not durable per-subscription checkpoints.
- Google Pub/Sub is correctly rejected for per-client subscriptions, but then it is not really Pattern C except as an ack-window backend.
- Redis Streams support is plausible but not backward-compatible with today’s Redis EDFS semantics, because `PUBLISH` to Pub/Sub and `XADD` to Streams are different products operationally.

The degradation story is non-silent in intent, but it will only stay non-silent if the capability class is surfaced at startup, subscription start, and client negotiation. Logging alone is not enough.

### 3. Engine, Protocol, And Client Scope

The scope is correctly classified as XL. This is not a router-only change.

Hidden or easily underestimated work includes:

- `graphql-go-tools` must expose per-subscriber delivery results instead of discarding flush failures.
- Trigger keying must change to include per-client identity for `per-subscriber`, intentionally defeating trigger dedup.
- Router must coordinate an engine release and `go.mod` pin bump.
- WebSocket ack is a non-standard protocol extension requiring patched clients.
- SSE ack requires a side-channel endpoint.
- Redis durable support requires publish-path changes, not only subscribe-path changes.
- External checkpoint stores need leasing/fencing, schema, GC, observability, and operational documentation.

The RFC is honest about much of this. The remaining risk is that “client ack” is underspecified: the protocol frame alone does not prove application processing unless the SDK contract makes ack timing explicit.

### 4. Top Strengths

1. It correctly identifies the shared-trigger optimization as incompatible with true per-client durability.
2. The backend matrix is materially better than a generic “durable consumer everywhere” claim.
3. It has the right fail-closed instinct: refuse on checkpoint load errors, do not restart from “now.”

### 5. Top Weaknesses

1. Pattern C alone still has the flush-versus-receipt loss window.
2. The default `shared` mode is not per-client at-least-once and may confuse operators despite the RFC’s caveats.
3. The cost is very high: engine changes, client protocol extensions, per-subscriber broker resources, and external state.

### 6. Relationship To Other Patterns

Pattern C is not standalone. It is a foundation for Pattern A when true client-receipt acknowledgement is required. On Kafka/Kinesis/Event Hubs it overlaps heavily with Pattern B, because external checkpoints plus seek are cursor replay. The default shared mode is close to Pattern D plus restart-survivable checkpointing. Pattern G should eventually negotiate and report the actual class, but G does not make C correct by itself.

### 7. Verdict

Scores:

- correctness: 3/5
- feasibility: 2/5
- backend_adaptability: 3/5
- value_for_effort: 2/5

Recommendation: **MERGE-WITH-A**

Pattern C should not ship as the primary at-least-once RFC. Keep its durable per-subscriber checkpoint machinery as the server-side substrate, but merge it with Pattern A so checkpoint advancement can be gated on real client acknowledgement. Without that, the design remains restart-survivable flush-at-least-once, not end-to-end at-least-once. Pattern B should be reused for cursor-oriented backends rather than forcing all of them through the heavier Pattern C framing.