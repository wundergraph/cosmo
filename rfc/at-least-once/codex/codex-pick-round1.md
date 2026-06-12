Build **D first**, but do not sell it as end-to-end at-least-once. Build it because it creates the missing engine contract: per-subscriber delivery outcomes flowing back from `graphql-go-tools` to the adapter. Without that, A, C, and honest ack/commit behavior are all hand-waving. Its guarantee is only **at-least-once relative to successful socket flush**: bytes accepted by the kernel/TCP buffer, not client application processing. That is still the right first cut because it fixes the current JetStream “ack even on failure” bug and gives Cosmo the substrate for stronger modes.

The end-state should be **B as the product anchor, with G as the policy/reporting layer**. Cursor/resume is the best default architecture for heterogeneous brokers because it uses the broker’s retained log instead of making the router a database. Kafka, JetStream, Redis Streams, Kinesis, Event Hubs, and Pub/Sub all have position primitives; surface them as signed opaque cursors, emit SSE `id:`, accept WS resume tokens, replay from cursor, then go live. The guarantee is **at-least-once across reconnect/restart gaps within retention**, not proof of client processing. If the client only stores the cursor after applying the event, B is very strong operationally; if it stores cursors on receipt, the boundary is receipt/parsing, not business processing. For true processing acknowledgement, layer A later.

Sequence:

1. **D:** engine/router delivery-result contract; JetStream no-hooks ack/nak on flush success; explicit metrics for stall/redelivery.
2. **B:** signed cursor envelope, backend positions, `SubscribeFrom`, SSE `id:` / `Last-Event-ID`, WS resume extension, `CURSOR_EXPIRED`.
3. **G:** capability negotiation and `extensions.delivery` reporting once there are real mechanisms underneath. G first is just an elaborate way to say “at-most-once.”
4. **A selectively:** client ack for JetStream, SQS, RabbitMQ, Redis Streams, Pub/Sub where receipt acknowledgement matters. This is the only path that moves the boundary from socket write/resume to client receipt.
5. **C only for premium isolation/HA:** per-subscription durable consumers/checkpoints where customers accept N broker consumers and external state.
6. **E only for no-cursor backends:** short in-memory replay window for NATS core / Redis Pub/Sub; no durable-store variant unless a customer cannot move to a log backend.
7. **F as SDK/docs pattern:** useful for state convergence, not stream durability.

Do **not** build C as the first-class answer. It is expensive, breaks trigger dedup, requires external checkpoint semantics, and still does not close flush-vs-processing without A. Do **not** build durable E as a general solution; if you are willing to run a durable replay store, run a real log backend and use B. Do **not** ship F as “at-least-once”; it is a backfill/state-convergence recipe. Fold D into the substrate, G into policy/observability, F into SDK guidance, and E into an explicit degraded-mode component.

Forced single best pick: **B, cursor/resume replay**. It best matches Cosmo’s multi-backend future, keeps router state low, gives an honest degradation story, and works especially well with SSE. But the first engineering milestone should still be D because the engine boundary is currently too fire-and-forget to support the rest cleanly.

PRIMARY PICK: B cursor/resume replay; SEQUENCE: D → B → G → selective A → optional C/E → F as SDK/docs; DROP/FOLD: drop standalone C-first and durable-E-generalization, fold D/G/F/E into substrate/policy/docs/degraded-mode components.