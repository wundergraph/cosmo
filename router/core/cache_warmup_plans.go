package core

import (
	"context"
	"github.com/dgraph-io/ristretto/v2"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"go.uber.org/zap"
)

var _ CacheWarmupSource = (*PlanSource)(nil)

type PlanSource struct {
	queries []*nodev1.Operation
}

func NewPlanSource(switchoverCacheWarmerQueries *ristretto.Cache[uint64, *planWithMetaData]) *PlanSource {
	// Extract the items on creation so that the previous planCache can be garbage collected as we won't hold a reference
	items := make([]*nodev1.Operation, 0)

	if switchoverCacheWarmerQueries != nil {
		switchoverCacheWarmerQueries.IterValues(func(v *planWithMetaData) (stop bool) {
			items = append(items, &nodev1.Operation{
				Request: &nodev1.OperationRequest{Query: v.content},
			})
			return false
		})
	}

	return &PlanSource{queries: items}
}

func (c *PlanSource) LoadItems(_ context.Context, _ *zap.Logger) ([]*nodev1.Operation, error) {
	return c.queries, nil
}
