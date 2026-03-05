package graphqltransportws_test

import (
	"os"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/speedtrap"
	"github.com/wundergraph/cosmo/speedtrap/scenarios/graphqltransportws"
)

func proxyAddr(t *testing.T) string {
	t.Helper()
	addr := os.Getenv("SPEEDTRAP_PROXY_ADDR")
	if addr == "" {
		t.Skip("SPEEDTRAP_PROXY_ADDR not set, skipping proxy scenario")
	}
	return addr
}

func TestAllScenarios(t *testing.T) {
	addr := proxyAddr(t)

	backend, err := speedtrap.StartBackend(speedtrap.WithSubprotocol("graphql-transport-ws"))
	require.NoError(t, err)
	t.Cleanup(backend.Stop)

	cfg := speedtrap.HarnessConfig{
		TargetAddr: addr,
		Backends: map[string]*speedtrap.Backend{
			"default": backend,
		},
	}
	for _, s := range graphqltransportws.AllScenarios {
		t.Run(s.Name, func(t *testing.T) {
			speedtrap.RequireScenario(t, cfg, s)
		})
	}
}

func TestFederatedScenarios(t *testing.T) {
	addr := proxyAddr(t)

	users, err := speedtrap.StartBackend(speedtrap.WithSubprotocol("graphql-transport-ws"))
	require.NoError(t, err)
	t.Cleanup(users.Stop)

	products, err := speedtrap.StartBackend(speedtrap.WithSubprotocol("graphql-transport-ws"))
	require.NoError(t, err)
	t.Cleanup(products.Stop)

	cfg := speedtrap.HarnessConfig{
		TargetAddr: addr,
		Backends: map[string]*speedtrap.Backend{
			"users":    users,
			"products": products,
		},
	}
	for _, s := range graphqltransportws.FederatedScenarios {
		t.Run(s.Name, func(t *testing.T) {
			speedtrap.RequireScenario(t, cfg, s)
		})
	}
}
