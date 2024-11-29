package metric

import (
	"context"
	"errors"
	"github.com/dgraph-io/ristretto"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"go.opentelemetry.io/otel/attribute"
	otelmetric "go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.uber.org/zap"
)

const (
	cosmoRouterCacheMeterName    = "cosmo.router.cache"
	cosmoRouterCacheMeterVersion = "0.0.1"

	operationCacheMetricBaseName = "router.graphql.cache."
	operationCacheRequestsMetric = operationCacheMetricBaseName + "requests.stats"
	operationCacheKeyMetric      = operationCacheMetricBaseName + "keys.stats"
	operationCacheCostMetric     = operationCacheMetricBaseName + "cost.stats"
	operationCacheCostMaxMetric  = operationCacheMetricBaseName + "cost.max"
)

// CacheMetricInfo is a struct that aggregates information to provide metrics for a single cache implementation.
type CacheMetricInfo struct {
	CacheType string
	MaxCost   int64
	Metrics   *ristretto.Metrics
}

// NewCacheMetricInfo creates a new CacheMetricInfo instance.
func NewCacheMetricInfo(cacheType string, maxCost int64, cacheMetrics *ristretto.Metrics) CacheMetricInfo {
	return CacheMetricInfo{
		CacheType: cacheType,
		MaxCost:   maxCost,
		Metrics:   cacheMetrics,
	}
}

var (
	cacheRequestStats otelmetric.Int64ObservableCounter
	cacheKeyStats     otelmetric.Int64ObservableCounter
	cacheCostStats    otelmetric.Int64ObservableCounter
	cacheMaxCost      otelmetric.Int64ObservableGauge
)

// CacheMetrics is a struct that holds the metrics for various graphql operation caches.
type CacheMetrics struct {
	meters                  []otelmetric.Meter
	baseAttributes          []attribute.KeyValue
	instrumentRegistrations []otelmetric.Registration
	logger                  *zap.Logger
}

// NewCacheMetrics creates a new CacheMetrics instance.
func NewCacheMetrics(logger *zap.Logger, baseAttributes []attribute.KeyValue, providers ...*metric.MeterProvider) (*CacheMetrics, error) {
	configuredMeters := make([]otelmetric.Meter, 0, len(providers))

	for _, meterProvider := range providers {
		meter := meterProvider.Meter(cosmoRouterCacheMeterName,
			otelmetric.WithInstrumentationVersion(cosmoRouterCacheMeterVersion))

		if err := configureMeter(meter); err != nil {
			return nil, err
		}

		configuredMeters = append(configuredMeters, meter)
	}

	return &CacheMetrics{
		meters:         configuredMeters,
		baseAttributes: baseAttributes,
		logger:         logger,
	}, nil
}

func configureMeter(meter otelmetric.Meter) error {
	var err error
	if cacheRequestStats, err = meter.Int64ObservableCounter(
		operationCacheRequestsMetric,
		otelmetric.WithDescription("Cache stats related to cache requests. Tracks cache hits and misses. Can be used to calculate the ratio"),
	); err != nil {
		return err
	}

	if cacheKeyStats, err = meter.Int64ObservableCounter(
		operationCacheKeyMetric,
		otelmetric.WithDescription("Cache stats for Keys. Tracks added, updated and evicted keys. Can be used to get the total number of items"),
	); err != nil {
		return err
	}

	if cacheCostStats, err = meter.Int64ObservableCounter(
		operationCacheCostMetric,
		otelmetric.WithDescription("Cache stats for Cost. Tracks the cost of the cache operations. Can be used to calculate the cost of the cache operations"),
	); err != nil {
		return err
	}

	if cacheMaxCost, err = meter.Int64ObservableGauge(
		operationCacheCostMaxMetric,
		otelmetric.WithDescription("Tracks the maximum configured cost for a cache. Useful to investigate differences between the number of keys and the current cost"),
	); err != nil {
		return err
	}

	return nil
}

func (c *CacheMetrics) RegisterObservers(
	operationCacheMetrics []CacheMetricInfo,
) error {
	for _, meter := range c.meters {
		rc, err := meter.RegisterCallback(func(_ context.Context, o otelmetric.Observer) error {
			for _, cacheMetric := range operationCacheMetrics {
				c.observeForCacheType(o, cacheMetric.CacheType, cacheMetric.Metrics, cacheMetric.MaxCost)
			}

			return nil
		},
			cacheRequestStats,
			cacheKeyStats,
			cacheCostStats,
			cacheMaxCost,
		)

		if err != nil {
			return err
		}

		c.instrumentRegistrations = append(c.instrumentRegistrations, rc)
	}

	return nil
}

func (c *CacheMetrics) observeForCacheType(o otelmetric.Observer, cacheType string, metrics *ristretto.Metrics, maxCost int64) {
	if metrics == nil {
		return
	}

	o.ObserveInt64(cacheRequestStats, int64(metrics.Hits()),
		otelmetric.WithAttributes(c.baseAttributes...),
		otelmetric.WithAttributes(
			otel.CacheMetricsTypeAttribute.String("hits"),
			otel.CacheMetricsCacheTypeAttribute.String(cacheType)),
	)

	o.ObserveInt64(cacheRequestStats, int64(metrics.Misses()),
		otelmetric.WithAttributes(c.baseAttributes...),
		otelmetric.WithAttributes(
			otel.CacheMetricsTypeAttribute.String("misses"),
			otel.CacheMetricsCacheTypeAttribute.String(cacheType)),
	)

	o.ObserveInt64(cacheKeyStats, int64(metrics.KeysAdded()),
		otelmetric.WithAttributes(c.baseAttributes...),
		otelmetric.WithAttributes(
			otel.CacheMetricsOperationAttribute.String("added"),
			otel.CacheMetricsCacheTypeAttribute.String(cacheType)),
	)

	o.ObserveInt64(cacheKeyStats, int64(metrics.KeysUpdated()),
		otelmetric.WithAttributes(c.baseAttributes...),
		otelmetric.WithAttributes(
			otel.CacheMetricsOperationAttribute.String("updated"),
			otel.CacheMetricsCacheTypeAttribute.String(cacheType)),
	)

	o.ObserveInt64(cacheKeyStats, int64(metrics.KeysEvicted()),
		otelmetric.WithAttributes(c.baseAttributes...),
		otelmetric.WithAttributes(
			otel.CacheMetricsOperationAttribute.String("evicted"),
			otel.CacheMetricsCacheTypeAttribute.String(cacheType)),
	)

	o.ObserveInt64(cacheCostStats, int64(metrics.CostAdded()),
		otelmetric.WithAttributes(c.baseAttributes...),
		otelmetric.WithAttributes(
			otel.CacheMetricsOperationAttribute.String("added"),
			otel.CacheMetricsCacheTypeAttribute.String(cacheType)),
	)

	o.ObserveInt64(cacheCostStats, int64(metrics.CostEvicted()),
		otelmetric.WithAttributes(c.baseAttributes...),
		otelmetric.WithAttributes(
			otel.CacheMetricsOperationAttribute.String("evicted"),
			otel.CacheMetricsCacheTypeAttribute.String(cacheType)),
	)

	o.ObserveInt64(cacheMaxCost, maxCost,
		otelmetric.WithAttributes(c.baseAttributes...),
		otelmetric.WithAttributes(
			otel.CacheMetricsCacheTypeAttribute.String(cacheType),
		),
	)
}

func (c *CacheMetrics) Shutdown() error {
	var err error

	for _, reg := range c.instrumentRegistrations {
		if regErr := reg.Unregister(); regErr != nil {
			err = errors.Join(regErr)
		}
	}

	return err
}
