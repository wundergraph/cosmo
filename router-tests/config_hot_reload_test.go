package integration

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/wundergraph/cosmo/router/pkg/routerconfig"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/controlplane/configpoller"
)

var (
	_ configpoller.ConfigPoller = (*ConfigPollerMock)(nil)
)

type ConfigPollerMock struct {
	initConfig   *nodev1.RouterConfig
	updateConfig func(newConfig *nodev1.RouterConfig, oldVersion string) error
	ready        chan struct{}
}

func (c *ConfigPollerMock) Subscribe(_ context.Context, handler func(newConfig *nodev1.RouterConfig, oldVersion string) error) {
	c.updateConfig = handler
	close(c.ready)
}

func (c *ConfigPollerMock) GetRouterConfig(_ context.Context) (*routerconfig.Response, error) {
	result := &routerconfig.Response{
		Config: c.initConfig,
	}
	return result, nil
}

func (c *ConfigPollerMock) Stop(_ context.Context) error {
	return nil
}

func TestConfigHotReload(t *testing.T) {

	t.Parallel()

	t.Run("Swap config and be able to make requests successfully", func(t *testing.T) {

		t.Parallel()

		pm := ConfigPollerMock{
			ready: make(chan struct{}),
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithConfigVersionHeader(true),
			},
			RouterConfig: &testenv.RouterConfig{
				ConfigPollerFactory: func(config *nodev1.RouterConfig) configpoller.ConfigPoller {
					pm.initConfig = config
					return &pm
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id } }`,
			})
			require.Equal(t, res.Response.StatusCode, 200)
			require.Equal(t, xEnv.RouterConfigVersionMain(), res.Response.Header.Get("X-Router-Config-Version"))
			require.JSONEq(t, employeesIDData, res.Body)

			// Wait for the config poller to be ready
			<-pm.ready

			pm.initConfig.Version = "updated"
			require.NoError(t, pm.updateConfig(pm.initConfig, "old-1"))

			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id } }`,
			})
			require.Equal(t, res.Response.StatusCode, 200)
			require.Equal(t, res.Response.Header.Get("X-Router-Config-Version"), "updated")
			require.JSONEq(t, employeesIDData, res.Body)

		})
	})

	t.Run("Swap config must not interrupt existing client traffic. All requests are served successfully", func(t *testing.T) {

		t.Parallel()

		pm := ConfigPollerMock{
			ready: make(chan struct{}),
		}

		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				GlobalDelay: time.Millisecond * 500,
			},
			RouterOptions: []core.Option{
				core.WithConfigVersionHeader(true),
				core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
					EnableSingleFlight:     false,
					MaxConcurrentResolvers: 32,
				}),
			},
			RouterConfig: &testenv.RouterConfig{
				ConfigPollerFactory: func(config *nodev1.RouterConfig) configpoller.ConfigPoller {
					pm.initConfig = config
					return &pm
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {

			var wg sync.WaitGroup

			wg.Add(1)

			go func() {
				defer wg.Done()

				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employees { id } }`,
				})
				require.Equal(t, res.Response.StatusCode, 200)
				require.Equal(t, xEnv.RouterConfigVersionMain(), res.Response.Header.Get("X-Router-Config-Version"))
				require.JSONEq(t, employeesIDData, res.Body)
			}()

			wg.Add(1)

			go func() {
				defer wg.Done()

				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employees { id } }`,
				})
				require.Equal(t, res.Response.StatusCode, 200)
				require.Equal(t, xEnv.RouterConfigVersionMain(), res.Response.Header.Get("X-Router-Config-Version"))
				require.JSONEq(t, employeesIDData, res.Body)
			}()

			// Let's wait a bit to make sure the requests are in flight
			time.Sleep(time.Millisecond * 100)

			// Wait for the config poller to be ready
			<-pm.ready

			// Swap config
			pm.initConfig.Version = "updated"
			require.NoError(t, pm.updateConfig(pm.initConfig, "old-1"))

			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id } }`,
			})
			require.Equal(t, res.Response.StatusCode, 200)
			require.Equal(t, res.Response.Header.Get("X-Router-Config-Version"), "updated")
			require.JSONEq(t, employeesIDData, res.Body)

			// Ensure that all requests are served successfully
			wg.Wait()
		})
	})

	t.Run("Shutdown server waits until all requests has been served", func(t *testing.T) {

		t.Parallel()

		pm := ConfigPollerMock{
			ready: make(chan struct{}),
		}

		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				GlobalDelay: time.Millisecond * 1000,
			},
			RouterConfig: &testenv.RouterConfig{
				ConfigPollerFactory: func(config *nodev1.RouterConfig) configpoller.ConfigPoller {
					pm.initConfig = config
					return &pm
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {

			wg := &sync.WaitGroup{}

			for i := 0; i < 10; i++ {
				wg.Add(1)

				go func() {
					defer wg.Done()

					// Create a new context for each request to ensure that the request is not cancelled by the shutdown
					res, err := xEnv.MakeGraphQLRequestWithContext(context.Background(), testenv.GraphQLRequest{
						Query: `{ employees { id } }`,
					})
					require.NoError(t, err)
					require.Equal(t, res.Response.StatusCode, 200)
					require.JSONEq(t, employeesIDData, res.Body)
				}()
			}

			// Let's wait a bit to make sure all requests are in flight
			// otherwise the shutdown will be too fast and the wait-group will not be done fully
			time.Sleep(time.Millisecond * 100)

			xEnv.Shutdown()

			// Ensure that all requests are served successfully
			wg.Wait()

		})
	})

	t.Run("Router grace period defines how long the shutdown can take until all client connections are closed immediately", func(t *testing.T) {

		t.Parallel()

		pm := ConfigPollerMock{
			ready: make(chan struct{}),
		}

		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				// This is a very high delay to make sure that the shutdown is enforced by the grace period
				GlobalDelay: time.Hour * 1,
			},
			RouterOptions: []core.Option{
				// This results in a context.DeadlineExceeded error after the grace period
				core.WithGracePeriod(time.Millisecond * 100),
			},
			RouterConfig: &testenv.RouterConfig{
				ConfigPollerFactory: func(config *nodev1.RouterConfig) configpoller.ConfigPoller {
					pm.initConfig = config
					return &pm
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {

			wg := &sync.WaitGroup{}

			wg.Add(1)

			go func() {
				defer wg.Done()

				res, err := xEnv.MakeGraphQLRequestWithContext(context.Background(), testenv.GraphQLRequest{
					Query: `{ employees { id } }`,
				})
				require.NoError(t, err)
				require.Equal(t, res.Response.StatusCode, 200)
				require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph '0'."}],"data":{"employees":null}}`, res.Body)
			}()

			// Let's wait a bit to make sure all requests are in flight
			// otherwise the shutdown will be too fast and the wait-group will not be done fully
			time.Sleep(time.Millisecond * 100)

			xEnv.Shutdown()

			wg.Wait()
		})
	})

	t.Run("Swap config closes websockets connections of old graph instance immediately", func(t *testing.T) {

		t.Parallel()

		type currentTimePayload struct {
			Data struct {
				CurrentTime struct {
					UnixTime  float64 `json:"unixTime"`
					Timestamp string  `json:"timestamp"`
				} `json:"currentTime"`
			} `json:"data"`
		}

		pm := ConfigPollerMock{
			ready: make(chan struct{}),
		}

		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				GlobalDelay: time.Millisecond * 200,
			},
			RouterConfig: &testenv.RouterConfig{
				ConfigPollerFactory: func(config *nodev1.RouterConfig) configpoller.ConfigPoller {
					pm.initConfig = config
					return &pm
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {

			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err := conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { currentTime { unixTime timeStamp }}"}`),
			})
			require.NoError(t, err)
			var msg testenv.WebSocketMessage
			var payload currentTimePayload

			// Read a result and store its timestamp, next result should be 1 second later
			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			require.Equal(t, "1", msg.ID)
			require.Equal(t, "next", msg.Type)
			err = json.Unmarshal(msg.Payload, &payload)
			require.NoError(t, err)

			// Wait for the config poller to be ready
			<-pm.ready

			// Swap config
			require.NoError(t, pm.updateConfig(pm.initConfig, "old-1"))

			err = conn.ReadJSON(&msg)

			// Ensure that the connection is closed. In the future, we might want to send a complete message to the client
			// and wait until in-flight messages are delivered before closing the connection
			var wsErr *websocket.CloseError
			require.ErrorAs(t, err, &wsErr)

			require.NoError(t, conn.Close())

			// Connecting again to the new graph instance should work

			conn = xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err = conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { currentTime { unixTime timeStamp }}"}`),
			})
			require.NoError(t, err)

			// Read a result and store its timestamp, next result should be 1 second later
			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			require.Equal(t, "1", msg.ID)
			require.Equal(t, "next", msg.Type)
			err = json.Unmarshal(msg.Payload, &payload)
			require.NoError(t, err)

			require.NoError(t, conn.Close())
		})
	})

}

func BenchmarkConfigHotReload(b *testing.B) {
	pm := ConfigPollerMock{
		ready: make(chan struct{}),
	}

	testenv.Run(&testing.T{}, &testenv.Config{
		RouterConfig: &testenv.RouterConfig{
			ConfigPollerFactory: func(config *nodev1.RouterConfig) configpoller.ConfigPoller {
				pm.initConfig = config
				return &pm
			},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		b.ResetTimer()

		for i := 0; i < b.N; i++ {
			require.NoError(t, pm.updateConfig(pm.initConfig, "old-1"))
		}

	})

}
