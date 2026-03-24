package core

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/graphqlmetrics"
	"github.com/wundergraph/cosmo/router/pkg/metric"
	"go.opentelemetry.io/otel/attribute"
	otelmetric "go.opentelemetry.io/otel/metric"
	"go.uber.org/zap"
)

func TestFinishSchemaUsageExport(t *testing.T) {
	t.Parallel()

	t.Run("client disconnection passes hasError=false to schema usage exporters", func(t *testing.T) {
		t.Parallel()

		store := &spyMetricStore{}
		rm := &spyRouterMetrics{store: store}
		rc := newTestRequestContext(t)
		rc.error = context.Canceled

		m := &OperationMetrics{
			routerMetrics:            rm,
			inflightMetric:           func() {},
			trackUsageInfo:           true,
			prometheusTrackUsageInfo: true,
		}
		m.Finish(rc, 200, 100, false)

		require.True(t, rm.schemaUsageCalled)
		require.False(t, rm.schemaUsageHasError, "ExportSchemaUsageInfo should receive hasError=false for client disconnections")

		require.True(t, rm.promUsageCalled)
		require.False(t, rm.promUsageHasError, "ExportSchemaUsageInfoPrometheus should receive hasError=false for client disconnections")

		require.False(t, store.requestErrorCalled, "MeasureRequestError should not be called for client disconnections")
	})

	t.Run("real error passes hasError=true to schema usage exporters", func(t *testing.T) {
		t.Parallel()

		store := &spyMetricStore{}
		rm := &spyRouterMetrics{store: store}
		rc := newTestRequestContext(t)
		rc.error = errors.New("subgraph timeout")

		m := &OperationMetrics{
			routerMetrics:            rm,
			inflightMetric:           func() {},
			trackUsageInfo:           true,
			prometheusTrackUsageInfo: true,
		}
		m.Finish(rc, 500, 100, false)

		require.True(t, rm.schemaUsageCalled)
		require.True(t, rm.schemaUsageHasError, "ExportSchemaUsageInfo should receive hasError=true for real errors")

		require.True(t, rm.promUsageCalled)
		require.True(t, rm.promUsageHasError, "ExportSchemaUsageInfoPrometheus should receive hasError=true for real errors")

		require.True(t, store.requestErrorCalled, "MeasureRequestError should be called for real errors")
	})

	t.Run("no error passes hasError=false to schema usage exporters", func(t *testing.T) {
		t.Parallel()

		store := &spyMetricStore{}
		rm := &spyRouterMetrics{store: store}
		rc := newTestRequestContext(t)

		m := &OperationMetrics{
			routerMetrics:            rm,
			inflightMetric:           func() {},
			trackUsageInfo:           true,
			prometheusTrackUsageInfo: true,
		}
		m.Finish(rc, 200, 100, false)

		require.True(t, rm.schemaUsageCalled)
		require.False(t, rm.schemaUsageHasError)

		require.True(t, rm.promUsageCalled)
		require.False(t, rm.promUsageHasError)

		require.False(t, store.requestErrorCalled)
	})
}

type spyRouterMetrics struct {
	store metric.Store

	schemaUsageCalled   bool
	schemaUsageHasError bool
	promUsageCalled     bool
	promUsageHasError   bool
}

func (m *spyRouterMetrics) StartOperation(_ *zap.Logger, _ int64, _ []attribute.KeyValue, _ otelmetric.AddOption) *OperationMetrics {
	return nil
}

func (m *spyRouterMetrics) ExportSchemaUsageInfo(_ *operationContext, _ int, hasError bool, _ bool) {
	m.schemaUsageCalled = true
	m.schemaUsageHasError = hasError
}

func (m *spyRouterMetrics) ExportSchemaUsageInfoPrometheus(_ *operationContext, _ int, hasError bool, _ bool) {
	m.promUsageCalled = true
	m.promUsageHasError = hasError
}

func (m *spyRouterMetrics) GQLMetricsExporter() *graphqlmetrics.GraphQLMetricsExporter {
	return nil
}

func (m *spyRouterMetrics) PrometheusMetricsExporter() *graphqlmetrics.PrometheusMetricsExporter {
	return nil
}

func (m *spyRouterMetrics) MetricStore() metric.Store {
	return m.store
}

type spyMetricStore struct {
	metric.NoopMetrics
	requestErrorCalled bool
}

func (m *spyMetricStore) MeasureRequestError(_ context.Context, _ []attribute.KeyValue, _ otelmetric.AddOption) {
	m.requestErrorCalled = true
}

func newTestRequestContext(t *testing.T) *requestContext {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/graphql", nil)
	rc := buildRequestContext(requestContextOptions{r: req})
	rc.operation = &operationContext{}
	return rc
}
