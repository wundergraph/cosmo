package core

import (
	"context"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"go.uber.org/zap"
)

var _ CacheWarmupSource = (*PlanSource)(nil)

type PlanSource struct {
	queries []*nodev1.Operation
}

func NewPlanSource(switchoverCacheWarmerQueries []*nodev1.Operation) *PlanSource {
	return &PlanSource{queries: switchoverCacheWarmerQueries}
}

func (c *PlanSource) LoadItems(_ context.Context, _ *zap.Logger) ([]*nodev1.Operation, error) {
	return c.queries, nil
}
