package integration

import (
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
)

func TestRouterConfigWatch(t *testing.T) {
	t.Parallel()

	// Create a temporary file for the router config
	configFile := t.TempDir() + "/config.json"

	// Initial config with just the employees subgraph
	initialConfig := MakeTestConfig("initial")

	// Write initial config to file
	initialBytes, err := json.Marshal(initialConfig)
	require.NoError(t, err)
	err = os.WriteFile(configFile, initialBytes, 0644)
	require.NoError(t, err)

	testenv.Run(t, &testenv.Config{
		RouterOptions: []core.Option{
			core.WithExecutionConfig(&core.ExecutionConfig{
				Path:          configFile,
				Watch:         true,
				WatchInterval: 100 * time.Millisecond,
			}),
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `query { hello }`,
		})
		require.JSONEq(t, `{"data":{"hello":"initial"}}`, res.Body)

		updatedConfig := MakeTestConfig("updated")

		updatedBytes, err := json.Marshal(updatedConfig)
		require.NoError(t, err)

		err = os.WriteFile(configFile, updatedBytes, 0644)
		require.NoError(t, err)

		require.EventuallyWithT(t, func(t *assert.CollectT) {
			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { hello }`,
			})
			require.JSONEq(t, `{"data":{"hello":"updated"}}`, res.Body)
		}, 2*time.Second, 100*time.Millisecond)
	})
}

func MakeTestConfig(msg string) *nodev1.RouterConfig {
	return &nodev1.RouterConfig{
		Version: "1a7c0b1a-839c-4b6f-9d05-7cb728168f57",
		EngineConfig: &nodev1.EngineConfiguration{
			DefaultFlushInterval: 500,
			DatasourceConfigurations: []*nodev1.DataSourceConfiguration{
				{
					Kind: nodev1.DataSourceKind_STATIC,
					RootNodes: []*nodev1.TypeField{
						{
							TypeName:   "Query",
							FieldNames: []string{"hello"},
						},
					},
					CustomStatic: &nodev1.DataSourceCustom_Static{
						Data: &nodev1.ConfigurationVariable{
							StaticVariableContent: fmt.Sprintf(`{"hello": "%s"}`, msg),
						},
					},
					Id: "0",
				},
			},
			GraphqlSchema: "schema {\n  query: Query\n}\ntype Query {\n  hello: String\n}",
			FieldConfigurations: []*nodev1.FieldConfiguration{
				{
					TypeName:  "Query",
					FieldName: "hello",
				},
			},
		},
	}
}
