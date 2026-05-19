# graphql-ws (subscriptions-transport-ws) proxy scenarios

Protocol: [subscriptions-transport-ws](https://github.com/apollographql/subscriptions-transport-ws/blob/master/PROTOCOL.md) (subprotocol `graphql-ws`)

These scenarios verify the router's behavior as a protocol-translating
proxy. The client speaks the legacy `graphql-ws` protocol while the
upstream subgraph speaks the modern `graphql-transport-ws` protocol.
The router translates message types in both directions:

- Client `start` becomes upstream `subscribe`
- Client `stop` becomes upstream `complete`
- Upstream `next` becomes client `data`
- Upstream `error` becomes client `data` with `{"errors":[...]}` payload

The router may interleave `ka` (keep-alive) messages at any time;
scenarios use a `readSkippingKA` helper to drain them transparently.

The test harness must register a backend named `"subgraph-a"`.

## Connection phase (`connect.go`)

| Scenario | Asserts |
|-|-|
| `ConnectionInitAndAck` | `connection_init` receives `connection_ack` with the legacy `graphql-ws` subprotocol |

## Operation lifecycle (`lifecycle.go`)

| Scenario | Asserts |
|-|-|
| `StartDataCompleteRoundTrip` | Full lifecycle: client `start` is translated to upstream `subscribe`, upstream `next` arrives as client `data`, upstream `complete` arrives as client `complete` |
| `MultipleDataMessagesBeforeComplete` | Three upstream `next` messages arrive as three `data` messages on the client, in order |
| `StopCancelsSubscription` | Client `stop` is translated to upstream `complete` with the remapped upstream ID |
| `ServerErrorInDataPayload` | Upstream `error` is delivered to the client as a `data` message with `{"errors":[...]}` in the payload (per the subscriptions-transport-ws convention) |
