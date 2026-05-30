## Pattern D Review

Pattern D’s claimed guarantee holds only in its narrowed form: **at-least-once relative to successful router flush on NATS JetStream, no hooks, no client receipt guarantee**. The RFC is unusually honest about this ceiling, and that honesty matters. It does **not** restore end-to-end at-least-once broker → client application. The remaining silent-loss window is the fundamental one: `Flush()` only proves bytes were accepted by the socket/TCP stack; a client crash after flush but before application processing is still acked and lost. This requires Pattern A.

There are also important residual races and overclaims. The mutable shared-trigger set means redelivery targets “whoever is subscribed now,” not the subscriber that failed. Departed subscribers are never satisfied; new subscribers may receive pre-join events. Under `quorum` or `any`, failed subscribers still miss events; metrics make this operationally visible, but not client-visible. The RFC should not call that non-silent from the client’s perspective. The biggest correctness concern is the v1 “option b” for init/load/resolve errors: classifying non-flushed GraphQL errors as `DeliveryFailed` can turn deterministic resolver failures into redelivery loops until `MaxDeliver` and then `Term`, stalling unrelated healthy co-subscribers. I would make “flush GraphQL error payloads and classify successful error flush as delivered” part of v1, not a follow-up.

Backend adaptability is realistic for current Cosmo only because the RFC scopes v1 to **JetStream only** and rejects Kafka/hooks at startup. That is the right call. NATS core and Redis Pub/Sub correctly degrade to unchanged at-most-once with warn/error behavior. Kafka is correctly deferred; the current groupless reset-to-now consumer cannot support commit semantics without becoming Pattern C/B territory. Redis Streams, SQS, Pub/Sub, RabbitMQ, Kinesis, and Event Hubs are discussed too hand-wavily as “map cleanly when added.” They do not all map cleanly: Pub/Sub needs ack-deadline extension while waiting on downstream delivery, RabbitMQ requeue/prefetch can reorder and thrash, SQS visibility timeouts need extension and DLQ policy, and Kinesis/Event Hubs are checkpoint-floor systems with head-of-line blocking. Since they are future backends, this is not fatal, but the matrix should say “plausible family fit,” not imply implementation confidence.

Engine and router feasibility is good but not as “surgical” as the RFC sometimes suggests. Changing `SubscriptionUpdater.Update` to return a report touches `graphql-go-tools`, router datasource plumbing, adapter tests, mocks, and module versioning. It is cross-repo work and a public Go interface change, not just an internal router patch. Existing call sites can ignore a return value, but existing implementers of the interface must be updated. No wire-protocol or stock-client changes are needed; that scope is correct. Complexity **M** for JetStream/no-hooks is credible if error-flush behavior is handled in v1; full Kafka/hooks support is rightly **L**.

Top strengths:
1. Correctly attacks the real ack-timing bug with minimal client impact.
2. Explicitly names the shared-trigger coupling, duplicate delivery, mutable subscriber set, and stall blast radius.
3. Provides concrete validation, metrics, and startup rejection for unsupported combinations.

Top weaknesses:
1. It is not end-to-end at-least-once; flush is a weak delivery boundary.
2. Shared-trigger `policy: all` can stall healthy subscribers and redeliver stale/pre-join events.
3. Current v1 error-branch handling risks poison redelivery loops unless flushed error delivery is included.

Relationship to other patterns: Pattern D is **not standalone** for the overall goal. It is a necessary server-side foundation for A, B, and parts of C, and a useful immediate JetStream correctness fix. It should precede Pattern A/B work, but should not be marketed as solving end-to-end delivery by itself.

Scores:
- `correctness`: 3/5
- `feasibility`: 4/5
- `backend_adaptability`: 2/5
- `value_for_effort`: 4/5

Recommendation: **KEEP**

Keep Pattern D as the first server-side ack-correctness increment, limited to JetStream/no-hooks and framed as “at-least-once to router flush,” not end-to-end at-least-once. Require v1 to flush GraphQL error payloads or otherwise explicitly prevent deterministic error redelivery loops, and tighten the future-backend matrix so unsupported or checkpoint-based systems do not look cleaner than they are.