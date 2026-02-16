package core

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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

// generateTestCert creates a self-signed certificate and key in the given directory.
// Returns the paths to the cert and key files.
func generateTestCert(t *testing.T, dir, prefix string) (certPath, keyPath string) {
	t.Helper()

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)

	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: prefix + "-test"},
		NotBefore:    time.Now(),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		IsCA:         true,
		BasicConstraintsValid: true,
	}

	certDER, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	require.NoError(t, err)

	certPath = filepath.Join(dir, prefix+".crt")
	certFile, err := os.Create(certPath)
	require.NoError(t, err)
	require.NoError(t, pem.Encode(certFile, &pem.Block{Type: "CERTIFICATE", Bytes: certDER}))
	certFile.Close()

	keyPath = filepath.Join(dir, prefix+".key")
	keyFile, err := os.Create(keyPath)
	require.NoError(t, err)
	keyDER, err := x509.MarshalECPrivateKey(key)
	require.NoError(t, err)
	require.NoError(t, pem.Encode(keyFile, &pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}))
	keyFile.Close()

	return certPath, keyPath
}

func TestBuildTLSClientConfig(t *testing.T) {
	t.Run("returns nil for nil input", func(t *testing.T) {
		tlsCfg, err := buildTLSClientConfig(nil)
		assert.NoError(t, err)
		assert.Nil(t, tlsCfg)
	})

	t.Run("returns config with insecure_skip_ca_verification only", func(t *testing.T) {
		tlsCfg, err := buildTLSClientConfig(&config.TLSClientCertConfiguration{
			InsecureSkipCaVerification: true,
		})
		assert.NoError(t, err)
		require.NotNil(t, tlsCfg)
		assert.True(t, tlsCfg.InsecureSkipVerify)
		assert.Empty(t, tlsCfg.Certificates)
		assert.Nil(t, tlsCfg.RootCAs)
	})

	t.Run("loads client cert and key", func(t *testing.T) {
		dir := t.TempDir()
		certPath, keyPath := generateTestCert(t, dir, "client")

		tlsCfg, err := buildTLSClientConfig(&config.TLSClientCertConfiguration{
			CertificateChain: certPath,
			Key:     keyPath,
		})
		assert.NoError(t, err)
		require.NotNil(t, tlsCfg)
		assert.Len(t, tlsCfg.Certificates, 1)
	})

	t.Run("loads CA file", func(t *testing.T) {
		dir := t.TempDir()
		certPath, _ := generateTestCert(t, dir, "ca")

		tlsCfg, err := buildTLSClientConfig(&config.TLSClientCertConfiguration{
			CaFile: certPath,
		})
		assert.NoError(t, err)
		require.NotNil(t, tlsCfg)
		assert.NotNil(t, tlsCfg.RootCAs)
	})

	t.Run("errors on invalid cert path", func(t *testing.T) {
		_, err := buildTLSClientConfig(&config.TLSClientCertConfiguration{
			CertificateChain: "/nonexistent/cert.pem",
			Key:     "/nonexistent/key.pem",
		})
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "failed to load client TLS cert and key")
	})

	t.Run("errors on invalid CA path", func(t *testing.T) {
		_, err := buildTLSClientConfig(&config.TLSClientCertConfiguration{
			CaFile: "/nonexistent/ca.pem",
		})
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "failed to read client TLS CA file")
	})
}

func TestBuildSubgraphTLSConfigs(t *testing.T) {
	t.Run("returns nil when no TLS configured", func(t *testing.T) {
		cfg := &config.SubgraphTLSConfiguration{}
		defaultTLS, perSubgraphTLS, err := buildSubgraphTLSConfigs(cfg)
		assert.NoError(t, err)
		assert.Nil(t, defaultTLS)
		assert.Nil(t, perSubgraphTLS)
	})

	t.Run("builds global client TLS config", func(t *testing.T) {
		dir := t.TempDir()
		certPath, keyPath := generateTestCert(t, dir, "client")
		caPath, _ := generateTestCert(t, dir, "ca")

		cfg := &config.SubgraphTLSConfiguration{
			All: config.TLSClientCertConfiguration{
				CertificateChain: certPath,
				Key:              keyPath,
				CaFile:           caPath,
			},
		}

		defaultTLS, perSubgraphTLS, err := buildSubgraphTLSConfigs(cfg)
		assert.NoError(t, err)
		require.NotNil(t, defaultTLS)
		assert.Len(t, defaultTLS.Certificates, 1)
		assert.NotNil(t, defaultTLS.RootCAs)
		assert.Empty(t, perSubgraphTLS)
	})

	t.Run("builds per-subgraph TLS config", func(t *testing.T) {
		dir := t.TempDir()
		certPath, keyPath := generateTestCert(t, dir, "products")

		cfg := &config.SubgraphTLSConfiguration{
			Subgraphs: map[string]config.TLSClientCertConfiguration{
				"products": {
					CertificateChain: certPath,
					Key:              keyPath,
				},
			},
		}

		defaultTLS, perSubgraphTLS, err := buildSubgraphTLSConfigs(cfg)
		assert.NoError(t, err)
		assert.Nil(t, defaultTLS)
		require.Contains(t, perSubgraphTLS, "products")
		assert.Len(t, perSubgraphTLS["products"].Certificates, 1)
	})

	t.Run("builds both global and per-subgraph TLS config", func(t *testing.T) {
		dir := t.TempDir()
		globalCert, globalKey := generateTestCert(t, dir, "global")
		productsCert, productsKey := generateTestCert(t, dir, "products")

		cfg := &config.SubgraphTLSConfiguration{
			All: config.TLSClientCertConfiguration{
				CertificateChain: globalCert,
				Key:              globalKey,
			},
			Subgraphs: map[string]config.TLSClientCertConfiguration{
				"products": {
					CertificateChain: productsCert,
					Key:              productsKey,
				},
			},
		}

		defaultTLS, perSubgraphTLS, err := buildSubgraphTLSConfigs(cfg)
		assert.NoError(t, err)
		require.NotNil(t, defaultTLS)
		require.Contains(t, perSubgraphTLS, "products")
	})

	t.Run("errors on invalid global cert", func(t *testing.T) {
		cfg := &config.SubgraphTLSConfiguration{
			All: config.TLSClientCertConfiguration{
				CertificateChain: "/nonexistent/cert.pem",
				Key:              "/nonexistent/key.pem",
			},
		}

		_, _, err := buildSubgraphTLSConfigs(cfg)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "global subgraph TLS config")
	})

	t.Run("errors on invalid per-subgraph cert", func(t *testing.T) {
		cfg := &config.SubgraphTLSConfiguration{
			Subgraphs: map[string]config.TLSClientCertConfiguration{
				"products": {
					CertificateChain: "/nonexistent/cert.pem",
					Key:              "/nonexistent/key.pem",
				},
			},
		}

		_, _, err := buildSubgraphTLSConfigs(cfg)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), `subgraph "products"`)
	})
}

func TestWithSubgraphTLSConfiguration(t *testing.T) {
	cfg := config.SubgraphTLSConfiguration{
		All: config.TLSClientCertConfiguration{
			CertificateChain: "/path/to/cert.pem",
			Key:              "/path/to/key.pem",
		},
	}

	options := []Option{
		WithSubgraphTLSConfiguration(cfg),
	}
	router, err := NewRouter(options...)
	assert.NoError(t, err)
	assert.Equal(t, cfg, router.subgraphTLSConfiguration)
}
