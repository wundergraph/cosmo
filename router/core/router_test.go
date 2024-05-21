package core

import (
	"net/url"
	"testing"

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

	subgraphs, err := router.configureSubgraphOverwrites(routerConfig)
	assert.Nil(t, err)

	parsedURL, err := url.Parse("http://localhost:8080")
	assert.Nil(t, err)

	assert.Equal(t, "http://localhost:8080", routerConfig.Subgraphs[0].RoutingUrl)
	assert.Equal(t, "http://localhost:8080", routerConfig.EngineConfig.DatasourceConfigurations[0].CustomGraphql.Fetch.Url.StaticVariableContent)
	assert.Equal(t, "http://localhost:8000/ws", routerConfig.EngineConfig.DatasourceConfigurations[0].CustomGraphql.Subscription.Url.StaticVariableContent)
	assert.Equal(t, parsedURL, subgraphs[0].Url)
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

	subgraphs, err := router.configureSubgraphOverwrites(routerConfig)
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

	subgraphs, err := router.configureSubgraphOverwrites(routerConfig)
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
