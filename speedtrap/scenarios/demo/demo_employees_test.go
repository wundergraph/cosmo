package demo_test

import (
	"net/http/httptest"
	"testing"

	"github.com/kinbiko/jsonassert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs"
	"github.com/wundergraph/cosmo/speedtrap"
)

// DirectServerScenarios contains scenarios that connect directly to a real
// GraphQL server (e.g. a gqlgen demo subgraph) with no mock backend.
var DirectServerScenarios = []speedtrap.Scenario{
	DirectHandshake,
	CountEmp,
}

// DirectHandshake verifies connection_init / connection_ack against a real
// GraphQL server (no mock backend). The harness ProxyAddr should point
// directly at the server's WebSocket endpoint.
var DirectHandshake = speedtrap.Scenario{
	Name: "direct server connection_init / connection_ack",
	Run: func(t *speedtrap.S) {
		c, err := t.Client(speedtrap.WithClientSubprotocol("graphql-transport-ws"))
		require.NoError(t, err, "dial")

		require.NoError(t, c.Send(`{"type":"connection_init"}`))

		msg, err := c.Read()
		require.NoError(t, err)
		require.JSONEq(t, `{"type":"connection_ack","payload":null}`, msg)
	},
}

var CountEmp = speedtrap.Scenario{
	Name: "countemp subscription",
	Run: func(t *speedtrap.S) {
		c, err := t.Client(speedtrap.WithClientSubprotocol("graphql-transport-ws"))
		require.NoError(t, err, "dial")

		require.NoError(t, c.Send(`{"type":"connection_init", "payload":null}`))

		msg, err := c.Read()
		require.NoError(t, err)
		require.JSONEq(t, `{"type":"connection_ack","payload":null}`, msg)

		require.NoError(t, c.Send(`{"id":"1","type":"subscribe","payload":{"query":"subscription { countEmp(max: 25, intervalMilliseconds: 5) }"}}`))

		for i := range 25 {
			msg, err = c.Read()
			require.NoError(t, err)
			jsonassert.New(t).Assertf(msg, `{"id":"1","type":"next","payload":{"data":{"countEmp":%d}}}`, i)
		}

		require.NoError(t, c.Send(`{"id":"1","type":"complete"}`))
	},
}

func TestDirectServerScenarios(t *testing.T) {
	// Start a demo gqlgen server with minimal config (no NATS, no pubsub).
	// This mirrors how router-tests/testenv creates subgraph servers from the
	// demo package, but without any external dependencies.
	opts := &subgraphs.SubgraphOptions{}
	srv := httptest.NewServer(subgraphs.EmployeesHandler(opts))
	t.Cleanup(srv.Close)

	cfg := speedtrap.HarnessConfig{
		TargetAddr: "ws://" + srv.Listener.Addr().String() + "/graphql",
	}
	for _, s := range DirectServerScenarios {
		t.Run(s.Name, func(t *testing.T) {
			speedtrap.RequireScenario(t, cfg, s)
		})
	}
}
