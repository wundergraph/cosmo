package integration

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/speedtrap"
	cosmo "github.com/wundergraph/cosmo/speedtrap/scenarios/graphql/configs/cosmo"
	"github.com/wundergraph/cosmo/speedtrap/scenarios/graphql/proxy/graphqltransportws"
	"github.com/wundergraph/cosmo/speedtrap/scenarios/graphql/proxy/graphqlws"
)

// speedtrapHeaderRules configures header propagation for all speedtrap
// scenarios. Authorization and X-Custom-* are forwarded as HTTP headers on the
// upstream WebSocket dial so header-forwarding scenarios can assert them via
// UpgradeHeaders on the backend connection.
var speedtrapHeaderRules = config.HeaderRules{
	All: &config.GlobalHeaderRule{
		Request: []*config.RequestHeaderRule{
			{
				Operation: config.HeaderRuleOperationPropagate,
				Named:     "Authorization",
			},
			{
				Operation: config.HeaderRuleOperationPropagate,
				Matching:  "(?i)^X-Custom-.*",
			},
		},
	},
}

// runSpeedtrapScenarios is the shared harness for all speedtrap proxy scenarios.
// Each scenario gets its own backend, subgraph server, and router instance.
func runSpeedtrapScenarios(t *testing.T, scenarios []speedtrap.Scenario) {
	t.Helper()
	t.Parallel()

	for _, scenario := range scenarios {
		t.Run(scenario.Name, func(t *testing.T) {
			t.Parallel()

			backendA := speedtrap.NewBackend(speedtrap.WithSubprotocol("graphql-transport-ws"))

			// Start an HTTP server for subgraph-a that routes WS to the speedtrap backend
			subgraphA := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Upgrade") == "websocket" {
					backendA.Handler().ServeHTTP(w, r)
					return
				}
				w.WriteHeader(http.StatusOK)
			}))
			t.Cleanup(subgraphA.Close)

			// Replace placeholder URLs in the speedtrap config with actual test server URLs
			configJSON := strings.ReplaceAll(cosmo.ConfigJSON, cosmo.SubgraphAPlaceholderURL, testenv.GqlURL(subgraphA))

			testenv.Run(t, &testenv.Config{
				RouterConfigJSONTemplate: configJSON,
				ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
					cfg.MinifySubgraphOperations = false
					cfg.DisableVariablesRemapping = true
					cfg.WebSocketClientAckTimeout = 3 * time.Second
				},
				ModifyWebsocketConfiguration: func(cfg *config.WebSocketConfiguration) {
					cfg.ForwardUpgradeHeaders.Enabled = false
					cfg.ForwardUpgradeQueryParams.Enabled = false
					cfg.ForwardInitialPayload = false
				},
				RouterOptions: []core.Option{
					core.WithHeaderRules(speedtrapHeaderRules),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				cfg := speedtrap.HarnessConfig{
					TargetAddr: xEnv.GraphQLWebSocketSubscriptionURL(),
					Backends:   map[string]*speedtrap.Backend{"subgraph-a": backendA},
				}
				speedtrap.RequireScenario(t, cfg, scenario)
			})
		})
	}
}

func TestSpeedtrapScenarios(t *testing.T) {
	t.Run("graphql-transport-ws", func(t *testing.T) {
		runSpeedtrapScenarios(t, graphqltransportws.Scenarios)
	})

	t.Run("graphql-ws", func(t *testing.T) {
		runSpeedtrapScenarios(t, graphqlws.Scenarios)
	})
}

func TestSpeedtrapBenchmark(t *testing.T) {
	t.Parallel()

	for _, sc := range graphqltransportws.BenchScenarios {
		sc.Params = &graphqltransportws.GraphQLFlags{Mux: true, Subs: 2}

		t.Run(sc.Name, func(t *testing.T) {
			t.Parallel()

			backendA := speedtrap.NewBackend(speedtrap.WithSubprotocol("graphql-transport-ws"))

			subgraphA := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Upgrade") == "websocket" {
					backendA.Handler().ServeHTTP(w, r)
					return
				}
				w.WriteHeader(http.StatusOK)
			}))
			t.Cleanup(subgraphA.Close)

			configJSON := strings.ReplaceAll(cosmo.ConfigJSON, cosmo.SubgraphAPlaceholderURL, testenv.GqlURL(subgraphA))

			testenv.Run(t, &testenv.Config{
				RouterConfigJSONTemplate: configJSON,
				ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
					cfg.MinifySubgraphOperations = false
					cfg.DisableVariablesRemapping = true
					cfg.WebSocketClientAckTimeout = 3 * time.Second
				},
				ModifyWebsocketConfiguration: func(cfg *config.WebSocketConfiguration) {
					cfg.ForwardUpgradeHeaders.Enabled = false
					cfg.ForwardUpgradeQueryParams.Enabled = false
					cfg.ForwardInitialPayload = false
				},
				RouterOptions: []core.Option{
					core.WithHeaderRules(speedtrapHeaderRules),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				benchCfg := speedtrap.BenchmarkConfig{
					HarnessConfig: speedtrap.HarnessConfig{
						TargetAddr: xEnv.GraphQLWebSocketSubscriptionURL(),
						Backends:   map[string]*speedtrap.Backend{"subgraph-a": backendA},
						Timeout:    10 * time.Second,
					},
					Params: sc.Params,
				}
				result := sc.Run(benchCfg, speedtrap.LoadConfig{
					VUs:      2,
					Duration: 2 * time.Second,
				})
				require.Empty(t, result.Error, "benchmark setup failed: %s", result.Error)

				latency := result.Metrics["latency"]
				require.NotNil(t, latency, "expected latency metrics")
				require.Greater(t, latency["count"], 0, "expected messages to flow through the router")

				outOfOrder := result.Metrics["out_of_order"]
				require.NotNil(t, outOfOrder)
				require.Equal(t, int64(0), outOfOrder["count"], "messages arrived out of order")

				gaps := result.Metrics["gaps"]
				require.NotNil(t, gaps)
				require.Equal(t, int64(0), gaps["count"], "messages were lost")

				t.Logf("p50=%s  p99=%s  msgs=%v",
					latency["p50"], latency["p99"], latency["count"])
			})
		})
	}
}
