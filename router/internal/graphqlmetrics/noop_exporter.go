package graphqlmetrics

import (
	"context"
	graphqlmetricsv12 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1"
)

type NoopExporter struct{}

func NewNoopExporter() *NoopExporter {
	return &NoopExporter{}
}

func (e *NoopExporter) Record(_ *graphqlmetricsv12.SchemaUsageInfo) bool {
	return true
}

func (e *NoopExporter) ForceFlush(_ context.Context) error {
	return nil
}

func (e *NoopExporter) Shutdown(_ context.Context) error {
	return nil
}
