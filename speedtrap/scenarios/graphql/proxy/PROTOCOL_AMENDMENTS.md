# Protocol amendments

The speedtrap proxy scenarios intentionally deviate from the reference server
implementations in several cases. This document records each deviation, the
reference behavior it replaces, and the rationale.

# subscriptions-transport-ws (graphql-ws subprotocol)

Deviations from the subscriptions-transport-ws reference server (v0.11.0).
These apply graphql-transport-ws close semantics to the legacy protocol for
consistency, safety, and lower implementation complexity.

## Unknown message types close the connection

**Reference behavior:** Returns `{"type":"error","payload":{"message":"Invalid
message type!"}}` and keeps the connection alive.

**Speedtrap expectation:** Closes the connection (mirrors graphql-transport-ws
close with 4400).

**Scenario:** `UnknownMessageTypeClosesSocket`

**Rationale:** The error-and-continue approach creates an infinite loop risk — a
misbehaving client can spam unknown messages indefinitely. Closing on unknown
types is consistent with the modern protocol and avoids this problem.

## Duplicate connection_init closes the connection

**Reference behavior:** Silently re-acks every `connection_init`, keeping the
connection alive.

**Speedtrap expectation:** The protocol layer closes with 4429 (mirrors
graphql-transport-ws "Too many initialisation requests").

**Scenario:** `DuplicateConnectionInitClosesSocket`

**Rationale:** Silently re-acking is permissive to the point of being dangerous.
A client sending repeated `connection_init` messages is either buggy or
malicious.

## Subscribe before connection_init closes the connection

**Reference behavior:** Processes the subscription without requiring a
handshake — sends data back immediately.

**Speedtrap expectation:** The protocol layer closes with 4401 (mirrors
graphql-transport-ws "Unauthorized").

**Scenario:** `SubscribeBeforeAckClosesSocket`

**Rationale:** Skipping the handshake bypasses any authentication or
authorization that may be attached to `connection_init`. The reference server's
permissiveness here is a security concern.

## Duplicate subscription ID closes the connection

**Reference behavior:** Completes the existing subscription for that ID, then
starts a new one with the same ID (replace semantics). The connection stays
alive.

**Speedtrap expectation:** Closes the connection (matches graphql-transport-ws
close with 4409 "Subscriber for <id> already exists").

**Scenario:** `DuplicateStartIDClosesSocket`

**Rationale:** Implicit replacement adds complexity and can mask client bugs. A
client reusing an active ID is almost certainly a bug. Closing is the safest
response and keeps behavior consistent across protocols.
