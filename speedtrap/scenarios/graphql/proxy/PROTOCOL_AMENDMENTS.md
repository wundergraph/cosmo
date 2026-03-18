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

# graphql-transport-ws

Deviations from the graphql-transport-ws spec and reference implementation
(graphql-ws v6.0.7).

## Server sends complete after error

**Spec behavior:** An `error` message terminates the operation — "no further
messages will be sent" for that subscription ID.

**Observed behavior (graphql-ws reference implementation v6.0.7):** After
sending an `error` for a subscription, the server also sends a `complete` for
the same ID. This contradicts the spec but is consistent across the reference
implementation.

**Speedtrap expectation:** The router follows the reference implementation and
sends both `error` and `complete` for the affected subscription. Scenarios that
involve server errors on multiplexed connections must accept both messages
(in any order) without treating the extra `complete` as a failure.

**Scenario:** `OneSubscriptionErrorDoesNotAffectAnother`

**Rationale:** The router proxies the upstream behavior faithfully. Since the
graphql-ws reference implementation (which most backends use) sends
complete-after-error, the router must forward it rather than suppress it. This
is a known spec violation tracked upstream.
