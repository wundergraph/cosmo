## Pattern B Review: Cursor / Resume-Token Replay

Pattern B is a strong RFC after the revisions: it correctly abandons the unsafe “replay then splice into shared trigger” idea, admits the engine interface work, and limits the guarantee to retained log backends. But its headline “at-least-once” still needs tightening. This is not an end-to-end receipt guarantee; it is replay-from-client-checkpoint within retention.

### 1. Does The Claimed Guarantee Hold?

Mostly, but only under stricter conditions than the RFC headline implies.

For exact cursor backends, the core seek-then-live design can provide no-gap replay after reconnect if the cursor represents the last event the client has durably processed, not merely the last event the client received. Without client ack, the router cannot know that distinction. A WS client that persists the cursor before processing the payload can crash and resume after the event, losing it. Stock `EventSource` is worse: browser-managed `Last-Event-ID` advances around event dispatch, not after application-level durable processing. So the guarantee is “at-least-once to a correctly checkpointing resume-aware client,” not end-to-end at-least-once to application processing.

Remaining loss/overclaim areas:

- `CURSOR_EXPIRED` is honest, but it means permanent loss beyond retention.
- Timestamp fallback is correctly downgraded, but should not be marketed as at-least-once.
- Multi-partition Kafka cursors are under-specified. A per-event cursor must be a delivery-progress vector, not a fetched high-watermark vector, or it can skip records from other partitions.
- JetStream replay assumes replayable stream retention. Existing Cosmo config exposes `streamName`, not retention policy. `WorkQueuePolicy` or aggressive interest-based deletion can invalidate the replay story after ack.
- WS half-open detection remains weak; reconnect may happen late, increasing retention pressure and duplicate live/replay overlap.

### 2. Backend Adaptability / Degradation

The RFC is directionally realistic and unusually explicit about degradation, but a few backend claims need sharper boundaries.

Good claims:

- NATS core and Redis Pub/Sub are correctly downgraded to at-most-once.
- Kafka exact `(partition, offset)` replay is the right primitive.
- Redis Streams requires a real topology/publisher migration; the RFC calls that out.
- SQS and RabbitMQ classic are correctly not cursor-replay fits.

Problems:

- JetStream must validate stream retention semantics, not just `streamConfiguration` presence. A stream-backed subject is not automatically a durable replay log suitable for arbitrary client resume.
- Google Pub/Sub snapshot seek is oversimplified. Snapshots are subscription-level state and seeking affects a subscription; using them as per-client cursors likely requires ephemeral subscriptions or maintained snapshots, breaking the RFC’s “cursor only, no router state” posture.
- Kafka compaction deserves more attention. Offset seek may land on deleted compacted records; that is fine if detected as expired/gapped, but not if treated as contiguous replay.
- Redis Streams `XREAD` from `<lastId>` is plausible, but trimming checks must be exact enough to avoid silently starting at the earliest retained entry.
- Event Hubs/Kinesis claims are plausible but non-shippable scope; they should remain illustrative, not part of the RFC’s implementation promise.

The degradation story is mostly non-silent, which is a major strength.

### 3. Engine / Protocol / Client Feasibility

Feasible, but L/XL is the honest estimate. This is cross-repo work:

- `graphql-go-tools` exported subscription writer/updater interfaces change.
- Router WS/SSE writers change.
- PubSub adapter contracts change.
- Cursor metadata must flow through `StreamEvent`, hooks, resolver fan-out, and flush.
- Optional composition/proto changes may be needed for per-field policy.
- Client documentation and likely SDK examples are required, because WS clients must persist and return cursors correctly.

The RFC scopes this better than most patterns, especially by identifying that resuming clients require their own trigger. The hidden hard part is not the cursor codec; it is making the engine route resume-trigger creation reliably without accidental shared-trigger attachment, then proving no partition-vector advancement bug exists.

### 4. Strengths

1. Correct architectural fit for log-backed systems: Kafka, JetStream with replayable retention, Redis Streams.
2. Preserves current shared-trigger fan-out for fresh subscriptions.
3. Excellent degradation posture: explicit `CURSOR_EXPIRED`, `delivery.class`, authz mode, and non-seekable reporting.

### 5. Weaknesses

1. No client receipt ack means the guarantee depends on client checkpoint discipline; stock SSE auto-resume is not true application-level at-least-once.
2. Resumed subscriptions create one broker reader per client for the lifetime of the subscription, which can be severe during reconnect storms.
3. Backend edge cases remain: JetStream retention policy, Kafka vector cursors/compaction, Pub/Sub snapshot impracticality.

### 6. Relationship To Other Patterns

Pattern B is a standalone mechanism for retained log backends and a foundation for Pattern G capability negotiation. It complements Pattern D, which should still ship first to fix current ack timing bugs. It is not a substitute for Pattern A when application-level receipt is required, and not a substitute for Pattern E on ephemeral backends. Pattern C is stronger for per-client durable state but much more expensive.

### 7. Verdict

Scores:

- correctness: 3
- feasibility: 3
- backend_adaptability: 4
- value_for_effort: 4

Recommendation: **KEEP**

Keep Pattern B, but narrow the guarantee language: “at-least-once replay within retention for exact-cursor log backends, assuming the client checkpoints only after processing.” Require explicit validation/reporting for JetStream retention policy, Kafka vector cursor semantics, and Redis trim boundaries. Treat D as a prerequisite sequencing item and G as the product negotiation layer, but do not merge B into them; it is a distinct, valuable mechanism with clear backend scope.