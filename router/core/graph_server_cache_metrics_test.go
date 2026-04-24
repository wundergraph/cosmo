package core

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/entitycache"
	rmetric "github.com/wundergraph/cosmo/router/pkg/metric"
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

func TestSetupEntityCacheMetrics_RespectsMetricOptIn(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		metrics  rmetric.Config
		wantOTLP bool
		wantProm bool
	}{
		{
			name:     "default off",
			metrics:  rmetric.Config{},
			wantOTLP: false,
			wantProm: false,
		},
		{
			name: "otlp only",
			metrics: rmetric.Config{
				OpenTelemetry: rmetric.OpenTelemetry{
					EntityCachingStats: true,
				},
			},
			wantOTLP: true,
			wantProm: false,
		},
		{
			name: "prometheus only",
			metrics: rmetric.Config{
				Prometheus: rmetric.PrometheusConfig{
					EntityCachingStats: true,
				},
			},
			wantOTLP: false,
			wantProm: true,
		},
		{
			name: "both enabled",
			metrics: rmetric.Config{
				OpenTelemetry: rmetric.OpenTelemetry{
					EntityCachingStats: true,
				},
				Prometheus: rmetric.PrometheusConfig{
					EntityCachingStats: true,
				},
			},
			wantOTLP: true,
			wantProm: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			s := &graphServer{
				Config: &Config{
					logger: zap.NewNop(),
					entityCachingConfig: config.EntityCachingConfiguration{
						Enabled: true,
					},
					metricConfig:      &tt.metrics,
					otlpMeterProvider: sdkmetric.NewMeterProvider(sdkmetric.WithReader(sdkmetric.NewManualReader())),
					promMeterProvider: sdkmetric.NewMeterProvider(sdkmetric.WithReader(sdkmetric.NewManualReader())),
				},
			}

			err := s.setupEntityCacheMetrics([]attribute.KeyValue{
				attribute.String("service.name", "test-router"),
			})
			require.NoError(t, err)

			assert.Equal(t, tt.wantOTLP, s.metrics.OTLPEntityCache != nil)
			assert.Equal(t, tt.wantProm, s.metrics.PromEntityCache != nil)
		})
	}
}
