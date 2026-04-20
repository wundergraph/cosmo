package core

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router/pkg/entitycache"
)

func TestEntityCacheMetricRegistrations_DeduplicatesDefaultAlias(t *testing.T) {
	t.Parallel()

	cache, err := entitycache.NewMemoryEntityCache(1024)
	require.NoError(t, err)
	t.Cleanup(func() { _ = cache.Close() })

	registrations := entityCacheMetricRegistrations(map[string]cacheMetricSource{
		"default":  cache,
		"memory-1": cache,
	})

	require.Len(t, registrations, 1)
	require.Equal(t, "entity_memory-1", registrations[0].cacheType)
	require.EqualValues(t, 1024, registrations[0].maxCost)
	require.NotNil(t, registrations[0].metrics)
}

func TestEntityCacheMetricRegistrations_UsesCircuitBreakerWrappedMemoryCache(t *testing.T) {
	t.Parallel()

	cache, err := entitycache.NewMemoryEntityCache(2048)
	require.NoError(t, err)
	t.Cleanup(func() { _ = cache.Close() })

	wrapped := entitycache.NewCircuitBreakerCache(cache, entitycache.CircuitBreakerConfig{
		Enabled:          true,
		FailureThreshold: 3,
		CooldownPeriod:   time.Second,
	})

	registrations := entityCacheMetricRegistrations(map[string]cacheMetricSource{
		"memory-2": wrapped,
	})

	require.Len(t, registrations, 1)
	require.Equal(t, "entity_memory-2", registrations[0].cacheType)
	require.EqualValues(t, 2048, registrations[0].maxCost)
	require.NotNil(t, registrations[0].metrics)
}
