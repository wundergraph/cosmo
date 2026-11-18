package routerconfig_test

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/routerconfig"
)

func TestExecutionConfig(t *testing.T) {
	const schema = `type Query { greeting: String @translate(to: "Hallo") }`
	const client = `type Query { greeting: String }`
	sg := routerconfig.Subgraph{ID: "1", Name: "greetings", RoutingURL: "https://example.com/graphql"}
	subgraphs := []routerconfig.Subgraph{sg}
	cfg := routerconfig.NewExecutionConfig("version", schema, client, subgraphs)
	require.Equal(t, "version", cfg.Version())
	require.Equal(t, schema, cfg.Schema())
	require.Equal(t, client, cfg.ClientSchema())

	subgraphs[0].Name = "changed by producer"
	cfg.Subgraphs()[0].Name = "changed by consumer"
	require.Equal(t, []routerconfig.Subgraph{sg}, cfg.Subgraphs())

	fallback := routerconfig.NewExecutionConfig("version", schema, "", nil)
	require.Equal(t, schema, fallback.ClientSchema())
}
