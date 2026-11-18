package routerconfig_test

import (
	"testing"

	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/routerconfig"
)

func TestExecutionConfigClientSchema(t *testing.T) {
	const schema = `type Query { hello: String @modulePolicy(role: "reader") }`
	const client = `type Query { hello: String }`
	empty := ""
	separate := client
	for _, tt := range []struct {
		name   string
		client *string
		want   string
	}{
		{name: "separate client schema", client: &separate, want: client},
		{name: "absent client schema falls back to router schema", want: schema},
		{name: "empty client schema falls back to router schema", client: &empty, want: schema},
	} {
		t.Run(tt.name, func(t *testing.T) {
			response := &routerconfig.Response{Config: &nodev1.RouterConfig{
				Version: "same-version",
				EngineConfig: &nodev1.EngineConfiguration{
					GraphqlSchema: schema, GraphqlClientSchema: tt.client,
				},
			}}
			snapshot := response.ExecutionConfig(nil)
			require.Equal(t, "same-version", snapshot.Version())
			require.Equal(t, schema, snapshot.Schema())
			require.Equal(t, tt.want, snapshot.ClientSchema())
		})
	}
}

func TestExecutionConfigSnapshotDoesNotRetainMutableConfig(t *testing.T) {
	client := "original client schema"
	response := &routerconfig.Response{Config: &nodev1.RouterConfig{
		Version: "constant-version",
		EngineConfig: &nodev1.EngineConfiguration{
			GraphqlSchema: "original router schema", GraphqlClientSchema: &client,
		},
	}}
	subgraphs := []routerconfig.Subgraph{{ID: "1", Name: "products", RoutingURL: "https://products.example"}}
	original := response.ExecutionConfig(subgraphs)
	want := subgraphs[0]
	subgraphs[0].RoutingURL = "https://new.example"
	original.Subgraphs()[0].Name = "changed by module"
	require.Equal(t, []routerconfig.Subgraph{want}, original.Subgraphs())

	// Config producers can reuse and mutate their messages between reloads.
	response.Config.EngineConfig.GraphqlSchema = "updated router schema"
	client = "updated client schema"
	updated := response.ExecutionConfig(subgraphs)
	require.Equal(t, subgraphs, updated.Subgraphs())

	require.Equal(t, "constant-version", original.Version())
	require.Equal(t, "original router schema", original.Schema())
	require.Equal(t, "original client schema", original.ClientSchema())
	require.Equal(t, original.Version(), updated.Version())
	require.Equal(t, "updated router schema", updated.Schema())
	require.Equal(t, "updated client schema", updated.ClientSchema())

	response.Config.Version = "new-version"
	response.Config.EngineConfig = nil
	require.Equal(t, "constant-version", original.Version())
	require.Equal(t, "constant-version", updated.Version())
	require.Equal(t, "updated router schema", updated.Schema())
	require.Equal(t, "updated client schema", updated.ClientSchema())
}
