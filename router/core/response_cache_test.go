package core

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/pkg/config"
)

// TestSetupResponseCache covers the validation setupResponseCache does for
// itself. The config schema refuses most of this in the YAML, but the env
// overrides and any embedder assembling a Config in go never pass through the
// schema, so startup is the only place these are caught for them.
func TestSetupResponseCache(t *testing.T) {
	t.Parallel()

	newRouter := func(cfg *config.ResponseCacheConfiguration, providers config.StorageProviders) *Router {
		t.Helper()

		registry, err := NewProviderRegistry(providers)
		require.NoError(t, err)

		return &Router{
			Config: Config{
				logger:              zap.NewNop(),
				providerRegistry:    registry,
				responseCacheConfig: cfg,
			},
		}
	}

	t.Run("no configuration at all builds no cache", func(t *testing.T) {
		t.Parallel()

		r := newRouter(nil, config.StorageProviders{})
		require.NoError(t, r.setupResponseCache(context.Background()))
		require.Nil(t, r.responseCache)
	})

	t.Run("a disabled cache is not built", func(t *testing.T) {
		t.Parallel()

		// Everything else here is deliberately invalid: while disabled, none of
		// it should be looked at.
		r := newRouter(&config.ResponseCacheConfiguration{
			Enabled: false,
			Storage: config.ResponseCacheStorageConfig{Provider: "memcached"},
		}, config.StorageProviders{})

		require.NoError(t, r.setupResponseCache(context.Background()))
		require.Nil(t, r.responseCache)
	})

	t.Run("a non positive fallback_ttl is refused", func(t *testing.T) {
		t.Parallel()

		// A fallback of zero would otherwise be rediscovered and swallowed on
		// every response that needs it, rather than failing once at startup.
		for _, ttl := range []time.Duration{0, -time.Second} {
			r := newRouter(&config.ResponseCacheConfiguration{
				Enabled:     true,
				FallbackTTL: ttl,
				Storage:     config.ResponseCacheStorageConfig{Provider: config.ResponseCacheStorageProviderMemory, MaxEntries: 128},
			}, config.StorageProviders{})

			err := r.setupResponseCache(context.Background())
			require.ErrorContains(t, err, "fallback_ttl")
			require.Nil(t, r.responseCache)
		}
	})

	t.Run("an unsupported storage provider is refused", func(t *testing.T) {
		t.Parallel()

		r := newRouter(&config.ResponseCacheConfiguration{
			Enabled:     true,
			FallbackTTL: 30 * time.Second,
			Storage:     config.ResponseCacheStorageConfig{Provider: "memcached"},
		}, config.StorageProviders{})

		err := r.setupResponseCache(context.Background())
		require.ErrorContains(t, err, `storage provider "memcached" is not supported`)
		require.Nil(t, r.responseCache)
	})

	t.Run("an empty provider is redis and so still needs a provider_id", func(t *testing.T) {
		t.Parallel()

		// An embedder assembling this in go never passes through the yaml
		// defaults, so the zero value has to mean redis here too. Reading it as
		// anything else would quietly turn one shared cache into one per replica.
		r := newRouter(&config.ResponseCacheConfiguration{
			Enabled:     true,
			FallbackTTL: 30 * time.Second,
		}, config.StorageProviders{})

		err := r.setupResponseCache(context.Background())
		require.ErrorContains(t, err, "no storage provider_id is configured")
		require.Nil(t, r.responseCache)
	})

	t.Run("an unknown redis provider_id is refused", func(t *testing.T) {
		t.Parallel()

		r := newRouter(&config.ResponseCacheConfiguration{
			Enabled:     true,
			FallbackTTL: 30 * time.Second,
			Storage: config.ResponseCacheStorageConfig{
				Provider:   config.ResponseCacheStorageProviderRedis,
				ProviderID: "not_declared",
			},
		}, config.StorageProviders{})

		err := r.setupResponseCache(context.Background())
		require.ErrorContains(t, err, `unknown redis storage provider "not_declared"`)
		require.Nil(t, r.responseCache)
	})

	t.Run("a non positive max_entries is refused by the memory provider", func(t *testing.T) {
		t.Parallel()

		r := newRouter(&config.ResponseCacheConfiguration{
			Enabled:     true,
			FallbackTTL: 30 * time.Second,
			Storage: config.ResponseCacheStorageConfig{
				Provider:   config.ResponseCacheStorageProviderMemory,
				MaxEntries: 0,
			},
		}, config.StorageProviders{})

		err := r.setupResponseCache(context.Background())
		require.ErrorContains(t, err, "failed to create response cache")
		require.Nil(t, r.responseCache)
	})

	t.Run("the memory provider builds a cache and needs no provider_id", func(t *testing.T) {
		t.Parallel()

		r := newRouter(&config.ResponseCacheConfiguration{
			Enabled:     true,
			FallbackTTL: 30 * time.Second,
			Storage: config.ResponseCacheStorageConfig{
				Provider:   config.ResponseCacheStorageProviderMemory,
				MaxEntries: 128,
			},
		}, config.StorageProviders{})

		require.NoError(t, r.setupResponseCache(context.Background()))
		require.NotNil(t, r.responseCache)
		require.NoError(t, r.responseCache.Close())
	})
}
