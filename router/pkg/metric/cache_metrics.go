package metric

import (
	"context"
	"errors"
	"github.com/dgraph-io/ristretto/v2"
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
	cacheType string
	maxCost   int64
	metrics   *ristretto.Metrics
}

// NewCacheMetricInfo creates a new CacheMetricInfo instance.
func NewCacheMetricInfo(cacheType string, maxCost int64, cacheMetrics *ristretto.Metrics) CacheMetricInfo {
	return CacheMetricInfo{
		cacheType: cacheType,
		maxCost:   maxCost,
		metrics:   cacheMetrics,
	}
}

type providerMetrics struct {
	cacheRequestStats otelmetric.Int64ObservableCounter
	cacheKeyStats     otelmetric.Int64ObservableCounter
	cacheCostStats    otelmetric.Int64ObservableCounter
	cacheMaxCost      otelmetric.Int64ObservableGauge
}

// CacheMetrics is a struct that holds the metrics for various graphql operation caches.
type CacheMetrics struct {
	meterConfigs            *providerMetrics
	meter                   otelmetric.Meter
	baseAttributes          []attribute.KeyValue
	instrumentRegistrations []otelmetric.Registration
	logger                  *zap.Logger
}

// NewCacheMetrics creates a new CacheMetrics instance.
func NewCacheMetrics(logger *zap.Logger, baseAttributes []attribute.KeyValue, provider *metric.MeterProvider) (*CacheMetrics, error) {
	meter := provider.Meter(cosmoRouterCacheMeterName, otelmetric.WithInstrumentationVersion(cosmoRouterCacheMeterVersion))

	pm, err := configureMeter(meter)
	if err != nil {
		return nil, err
	}

	return &CacheMetrics{
		meterConfigs:   pm,
		meter:          meter,
		baseAttributes: baseAttributes,
		logger:         logger,
	}, nil
}

func configureMeter(meter otelmetric.Meter) (*providerMetrics, error) {
	cacheRequestStats, err := meter.Int64ObservableCounter(
		operationCacheRequestsMetric,
		otelmetric.WithDescription("Cache stats related to cache requests. Tracks cache hits and misses. Can be used to calculate the ratio"),
	)
	if err != nil {
		return nil, err
	}

	cacheKeyStats, err := meter.Int64ObservableCounter(
		operationCacheKeyMetric,
		otelmetric.WithDescription("Cache stats for Keys. Tracks added, updated and evicted keys. Can be used to get the total number of items"),
	)
	if err != nil {
		return nil, err
	}

	cacheCostStats, err := meter.Int64ObservableCounter(
		operationCacheCostMetric,
		otelmetric.WithDescription("Cache stats for Cost. Tracks the cost of the cache operations. Can be used to calculate the cost of the cache operations"),
	)
	if err != nil {
		return nil, err
	}

	cacheMaxCost, err := meter.Int64ObservableGauge(
		operationCacheCostMaxMetric,
		otelmetric.WithDescription("Tracks the maximum configured cost for a cache. Useful to investigate differences between the number of keys and the current cost"),
	)

	if err != nil {
		return nil, err
	}

	return &providerMetrics{
		cacheRequestStats: cacheRequestStats,
		cacheKeyStats:     cacheKeyStats,
		cacheCostStats:    cacheCostStats,
		cacheMaxCost:      cacheMaxCost,
	}, nil
}

// RegisterObservers creates observer callbacks for the OTEL metrics, which will be invoked in intervals.
func (c *CacheMetrics) RegisterObservers(
	operationCacheMetrics []CacheMetricInfo,
) error {

	rc, err := c.meter.RegisterCallback(func(_ context.Context, o otelmetric.Observer) error {
		for _, cacheMetric := range operationCacheMetrics {
			c.observeForCacheType(o, c.meterConfigs, cacheMetric.cacheType, cacheMetric.metrics, cacheMetric.maxCost)
		}
		return nil
	},
		c.meterConfigs.cacheRequestStats,
		c.meterConfigs.cacheKeyStats,
		c.meterConfigs.cacheCostStats,
		c.meterConfigs.cacheMaxCost,
	)

	if err != nil {
		return err
	}

	c.instrumentRegistrations = append(c.instrumentRegistrations, rc)

	return nil
}

func (c *CacheMetrics) observeForCacheType(o otelmetric.Observer, config *providerMetrics, cacheType string, metrics *ristretto.Metrics, maxCost int64) {
	if metrics == nil {
		return
	}

	o.ObserveInt64(config.cacheRequestStats, int64(metrics.Hits()),
		otelmetric.WithAttributes(c.baseAttributes...),
		otelmetric.WithAttributes(
			otel.CacheMetricsTypeAttribute.String(otel.CacheMetricsRequestTypeHits),
			otel.CacheMetricsCacheTypeAttribute.String(cacheType)),
	)

	o.ObserveInt64(config.cacheRequestStats, int64(metrics.Misses()),
		otelmetric.WithAttributes(c.baseAttributes...),
		otelmetric.WithAttributes(
			otel.CacheMetricsTypeAttribute.String(otel.CacheMetricsRequestTypeMisses),
			otel.CacheMetricsCacheTypeAttribute.String(cacheType)),
	)

	o.ObserveInt64(config.cacheKeyStats, int64(metrics.KeysAdded()),
		otelmetric.WithAttributes(c.baseAttributes...),
		otelmetric.WithAttributes(
			otel.CacheMetricsOperationAttribute.String(otel.CacheMetricsOperationTypeAdded),
			otel.CacheMetricsCacheTypeAttribute.String(cacheType)),
	)

	o.ObserveInt64(config.cacheKeyStats, int64(metrics.KeysUpdated()),
		otelmetric.WithAttributes(c.baseAttributes...),
		otelmetric.WithAttributes(
			otel.CacheMetricsOperationAttribute.String(otel.CacheMetricsOperationTypeUpdated),
			otel.CacheMetricsCacheTypeAttribute.String(cacheType)),
	)

	o.ObserveInt64(config.cacheKeyStats, int64(metrics.KeysEvicted()),
		otelmetric.WithAttributes(c.baseAttributes...),
		otelmetric.WithAttributes(
			otel.CacheMetricsOperationAttribute.String(otel.CacheMetricsOperationTypeEvicted),
			otel.CacheMetricsCacheTypeAttribute.String(cacheType)),
	)

	o.ObserveInt64(config.cacheCostStats, int64(metrics.CostAdded()),
		otelmetric.WithAttributes(c.baseAttributes...),
		otelmetric.WithAttributes(
			otel.CacheMetricsOperationAttribute.String(otel.CacheMetricsOperationTypeAdded),
			otel.CacheMetricsCacheTypeAttribute.String(cacheType)),
	)

	o.ObserveInt64(config.cacheCostStats, int64(metrics.CostEvicted()),
		otelmetric.WithAttributes(c.baseAttributes...),
		otelmetric.WithAttributes(
			otel.CacheMetricsOperationAttribute.String(otel.CacheMetricsOperationTypeEvicted),
			otel.CacheMetricsCacheTypeAttribute.String(cacheType)),
	)

	o.ObserveInt64(config.cacheMaxCost, maxCost,
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
