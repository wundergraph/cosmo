package core

import (
	"context"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"go.uber.org/zap"
)

var _ CacheWarmupSource = (*PlanSource)(nil)

type PlanSource struct {
	plans map[uint64]string
}

func NewPlanSource(plans map[uint64]string) *PlanSource {
	return &PlanSource{plans: plans}
}

func (c *PlanSource) LoadItems(ctx context.Context, log *zap.Logger) ([]*nodev1.Operation, error) {
	var items []*nodev1.Operation

	for _, query := range c.plans {
		items = append(items, &nodev1.Operation{
			Request: &nodev1.OperationRequest{Query: query},
		})
	}

	return items, nil
}
