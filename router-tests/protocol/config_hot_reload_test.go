package integration

import (
	"github.com/wundergraph/cosmo/router-tests/testutils"

	"context"
	"encoding/json"
	"net/http"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/wundergraph/cosmo/router/pkg/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.opentelemetry.io/otel/sdk/metric/metricdata/metricdatatest"

	"github.com/wundergraph/cosmo/router/pkg/routerconfig"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
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
	updateConfig func(response *routerconfig.Response) error
	ready        chan struct{}
}

func (c *ConfigPollerMock) Subscribe(_ context.Context, handler func(response *routerconfig.Response) error) {
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

func TestConfigHotReloadPoller(t *testing.T) {
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
			require.JSONEq(t, testutils.EmployeesIDData, res.Body)

			// Wait for the config poller to be ready
			<-pm.ready

			pm.initConfig.Version = "updated"
			require.NoError(t, pm.updateConfig(&routerconfig.Response{Config: pm.initConfig}))

			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id } }`,
			})
			require.Equal(t, res.Response.StatusCode, 200)
			require.Equal(t, res.Response.Header.Get("X-Router-Config-Version"), "updated")
			require.JSONEq(t, testutils.EmployeesIDData, res.Body)

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

			var done atomic.Uint32

			go func() {
				defer done.Add(1)

				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employees { id } }`,
				})
				assert.Equal(t, res.Response.StatusCode, 200)
				assert.Equal(t, xEnv.RouterConfigVersionMain(), res.Response.Header.Get("X-Router-Config-Version"))
				assert.JSONEq(t, testutils.EmployeesIDData, res.Body)
			}()

			go func() {
				defer done.Add(1)

				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employees { id } }`,
				})
				assert.Equal(t, res.Response.StatusCode, 200)
				assert.Equal(t, xEnv.RouterConfigVersionMain(), res.Response.Header.Get("X-Router-Config-Version"))
				assert.JSONEq(t, testutils.EmployeesIDData, res.Body)
			}()

			// Let's wait a bit to make sure the requests are in flight
			time.Sleep(time.Millisecond * 100)

			// Wait for the config poller to be ready
			<-pm.ready

			// Swap config
			pm.initConfig.Version = "updated"
			require.NoError(t, pm.updateConfig(&routerconfig.Response{Config: pm.initConfig}))

			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id } }`,
			})
			require.Equal(t, res.Response.StatusCode, 200)
			require.Equal(t, res.Response.Header.Get("X-Router-Config-Version"), "updated")
			require.JSONEq(t, testutils.EmployeesIDData, res.Body)

			// Ensure that all requests are served successfully
			require.Eventually(t, func() bool {
				return done.Load() == 2
			}, time.Second*5, time.Millisecond*100)
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
			err := testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { currentTime { unixTime timeStamp }}"}`),
			})
			require.NoError(t, err)
			var msg testenv.WebSocketMessage
			var payload currentTimePayload

			// Read a result and store its timestamp, next result should be 1 second later
			err = testenv.WSReadJSON(t, conn, &msg)
			require.NoError(t, err)
			require.Equal(t, "1", msg.ID)
			require.Equal(t, "next", msg.Type)
			err = json.Unmarshal(msg.Payload, &payload)
			require.NoError(t, err)

			// Wait for the config poller to be ready
			<-pm.ready

			// Swap config — the ReadJSON below expects a possible websocket close error,
			// so use a deadline instead of WSReadJSON (which retries on errors)
			require.NoError(t, pm.updateConfig(&routerconfig.Response{Config: pm.initConfig}))
			conn.SetReadDeadline(time.Now().Add(5 * time.Second))
			err = conn.ReadJSON(&msg)
			conn.SetReadDeadline(time.Time{})

			// If the operation happen fast enough, ensure that the connection is closed.
			// In the future, we might want to send a complete message to the client
			// and wait until in-flight messages are delivered before closing the connection
			if err != nil {
				var wsErr *websocket.CloseError
				require.ErrorAs(t, err, &wsErr)
			}

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
			err = testenv.WSReadJSON(t, conn, &msg)
			require.NoError(t, err)
			require.Equal(t, "1", msg.ID)
			require.Equal(t, "next", msg.Type)
			err = json.Unmarshal(msg.Payload, &payload)
			require.NoError(t, err)

			require.NoError(t, conn.Close())
		})
	})
}

func TestConfigHotReloadFile(t *testing.T) {
	t.Parallel()

	t.Run("hot-reload config from file", func(t *testing.T) {
		t.Parallel()

		// Create a temporary file for the router config
		configFile := t.TempDir() + "/config.json"

		// Initial config with just the employees subgraph
		writeTestConfig(t, "initial", configFile)

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithConfigVersionHeader(true),
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
			require.Equal(t, res.Response.StatusCode, 200)
			require.Equal(t, "initial", res.Response.Header.Get("X-Router-Config-Version"))

			writeTestConfig(t, "updated", configFile)

			require.EventuallyWithT(t, func(t *assert.CollectT) {
				res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { hello }`,
				})
				require.Equal(t, "updated", res.Response.Header.Get("X-Router-Config-Version"))
			}, 2*time.Second, 100*time.Millisecond)
		})
	})

	t.Run("does not hot-reload config from file if watch is disabled", func(t *testing.T) {
		t.Parallel()

		// Create a temporary file for the router config
		configFile := t.TempDir() + "/config.json"

		// Initial config with just the employees subgraph
		writeTestConfig(t, "initial", configFile)

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithConfigVersionHeader(true),
				core.WithExecutionConfig(&core.ExecutionConfig{
					Path:          configFile,
					Watch:         false,
					WatchInterval: 100 * time.Millisecond,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { hello }`,
			})
			require.Equal(t, res.Response.StatusCode, 200)
			require.Equal(t, "initial", res.Response.Header.Get("X-Router-Config-Version"))

			writeTestConfig(t, "updated", configFile)

			require.EventuallyWithT(t, func(t *assert.CollectT) {
				res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { hello }`,
				})
				require.Equal(t, "initial", res.Response.Header.Get("X-Router-Config-Version"))
			}, 2*time.Second, 100*time.Millisecond)
		})
	})

	t.Run("does not interrupt existing client traffic", func(t *testing.T) {
		t.Parallel()

		// Create a temporary file for the router config
		configFile := t.TempDir() + "/config.json"

		// Initial config with just the employees subgraph
		writeTestConfig(t, "initial", configFile)

		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				GlobalDelay: time.Millisecond * 500,
			},
			RouterOptions: []core.Option{
				core.WithConfigVersionHeader(true),
				core.WithExecutionConfig(&core.ExecutionConfig{
					Path:          configFile,
					Watch:         true,
					WatchInterval: 100 * time.Millisecond,
				}),
				core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
					EnableSingleFlight:     false,
					MaxConcurrentResolvers: 32,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { hello }`,
			})
			require.Equal(t, res.Response.StatusCode, 200)
			require.Equal(t, "initial", res.Response.Header.Get("X-Router-Config-Version"))

			var done atomic.Uint32

			go func() {
				defer done.Add(1)

				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { hello }`,
				})
				assert.Equal(t, res.Response.StatusCode, 200)
				assert.Equal(t, "initial", res.Response.Header.Get("X-Router-Config-Version"))
			}()

			go func() {
				defer done.Add(1)

				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { hello }`,
				})
				assert.Equal(t, res.Response.StatusCode, 200)
				assert.Equal(t, "initial", res.Response.Header.Get("X-Router-Config-Version"))
			}()

			time.Sleep(time.Millisecond * 100)

			writeTestConfig(t, "updated", configFile)

			require.EventuallyWithT(t, func(t *assert.CollectT) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { hello }`,
				})
				require.Equal(t, "updated", res.Response.Header.Get("X-Router-Config-Version"))
			}, 2*time.Second, 100*time.Millisecond)

			// Ensure that all requests are served successfully
			require.Eventually(t, func() bool {
				return done.Load() == 2
			}, time.Second*5, time.Millisecond*100)
		})
	})

}

func TestSwapConfig(t *testing.T) {
	t.Parallel()

	t.Run("shutdown server waits until all requests has been served", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				GlobalDelay: time.Millisecond * 1000,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			var requestsStarted atomic.Uint32
			var requestsDone atomic.Uint32

			for i := 0; i < 10; i++ {
				requestsStarted.Add(1)
				func() {
					defer requestsDone.Add(1)

					// Create a new context for each request to ensure that the request is not cancelled by the shutdown
					res, err := xEnv.MakeGraphQLRequestWithContext(context.Background(), testenv.GraphQLRequest{
						Query: `{ employees { id } }`,
					})
					require.NoError(t, err)
					require.Equal(t, res.Response.StatusCode, 200)
					require.JSONEq(t, testutils.EmployeesIDData, res.Body)
				}()
			}

			// Let's wait until all requests are in flight
			require.Eventually(t, func() bool {
				return requestsStarted.Load() == 10
			}, time.Second*5, time.Millisecond*100)

			xEnv.Shutdown()

			// Let's wait until all requests are completed
			require.Eventually(t, func() bool {
				return requestsDone.Load() == 10
			}, time.Second*20, time.Millisecond*100)
		})
	})

	t.Run("Router grace period defines how long the shutdown can take until all client connections are closed immediately", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				// This is a very high delay to make sure that the shutdown is enforced by the grace period
				GlobalDelay: time.Hour * 1,
			},
			RouterOptions: []core.Option{
				// This results in a context.DeadlineExceeded error after the grace period
				core.WithGracePeriod(time.Millisecond * 100),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {

			var startedReq atomic.Bool
			go func() {
				startedReq.Store(true)
				res, err := xEnv.MakeGraphQLRequestWithContext(context.Background(), testenv.GraphQLRequest{
					Query: `{ employees { id } }`,
				})
				require.NoError(t, err)
				assert.Equal(t, res.Response.StatusCode, 200)
				assert.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees'."}],"data":{"employees":null}}`, res.Body)
			}()

			// Let's wait a bit to make sure all requests are in flight
			// otherwise the shutdown will be too fast and the wait-group will not be done fully
			require.Eventually(t, startedReq.Load, time.Second*10, time.Millisecond*100)
			time.Sleep(time.Millisecond * 100)

			var done atomic.Bool
			go func() {
				defer done.Store(true)

				err := xEnv.Router.Shutdown(context.Background())
				assert.ErrorContains(t, err, context.DeadlineExceeded.Error())
			}()

			require.Eventually(t, done.Load, time.Second*20, time.Millisecond*100)
		})
	})
}

func TestFlakyConfigHotReloadPoller(t *testing.T) {
	t.Run("verify the config version is updated after config reload", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()

		// Create a temporary file for the router config
		configFile := t.TempDir() + "/config.json"

		// Initial config with just the employees subgraph
		writeTestConfig(t, "initial", configFile)

		testenv.Run(t, &testenv.Config{
			MetricReader: metricReader,
			RouterOptions: []core.Option{
				core.WithConfigVersionHeader(true),
				core.WithExecutionConfig(&core.ExecutionConfig{
					Path:          configFile,
					Watch:         true,
					WatchInterval: 100 * time.Millisecond,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { hello }`,
			})
			rm := metricdata.ResourceMetrics{}
			err := metricReader.Collect(context.Background(), &rm)
			require.NoError(t, err)
			scopeMetric := *testutils.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")

			beforeUpdate := metricdata.Metrics{
				Name:        "router.info",
				Description: "Router configuration info.",
				Unit:        "",
				Data: metricdata.Gauge[int64]{
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Value: 1,
							Attributes: attribute.NewSet(
								otel.WgRouterConfigVersion.String("initial"),
								otel.WgRouterVersion.String("dev"),
							),
						},
					},
				},
			}

			metricdatatest.AssertEqual(t, beforeUpdate, scopeMetric.Metrics[6], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())

			writeTestConfig(t, "updated", configFile)

			require.EventuallyWithT(t, func(collectT *assert.CollectT) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { hello }`,
				})
				require.Equal(collectT, "updated", res.Response.Header.Get("X-Router-Config-Version"))

				rm := metricdata.ResourceMetrics{}
				err := metricReader.Collect(context.Background(), &rm)
				require.NoError(collectT, err)
				scopeMetricAfterUpdate := *testutils.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")
				afterUpdate := metricdata.Metrics{
					Name:        "router.info",
					Description: "Router configuration info.",
					Unit:        "",
					Data: metricdata.Gauge[int64]{
						DataPoints: []metricdata.DataPoint[int64]{
							{
								Value: 1,
								Attributes: attribute.NewSet(
									otel.WgRouterConfigVersion.String("updated"),
									otel.WgRouterVersion.String("dev"),
								),
							},
						},
					},
				}

				metricdatatest.AssertEqual(t, afterUpdate, scopeMetricAfterUpdate.Metrics[6], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
			}, 2*time.Second, 100*time.Millisecond)
		})
	})
}

func TestConfigHotReloadGraphServerSwap(t *testing.T) {
	t.Parallel()

	t.Run("verify only ws connections on swapped muxes are closed", func(t *testing.T) {
		// verifies that after a config update that changes only one feature flag's mux, websocket connections on
		// unchanged muxes (base graph and unmodified feature flags) remain active, while
		// connections on the changed mux are closed by the server.

		pm := ConfigPollerMock{
			ready: make(chan struct{}),
		}

		testenv.Run(t, &testenv.Config{
			RouterConfig: &testenv.RouterConfig{
				ConfigPollerFactory: func(cfg *nodev1.RouterConfig) configpoller.ConfigPoller {
					// Add "myff2" as a second feature flag (clone of "myff") so the router
					// starts with three distinct muxes: base graph, myff, and myff2.
					if cfg.FeatureFlagConfigs != nil {
						if myff, ok := cfg.FeatureFlagConfigs.ConfigByFeatureFlagName["myff"]; ok {
							cfg.FeatureFlagConfigs.ConfigByFeatureFlagName["myff2"] = &nodev1.FeatureFlagRouterExecutionConfig{
								EngineConfig: myff.EngineConfig,
								Version:      "myff2-initial",
								Subgraphs:    myff.Subgraphs,
							}
						}
					}
					pm.initConfig = cfg
					return &pm
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Wait for the config poller to be ready before establishing connections.
			<-pm.ready

			// subscribe dials a WebSocket, starts a currentTime subscription, and reads
			// one initial message to confirm the subscription is live before returning.
			subscribe := func(header http.Header) *websocket.Conn {
				t.Helper()
				conn := xEnv.InitGraphQLWebSocketConnection(header, nil, nil)
				err := conn.WriteJSON(&testenv.WebSocketMessage{
					ID:      "1",
					Type:    "subscribe",
					Payload: []byte(`{"query":"subscription { currentTime { unixTime timeStamp }}"}`),
				})
				require.NoError(t, err)
				var msg testenv.WebSocketMessage
				err = testenv.WSReadJSON(t, conn, &msg)
				require.NoError(t, err)
				require.Equal(t, "next", msg.Type)
				return conn
			}

			// Establish 2 connections on each of the three muxes (6 total).
			baseConn1 := subscribe(nil)
			baseConn2 := subscribe(nil)
			myffConn1 := subscribe(http.Header{"X-Feature-Flag": []string{"myff"}})
			myffConn2 := subscribe(http.Header{"X-Feature-Flag": []string{"myff"}})
			myff2Conn1 := subscribe(http.Header{"X-Feature-Flag": []string{"myff2"}})
			myff2Conn2 := subscribe(http.Header{"X-Feature-Flag": []string{"myff2"}})

			// Trigger a config update where only "myff" has changed.
			// The base graph mux and "myff2" mux are unchanged and will be reused.
			pm.initConfig.FeatureFlagConfigs.ConfigByFeatureFlagName["myff"].Version = "myff-v2"
			require.NoError(t, pm.updateConfig(&routerconfig.Response{
				Config: pm.initConfig,
				Changes: &routerconfig.Changes{
					ChangedConfigs: map[string]struct{}{"myff": {}},
				},
			}))

			// assertConnectionClosed drains any pending subscription messages then expects
			// a WebSocket close error, confirming the server closed the connection.
			// A single absolute deadline is set on the connection before the loop so that
			// continuous data messages cannot prevent the timeout from firing.
			assertConnectionClosed := func(conn *websocket.Conn) {
				t.Helper()
				conn.SetReadDeadline(time.Now().Add(10 * time.Second))
				defer conn.SetReadDeadline(time.Time{})
				for {
					var msg testenv.WebSocketMessage
					err := conn.ReadJSON(&msg)
					if err != nil {
						var wsErr *websocket.CloseError
						require.ErrorAs(t, err, &wsErr, "expected websocket close error, got: %v", err)
						return
					}
					// A data message arrived before the close — keep draining.
					require.Equal(t, "next", msg.Type)
				}
			}

			// The "myff" connections must be closed because their mux was rebuilt.
			assertConnectionClosed(myffConn1)
			assertConnectionClosed(myffConn2)

			// The base graph and "myff2" connections must still receive data because their
			// muxes were reused and their per-mux contexts were not cancelled.
			for _, conn := range []*websocket.Conn{baseConn1, baseConn2, myff2Conn1, myff2Conn2} {
				var msg testenv.WebSocketMessage
				err := testenv.WSReadJSON(t, conn, &msg)
				require.NoError(t, err)
				require.Equal(t, "next", msg.Type)
			}

			// Close the remaining connections.
			for _, conn := range []*websocket.Conn{baseConn1, baseConn2, myff2Conn1, myff2Conn2} {
				require.NoError(t, conn.Close())
			}
		})
	})
}

func writeTestConfig(t *testing.T, version string, path string) {
	t.Helper()

	cfg := &nodev1.RouterConfig{
		Version: version,
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
							StaticVariableContent: `{"hello": "Hello!"}`,
						},
					},
					Id: "0",
				},
				{
					Kind: nodev1.DataSourceKind_STATIC,
					RootNodes: []*nodev1.TypeField{
						{
							TypeName:   "Query",
							FieldNames: []string{"world"},
						},
					},
					CustomStatic: &nodev1.DataSourceCustom_Static{
						Data: &nodev1.ConfigurationVariable{
							StaticVariableContent: `{"world": "World!"}`,
						},
					},
					Id: "1",
				},
			},
			GraphqlSchema: "schema {\n  query: Query\n}\ntype Query {\n  hello: String\n  world: String\n}",
			FieldConfigurations: []*nodev1.FieldConfiguration{
				{
					TypeName:  "Query",
					FieldName: "hello",
				},
				{
					TypeName:  "Query",
					FieldName: "world",
				},
			},
		},
	}

	bytes, err := json.Marshal(cfg)
	require.NoError(t, err)

	err = os.WriteFile(path, bytes, 0644)
	require.NoError(t, err)
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
			require.NoError(t, pm.updateConfig(&routerconfig.Response{Config: pm.initConfig}))
		}

	})

}
