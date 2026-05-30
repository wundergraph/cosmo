**Review: Pattern F**

Pattern F is honest about its core tradeoff: it does **not** restore at-least-once event delivery. It restores state convergence for a narrow class of subscriptions: state-shaped payloads backed by a complete, queryable outbox/changelog with aligned `idempotencyKey` and monotonic `since`. Within that scope, the guarantee mostly holds, but the RFC should avoid calling this “at-least-once” except as “at-least-once recovery of persisted state via backfill.”

Remaining silent-loss/staleness windows:

- If a live event is dropped while the client remains connected, no reconnect occurs, so no backfill is triggered. The client can remain silently stale indefinitely unless the SDK periodically reconciles or uses heartbeats/version checks.
- If the client advances `lastSeen` before durably applying the update locally, a crash can skip state. The SDK contract must require “apply first, persist watermark second.”
- The lower-boundary gap is correctly identified, but “safety margin” is hand-wavy for non-contiguous cursors like ULIDs unless the backfill query supports time/window overlap rather than arithmetic decrement.
- Key misalignment remains catastrophic and largely outside router enforcement. The proposed lint cannot prove the live and query resolvers use the same key space.
- “Snapshot reset” must be mandatory when retention is exceeded; otherwise truncated backfill is silent state loss.

Backend adaptability is directionally right because F barely depends on the broker. But the backend table overstates some key-source claims. Broker-assigned positions such as JetStream stream sequence, Kafka offset, Redis auto entry ID, Pub/Sub `messageId`, Kinesis sequence number, and Event Hubs offset are not generally usable as the outbox dedup key under commit-then-publish, because they are assigned after publish and are not available when the outbox row is committed. Using them requires a post-publish outbox update, which reintroduces the lower-boundary race. The RFC should distinguish app-assigned IDs (`Nats-Msg-Id`, Kafka record key, AMQP `message-id`, SQS FIFO dedup ID, explicit outbox ID) from broker-assigned offsets. Also, SQS Standard and FIFO should be split; the current row mixes them.

Degradation is mostly non-silent in prose, but not in runtime behavior. A non-participating client silently gets today’s at-most-once semantics. A participating client with a bad resolver, expired retention, or missing outbox rows can still fail silently unless the SDK requires explicit backfill completeness signals.

Engine and protocol scoping is accurate. The RFC correctly withdraws router-stamped `extensions.cosmo`, SSE `Last-Event-ID`, and content-hash claims. Primary path needs no `graphql-go-tools` change, no router wire change, and no broker adapter change. The hidden cross-repo work is only in the deferred engine-stamped alternative, and the RFC calls that L effort. The honest miss is product effort: the “S router” story is true, but the deliverable that matters is a client SDK plus application templates/tests. Without those, this is mostly documentation.

Top strengths:

1. Very low router operational risk: no held broker acks, no per-subscriber consumers, no HA state.
2. Works across NATS core, Redis Pub/Sub, SQS Standard, and RabbitMQ because durability is moved to the app datastore.
3. Correctly documents its ceiling: state convergence, not event fidelity.

Top weaknesses:

1. Does not solve the original “end-to-end at-least-once event delivery” problem.
2. Depends on application discipline that Cosmo cannot strongly verify.
3. Can create reconnect thundering herds and expensive per-client backfills.

Relationship to other patterns: F is standalone only for state-convergent subscriptions. It is not a foundation for A/B/C/D; it is an application-level fallback. It pairs best with D, because D fixes real broker ack bugs while F gives cheap recovery for app-state use cases. For log backends, B is the stronger native solution. For transient streams, E or A is required.

Scores:

- correctness: 3/5
- feasibility: 4/5
- backend_adaptability: 4/5
- value_for_effort: 3/5

Recommendation: **MERGE-WITH-D**

Pattern F is useful, but it should not stand as an at-least-once delivery RFC. Merge it with Pattern D as the application-state recovery layer: D improves the actual router/broker delivery semantics, while F provides cheap reconnect convergence where applications already maintain an outbox. Keep F’s scope gates loud, remove broker-assigned key overclaims, and require explicit backfill completeness/error signaling in the SDK.