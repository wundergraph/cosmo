package core

import (
	"context"

	"github.com/wundergraph/cosmo/router/internal/graphqlmetrics"
	"github.com/wundergraph/cosmo/router/internal/metric"
)

// RouterMetrics encapsulates all data and configuration that the router
// uses to collect and its metrics
type RouterMetrics struct {
	metrics             *metric.Metrics
	gqlMetricsExporter  *graphqlmetrics.Exporter
	routerConfigVersion string
}

// StartOperation starts the metrics for a new GraphQL operation. The returned value is a OperationMetrics
// where the caller must always call Finish() (usually via defer()). If the metrics are disabled, this
// returns nil, but OperationMetrics is safe to call with a nil receiver.
func (m *RouterMetrics) StartOperation(ctx context.Context, clientInfo *ClientInfo, requestContentLength int64) *OperationMetrics {
	if m == nil || m.metrics == nil {
		// Return a nil OperationMetrics, which will be a no-op, to simplify callers
		return nil
	}
	metrics := startOperationMetrics(ctx, m.metrics, requestContentLength, m.gqlMetricsExporter, m.routerConfigVersion)
	if clientInfo != nil {
		metrics.AddClientInfo(ctx, clientInfo)
	}
	return metrics
}

func NewRouterMetrics(metrics *metric.Metrics, gqlMetrics *graphqlmetrics.Exporter, configVersion string) *RouterMetrics {
	return &RouterMetrics{
		metrics:             metrics,
		gqlMetricsExporter:  gqlMetrics,
		routerConfigVersion: configVersion,
	}
}
