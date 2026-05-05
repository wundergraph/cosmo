package cacheevents

import (
	"time"

	cacheeventsv1 "github.com/wundergraph/cosmo/graphqlmetrics/gen/proto/wg/cosmo/cacheevents/v1"
	utils "github.com/wundergraph/cosmo/graphqlmetrics/pkg/utils"
)

// BatchItem is the unit of work pushed onto the cache-events batch processor.
// One BatchItem corresponds to one PublishEntityCacheEvents RPC call from
// a router; it carries the events and the JWT claims that authenticated
// the request.
type BatchItem struct {
	Events []*cacheeventsv1.CacheEvent
	Claims *utils.GraphAPITokenClaims
}

// ProcessorConfig carries the tunables for the cache-events batch processor.
// Defaults are set higher than the schema-usage processor because cache
// events are 10-100x request volume.
type ProcessorConfig struct {
	MaxBatchSize int
	MaxQueueSize int
	MaxWorkers   int
	Interval     time.Duration
}

// DefaultProcessorConfig returns the resource-isolated defaults used when no
// env-overrides are provided. These are intentionally separate from the
// schema-usage processor's defaults so a cache-events spike does not
// degrade schema-usage SLAs.
func DefaultProcessorConfig() ProcessorConfig {
	return ProcessorConfig{
		MaxBatchSize: 8192,
		MaxQueueSize: 131072,
		MaxWorkers:   4,
		Interval:     5 * time.Second,
	}
}

// batchCost returns the number of events in the batch — used by the
// generic batchprocessor as the cost function.
func batchCost(items []BatchItem) int {
	n := 0
	for _, it := range items {
		n += len(it.Events)
	}
	return n
}
