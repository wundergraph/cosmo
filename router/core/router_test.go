package core

import (
	"context"
	"net/url"
	"slices"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/common"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/mcpserver"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
)

func TestOverrideURLConfig(t *testing.T) {
	options := []Option{
		WithOverrideRoutingURL(config.OverrideRoutingURLConfiguration{
			Subgraphs: map[string]string{
				"some-subgraph": "http://localhost:8080",
			},
		}),
	}
	router, err := NewRouter(t.Context(), options...)
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
	_, err := NewRouter(t.Context(), options...)
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
	router, err := NewRouter(t.Context(), options...)
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
	router, err := NewRouter(t.Context(), options...)
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
		router, err := NewRouter(t.Context(), options...)
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

		router, err := NewRouter(t.Context(), options...)
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
		router, err := NewRouter(t.Context(), options...)
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
		router, err := NewRouter(t.Context(), options...)
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

func TestMCPServersMapMountsEachServerOnItsPath(t *testing.T) {
	t.Parallel()

	cfg := config.MCPConfiguration{
		Enabled: true,
		Servers: map[string]config.MCPServerEntry{
			"support": {Enabled: true, Path: "/mcp/support"},
			"billing": {Enabled: true, Path: "/billing/mcp"},
		},
	}

	host, err := buildMCPHost(context.Background(), mcpHostDeps{
		cfg:             cfg,
		logger:          zap.NewNop(),
		graphqlEndpoint: "http://localhost:3002/graphql",
		routerVersion:   "test",
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = host.Stop(context.Background()) })

	paths := make([]string, 0, len(host.Servers()))
	for _, s := range host.Servers() {
		paths = append(paths, s.MountPath())
	}
	slices.Sort(paths)

	require.Equal(t, []string{"/billing/mcp", "/mcp/support"}, paths)
}

func TestMCPServersMapRejectsDuplicatePaths(t *testing.T) {
	t.Parallel()

	cfg := config.MCPConfiguration{
		Enabled: true,
		Servers: map[string]config.MCPServerEntry{
			"support": {Enabled: true, Path: "/mcp"},
			"billing": {Enabled: true, Path: "/mcp"},
		},
	}

	_, err := buildMCPHost(context.Background(), mcpHostDeps{
		cfg:             cfg,
		logger:          zap.NewNop(),
		graphqlEndpoint: "http://localhost:3002/graphql",
		routerVersion:   "test",
	})
	require.ErrorContains(t, err, "use the same path")
}

// TestMCPDeprecatedOptionsBuildOneServerOnDefaultPath covers the deprecated
// path: no mcp.servers entries means exactly one server, on DefaultMountPath,
// so an existing config keeps working unchanged.
func TestMCPDeprecatedOptionsBuildOneServerOnDefaultPath(t *testing.T) {
	t.Parallel()

	cfg := config.MCPConfiguration{
		Enabled:   true,
		GraphName: "legacy-graph",
	}

	host, err := buildMCPHost(context.Background(), mcpHostDeps{
		cfg:             cfg,
		logger:          zap.NewNop(),
		graphqlEndpoint: "http://localhost:3002/graphql",
		routerVersion:   "test",
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = host.Stop(context.Background()) })

	servers := host.Servers()
	require.Len(t, servers, 1)
	require.Equal(t, mcpserver.DefaultMountPath, servers[0].MountPath())
}

// TestDeprecatedServerEntryCarriesTopLevelOptions asserts that every
// deprecated top-level mcp option actually reaches the single server built
// from it. GraphQLSchemaServer exposes no getters for most of these fields,
// so this checks the adapter that feeds them in, deprecatedServerEntry,
// directly.
func TestDeprecatedServerEntryCarriesTopLevelOptions(t *testing.T) {
	t.Parallel()

	cfg := config.MCPConfiguration{
		Enabled:                   true,
		GraphName:                 "legacy-graph",
		ExcludeMutations:          true,
		EnableArbitraryOperations: true,
		ExposeSchema:              true,
		OmitToolNamePrefix:        true,
		ResourceDocumentation:     "https://example.com/docs",
		Storage: config.MCPStorageConfig{
			ProviderID: "legacy-fs",
		},
		Server: config.MCPServer{
			BaseURL:     "https://example.com",
			Title:       "Legacy",
			Description: "Legacy MCP server",
			Version:     "1.2.3",
		},
	}

	entry := deprecatedServerEntry(cfg)

	require.True(t, entry.Enabled)
	require.Equal(t, mcpserver.DefaultMountPath, entry.Path)
	require.Equal(t, "legacy-graph", entry.GraphName)
	require.True(t, entry.ExcludeMutations)
	require.True(t, entry.EnableArbitraryOperations)
	require.True(t, entry.ExposeSchema)
	require.True(t, entry.OmitToolNamePrefix)
	require.Equal(t, "https://example.com/docs", entry.ResourceDocumentation)
	require.Equal(t, "legacy-fs", entry.Storage.ProviderID)
	require.Equal(t, "https://example.com", entry.BaseURL)
	require.Equal(t, "Legacy", entry.Title)
	require.Equal(t, "Legacy MCP server", entry.Description)
	require.Equal(t, "1.2.3", entry.Version)
}

// TestMCPGraphQLEndpointUsesRouterURLOnDeprecatedPath asserts that
// mcp.router_url still redirects the single deprecated-path server, keeping
// existing deployments that set it working unchanged.
func TestMCPGraphQLEndpointUsesRouterURLOnDeprecatedPath(t *testing.T) {
	t.Parallel()

	cfg := config.MCPConfiguration{
		Enabled:   true,
		RouterURL: "http://deprecated.example/graphql",
	}

	got := mcpGraphQLEndpoint(cfg, "http://router.example/graphql", true)
	require.Equal(t, "http://deprecated.example/graphql", got)
}

// TestMCPGraphQLEndpointIgnoresRouterURLForServersMap asserts that
// mcp.router_url does NOT leak into servers built from mcp.servers, even
// when both are set at once. Without this, every map-based server would be
// silently redirected to router_url while warnIgnoredDeprecatedMCPOptions
// simultaneously tells the user it was ignored.
func TestMCPGraphQLEndpointIgnoresRouterURLForServersMap(t *testing.T) {
	t.Parallel()

	cfg := config.MCPConfiguration{
		Enabled:   true,
		RouterURL: "http://deprecated.example/graphql",
		Servers: map[string]config.MCPServerEntry{
			"support": {Enabled: true, Path: "/mcp/support"},
		},
	}

	got := mcpGraphQLEndpoint(cfg, "http://router.example/graphql", false)
	require.Equal(t, "http://router.example/graphql", got)
}

// TestWarnIgnoredDeprecatedMCPOptionsSkipsUntouchedGraphName asserts that
// mcp.graph_name is not reported as ignored merely because it carries its
// envDefault value. GraphName defaults to "mygraph" via env.Parse before the
// YAML merge, so a bare non-empty check would warn on every mcp.servers
// deployment regardless of whether the user ever set it.
func TestWarnIgnoredDeprecatedMCPOptionsSkipsUntouchedGraphName(t *testing.T) {
	t.Parallel()

	cfg := config.MCPConfiguration{
		Enabled:   true,
		GraphName: defaultMCPGraphName,
		Servers: map[string]config.MCPServerEntry{
			"support": {Enabled: true, Path: "/mcp/support"},
		},
	}

	obsCore, logs := observer.New(zapcore.WarnLevel)
	logger := zap.New(obsCore)

	warnIgnoredDeprecatedMCPOptions(cfg, logger)

	for _, entry := range logs.All() {
		for _, field := range entry.Context {
			if field.Key == "ignored_options" {
				require.NotContains(t, field.Interface, "mcp.graph_name")
			}
		}
	}
}

// TestBuildMCPHostClosesAlreadyRegisteredServersOnFailure covers a
// multi-entry config where a later entry fails after earlier entries were
// already registered on the host. Register does not take ownership on
// failure and newMCPServerFromEntry can fail for reasons ValidateServers
// cannot catch statically (here: an unknown storage provider id), so
// buildMCPHost must guarantee cleanup of everything registered so far.
//
// GraphQLSchemaServer exposes no way to observe from outside the mcpserver
// package whether Close (and the context cancellation it drives) actually
// ran on the earlier, already-registered server, so this test cannot assert
// "the first server was closed" directly. What it does assert: the call
// fails, the error names the failing entry (not the one that already
// succeeded), and no host is handed back for the caller to accidentally
// use half-built. The cleanup guarantee itself is enforced by the
// success-flag/defer construction in buildMCPHost, which runs host.Stop on
// every early return, verified by reading the implementation.
func TestBuildMCPHostClosesAlreadyRegisteredServersOnFailure(t *testing.T) {
	t.Parallel()

	cfg := config.MCPConfiguration{
		Enabled: true,
		Servers: map[string]config.MCPServerEntry{
			"a-first": {Enabled: true, Path: "/mcp/a"},
			"b-second": {
				Enabled: true,
				Path:    "/mcp/b",
				Storage: config.MCPStorageConfig{ProviderID: "missing-provider"},
			},
			"c-third": {Enabled: true, Path: "/mcp/c"},
		},
	}

	host, err := buildMCPHost(context.Background(), mcpHostDeps{
		cfg:              cfg,
		logger:           zap.NewNop(),
		graphqlEndpoint:  "http://localhost:3002/graphql",
		routerVersion:    "test",
		providerRegistry: &ProviderRegistry{},
	})

	require.Nil(t, host)
	require.ErrorContains(t, err, "b-second")
	require.ErrorContains(t, err, "missing-provider")
}

// TestResolveMCPServerStatelessDefaultsToTrue covers an mcp.servers entry
// that never sets session.stateless. The deprecated top-level path gets
// Stateless=true from MCPSessionConfig's envDefault:"true" tag, but env.Parse
// cannot reach a map entry, so entry.Session.Stateless would be the Go zero
// value if MCPServerSessionConfig used a plain bool. resolveMCPServerStateless
// must restore the documented default (true) for the unset case.
//
// GraphQLSchemaServer exposes no getter for its internal stateless field, so
// this asserts the resolution helper directly, per the package's established
// pattern (see TestBuildMCPHostClosesAlreadyRegisteredServersOnFailure above)
// for testing what package core can actually observe.
func TestResolveMCPServerStatelessDefaultsToTrue(t *testing.T) {
	t.Parallel()

	entry := config.MCPServerEntry{Enabled: true, Path: "/mcp"}

	require.True(t, resolveMCPServerStateless(entry))
}

// TestResolveMCPServerStatelessRespectsExplicitFalse covers an mcp.servers
// entry that explicitly sets session.stateless: false. This is the assertion
// that proves *bool actually distinguishes "unset" from "explicitly false":
// a plain bool cannot, and a naive "zero value means default" fix would make
// this case indistinguishable from the unset case in
// TestResolveMCPServerStatelessDefaultsToTrue above.
func TestResolveMCPServerStatelessRespectsExplicitFalse(t *testing.T) {
	t.Parallel()

	stateless := false
	entry := config.MCPServerEntry{
		Enabled: true,
		Path:    "/mcp",
		Session: config.MCPServerSessionConfig{Stateless: &stateless},
	}

	require.False(t, resolveMCPServerStateless(entry))
}

// TestResolveMCPServerMaxScopeCombinationsDefaultsTo2048 covers an
// mcp.servers entry that never sets oauth.max_scope_combinations. The
// deprecated top-level path gets 2048 from MCPOAuthConfiguration's
// envDefault:"2048" tag, but env.Parse cannot reach a map entry, so
// entry.OAuth.MaxScopeCombinations is 0 unless resolved. A limit of 0 makes
// crossProduct (scope_extractor.go) reject every non-empty cross product,
// so ComputeToolScopes fails and the server registers zero tools: any
// OAuth-enabled map server with @requiresScopes directives would be
// functionally dead without this fallback.
func TestResolveMCPServerMaxScopeCombinationsDefaultsTo2048(t *testing.T) {
	t.Parallel()

	entry := config.MCPServerEntry{
		Enabled: true,
		Path:    "/mcp",
		OAuth:   config.MCPOAuthConfiguration{Enabled: true},
	}

	require.Equal(t, 2048, resolveMCPServerMaxScopeCombinations(entry))
}

// TestResolveMCPServerMaxScopeCombinationsRespectsExplicitValue covers an
// mcp.servers entry that sets its own oauth.max_scope_combinations. The
// fallback in resolveMCPServerMaxScopeCombinations must not override an
// explicit user value.
func TestResolveMCPServerMaxScopeCombinationsRespectsExplicitValue(t *testing.T) {
	t.Parallel()

	entry := config.MCPServerEntry{
		Enabled: true,
		Path:    "/mcp",
		OAuth:   config.MCPOAuthConfiguration{Enabled: true, MaxScopeCombinations: 64},
	}

	require.Equal(t, 64, resolveMCPServerMaxScopeCombinations(entry))
}

// TestResolveMCPServerOAuthAppliesFallbackForServersMap covers an
// mcp.servers entry (fromServersMap: true) with OAuth enabled and
// max_scope_combinations unset. The resolved OAuth config handed to
// mcpserver.WithOAuth must carry 2048, not 0, or the server registers zero
// tools for any @requiresScopes-protected operation. See
// defaultMCPServerMaxScopeCombinations.
func TestResolveMCPServerOAuthAppliesFallbackForServersMap(t *testing.T) {
	t.Parallel()

	entry := config.MCPServerEntry{
		Enabled: true,
		Path:    "/mcp",
		OAuth:   config.MCPOAuthConfiguration{Enabled: true},
	}

	oauth := resolveMCPServerOAuth(entry, true)

	require.Equal(t, 2048, oauth.MaxScopeCombinations)
}

// TestResolveMCPServerOAuthLeavesDeprecatedPathUntouched is the regression
// test for the finding that the first version of this fix silently
// coerced an operator-set 0 to 2048 on the deprecated top-level path too.
// deprecatedServerEntry funnels the top-level options through the same
// MCPServerEntry shape as mcp.servers, so without gating on fromServersMap,
// resolveMCPServerOAuth could not tell "unset map entry" (should become
// 2048) apart from "operator explicitly configured 0 at the top level"
// (must stay 0, whatever failure that produces downstream). This asserts
// fromServersMap: false leaves an explicit 0 as 0.
func TestResolveMCPServerOAuthLeavesDeprecatedPathUntouched(t *testing.T) {
	t.Parallel()

	entry := config.MCPServerEntry{
		Enabled: true,
		Path:    "/mcp",
		OAuth:   config.MCPOAuthConfiguration{Enabled: true, MaxScopeCombinations: 0},
	}

	oauth := resolveMCPServerOAuth(entry, false)

	require.Equal(t, 0, oauth.MaxScopeCombinations)
}
