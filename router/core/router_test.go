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
	t.Run("loads defaults correctly when empty", func(t *testing.T) {
		config := config.TrafficShapingRules{
			All: config.GlobalSubgraphRequestRule{},
		}

		defaults := DefaultTransportRequestOptions()

		options := []Option{
			WithSubgraphTransportOptions(NewSubgraphTransportOptions(config)),
		}
		router, err := NewRouter(options...)
		assert.Nil(t, err)

		// Assert that configs are properly loaded from defaults when empty
		assert.Equal(t, defaults.RequestTimeout, router.subgraphTransportOptions.RequestTimeout)
		assert.Equal(t, defaults.TLSHandshakeTimeout, router.subgraphTransportOptions.TLSHandshakeTimeout)
		assert.Equal(t, defaults.ResponseHeaderTimeout, router.subgraphTransportOptions.ResponseHeaderTimeout)
		assert.Equal(t, defaults.ExpectContinueTimeout, router.subgraphTransportOptions.ExpectContinueTimeout)
		assert.Equal(t, defaults.KeepAliveProbeInterval, router.subgraphTransportOptions.KeepAliveProbeInterval)
		assert.Equal(t, defaults.KeepAliveIdleTimeout, router.subgraphTransportOptions.KeepAliveIdleTimeout)
		assert.Equal(t, defaults.DialTimeout, router.subgraphTransportOptions.DialTimeout)
		assert.Equal(t, defaults.MaxConnsPerHost, router.subgraphTransportOptions.MaxConnsPerHost)
		assert.Equal(t, defaults.MaxIdleConns, router.subgraphTransportOptions.MaxIdleConns)
		assert.Equal(t, defaults.MaxIdleConnsPerHost, router.subgraphTransportOptions.MaxIdleConnsPerHost)
	})

	t.Run("loads set values over defaults when populated", func(t *testing.T) {
		allRequestTimeout := 60 * time.Second
		allTLSHandshakeTimeout := 10 * time.Second
		allResponseHeaderTimeout := 0 * time.Second
		allExpectContinueTimeout := 0 * time.Second
		allKeepAliveProbeInterval := 30 * time.Second
		allKeepAliveIdleTimeout := 90 * time.Second
		allDialTimeout := 30 * time.Second
		allMaxConnsPerHost := 100
		allMaxIdleConns := 1024
		allMaxIdleConnsPerHost := 20

		config := config.TrafficShapingRules{
			All: config.GlobalSubgraphRequestRule{
				RequestTimeout:         &allRequestTimeout,
				TLSHandshakeTimeout:    &allTLSHandshakeTimeout,
				ResponseHeaderTimeout:  &allResponseHeaderTimeout,
				ExpectContinueTimeout:  &allExpectContinueTimeout,
				KeepAliveProbeInterval: &allKeepAliveProbeInterval,
				KeepAliveIdleTimeout:   &allKeepAliveIdleTimeout,
				DialTimeout:            &allDialTimeout,
				MaxConnsPerHost:        &allMaxConnsPerHost,
				MaxIdleConns:           &allMaxIdleConns,
				MaxIdleConnsPerHost:    &allMaxIdleConnsPerHost,
			},
		}

		options := []Option{
			WithSubgraphTransportOptions(NewSubgraphTransportOptions(config)),
		}

		router, err := NewRouter(options...)
		assert.Nil(t, err)

		// Assert that configs are properly loaded over defaults when populated
		assert.Equal(t, allRequestTimeout, router.subgraphTransportOptions.RequestTimeout)
		assert.Equal(t, allDialTimeout, router.subgraphTransportOptions.DialTimeout)
		assert.Equal(t, allMaxConnsPerHost, router.subgraphTransportOptions.MaxConnsPerHost)
		assert.Equal(t, allTLSHandshakeTimeout, router.subgraphTransportOptions.TLSHandshakeTimeout)
		assert.Equal(t, allResponseHeaderTimeout, router.subgraphTransportOptions.ResponseHeaderTimeout)
		assert.Equal(t, allExpectContinueTimeout, router.subgraphTransportOptions.ExpectContinueTimeout)
		assert.Equal(t, allKeepAliveProbeInterval, router.subgraphTransportOptions.KeepAliveProbeInterval)
		assert.Equal(t, allKeepAliveIdleTimeout, router.subgraphTransportOptions.KeepAliveIdleTimeout)
		assert.Equal(t, allMaxIdleConns, router.subgraphTransportOptions.MaxIdleConns)
		assert.Equal(t, allMaxIdleConnsPerHost, router.subgraphTransportOptions.MaxIdleConnsPerHost)
	})

	t.Run("falls through to defaults when partially populated", func(t *testing.T) {
		allRequestTimeout := 60 * time.Second

		config := config.TrafficShapingRules{
			All: config.GlobalSubgraphRequestRule{
				RequestTimeout: &allRequestTimeout,
			},
		}

		defaults := DefaultTransportRequestOptions()

		options := []Option{
			WithSubgraphTransportOptions(NewSubgraphTransportOptions(config)),
		}
		router, err := NewRouter(options...)
		assert.Nil(t, err)

		// Loads the populated value
		assert.Equal(t, allRequestTimeout, router.subgraphTransportOptions.RequestTimeout)

		// Falls through to defaults when not set
		assert.Equal(t, defaults.TLSHandshakeTimeout, router.subgraphTransportOptions.TLSHandshakeTimeout)
		assert.Equal(t, defaults.ResponseHeaderTimeout, router.subgraphTransportOptions.ResponseHeaderTimeout)
		assert.Equal(t, defaults.ExpectContinueTimeout, router.subgraphTransportOptions.ExpectContinueTimeout)
		assert.Equal(t, defaults.KeepAliveProbeInterval, router.subgraphTransportOptions.KeepAliveProbeInterval)
		assert.Equal(t, defaults.KeepAliveIdleTimeout, router.subgraphTransportOptions.KeepAliveIdleTimeout)
		assert.Equal(t, defaults.DialTimeout, router.subgraphTransportOptions.DialTimeout)
		assert.Equal(t, defaults.MaxConnsPerHost, router.subgraphTransportOptions.MaxConnsPerHost)
		assert.Equal(t, defaults.MaxIdleConns, router.subgraphTransportOptions.MaxIdleConns)
		assert.Equal(t, defaults.MaxIdleConnsPerHost, router.subgraphTransportOptions.MaxIdleConnsPerHost)
	})

	t.Run("loads subgraph specific options with fallback to all and defaults", func(t *testing.T) {
		allRequestTimeout := 10 * time.Second
		allDialTimeout := 0 * time.Second
		allMaxConnsPerHost := 1024

		subgraphRequestTimeout := 15 * time.Second
		subgraphDialTimeout := 0 * time.Second

		defaults := DefaultTransportRequestOptions()

		config := config.TrafficShapingRules{
			All: config.GlobalSubgraphRequestRule{
				RequestTimeout:  &allRequestTimeout,
				DialTimeout:     &allDialTimeout,
				MaxConnsPerHost: &allMaxConnsPerHost,
			},
			Subgraphs: map[string]config.GlobalSubgraphRequestRule{
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
		assert.Equal(t, allMaxConnsPerHost, router.subgraphTransportOptions.MaxConnsPerHost)
		assert.Equal(t, defaults.MaxIdleConns, router.subgraphTransportOptions.MaxIdleConns)

		subgraphRequestOptions := router.subgraphTransportOptions.SubgraphMap["some-subgraph"]

		// Subgraph specific configurations
		assert.Equal(t, subgraphRequestTimeout, subgraphRequestOptions.RequestTimeout)
		assert.Equal(t, subgraphDialTimeout, subgraphRequestOptions.DialTimeout)

		// Inherit from `all`
		assert.Equal(t, allMaxConnsPerHost, subgraphRequestOptions.MaxConnsPerHost)

		// Inherit from global defaults
		assert.Equal(t, defaults.MaxIdleConns, subgraphRequestOptions.MaxIdleConns)
	})
}

// Confirms that defaults and fallthrough works properly
func TestNewTransportRequestOptions(t *testing.T) {
	defaults := DefaultTransportRequestOptions()

	subgraphRequestTimeout := 10 * time.Second
	subgraphDialTimeout := 0 * time.Second
	subgraphConfig := config.GlobalSubgraphRequestRule{
		RequestTimeout: &subgraphRequestTimeout,
		DialTimeout:    &subgraphDialTimeout,
	}

	// Test that the defaults are set properly
	transportCfg := NewTransportRequestOptions(subgraphConfig, nil)

	// The two set values are preserved, including the manually specified zero
	assert.Equal(t, subgraphRequestTimeout, transportCfg.RequestTimeout)
	assert.Equal(t, subgraphDialTimeout, transportCfg.DialTimeout)

	// The rest of the values are set to the defaults
	assert.Equal(t, defaults.MaxIdleConns, transportCfg.MaxIdleConns)
	assert.Equal(t, defaults.MaxIdleConnsPerHost, transportCfg.MaxIdleConnsPerHost)
}
