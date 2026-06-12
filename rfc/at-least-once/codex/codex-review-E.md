**Pattern E Review**

The RFC is now much more honest than the naïve router-buffer version, but its claimed guarantee should be narrowed further. It does **not** restore end-to-end at-least-once delivery. It restores **same-router, same-trigger, within-window replay of frames the router actually captured**. That is useful, but weaker than the title implies.

The biggest remaining correctness issue is the gap between “client disconnected” and “router continues producing frames for that subscriber.” In default `cursor_only` warm-keep, a sole subscriber that disconnects does **not** get frames produced during the gap, because no resolved frames are captured for an absent subscriber. That means the flagship no-replay backends, NATS core and Redis Pub/Sub, only benefit when some live path keeps the trigger reading and the router is configured to keep capturing for the detached subscriber. Otherwise the client gets an explicit gap, not at-least-once. Explicit is better than silent, but it is not the advertised guarantee.

There is also a race around capture-vs-flush semantics. The RFC says the writer stamps, captures, then writes. If the socket write fails, the frame may be in the ring even though it was never delivered, which is acceptable as duplicate/redelivery behavior on reconnect. But if the subscriber is torn down before a frame reaches this wrapper, no frame exists. The guarantee therefore depends on precise teardown ordering between disconnect detection, engine subscription removal, warm ring retention, and replay reassociation. That needs to be specified as a state machine, not prose.

Backend adaptability is directionally right but still overstates the “backend-agnostic” value. For NATS core and Redis Pub/Sub, the buffer can only replay what the router observed; broker/client slow-consumer drops before the adapter reads are still unrecoverable. For Kafka as currently implemented, Pattern E is a poor fit because groupless reset-to-now skips broker backlog on trigger rebuild or restart. JetStream, Kafka, Redis Streams, Kinesis, Event Hubs, and Google Pub/Sub are better served by Pattern B-style broker cursors. SQS and RabbitMQ fit ack/redelivery better than replay-buffer semantics, but they are not supported today. Kinesis and Event Hubs checkpointing are correctly flagged as coarse and not per-message ack compatible.

The engine and wire-protocol scope is now mostly honest. This is not a router-only patch: it needs `graphql-go-tools` changes for single-subscriber replay, subscription identity exposure, replay/live serialization, and post-resolve writer stamping. It also changes downstream WS/SSE/multipart behavior, adds resume-token client behavior, requires SDK support for durable token persistence, and needs router config/metrics. The `L` estimate for in-process mode is plausible but optimistic at 6-8 weeks because concurrency, replay ordering, engine API review, and HA/stickiness testing are all load-bearing. The Redis durable-store variant is effectively a new log of resolved frames and should be treated as a separate XL project.

Top strengths:

1. Correctly identifies that replay must store **post-resolve frames**, not raw broker events.
2. Makes degradation visible with gap signaling instead of pretending old clients or expired windows are safe.
3. Preserves broker-side shared trigger fan-out for the live path, which matters for Cosmo scale.

Top weaknesses:

1. The useful guarantee collapses for sole subscribers unless `frame_capture` is enabled, which means resolving for absent clients.
2. In-process replay is weak under restart, rolling deploys, non-sticky load balancing, and trigger rebuilds.
3. It duplicates broker-log functionality on backends where Pattern B is simpler, more durable, and less memory-intensive.

Relationship to the other patterns: Pattern E is not a general standalone answer. It is a fallback mechanism for no-cursor/no-replay backends, a partial complement to Pattern F for explicit client backfill, and mostly redundant with Pattern B on log backends. It is not a subset of A because it lacks client receipt ack, and not a substitute for C because it has no durable per-subscriber checkpoint. Product-wise it belongs under Pattern G as one negotiated delivery tier: `at-least-once-window`, not “at-least-once.”

Scores: correctness `3/5`, feasibility `3/5`, backend_adaptability `3/5`, value_for_effort `3/5`.

Recommendation: **MERGE-WITH-G**.

Pattern E is valuable only when presented as a negotiated, explicitly degraded short-window replay mode for backends that cannot seek or replay. Kept alone, it invites overclaiming and expensive engine work for a narrow guarantee. Under Pattern G, it becomes the right fallback tier for NATS core and Redis Pub/Sub, while log backends use Pattern B and long-disconnect/mobile cases pair with Pattern F.