# Router bugs discovered by speedtrap scenarios

These are known-failing scenarios that assert spec-correct behavior the router
does not yet implement. Each entry lists the affected scenarios and the expected
fix.

## Missing ack timeout

**Failing scenarios (both protocols):**
- `BackendNeverAcksConnectionInitTimesOut`

When the backend accepts the WebSocket connection but never sends
`connection_ack`, the client receives no message. The client should receive an
error for the pending subscribe, equivalent to an unreachable subgraph.
