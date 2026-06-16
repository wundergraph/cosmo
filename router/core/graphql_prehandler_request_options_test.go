package core

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestPreHandlerInternalParseRequestOptions_ForceUnauthenticatedRequestTracing(t *testing.T) {
	t.Parallel()

	t.Run("allows ART options when force_unauthenticated_request_tracing is true without dev mode or token", func(t *testing.T) {
		t.Parallel()

		req := httptest.NewRequest("GET", "http://localhost/graphql?wg_include_query_plan=1&wg_trace=exclude_output", nil)
		h := &PreHandler{
			enableRequestTracing:               true,
			developmentMode:                    false,
			forceUnauthenticatedRequestTracing: true,
		}

		executionOptions, traceOptions, err := h.internalParseRequestOptions(req, &ClientInfo{}, zap.NewNop())
		require.NoError(t, err)
		require.True(t, executionOptions.IncludeQueryPlanInResponse)
		require.True(t, traceOptions.Enable)
		require.True(t, traceOptions.ExcludeOutput)
	})

	t.Run("keeps ART options disabled when force_unauthenticated_request_tracing is false without dev mode or token", func(t *testing.T) {
		t.Parallel()

		req := httptest.NewRequest("GET", "http://localhost/graphql?wg_include_query_plan=1&wg_trace=exclude_output", nil)
		h := &PreHandler{
			enableRequestTracing:               true,
			developmentMode:                    false,
			forceUnauthenticatedRequestTracing: false,
			routerPublicKey:                    nil,
		}

		executionOptions, traceOptions, err := h.internalParseRequestOptions(req, &ClientInfo{}, zap.NewNop())
		require.NoError(t, err)
		require.False(t, executionOptions.IncludeQueryPlanInResponse)
		require.False(t, traceOptions.Enable)
		require.True(t, traceOptions.ExcludeOutput)
	})

	t.Run("returns error with disabled ART when force_unauthenticated_request_tracing is false and request token is invalid", func(t *testing.T) {
		t.Parallel()

		// A public key is configured but the client presents a token signed by a different key,
		// so signature verification must fail and ART must stay disabled (fail closed).
		routerKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		require.NoError(t, err)
		attackerKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		require.NoError(t, err)

		token := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.MapClaims{})
		signed, err := token.SignedString(attackerKey)
		require.NoError(t, err)

		req := httptest.NewRequest("GET", "http://localhost/graphql?wg_include_query_plan=1&wg_trace=exclude_output", nil)
		h := &PreHandler{
			enableRequestTracing:               true,
			developmentMode:                    false,
			forceUnauthenticatedRequestTracing: false,
			routerPublicKey:                    &routerKey.PublicKey,
		}

		executionOptions, traceOptions, err := h.internalParseRequestOptions(
			req,
			&ClientInfo{WGRequestToken: signed},
			zap.NewNop(),
		)
		require.ErrorIs(t, err, jwt.ErrTokenSignatureInvalid)
		require.False(t, executionOptions.IncludeQueryPlanInResponse)
		require.False(t, traceOptions.Enable)
	})
}

func TestPreHandlerParseRequestExecutionOptions_EntityCaching(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name          string
		entityCaching config.EntityCachingConfiguration
		metrics       RouterMetrics
		header        http.Header
		traceEnabled  bool
		expected      resolve.CachingOptions
	}{
		{
			name: "enables l1 cache when entity caching and l1 are enabled",
			entityCaching: config.EntityCachingConfiguration{
				Enabled:              true,
				GlobalCacheKeyPrefix: "schema-v1",
				L1: config.EntityCachingL1{
					Enabled: true,
				},
				L2: config.EntityCachingL2{
					Enabled: true,
				},
			},
			expected: resolve.CachingOptions{
				EnableL1Cache:        true,
				EnableL2Cache:        true,
				GlobalCacheKeyPrefix: "schema-v1",
			},
		},
		{
			name: "disables l1 cache when l1 is disabled",
			entityCaching: config.EntityCachingConfiguration{
				Enabled:              true,
				GlobalCacheKeyPrefix: "schema-v1",
				L1: config.EntityCachingL1{
					Enabled: false,
				},
				L2: config.EntityCachingL2{
					Enabled: true,
				},
			},
			expected: resolve.CachingOptions{
				EnableL2Cache:        true,
				GlobalCacheKeyPrefix: "schema-v1",
			},
		},
		{
			name: "disables l1 cache when entity caching is disabled",
			entityCaching: config.EntityCachingConfiguration{
				Enabled:              false,
				GlobalCacheKeyPrefix: "schema-v1",
				L1: config.EntityCachingL1{
					Enabled: true,
				},
				L2: config.EntityCachingL2{
					Enabled: true,
				},
			},
			expected: resolve.CachingOptions{
				GlobalCacheKeyPrefix: "schema-v1",
			},
		},
		{
			name: "trace enabled disable entity cache header disables l1 and l2",
			entityCaching: config.EntityCachingConfiguration{
				Enabled:              true,
				GlobalCacheKeyPrefix: "schema-v1",
				L1: config.EntityCachingL1{
					Enabled: true,
				},
				L2: config.EntityCachingL2{
					Enabled: true,
				},
			},
			header: http.Header{
				"X-WG-Disable-Entity-Cache": []string{"true"},
			},
			traceEnabled: true,
			expected: resolve.CachingOptions{
				GlobalCacheKeyPrefix: "schema-v1",
			},
		},
		{
			name: "trace enabled disable entity cache l1 header disables only l1",
			entityCaching: config.EntityCachingConfiguration{
				Enabled:              true,
				GlobalCacheKeyPrefix: "schema-v1",
				L1: config.EntityCachingL1{
					Enabled: true,
				},
				L2: config.EntityCachingL2{
					Enabled: true,
				},
			},
			header: http.Header{
				"X-WG-Disable-Entity-Cache-L1": []string{"true"},
			},
			traceEnabled: true,
			expected: resolve.CachingOptions{
				EnableL2Cache:        true,
				GlobalCacheKeyPrefix: "schema-v1",
			},
		},
		{
			name: "trace enabled disable entity cache l2 header disables only l2",
			entityCaching: config.EntityCachingConfiguration{
				Enabled:              true,
				GlobalCacheKeyPrefix: "schema-v1",
				L1: config.EntityCachingL1{
					Enabled: true,
				},
				L2: config.EntityCachingL2{
					Enabled: true,
				},
			},
			header: http.Header{
				"X-WG-Disable-Entity-Cache-L2": []string{"true"},
			},
			traceEnabled: true,
			expected: resolve.CachingOptions{
				EnableL1Cache:        true,
				GlobalCacheKeyPrefix: "schema-v1",
			},
		},
		{
			name: "trace disabled ignores disable entity cache header",
			entityCaching: config.EntityCachingConfiguration{
				Enabled:              true,
				GlobalCacheKeyPrefix: "schema-v1",
				L1: config.EntityCachingL1{
					Enabled: true,
				},
				L2: config.EntityCachingL2{
					Enabled: true,
				},
			},
			header: http.Header{
				"X-WG-Disable-Entity-Cache": []string{"true"},
			},
			expected: resolve.CachingOptions{
				EnableL1Cache:        true,
				EnableL2Cache:        true,
				GlobalCacheKeyPrefix: "schema-v1",
			},
		},
		{
			name: "trace enabled without disable headers leaves config derived caching unchanged",
			entityCaching: config.EntityCachingConfiguration{
				Enabled:              true,
				GlobalCacheKeyPrefix: "schema-v1",
				L1: config.EntityCachingL1{
					Enabled: true,
				},
				L2: config.EntityCachingL2{
					Enabled: true,
				},
			},
			traceEnabled: true,
			expected: resolve.CachingOptions{
				EnableL1Cache:        true,
				EnableL2Cache:        true,
				GlobalCacheKeyPrefix: "schema-v1",
			},
		},
		{
			name: "entity cache analytics is disabled without metrics recorder",
			entityCaching: config.EntityCachingConfiguration{
				Enabled: true,
				L1: config.EntityCachingL1{
					Enabled: true,
				},
			},
			expected: resolve.CachingOptions{
				EnableL1Cache: true,
			},
		},
		{
			name: "entity cache analytics is enabled when metrics recorder is enabled",
			entityCaching: config.EntityCachingConfiguration{
				Enabled: true,
				L1: config.EntityCachingL1{
					Enabled: true,
				},
			},
			metrics: &spyRouterMetrics{
				entityCacheAnalyticsEnabled: true,
			},
			expected: resolve.CachingOptions{
				EnableL1Cache:        true,
				EnableCacheAnalytics: true,
			},
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			req := httptest.NewRequest("GET", "http://localhost/graphql", nil)
			if tt.header != nil {
				req.Header = tt.header.Clone()
			}
			if tt.traceEnabled {
				req.Header.Set(RequestTraceHeader, "true")
			}
			h := &PreHandler{
				enableRequestTracing: true,
				developmentMode:      tt.traceEnabled,
				entityCaching:        tt.entityCaching,
				metrics:              tt.metrics,
			}

			executionOptions, _, err := h.internalParseRequestOptions(req, &ClientInfo{}, zap.NewNop())
			require.NoError(t, err)

			assert.Equal(t, tt.expected, executionOptions.Caching)
		})
	}
}
