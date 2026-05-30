# RFC bundle: At-Least-Once for GraphQL Subscriptions (Cosmo Streams / EDFS)

Goal: restore end-to-end at-least-once delivery (broker → router → client) for GraphQL subscriptions built on Cosmo's EDFS,
adaptable across heterogeneous backends (NATS, Kafka, Redis, SQS, …),
allowing a backend of choice even when that yields a weaker — but explicit, never silent — guarantee.

**Start here → [`CONCLUSION.md`](./CONCLUSION.md)** — summary of all RFCs, the combined scorecard, the recommended pick, codex's independent pick, the discussion, and the final locked sequence + honest per-piece guarantees.

## Contents

- [`00-research-dossier.md`](./00-research-dossier.md) — ground truth: current EDFS architecture, code anchors, where the guarantee is lost, per-backend matrix, the 7 patterns.
- Seven competing RFCs (each authored → adversarially critiqued → revised):
  - [`rfc-A-client-ack-protocol.md`](./rfc-A-client-ack-protocol.md) — end-to-end per-message client acks.
  - [`rfc-B-cursor-resume.md`](./rfc-B-cursor-resume.md) — cursor / resume-token replay **(flagship)**.
  - [`rfc-C-durable-consumer-checkpoint.md`](./rfc-C-durable-consumer-checkpoint.md) — durable consumer + checkpoint store.
  - [`rfc-D-broker-ack-timing.md`](./rfc-D-broker-ack-timing.md) — server-only ack-timing fix **(foundation)**.
  - [`rfc-E-router-replay-buffer.md`](./rfc-E-router-replay-buffer.md) — router-side replay buffer.
  - [`rfc-F-outbox-client-dedup.md`](./rfc-F-outbox-client-dedup.md) — outbox / dedup-on-client.
  - [`rfc-G-tiered-capability-negotiation.md`](./rfc-G-tiered-capability-negotiation.md) — tiered capability negotiation (policy layer).
- [`codex/`](./codex/) — independent codex reviews per RFC, plus codex's independent pick and the discussion.

## Outcome in one line

Build the coordinated engine contract once,
ship **D** (foundation) then **B** (flagship) with a thin honest delivery-class core,
add **B + cursor-ack** for the client-processed boundary on log backends,
keep **A** selective and **G** last,
and fold **C/E/F** in as supporting components.
