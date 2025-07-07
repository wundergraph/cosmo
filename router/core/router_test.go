package core

import (
	"net/url"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/common"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestOverrideURLConfig(t *testing.T) {
	options := []Option{
		WithOverrideRoutingURL(config.OverrideRoutingURLConfiguration{
			Subgraphs: map[string]string{
				"some-subgraph": "http://localhost:8080",
			},
		}),
	}
	router, err := NewRouter(options...)
	assert.Nil(t, err)

	routerConfig := &nodev1.RouterConfig{
		EngineConfig: &nodev1.EngineConfiguration{
			DatasourceConfigurations: []*nodev1.DataSourceConfiguration{
				{
					Id: "some-subgraph",
					CustomGraphql: &nodev1.DataSourceCustom_GraphQL{
						Fetch: &nodev1.FetchConfiguration{
							Url: &nodev1.ConfigurationVariable{
								StaticVariableContent: "http://localhost:8000",
							},
						},
						Subscription: &nodev1.GraphQLSubscriptionConfiguration{
							Enabled: true,
							Url: &nodev1.ConfigurationVariable{
								StaticVariableContent: "http://localhost:8000/ws",
							},
							Protocol:             common.GraphQLSubscriptionProtocol_GRAPHQL_SUBSCRIPTION_PROTOCOL_WS.Enum(),
							WebsocketSubprotocol: common.GraphQLWebsocketSubprotocol_GRAPHQL_WEBSOCKET_SUBPROTOCOL_AUTO.Enum(),
						},
					},
				},
			},
		},
		Subgraphs: []*nodev1.Subgraph{
			{
				Id:         "some-subgraph",
				Name:       "some-subgraph",
				RoutingUrl: "http://localhost:8000",
			},
		},
	}

	subgraphs, err := configureSubgraphOverwrites(
		routerConfig.EngineConfig,
		routerConfig.Subgraphs,
		router.overrideRoutingURLConfiguration,
		router.overrides,
		false,
	)
	assert.Nil(t, err)

	parsedURL, err := url.Parse("http://localhost:8080")
	assert.Nil(t, err)

	assert.Equal(t, "http://localhost:8080", routerConfig.Subgraphs[0].RoutingUrl)
	assert.Equal(t, "http://localhost:8080", routerConfig.EngineConfig.DatasourceConfigurations[0].CustomGraphql.Fetch.Url.StaticVariableContent)
	assert.Equal(t, "http://localhost:8000/ws", routerConfig.EngineConfig.DatasourceConfigurations[0].CustomGraphql.Subscription.Url.StaticVariableContent)
	assert.Equal(t, parsedURL, subgraphs[0].Url)
}

func TestApqAndSafelistErrors(t *testing.T) {
	options := []Option{
		WithAutomatedPersistedQueriesConfig(config.AutomaticPersistedQueriesConfig{
			Enabled: true,
		}),
		WithPersistedOperationsConfig(config.PersistedOperationsConfig{
			Safelist: config.SafelistConfiguration{
				Enabled: true,
			},
		}),
	}
	_, err := NewRouter(options...)
	assert.NotNil(t, err)
	assert.Contains(t, err.Error(), "automatic persisted queries and safelist cannot be enabled at the same time (as APQ would permit queries that are not in the safelist)")
}

func TestOverridesConfig(t *testing.T) {
	options := []Option{
		WithOverrides(config.OverridesConfiguration{
			Subgraphs: map[string]config.SubgraphOverridesConfiguration{
				"some-subgraph": {
					RoutingURL:                       "http://localhost:8080",
					SubscriptionURL:                  "http://localhost:8080/ws",
					SubscriptionProtocol:             "ws",
					SubscriptionWebsocketSubprotocol: "graphql-ws",
				},
			},
		}),
	}
	router, err := NewRouter(options...)
	assert.Nil(t, err)

	routerConfig := &nodev1.RouterConfig{
		EngineConfig: &nodev1.EngineConfiguration{
			DatasourceConfigurations: []*nodev1.DataSourceConfiguration{
				{
					Id: "some-subgraph",
					CustomGraphql: &nodev1.DataSourceCustom_GraphQL{
						Fetch: &nodev1.FetchConfiguration{
							Url: &nodev1.ConfigurationVariable{
								StaticVariableContent: "http://localhost:8000",
							},
						},
						Subscription: &nodev1.GraphQLSubscriptionConfiguration{
							Enabled: true,
							Url: &nodev1.ConfigurationVariable{
								StaticVariableContent: "http://localhost:8000/ws",
							},
							Protocol:             common.GraphQLSubscriptionProtocol_GRAPHQL_SUBSCRIPTION_PROTOCOL_SSE.Enum(),
							WebsocketSubprotocol: common.GraphQLWebsocketSubprotocol_GRAPHQL_WEBSOCKET_SUBPROTOCOL_AUTO.Enum(),
						},
					},
				},
			},
		},
		Subgraphs: []*nodev1.Subgraph{
			{
				Id:         "some-subgraph",
				Name:       "some-subgraph",
				RoutingUrl: "http://localhost:8000",
			},
		},
	}

	subgraphs, err := configureSubgraphOverwrites(
		routerConfig.EngineConfig,
		routerConfig.Subgraphs,
		router.overrideRoutingURLConfiguration,
		router.overrides,
		false,
	)
	assert.Nil(t, err)

	parsedURL, err := url.Parse("http://localhost:8080")
	assert.Nil(t, err)

	assert.Equal(t, "http://localhost:8080", routerConfig.Subgraphs[0].RoutingUrl)
	assert.Equal(t, "http://localhost:8080", routerConfig.EngineConfig.DatasourceConfigurations[0].CustomGraphql.Fetch.Url.StaticVariableContent)
	assert.Equal(t, "http://localhost:8080/ws", routerConfig.EngineConfig.DatasourceConfigurations[0].CustomGraphql.Subscription.Url.StaticVariableContent)
	assert.Equal(t, common.GraphQLSubscriptionProtocol_GRAPHQL_SUBSCRIPTION_PROTOCOL_WS.Enum(), routerConfig.EngineConfig.DatasourceConfigurations[0].CustomGraphql.Subscription.Protocol)
	assert.Equal(t, common.GraphQLWebsocketSubprotocol_GRAPHQL_WEBSOCKET_SUBPROTOCOL_WS.Enum(), routerConfig.EngineConfig.DatasourceConfigurations[0].CustomGraphql.Subscription.WebsocketSubprotocol)
	assert.Equal(t, parsedURL, subgraphs[0].Url)
}

func TestOverridesPriority(t *testing.T) {
	options := []Option{
		WithOverrideRoutingURL(config.OverrideRoutingURLConfiguration{
			Subgraphs: map[string]string{
				"some-subgraph": "http://localhost:8081",
			},
		}),
		WithOverrides(config.OverridesConfiguration{
			Subgraphs: map[string]config.SubgraphOverridesConfiguration{
				"some-subgraph": {
					RoutingURL:                       "http://localhost:8080",
					SubscriptionURL:                  "http://localhost:8080/ws",
					SubscriptionProtocol:             "ws",
					SubscriptionWebsocketSubprotocol: "graphql-ws",
				},
			},
		}),
	}
	router, err := NewRouter(options...)
	assert.Nil(t, err)

	routerConfig := &nodev1.RouterConfig{
		EngineConfig: &nodev1.EngineConfiguration{
			DatasourceConfigurations: []*nodev1.DataSourceConfiguration{
				{
					Id: "some-subgraph",
					CustomGraphql: &nodev1.DataSourceCustom_GraphQL{
						Fetch: &nodev1.FetchConfiguration{
							Url: &nodev1.ConfigurationVariable{
								StaticVariableContent: "http://localhost:8000",
							},
						},
						Subscription: &nodev1.GraphQLSubscriptionConfiguration{
							Enabled: true,
							Url: &nodev1.ConfigurationVariable{
								StaticVariableContent: "http://localhost:8000/ws",
							},
							Protocol:             common.GraphQLSubscriptionProtocol_GRAPHQL_SUBSCRIPTION_PROTOCOL_SSE.Enum(),
							WebsocketSubprotocol: common.GraphQLWebsocketSubprotocol_GRAPHQL_WEBSOCKET_SUBPROTOCOL_AUTO.Enum(),
						},
					},
				},
			},
		},
		Subgraphs: []*nodev1.Subgraph{
			{
				Id:         "some-subgraph",
				Name:       "some-subgraph",
				RoutingUrl: "http://localhost:8000",
			},
		},
	}

	subgraphs, err := configureSubgraphOverwrites(
		routerConfig.EngineConfig,
		routerConfig.Subgraphs,
		router.overrideRoutingURLConfiguration,
		router.overrides,
		false,
	)
	assert.Nil(t, err)

	parsedURL, err := url.Parse("http://localhost:8080")
	assert.Nil(t, err)

	assert.Equal(t, "http://localhost:8080", routerConfig.Subgraphs[0].RoutingUrl)
	assert.Equal(t, "http://localhost:8080", routerConfig.EngineConfig.DatasourceConfigurations[0].CustomGraphql.Fetch.Url.StaticVariableContent)
	assert.Equal(t, "http://localhost:8080/ws", routerConfig.EngineConfig.DatasourceConfigurations[0].CustomGraphql.Subscription.Url.StaticVariableContent)
	assert.Equal(t, common.GraphQLSubscriptionProtocol_GRAPHQL_SUBSCRIPTION_PROTOCOL_WS.Enum(), routerConfig.EngineConfig.DatasourceConfigurations[0].CustomGraphql.Subscription.Protocol)
	assert.Equal(t, common.GraphQLWebsocketSubprotocol_GRAPHQL_WEBSOCKET_SUBPROTOCOL_WS.Enum(), routerConfig.EngineConfig.DatasourceConfigurations[0].CustomGraphql.Subscription.WebsocketSubprotocol)
	assert.Equal(t, parsedURL, subgraphs[0].Url)
}

func TestTrafficShapingRules(t *testing.T) {
	allRequestTimeout := 10 * time.Second
	allDialTimeout := 0 * time.Second
	subgraphRequestTimeout := 15 * time.Second
	subgraphDialTimeout := 0 * time.Second

	defaults := DefaultTransportRequestOptions()

	config := config.TrafficShapingRules{
		All: config.GlobalSubgraphRequestRule{
			RequestTimeout: &allRequestTimeout,
			DialTimeout:    &allDialTimeout,
		},
		Subgraphs: map[string]*config.GlobalSubgraphRequestRule{
			"some-subgraph": {
				RequestTimeout: &subgraphRequestTimeout,
				DialTimeout:    &subgraphDialTimeout,
			},
		},
	}

	options := []Option{
		WithSubgraphTransportOptions(NewSubgraphTransportOptions(config)),
	}
	router, err := NewRouter(options...)
	assert.Nil(t, err)

	// Assert that configs are loaded for real, zero and absent values.
	assert.Equal(t, allRequestTimeout, router.subgraphTransportOptions.RequestTimeout)
	assert.Equal(t, allDialTimeout, router.subgraphTransportOptions.DialTimeout)
	assert.Equal(t, defaults.MaxIdleConns, router.subgraphTransportOptions.MaxIdleConns)

	assert.Equal(t, subgraphRequestTimeout, router.subgraphTransportOptions.SubgraphMap["some-subgraph"].RequestTimeout)
	assert.Equal(t, subgraphDialTimeout, router.subgraphTransportOptions.SubgraphMap["some-subgraph"].DialTimeout)
	assert.Equal(t, defaults.MaxIdleConns, router.subgraphTransportOptions.SubgraphMap["some-subgraph"].MaxIdleConns)
}

// Confirms that defaults and fallthrough works properly
func TestNewTransportRequestOptions(t *testing.T) {
	defaults := DefaultTransportRequestOptions()

	subgraphRequestTimeout := 10 * time.Second
	subgraphDialTimeout := 0 * time.Second
	subgraphConfig := &config.GlobalSubgraphRequestRule{
		RequestTimeout: &subgraphRequestTimeout,
		DialTimeout:    &subgraphDialTimeout,
	}

	// Test that the defaults are set properly
	transportCfg := NewTransportRequestOptions(*subgraphConfig)

	// The two set values are preserved, including the manually specified zero
	assert.Equal(t, subgraphRequestTimeout, transportCfg.RequestTimeout)
	assert.Equal(t, subgraphDialTimeout, transportCfg.DialTimeout)

	// The rest of the values are set to the defaults
	assert.Equal(t, defaults.MaxIdleConns, transportCfg.MaxIdleConns)
	assert.Equal(t, defaults.MaxIdleConnsPerHost, transportCfg.MaxIdleConnsPerHost)
}
