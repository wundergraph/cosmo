package integration

import (
	"encoding/json"
	"math"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// Interface guard
var (
	_ core.EnginePreOriginHandler = (*MyPanicModule)(nil)
	_ core.Module                 = (*MyPanicModule)(nil)
)

type MyPanicModule struct{}

func (m MyPanicModule) OnOriginRequest(req *http.Request, ctx core.RequestContext) (*http.Request, *http.Response) {
	panic("implement me")
}

func (m MyPanicModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       "myPanicModule",
		Priority: math.MaxInt32,
		New: func() core.Module {
			return &MyPanicModule{}
		},
	}
}

func TestEnginePanic(t *testing.T) {
	t.Parallel()

	t.Run("Router is still responsiveness even when panic count is greater than MaxConcurrentResolvers", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			NoRetryClient: true,
			RouterOptions: []core.Option{
				core.WithCustomModules(&MyPanicModule{}),
				core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
					EnableSingleFlight:     true,
					MaxConcurrentResolvers: 1,
				}),
				core.WithSubgraphRetryOptions(false, 0, 0, 0, ""),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:         `query MyQuery { employees { id } }`,
				OperationName: json.RawMessage(`"MyQuery"`),
			})
			require.NoError(t, err)

			require.Equal(t, 500, res.Response.StatusCode)

			res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:         `query MyQuery { employees { id } }`,
				OperationName: json.RawMessage(`"MyQuery"`),
			})
			require.NoError(t, err)

			require.Equal(t, 500, res.Response.StatusCode)
		})
	})

	t.Run("Router is still responsiveness even when panic count is greater than ParseKitPoolSize", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			NoRetryClient: true,
			RouterOptions: []core.Option{
				core.WithCustomModules(&MyPanicModule{}),
				core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
					EnableSingleFlight: true,
					ParseKitPoolSize:   1,
				}),
				core.WithSubgraphRetryOptions(false, 0, 0, 0, ""),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:         `query MyQuery { employees { id } }`,
				OperationName: json.RawMessage(`"MyQuery"`),
			})
			require.NoError(t, err)

			require.Equal(t, 500, res.Response.StatusCode)

			res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:         `query MyQuery { employees { id } }`,
				OperationName: json.RawMessage(`"MyQuery"`),
			})
			require.NoError(t, err)

			require.Equal(t, 500, res.Response.StatusCode)
		})
	})
}
