package metric

import (
	"context"
	"errors"
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

// ResponseCacheMemoryStats is what a cache held in this process reports about itself.
type ResponseCacheMemoryStats interface {
	Evictions() uint64
	RejectedWrites() uint64
	MaxEntries() int64
}

// ResponseCacheMetricStore is the interface for the health metrics of the response cache.
type ResponseCacheMetricStore interface {
	// MeasureOperation counts and times a call to the store. errorType is empty for a call that succeeded.
	MeasureOperation(ctx context.Context, operation string, duration time.Duration, errorType string)
	MeasureEngineError(ctx context.Context)
	MeasureKeys(ctx context.Context, operation, result string, count int64)
	MeasureWrite(ctx context.Context, bytes int64, ttl time.Duration)
	MeasureInvalidatedTags(ctx context.Context, count int64)
	Shutdown(ctx context.Context) error
}

type responseCacheMetricProvider struct {
	instruments             *responseCacheInstruments
	instrumentRegistrations []otelmetric.Registration
}

// ResponseCacheMetrics is the store for the health metrics of the response cache.
type ResponseCacheMetrics struct {
	baseAttributes []attribute.KeyValue
	logger         *zap.Logger
	providers      []*responseCacheMetricProvider
}

var _ ResponseCacheMetricStore = (*ResponseCacheMetrics)(nil)

// NewResponseCacheMetricStore creates the store for the given storage provider.
// memoryStats is nil for a cache that is not held in this process.
func NewResponseCacheMetricStore(
	logger *zap.Logger,
	baseAttributes []attribute.KeyValue,
	otelProvider, promProvider *metric.MeterProvider,
	metricsConfig *Config,
	storageProvider string,
	memoryStats ResponseCacheMemoryStats,
) (*ResponseCacheMetrics, error) {
	store := &ResponseCacheMetrics{
		baseAttributes: append(slices.Clone(baseAttributes), otel.WgResponseCacheProvider.String(storageProvider)),
		logger:         logger,
	}

	if metricsConfig.OpenTelemetry.ResponseCache {
		provider, err := newResponseCacheMetricProvider(otelProvider, cosmoRouterResponseCacheMeterName, store.baseAttributes, memoryStats)
		if err != nil {
			return nil, fmt.Errorf("failed to create otlp response cache metrics: %w", err)
		}
		store.providers = append(store.providers, provider)
	}

	if metricsConfig.Prometheus.ResponseCache {
		provider, err := newResponseCacheMetricProvider(promProvider, cosmoRouterResponseCachePrometheusMeterName, store.baseAttributes, memoryStats)
		if err != nil {
			return nil, errors.Join(fmt.Errorf("failed to create prometheus response cache metrics: %w", err), store.Shutdown(context.Background()))
		}
		store.providers = append(store.providers, provider)
	}

	return store, nil
}

func newResponseCacheMetricProvider(
	meterProvider *metric.MeterProvider,
	meterName string,
	attributes []attribute.KeyValue,
	memoryStats ResponseCacheMemoryStats,
) (*responseCacheMetricProvider, error) {
	meter := meterProvider.Meter(meterName, otelmetric.WithInstrumentationVersion(cosmoRouterResponseCacheMeterVersion))

	instruments, err := newResponseCacheInstruments(meter, memoryStats != nil)
	if err != nil {
		return nil, err
	}

	provider := &responseCacheMetricProvider{instruments: instruments}
	if memoryStats == nil {
		return provider, nil
	}

	opt := otelmetric.WithAttributeSet(attribute.NewSet(attributes...))
	registration, err := meter.RegisterCallback(func(_ context.Context, o otelmetric.Observer) error {
		o.ObserveInt64(instruments.memoryEvictions, int64(memoryStats.Evictions()), opt)
		o.ObserveInt64(instruments.memoryRejectedWrites, int64(memoryStats.RejectedWrites()), opt)
		o.ObserveInt64(instruments.memoryMaxEntries, memoryStats.MaxEntries(), opt)
		return nil
	}, instruments.memoryEvictions, instruments.memoryRejectedWrites, instruments.memoryMaxEntries)
	if err != nil {
		return nil, err
	}
	provider.instrumentRegistrations = append(provider.instrumentRegistrations, registration)

	return provider, nil
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
		provider.instruments.operations.Add(ctx, 1, countOpt)
		provider.instruments.operationDuration.Record(ctx, duration.Seconds(), durationOpt)
	}
}

func (s *ResponseCacheMetrics) MeasureEngineError(ctx context.Context) {
	opt := s.withAttrs(
		otel.WgResponseCacheOperation.String(ResponseCacheOperationEngine),
		otel.WgErrorType.String(ResponseCacheErrorOther),
	)

	for _, provider := range s.providers {
		provider.instruments.operations.Add(ctx, 1, opt)
	}
}

func (s *ResponseCacheMetrics) MeasureKeys(ctx context.Context, operation, result string, count int64) {
	if count <= 0 {
		return
	}
	opt := s.withAttrs(otel.WgResponseCacheOperation.String(operation), otel.WgResponseCacheResult.String(result))

	for _, provider := range s.providers {
		provider.instruments.keys.Add(ctx, count, opt)
	}
}

func (s *ResponseCacheMetrics) MeasureWrite(ctx context.Context, bytes int64, ttl time.Duration) {
	opt := s.withAttrs()

	for _, provider := range s.providers {
		provider.instruments.writeBytes.Add(ctx, bytes, opt)
		provider.instruments.writeTTL.Record(ctx, ttl.Seconds(), opt)
	}
}

func (s *ResponseCacheMetrics) MeasureInvalidatedTags(ctx context.Context, count int64) {
	if count <= 0 {
		return
	}
	opt := s.withAttrs()

	for _, provider := range s.providers {
		provider.instruments.invalidationTags.Add(ctx, count, opt)
	}
}

// Shutdown unregisters the callbacks reading the memory stats.
func (s *ResponseCacheMetrics) Shutdown(_ context.Context) error {
	var err error

	for _, provider := range s.providers {
		for _, registration := range provider.instrumentRegistrations {
			if regErr := registration.Unregister(); regErr != nil {
				err = errors.Join(err, regErr)
			}
		}
		provider.instrumentRegistrations = nil
	}

	return err
}
