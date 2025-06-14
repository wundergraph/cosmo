package module_test

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	customvaluerenderer "github.com/wundergraph/cosmo/router-tests/modules/custom-value-renderer"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestCustomValueRenderer(t *testing.T) {
	t.Parallel()

	t.Run("module is called", func(t *testing.T) {
		t.Parallel()

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"routerCustomValueRenderer": customvaluerenderer.RouterCustomValueRendererModule{},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&customvaluerenderer.RouterCustomValueRendererModule{}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:         `query MyQuery { employee(id: 1) { id } }`,
				OperationName: json.RawMessage(`"MyQuery"`),
			})
			require.NoError(t, err)
			assert.Equal(t, 200, res.Response.StatusCode)
			assert.Equal(t, `{"data":{"employee":{"id":1}}}`, res.Body)

			res, err = xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
				Query:         `query MyQuery { employee(id: 1) { id details { forename } } }`,
				OperationName: json.RawMessage(`"MyQuery"`),
			}, map[string]string{
				"X-Custom-Value-Renderer": "true",
			})
			require.NoError(t, err)
			assert.Equal(t, 200, res.Response.StatusCode)
			assert.Equal(t, `{"data":{"employee":{"id":123,"details":{"forename":"xxx"}}}}`, res.Body)

			res, err = xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
				Query:         `query MyQuery { employee(id: 1) { id currentMood } }`,
				OperationName: json.RawMessage(`"MyQuery"`),
			}, map[string]string{
				"X-Custom-Value-Renderer": "true",
			})
			require.NoError(t, err)
			assert.Equal(t, 200, res.Response.StatusCode)
			assert.Equal(t, `{"data":{"employee":{"id":123,"currentMood":"Mood-HAPPY"}}}`, res.Body)
		})
	})
}
