package metric

import (
	"fmt"

	otelmetric "go.opentelemetry.io/otel/metric"
)

// Response cache metric constants
const (
	responseCacheOperations        = "router.response_cache.operations"
	responseCacheOperationDuration = "router.response_cache.operation.duration_seconds"
	responseCacheKeys              = "router.response_cache.keys"
	responseCacheWriteBytes        = "router.response_cache.write.bytes"
	responseCacheWriteTTL          = "router.response_cache.write.ttl_seconds"
	responseCacheInvalidationTags  = "router.response_cache.invalidation.tags"

	responseCacheMemoryEvictions      = "router.response_cache.memory.evictions"
	responseCacheMemoryRejectedWrites = "router.response_cache.memory.rejected_writes"
	responseCacheMemoryMaxEntries     = "router.response_cache.memory.max_entries"

	// Not milliseconds, which the meter views force onto buckets starting at 10 ms.
	unitSeconds = "s"
)

var (
	responseCacheOperationsOptions = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription("Calls to the response cache store"),
	}

	responseCacheOperationDurationOptions = []otelmetric.Float64HistogramOption{
		otelmetric.WithUnit(unitSeconds),
		otelmetric.WithDescription("Duration of calls to the response cache store"),
		otelmetric.WithExplicitBucketBoundaries(0.00025, 0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1),
	}

	responseCacheKeysOptions = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription("Entries the response cache store was asked for, found, stored or removed"),
	}

	responseCacheWriteBytesOptions = []otelmetric.Int64CounterOption{
		otelmetric.WithUnit(unitBytes),
		otelmetric.WithDescription("Size of the values written to the response cache store"),
	}

	responseCacheWriteTTLOptions = []otelmetric.Float64HistogramOption{
		otelmetric.WithUnit(unitSeconds),
		otelmetric.WithDescription("Shortest lifetime of the entries of a write to the response cache store"),
		otelmetric.WithExplicitBucketBoundaries(1, 5, 15, 30, 60, 300, 900, 3600, 21600, 86400),
	}

	responseCacheInvalidationTagsOptions = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription("Tags the response cache store was asked to invalidate"),
	}

	responseCacheMemoryEvictionsOptions = []otelmetric.Int64ObservableCounterOption{
		otelmetric.WithDescription("Entries evicted from the in memory response cache"),
	}

	responseCacheMemoryRejectedWritesOptions = []otelmetric.Int64ObservableCounterOption{
		otelmetric.WithDescription("Writes the in memory response cache did not admit"),
	}

	responseCacheMemoryMaxEntriesOptions = []otelmetric.Int64ObservableGaugeOption{
		otelmetric.WithDescription("Configured size of the in memory response cache"),
	}
)

type responseCacheInstruments struct {
	operations        otelmetric.Int64Counter
	operationDuration otelmetric.Float64Histogram
	keys              otelmetric.Int64Counter
	writeBytes        otelmetric.Int64Counter
	writeTTL          otelmetric.Float64Histogram
	invalidationTags  otelmetric.Int64Counter

	// Only created for a cache that reports memory stats.
	memoryEvictions      otelmetric.Int64ObservableCounter
	memoryRejectedWrites otelmetric.Int64ObservableCounter
	memoryMaxEntries     otelmetric.Int64ObservableGauge
}

func newResponseCacheInstruments(meter otelmetric.Meter, memory bool) (*responseCacheInstruments, error) {
	var (
		instruments responseCacheInstruments
		err         error
	)

	if instruments.operations, err = meter.Int64Counter(responseCacheOperations, responseCacheOperationsOptions...); err != nil {
		return nil, fmt.Errorf("failed to create response cache operations counter: %w", err)
	}
	if instruments.operationDuration, err = meter.Float64Histogram(responseCacheOperationDuration, responseCacheOperationDurationOptions...); err != nil {
		return nil, fmt.Errorf("failed to create response cache operation duration histogram: %w", err)
	}
	if instruments.keys, err = meter.Int64Counter(responseCacheKeys, responseCacheKeysOptions...); err != nil {
		return nil, fmt.Errorf("failed to create response cache keys counter: %w", err)
	}
	if instruments.writeBytes, err = meter.Int64Counter(responseCacheWriteBytes, responseCacheWriteBytesOptions...); err != nil {
		return nil, fmt.Errorf("failed to create response cache write bytes counter: %w", err)
	}
	if instruments.writeTTL, err = meter.Float64Histogram(responseCacheWriteTTL, responseCacheWriteTTLOptions...); err != nil {
		return nil, fmt.Errorf("failed to create response cache write ttl histogram: %w", err)
	}
	if instruments.invalidationTags, err = meter.Int64Counter(responseCacheInvalidationTags, responseCacheInvalidationTagsOptions...); err != nil {
		return nil, fmt.Errorf("failed to create response cache invalidation tags counter: %w", err)
	}

	if !memory {
		return &instruments, nil
	}

	if instruments.memoryEvictions, err = meter.Int64ObservableCounter(responseCacheMemoryEvictions, responseCacheMemoryEvictionsOptions...); err != nil {
		return nil, fmt.Errorf("failed to create response cache evictions counter: %w", err)
	}
	if instruments.memoryRejectedWrites, err = meter.Int64ObservableCounter(responseCacheMemoryRejectedWrites, responseCacheMemoryRejectedWritesOptions...); err != nil {
		return nil, fmt.Errorf("failed to create response cache rejected writes counter: %w", err)
	}
	if instruments.memoryMaxEntries, err = meter.Int64ObservableGauge(responseCacheMemoryMaxEntries, responseCacheMemoryMaxEntriesOptions...); err != nil {
		return nil, fmt.Errorf("failed to create response cache max entries gauge: %w", err)
	}

	return &instruments, nil
}
