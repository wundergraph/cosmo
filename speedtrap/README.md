# speedtrap

Black-box integration test harness. Define scenarios that script interactions against a target, assert behavior, and report results through Go's `testing.T`.

## Writing Scenarios

A `Scenario` has a name and a `Run` callback that receives an `*S` — a test context with methods for creating connections and reporting failures. `S` implements the same interface as `testing.T`, so testify assertions work directly.

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

## `testing.T` Compatibility

`S` mirrors the failure-reporting interface of `testing.T` (`Fail`, `FailNow`, `Error`, `Errorf`, `Fatal`, `Fatalf`, `Log`, `Logf`). This means libraries like testify and jsonassert that accept `testing.T` work with `S` out of the box — no adapters needed.

## Running in Go Tests

`RequireScenario` runs a scenario and fails the test immediately if it doesn't pass. `AssertScenario` reports failures without stopping the test.

```go
func TestScenarios(t *testing.T) {
    cfg := speedtrap.HarnessConfig{
        TargetAddr: "ws://localhost:8080/graphql",
    }
    for _, s := range myScenarios {
        t.Run(s.Name, func(t *testing.T) {
            speedtrap.RequireScenario(t, cfg, s)
        })
    }
}
```

## Testing Proxies

Script conversations between a client and mock backends with a proxy in between, verifying that messages, close codes, and subprotocol negotiations are forwarded correctly.

```go
var EchoRoundTrip = speedtrap.Scenario{
    Name: "echo round-trip",
    Run: func(s *speedtrap.S) {
        c, err := s.Client(speedtrap.WithClientSubprotocol("graphql-transport-ws"))
        require.NoError(s, err)

        b, err := s.Backend("default").Accept()
        require.NoError(s, err)

        require.NoError(s, c.Send(`{"type":"ping"}`))

        msg, err := b.Read()
        require.NoError(s, err)
        require.Equal(s, `{"type":"ping"}`, msg)
    },
}
```


## Testing WebSockets

Connect directly to a WebSocket server (no mock backends) to verify its behavior end-to-end.

```go
var Handshake = speedtrap.Scenario{
    Name: "handshake",
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

