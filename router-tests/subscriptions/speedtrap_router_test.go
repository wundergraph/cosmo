package integration

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/speedtrap"
)

// Router-specific speedtrap scenarios. These depend on Cosmo config and do not
// belong in the shipped protocol compliance suites, so each one runs with its
// own router config.
func TestSpeedtrapRouterScenarios(t *testing.T) {
	t.Parallel()

	t.Run("client without subprotocol header is rejected when no default is configured", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			speedtrap.RequireScenario(t, speedtrap.HarnessConfig{TargetAddr: xEnv.GraphQLWebSocketSubscriptionURL()}, speedtrap.Scenario{
				Name: "no subprotocol header is rejected",
				Run: func(s *speedtrap.S) {
					// No WithClientSubprotocol, so no Sec-WebSocket-Protocol header is offered. The upgrade succeeds.
					c, err := s.Client()
					require.NoError(s, err)

					// The router closes the socket because it could not select a protocol.
					_, err = c.Read()
					require.EqualError(s, err, "connection closed")
				},
			})
		})
	})

	t.Run("client without subprotocol header uses the configured default", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyWebsocketConfiguration: func(cfg *config.WebSocketConfiguration) {
				cfg.DefaultSubprotocol = "graphql-transport-ws"
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			speedtrap.RequireScenario(t, speedtrap.HarnessConfig{TargetAddr: xEnv.GraphQLWebSocketSubscriptionURL()}, speedtrap.Scenario{
				Name: "no subprotocol header uses default",
				Run: func(s *speedtrap.S) {
					// No WithClientSubprotocol, so no Sec-WebSocket-Protocol header is offered.
					c, err := s.Client()
					require.NoError(s, err)

					// A graphql-transport-ws handshake completes, which proves the default was applied.
					require.NoError(s, c.Send(`{"type":"connection_init"}`))
					msg, err := c.Read()
					require.NoError(s, err)
					require.JSONEq(s, `{"type":"connection_ack"}`, msg)
				},
			})
		})
	})
}
