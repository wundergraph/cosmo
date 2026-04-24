# graphql-transport-ws proxy scenarios

Protocol: [graphql-transport-ws](https://github.com/enisdenjo/graphql-ws/blob/master/PROTOCOL.md) (subprotocol `graphql-transport-ws`)

These scenarios verify the router's behavior as a WebSocket proxy for the
modern graphql-transport-ws protocol. Both the client and the upstream
subgraph speak this protocol. The router remaps subscription IDs between
client and upstream.

The test harness must register a backend named `"subgraph-a"`.

## Connection phase (`connect.go`)

| Scenario | Asserts |
|-|-|
| `DuplicateConnectionInitClosesSocket` | A second `connection_init` after ack terminates the connection (close 4429 when a close frame is sent; TCP drop also accepted) |
| `SubscribeBeforeAckClosesSocket` | Sending `subscribe` without a prior `connection_init` terminates the connection (close 4401 when a close frame is sent; TCP drop also accepted) |

## Ping/pong (`pingpong.go`)

| Scenario | Asserts |
|-|-|
| `PingReceivesPongResponse` | A protocol-level `{"type":"ping"}` receives a `{"type":"pong"}` response |
| `PongCarriesPingPayload` | The pong message echoes the ping's `payload` field verbatim |

## Subscribe lifecycle (`scenarios.go`, `lifecycle.go`)

| Scenario | Asserts |
|-|-|
| `SubscribeRoundTrip` | Full lifecycle: init/ack, subscribe, backend receives remapped ID, `next` forwarded with original client ID, `complete` forwarded |
| `SubscribeWithVariablesAndOperationName` | Subscribe payload containing `variables` and `operationName` is forwarded to the backend; `next` and `complete` round-trip correctly |
| `MultipleNextMessagesBeforeComplete` | Three `next` messages are forwarded in order before `complete` |
| `DuplicateSubscriptionIDClosesSocket` | A second `subscribe` with an already-active ID closes the connection with 4409 and reason `"Subscriber for 1 already exists"` |
| `ClientCompleteStopsSubscription` | Client-sent `complete` is forwarded to the backend with the remapped upstream ID |
| `ServerErrorTerminatesOperation` | Backend `error` message is forwarded to the client with the original ID and payload |
| `MultipleConcurrentSubscriptions` | Two subscriptions (IDs `"1"` and `"2"`) on one connection receive independent `next` and `complete` messages with correct ID mapping |
