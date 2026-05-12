# speedtrap

Black-box scenario harness for WebSocket services. Ships with scenarios for GraphQL subscriptions (`graphql-transport-ws` and `graphql-ws`) so the same suite can be pointed at any gateway (Cosmo router, Apollo, Hive, or a new implementation) and asserted against at the wire level.

Benchmarking is planned on the same harness, so the suite doubles as a correctness check and a performance comparison across implementations.

## Mental Model

A scenario controls **both sides** of the target under test:

- **Client side**: a WebSocket client that speedtrap dials against `TargetAddr`.
- **Backend side**: one or more mock subgraph backends that the target connects to, registered in `HarnessConfig.Backends`.

The target sits in the middle. Usually that's a GraphQL router proxying subscriptions to subgraphs, but it can also be a plain WebSocket server with no backends at all.

```
  speedtrap client  -->  [ target under test ]  -->  speedtrap backends
        (c)                (router, gateway,                (b)
                           or direct WS server)
```

`Run` is written as a sequence of reads and writes on both sides, asserting that the target forwarded, transformed, or rejected messages correctly.

## Concepts

| Type | Role |
|-|-|
| `Scenario` | A named test: `{Name, Run func(*S)}`. |
| `S` | Per-scenario context. Satisfies the failure-reporting interface of `testing.T`, so testify works on it directly. Creates client connections via `s.Client(...)` and fetches mock backends via `s.Backend(name)`. |
| `ConnectionHandle` | A WebSocket connection with `Read`, `Send`, `ReadControl`, `SendClose`, `Drop`. Returned by both `s.Client()` (client side) and `backend.Accept()` (backend side). |
| `HarnessConfig` | Wires a scenario to a target: `TargetAddr` plus a map of mock `Backends`. |

## Writing a Scenario

```go
var Handshake = speedtrap.Scenario{
    Name: "connection_init / connection_ack",
    Run: func(s *speedtrap.S) {
        c, err := s.Client(speedtrap.WithClientSubprotocol("graphql-transport-ws"))
        require.NoError(s, err)

        require.NoError(s, c.Send(`{"type":"connection_init"}`))

        msg, err := c.Read()
        require.NoError(s, err)
        require.JSONEq(s, `{"type":"connection_ack","payload":null}`, msg)
    },
}
```

## Running in Go Tests

`RequireScenario` runs a scenario and fails the test if it doesn't pass. `AssertScenario` reports failures without stopping the test.

```go
func TestScenarios(t *testing.T) {
    cfg := speedtrap.HarnessConfig{
        TargetAddr: "ws://localhost:8080/graphql",
        Backends:   map[string]*speedtrap.Backend{"subgraph-a": backendA},
    }
    for _, sc := range myScenarios {
        t.Run(sc.Name, func(t *testing.T) {
            speedtrap.RequireScenario(t, cfg, sc)
        })
    }
}
```

## Targets With Backends (Router or Gateway)

When the target is a router, it opens its own connections to the subgraphs you register in `HarnessConfig.Backends`. The scenario drives the client, accepts each mock backend's side of the conversation, and asserts that the target routed messages correctly.

```go
var EchoRoundTrip = speedtrap.Scenario{
    Name: "echo round-trip",
    Run: func(s *speedtrap.S) {
        c, err := s.Client(speedtrap.WithClientSubprotocol("graphql-transport-ws"))
        require.NoError(s, err)

        b, err := s.Backend("subgraph-a").Accept()
        require.NoError(s, err)

        require.NoError(s, c.Send(`{"type":"ping"}`))

        msg, err := b.Read()
        require.NoError(s, err)
        require.Equal(s, `{"type":"ping"}`, msg)
    },
}
```

`s.Backend(name)` panics if `name` wasn't registered in `HarnessConfig.Backends`. The set of backend names a scenario uses is part of its contract with whoever runs it.

## Targets Without Backends (Direct WebSocket)

If the target is a WebSocket server you want to test end-to-end (no proxying), omit `Backends` and drive only the client.

```go
var DirectHandshake = speedtrap.Scenario{
    Name: "direct handshake",
    Run: func(s *speedtrap.S) {
        c, err := s.Client(speedtrap.WithClientSubprotocol("graphql-transport-ws"))
        require.NoError(s, err)

        require.NoError(s, c.Send(`{"type":"connection_init"}`))

        msg, err := c.Read()
        require.NoError(s, err)
        require.JSONEq(s, `{"type":"connection_ack","payload":null}`, msg)
    },
}
```

## Shipped Scenarios

`scenarios/graphql/` contains reusable scenario suites for `graphql-transport-ws` and `graphql-ws`, plus the subgraph schemas they expect:

- `scenarios/graphql/subgraph-a.graphqls`: the default subgraph. Every shipped scenario uses it.
- `scenarios/graphql/subgraph-b.graphqls`: a second subgraph, present in the composed graph to support future multi-subgraph scenarios. Not currently exercised by any shipped scenario.

To run the shipped suites, the consuming test harness must register a backend named `subgraph-a` in `HarnessConfig.Backends`.

## testing.T Compatibility

`S` implements the failure-reporting surface of `testing.T` (`Fail`, `FailNow`, `Error`, `Errorf`, `Fatal`, `Fatalf`, `Log`, `Logf`). Libraries that accept `testing.T`, including testify and jsonassert, work against `s` with no adapter.

## Running

During Cosmo development, the scenarios can be run against the Cosmo router via `router-tests/subscriptions/speedtrap_test.go` (`TestSpeedtrapScenarios`). That test stands up the router with a real subgraph HTTP server backed by a speedtrap mock, then runs each scenario. It is part of the integration test suite and thus runs in CI alongside the rest of those tests.
