package metric

import (
	"context"
	"fmt"
	"slices"
	"time"

	"go.opentelemetry.io/otel/attribute"
	otelmetric "go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/pkg/otel"
)

const (
	cosmoRouterResponseCacheMeterName           = "cosmo.router.response_cache"
	cosmoRouterResponseCachePrometheusMeterName = "cosmo.router.response_cache.prometheus"
	cosmoRouterResponseCacheMeterVersion        = "0.0.1"
)

// Values of the wg.response_cache.operation attribute.
const (
	ResponseCacheOperationLookup     = "lookup"
	ResponseCacheOperationWrite      = "write"
	ResponseCacheOperationInvalidate = "invalidate"
	// ResponseCacheOperationEngine is a failure of the engine around the store, e.g. an entry it could not read.
	ResponseCacheOperationEngine = "engine"
)

// Values of the wg.response_cache.result attribute.
const (
	ResponseCacheResultFound   = "found"
	ResponseCacheResultMissing = "missing"
	ResponseCacheResultStored  = "stored"
	ResponseCacheResultFailed  = "failed"
	ResponseCacheResultRemoved = "removed"
)

// Values of the wg.error.type attribute on response cache metrics.
const (
	ResponseCacheErrorCanceled        = "canceled"
	ResponseCacheErrorTimeout         = "timeout"
	ResponseCacheErrorPartialWrite    = "partial_write"
	ResponseCacheErrorInvalidArgument = "invalid_argument"
	ResponseCacheErrorOther           = "other"
)

// ResponseCacheMetricStore is the interface for the health metrics of the response cache.
type ResponseCacheMetricStore interface {
	// MeasureOperation counts and times a call to the store. errorType is empty for a call that succeeded.
	MeasureOperation(ctx context.Context, operation string, duration time.Duration, errorType string)
	MeasureEngineError(ctx context.Context)
	MeasureKeys(ctx context.Context, operation, result string, count int64)
	MeasureWrite(ctx context.Context, bytes int64, ttl time.Duration)
	MeasureInvalidatedTags(ctx context.Context, count int64)
}

// ResponseCacheMetrics is the store for the health metrics of the response cache.
type ResponseCacheMetrics struct {
	baseAttributes []attribute.KeyValue
	logger         *zap.Logger
	// providers holds the instruments of every enabled exporter.
	providers []*responseCacheInstruments
}

var _ ResponseCacheMetricStore = (*ResponseCacheMetrics)(nil)

// NewResponseCacheMetricStore creates the store for the given storage provider.
func NewResponseCacheMetricStore(
	logger *zap.Logger,
	baseAttributes []attribute.KeyValue,
	otelProvider, promProvider *metric.MeterProvider,
	metricsConfig *Config,
	storageProvider string,
) (*ResponseCacheMetrics, error) {
	store := &ResponseCacheMetrics{
		baseAttributes: append(slices.Clone(baseAttributes), otel.WgResponseCacheProvider.String(storageProvider)),
		logger:         logger,
	}

	if metricsConfig.OpenTelemetry.ResponseCache {
		instruments, err := newResponseCacheMeterInstruments(otelProvider, cosmoRouterResponseCacheMeterName)
		if err != nil {
			return nil, fmt.Errorf("failed to create otlp response cache metrics: %w", err)
		}
		store.providers = append(store.providers, instruments)
	}

	if metricsConfig.Prometheus.ResponseCache {
		instruments, err := newResponseCacheMeterInstruments(promProvider, cosmoRouterResponseCachePrometheusMeterName)
		if err != nil {
			return nil, fmt.Errorf("failed to create prometheus response cache metrics: %w", err)
		}
		store.providers = append(store.providers, instruments)
	}

	return store, nil
}

func newResponseCacheMeterInstruments(meterProvider *metric.MeterProvider, meterName string) (*responseCacheInstruments, error) {
	meter := meterProvider.Meter(meterName, otelmetric.WithInstrumentationVersion(cosmoRouterResponseCacheMeterVersion))
	return newResponseCacheInstruments(meter)
}

func (s *ResponseCacheMetrics) withAttrs(attrs ...attribute.KeyValue) otelmetric.MeasurementOption {
	return otelmetric.WithAttributeSet(attribute.NewSet(append(slices.Clone(s.baseAttributes), attrs...)...))
}

func (s *ResponseCacheMetrics) MeasureOperation(ctx context.Context, operation string, duration time.Duration, errorType string) {
	durationOpt := s.withAttrs(otel.WgResponseCacheOperation.String(operation))
	countOpt := durationOpt
	if errorType != "" {
		countOpt = s.withAttrs(otel.WgResponseCacheOperation.String(operation), otel.WgErrorType.String(errorType))
	}

	for _, provider := range s.providers {
		provider.operations.Add(ctx, 1, countOpt)
		provider.operationDuration.Record(ctx, duration.Seconds(), durationOpt)
	}
}

func (s *ResponseCacheMetrics) MeasureEngineError(ctx context.Context) {
	opt := s.withAttrs(
		otel.WgResponseCacheOperation.String(ResponseCacheOperationEngine),
		otel.WgErrorType.String(ResponseCacheErrorOther),
	)

	for _, provider := range s.providers {
		provider.operations.Add(ctx, 1, opt)
	}
}

func (s *ResponseCacheMetrics) MeasureKeys(ctx context.Context, operation, result string, count int64) {
	if count <= 0 {
		return
	}
	opt := s.withAttrs(otel.WgResponseCacheOperation.String(operation), otel.WgResponseCacheResult.String(result))

	for _, provider := range s.providers {
		provider.keys.Add(ctx, count, opt)
	}
}

func (s *ResponseCacheMetrics) MeasureWrite(ctx context.Context, bytes int64, ttl time.Duration) {
	opt := s.withAttrs()

	for _, provider := range s.providers {
		provider.writeBytes.Add(ctx, bytes, opt)
		provider.writeTTL.Record(ctx, ttl.Seconds(), opt)
	}
}

func (s *ResponseCacheMetrics) MeasureInvalidatedTags(ctx context.Context, count int64) {
	if count <= 0 {
		return
	}
	opt := s.withAttrs()

	for _, provider := range s.providers {
		provider.invalidationTags.Add(ctx, count, opt)
	}
}
