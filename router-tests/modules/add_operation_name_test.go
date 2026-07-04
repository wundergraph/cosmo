package module_test

import (
	"encoding/json"
	"io"
	"net/http"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	custom_add_operation_name "github.com/wundergraph/cosmo/router-tests/modules/custom-add-operation-name"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestAddOperationNameModule(t *testing.T) {
	t.Parallel()

	t.Run("adds the client operation name to the origin request body", func(t *testing.T) {
		t.Parallel()

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]any{
				"addOperationNameModule": custom_add_operation_name.AddOperationNameModule{},
			},
		}

		var (
			mu             sync.Mutex
			capturedBodies [][]byte
		)

		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				GlobalMiddleware: func(handler http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						body, err := io.ReadAll(r.Body)
						require.NoError(t, err)

						mu.Lock()
						capturedBodies = append(capturedBodies, body)
						mu.Unlock()

						handler.ServeHTTP(w, r)
					})
				},
			},
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&custom_add_operation_name.AddOperationNameModule{}),
			},
			ModifyEngineExecutionConfiguration: func(conf *config.EngineExecutionConfiguration) {
				conf.EnableSubgraphFetchOperationName = true
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:         `query MyQuery { employees { id } }`,
				OperationName: json.RawMessage(`"MyQuery"`),
			})
			require.NoError(t, err)
			require.Equal(t, 200, res.Response.StatusCode)

			mu.Lock()
			defer mu.Unlock()
			require.Len(t, capturedBodies, 1)

			var payload map[string]json.RawMessage
			require.NoError(t, json.Unmarshal(capturedBodies[0], &payload))

			// The operationName property must sit at the same level as the query property
			require.Contains(t, payload, "query")
			require.Contains(t, payload, "operationName")

			var operationName string
			require.NoError(t, json.Unmarshal(payload["operationName"], &operationName))
			assert.Equal(t, "MyQuery__employees__0", operationName)
		})
	})
}
