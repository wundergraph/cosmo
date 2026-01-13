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
	items := make([]*nodev1.Operation, 0)
	switchoverCacheWarmerQueries.Iter(func(k any, v *planWithMetaData) (stop bool) {
		items = append(items, &nodev1.Operation{
			Request: &nodev1.OperationRequest{Query: v.content},
		})
		return false
	})
	return &PlanSource{queries: items}
}

func (c *PlanSource) LoadItems(ctx context.Context, log *zap.Logger) ([]*nodev1.Operation, error) {
	return c.queries, nil
}
