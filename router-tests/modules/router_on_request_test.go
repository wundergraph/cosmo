package module_test

import (
	"context"
	"encoding/json"
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	"github.com/hasura/go-graphql-client"
	router_on_request "github.com/wundergraph/cosmo/router-tests/modules/router-on-request"
	"go.uber.org/zap/zapcore"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestRouterOnRequestHook(t *testing.T) {
	t.Parallel()

	t.Run("Test RouterOnRequest hook is called", func(t *testing.T) {
		t.Parallel()

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"routerOnRequestModule": router_on_request.RouterOnRequestModule{},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&router_on_request.RouterOnRequestModule{}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:         `query MyQuery { employees { id } }`,
				OperationName: json.RawMessage(`"MyQuery"`),
			})
			require.NoError(t, err)

			requestLog := xEnv.Observer().FilterMessage("RouterOnRequest Hook has been run")
			assert.Len(t, requestLog.All(), 1)
			assert.Equal(t, 200, res.Response.StatusCode)
			assert.JSONEq(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
		})
	})

	t.Run("Test RouterOnRequest hook is used to rewrite auth logic", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := configureAuth(t)
		token, err := authServer.Token(map[string]any{})

		require.NoError(t, err)

		onRequestModule := router_on_request.RouterOnRequestModule{
			TokenContainer: &router_on_request.TokenContainer{},
		}

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"routerOnRequestModule": onRequestModule,
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, true)),
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&router_on_request.RouterOnRequestModule{}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			initialRes, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:         `query MyQuery { employees { id } }`,
				OperationName: json.RawMessage(`"MyQuery"`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusUnauthorized, initialRes.Response.StatusCode)
			initialRequestLog := xEnv.Observer().FilterMessage("RouterOnRequest Hook has been run")
			assert.Len(t, initialRequestLog.All(), 1)

			onRequestModule.SetToken(token)

			retryRes, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:         `query MyQuery { employees { id } }`,
				OperationName: json.RawMessage(`"MyQuery"`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, retryRes.Response.StatusCode)
			retryRequestLog := xEnv.Observer().FilterMessage("RouterOnRequest Hook has been run")
			assert.Len(t, retryRequestLog.All(), 2)
		})
	})

	t.Run("Test RouterOnRequest hook is called with subscriptions over sse", func(t *testing.T) {
		t.Parallel()

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"routerOnRequestModule": router_on_request.RouterOnRequestModule{},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&router_on_request.RouterOnRequestModule{}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()

			var counter atomic.Uint32

			go xEnv.GraphQLSubscriptionOverSSE(ctx, testenv.GraphQLRequest{
				OperationName: []byte(`CurrentTime`),
				Query:         `subscription CurrentTime { currentTime { unixTime timeStamp }}`,
				Header: map[string][]string{
					"Content-Type":  {"application/json"},
					"Accept":        {"text/event-stream"},
					"Connection":    {"keep-alive"},
					"Cache-Control": {"no-cache"},
				},
			}, func(data string) {
				counter.Add(1)
			})

			require.Eventually(t, func() bool {
				return counter.Load() > 0
			}, time.Second*5, time.Millisecond*100)

			requestLog := xEnv.Observer().FilterMessage("RouterOnRequest Hook has been run")
			assert.Len(t, requestLog.All(), 1)
		})
	})

	t.Run("Test RouterOnRequest hook is called with subscriptions over ws", func(t *testing.T) {
		t.Parallel()

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"routerOnRequestModule": router_on_request.RouterOnRequestModule{},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&router_on_request.RouterOnRequestModule{}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {

			var counter atomic.Uint32

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)

			var subscriptionOne struct {
				currentTime struct {
					unixTime  float64 `graphql:"unixTime"`
					timeStamp float64 `graphql:"timeStamp"`
				} `graphql:"currentTime"`
			}

			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				counter.Add(1)
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			clientRunCh := make(chan error)
			go func() {
				clientRunCh <- client.Run()
			}()

			require.Eventually(t, func() bool {
				return counter.Load() > 0
			}, time.Second*5, time.Millisecond*100)

			err = client.Unsubscribe(subscriptionOneID)
			require.NoError(t, err)

			// Close the client
			client.Close()
			err = <-clientRunCh
			require.NoError(t, err)

			requestLog := xEnv.Observer().FilterMessage("RouterOnRequest Hook has been run")
			assert.Len(t, requestLog.All(), 1)
		})
	})
}
