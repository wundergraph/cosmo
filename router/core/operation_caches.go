package core

import (
	"fmt"
	"sync/atomic"

	"github.com/dgraph-io/ristretto/v2"

	"github.com/wundergraph/cosmo/router/pkg/slowplancache"
)

// OperationCaches are the caches a graph mux prepares operations with. Closing
// them while they are in use is not safe, so they are reference counted: the
// mux holds one reference until it shuts down, every operation holds one while
// it is prepared, and whoever releases the last one closes them.
type OperationCaches struct {
	Plan                   *ristretto.Cache[uint64, *planWithMetaData]
	PlanFallback           *slowplancache.Cache[*planWithMetaData]
	PersistedOperation     *ristretto.Cache[uint64, NormalizationCacheEntry]
	Normalization          *ristretto.Cache[uint64, NormalizationCacheEntry]
	VariablesNormalization *ristretto.Cache[uint64, VariablesNormalizationCacheEntry]
	RemapVariables         *ristretto.Cache[uint64, RemapVariablesCacheEntry]
	ComplexityCalculation  *ristretto.Cache[uint64, ComplexityCacheEntry]
	Validation             *ristretto.Cache[uint64, bool]
	OperationHash          *ristretto.Cache[uint64, string]

	refs   atomic.Int64
	closed chan struct{} // closed once the caches have been closed
	// release drops one reference. It is created once so that Acquire does not allocate.
	release func()
}

// NewOperationCaches returns caches holding their first reference. The caller sets the caches it needs.
func NewOperationCaches() *OperationCaches {
	c := &OperationCaches{closed: make(chan struct{})}
	c.refs.Store(1)
	c.release = func() {
		if c.refs.Add(-1) == 0 {
			defer close(c.closed)
			c.closeAll()
		}
	}
	return c
}

// Acquire takes a reference and returns the function that releases it. If the
// last reference is already gone, it waits for the caches to finish closing and
// returns a no-op: closed caches are safe to use, they miss every read and drop
// every write.
func (c *OperationCaches) Acquire() (release func()) {
	for {
		n := c.refs.Load()
		if n <= 0 {
			<-c.closed
			return func() {}
		}
		if c.refs.CompareAndSwap(n, n+1) {
			return c.release
		}
	}
}

// Wait blocks until all pending writes have been applied.
func (c *OperationCaches) Wait() {
	release := c.Acquire()
	defer release()

	c.Plan.Wait()
	c.PersistedOperation.Wait()
	c.Normalization.Wait()
	c.VariablesNormalization.Wait()
	c.RemapVariables.Wait()
	c.ComplexityCalculation.Wait()
	c.Validation.Wait()
	c.OperationHash.Wait()
}

// Close releases the reference the caches were created with. It must be called
// once, by their owner. The caches are closed when the last operation using
// them is done.
func (c *OperationCaches) Close() {
	c.release()
}

func (c *OperationCaches) closeAll() {
	c.Plan.Close()
	c.PlanFallback.Close()
	c.PersistedOperation.Close()
	c.Normalization.Close()
	c.VariablesNormalization.Close()
	c.RemapVariables.Close()
	c.ComplexityCalculation.Close()
	c.Validation.Close()
	c.OperationHash.Close()
}

// buildOperationCaches creates the caches that the configuration of srv enables.
func buildOperationCaches(srv *graphServer) (_ *OperationCaches, computeSha256 bool, err error) {
	c := NewOperationCaches()
	defer func() {
		if err != nil {
			c.Close()
		}
	}()

	// We create a new execution plan cache for each operation planner which is coupled to
	// the specific engine configuration. This is necessary because otherwise we would return invalid plans.
	//
	// when an execution plan was generated, which can be quite expensive, we want to cache it
	// this means that we can hash the input and cache the generated plan
	// the next time we get the same input, we can just return the cached plan
	// the engine is smart enough to first do normalization and then hash the input
	// this means that we can cache the normalized input and don't have to worry about
	// different inputs that would generate the same execution plan

	if srv.engineExecutionConfiguration.ExecutionPlanCacheSize > 0 {
		planCacheConfig := &ristretto.Config[uint64, *planWithMetaData]{
			Metrics:            srv.metricConfig.OpenTelemetry.GraphqlCache || srv.metricConfig.Prometheus.GraphqlCache,
			MaxCost:            srv.engineExecutionConfiguration.ExecutionPlanCacheSize,
			NumCounters:        srv.engineExecutionConfiguration.ExecutionPlanCacheSize * 10,
			IgnoreInternalCost: true,
			BufferItems:        64,
		}
		if srv.cacheWarmup != nil && srv.cacheWarmup.Enabled && srv.cacheWarmup.InMemoryFallback {
			planCacheConfig.OnEvict = func(item *ristretto.Item[*planWithMetaData]) {
				// This could be called before planFallback is set, but it's not a problem
				// because there is a nil guard inside, as well as items should not really be evicted
				// on startup
				c.PlanFallback.Set(item.Key, item.Value, item.Value.planningDuration)
			}
		}
		c.Plan, err = ristretto.NewCache(planCacheConfig)
		if err != nil {
			return nil, computeSha256, fmt.Errorf("failed to create planner cache: %w", err)
		}
	}

	if srv.engineExecutionConfiguration.EnablePersistedOperationsCache || srv.automaticPersistedQueriesConfig.Enabled {
		cacheSize := int64(1024)
		persistedOperationCacheConfig := &ristretto.Config[uint64, NormalizationCacheEntry]{
			MaxCost:            cacheSize,
			NumCounters:        cacheSize * 10,
			IgnoreInternalCost: true,
			BufferItems:        64,
			Metrics:            true,
		}

		c.PersistedOperation, err = ristretto.NewCache(persistedOperationCacheConfig)
		if err != nil {
			return nil, computeSha256, fmt.Errorf("failed to create persisted operation cache: %w", err)
		}
	}

	if srv.engineExecutionConfiguration.EnableNormalizationCache && srv.engineExecutionConfiguration.NormalizationCacheSize > 0 {
		normalizationCacheConfig := &ristretto.Config[uint64, NormalizationCacheEntry]{
			Metrics:            srv.metricConfig.OpenTelemetry.GraphqlCache || srv.metricConfig.Prometheus.GraphqlCache,
			MaxCost:            srv.engineExecutionConfiguration.NormalizationCacheSize,
			NumCounters:        srv.engineExecutionConfiguration.NormalizationCacheSize * 10,
			IgnoreInternalCost: true,
			BufferItems:        64,
		}
		c.Normalization, err = ristretto.NewCache(normalizationCacheConfig)
		if err != nil {
			return nil, computeSha256, fmt.Errorf("failed to create normalization cache: %w", err)
		}

		variablesNormalizationCacheConfig := &ristretto.Config[uint64, VariablesNormalizationCacheEntry]{
			Metrics:            srv.metricConfig.OpenTelemetry.GraphqlCache || srv.metricConfig.Prometheus.GraphqlCache,
			MaxCost:            srv.engineExecutionConfiguration.NormalizationCacheSize,
			NumCounters:        srv.engineExecutionConfiguration.NormalizationCacheSize * 10,
			IgnoreInternalCost: true,
			BufferItems:        64,
		}
		c.VariablesNormalization, err = ristretto.NewCache(variablesNormalizationCacheConfig)
		if err != nil {
			return nil, computeSha256, fmt.Errorf("failed to create variables normalization cache: %w", err)
		}

		remapVariablesCacheConfig := &ristretto.Config[uint64, RemapVariablesCacheEntry]{
			Metrics:            srv.metricConfig.OpenTelemetry.GraphqlCache || srv.metricConfig.Prometheus.GraphqlCache,
			MaxCost:            srv.engineExecutionConfiguration.NormalizationCacheSize,
			NumCounters:        srv.engineExecutionConfiguration.NormalizationCacheSize * 10,
			IgnoreInternalCost: true,
			BufferItems:        64,
		}
		c.RemapVariables, err = ristretto.NewCache(remapVariablesCacheConfig)
		if err != nil {
			return nil, computeSha256, fmt.Errorf("failed to create remap variables cache: %w", err)
		}
	}

	if srv.engineExecutionConfiguration.EnableValidationCache && srv.engineExecutionConfiguration.ValidationCacheSize > 0 {
		validationCacheConfig := &ristretto.Config[uint64, bool]{
			Metrics:            srv.metricConfig.OpenTelemetry.GraphqlCache || srv.metricConfig.Prometheus.GraphqlCache,
			MaxCost:            srv.engineExecutionConfiguration.ValidationCacheSize,
			NumCounters:        srv.engineExecutionConfiguration.ValidationCacheSize * 10,
			IgnoreInternalCost: true,
			BufferItems:        64,
		}
		c.Validation, err = ristretto.NewCache(validationCacheConfig)
		if err != nil {
			return nil, computeSha256, fmt.Errorf("failed to create validation cache: %w", err)
		}
	}

	if srv.securityConfiguration.ComplexityCalculationCache != nil && srv.securityConfiguration.ComplexityCalculationCache.Enabled && srv.securityConfiguration.ComplexityCalculationCache.CacheSize > 0 {
		complexityCalculationCacheConfig := &ristretto.Config[uint64, ComplexityCacheEntry]{
			Metrics:            srv.metricConfig.OpenTelemetry.GraphqlCache || srv.metricConfig.Prometheus.GraphqlCache,
			MaxCost:            srv.securityConfiguration.ComplexityCalculationCache.CacheSize,
			NumCounters:        srv.securityConfiguration.ComplexityCalculationCache.CacheSize * 10,
			IgnoreInternalCost: true,
			BufferItems:        64,
		}
		c.ComplexityCalculation, err = ristretto.NewCache(complexityCalculationCacheConfig)
		if err != nil {
			return nil, computeSha256, fmt.Errorf("failed to create query depth cache: %w", err)
		}
	}

	// Currently, we only support custom attributes from the context for OTLP metrics
	if !computeSha256 && len(srv.metricConfig.Attributes) > 0 {
		for _, customAttribute := range srv.metricConfig.Attributes {
			if customAttribute.ValueFrom != nil && customAttribute.ValueFrom.ContextField == ContextFieldOperationSha256 {
				computeSha256 = true
				break
			}
		}
	}

	if !computeSha256 && srv.accessLogsConfig != nil {
		for _, customAttribute := range append(srv.accessLogsConfig.Attributes, srv.accessLogsConfig.SubgraphAttributes...) {
			if customAttribute.ValueFrom != nil && customAttribute.ValueFrom.ContextField == ContextFieldOperationSha256 {
				computeSha256 = true
				break
			}
		}
	}

	if srv.persistedOperationsConfig.Safelist.Enabled || srv.persistedOperationsConfig.LogUnknown {
		// In these case, we'll want to compute the sha256 for every operation, in order to check that the operation
		// is present in the Persisted Operation cache
		computeSha256 = true
	}

	// Prometheus schema field usage metrics can use sha256, so we need to ensure it is computed
	if srv.metricConfig.Prometheus.PromSchemaFieldUsage.Enabled && srv.metricConfig.Prometheus.PromSchemaFieldUsage.IncludeOperationSha {
		computeSha256 = true
	}

	if computeSha256 {
		operationHashCacheConfig := &ristretto.Config[uint64, string]{
			MaxCost:            srv.engineExecutionConfiguration.OperationHashCacheSize,
			NumCounters:        srv.engineExecutionConfiguration.OperationHashCacheSize * 10,
			IgnoreInternalCost: true,
			BufferItems:        64,
			Metrics:            srv.metricConfig.OpenTelemetry.GraphqlCache || srv.metricConfig.Prometheus.GraphqlCache,
		}
		c.OperationHash, err = ristretto.NewCache(operationHashCacheConfig)
		if err != nil {
			return nil, computeSha256, fmt.Errorf("failed to create operation hash cache: %w", err)
		}
	}

	return c, computeSha256, nil
}
