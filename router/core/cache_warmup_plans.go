package core

import (
	"context"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"go.uber.org/zap"
)

var _ CacheWarmupSource = (*PlanSource)(nil)

type PlanSource struct {
	queries *ringBuffer
}

func NewPlanSource(switchoverCacheWarmerQueries *ringBuffer) *PlanSource {
	return &PlanSource{queries: switchoverCacheWarmerQueries}
}

func (c *PlanSource) LoadItems(ctx context.Context, log *zap.Logger) ([]*nodev1.Operation, error) {
	var items []*nodev1.Operation

	for _, query := range c.queries.Snapshot() {
		items = append(items, &nodev1.Operation{
			Request: &nodev1.OperationRequest{Query: query},
		})
	}

	return items, nil
}
