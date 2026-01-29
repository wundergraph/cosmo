package core

import (
	"context"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"go.uber.org/zap"
)

var _ CacheWarmupSource = (*PlanSource)(nil)

// PlanSource is a very basic cache warmup source that relies on the caller of this type to pass in the
// queries to be used for cache warming directly
type PlanSource struct {
	queries []*nodev1.Operation
}

// NewPlanSource creates a new PlanSource with the given queries from the caller
func NewPlanSource(switchoverCacheWarmerQueries []*nodev1.Operation) *PlanSource {
	if switchoverCacheWarmerQueries == nil {
		switchoverCacheWarmerQueries = make([]*nodev1.Operation, 0)
	}
	return &PlanSource{queries: switchoverCacheWarmerQueries}
}

// LoadItems loads the items from the plan source when called by the cache warmer
func (c *PlanSource) LoadItems(_ context.Context, _ *zap.Logger) ([]*nodev1.Operation, error) {
	if c == nil {
		return nil, nil
	}
	return c.queries, nil
}
