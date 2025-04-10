package core

import (
	"go.opentelemetry.io/otel/attribute"
	otelmetric "go.opentelemetry.io/otel/metric"

	graphqlmetricsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"github.com/wundergraph/cosmo/router/internal/graphqlmetrics"
	"github.com/wundergraph/cosmo/router/internal/unsafebytes"
	"github.com/wundergraph/cosmo/router/pkg/metric"
	"go.uber.org/zap"
)

type RouterMetrics interface {
	StartOperation(logger *zap.Logger, requestContentLength int64, sliceAttr []attribute.KeyValue, inFlightAddOption otelmetric.AddOption) *OperationMetrics
	ExportSchemaUsageInfo(operationContext *operationContext, statusCode int, hasError bool, exportSynchronous bool)
	GqlMetricsExporter() *graphqlmetrics.Exporter
	MetricStore() metric.Store
}

// routerMetrics encapsulates all data and configuration that the router
// uses to collect and its metrics
type routerMetrics struct {
	metrics             metric.Store
	gqlMetricsExporter  *graphqlmetrics.Exporter
	routerConfigVersion string
	logger              *zap.Logger
	exportEnabled       bool

	promSchemaUsageEnabled             bool
	promSchemaUsageIncludeOperationSha bool
}

type routerMetricsConfig struct {
	metrics             metric.Store
	gqlMetricsExporter  *graphqlmetrics.Exporter
	routerConfigVersion string
	logger              *zap.Logger
	exportEnabled       bool

	promSchemaUsageEnabled             bool
	promSchemaUsageIncludeOperationSha bool
}

func NewRouterMetrics(cfg *routerMetricsConfig) RouterMetrics {
	return &routerMetrics{
		metrics:             cfg.metrics,
		gqlMetricsExporter:  cfg.gqlMetricsExporter,
		routerConfigVersion: cfg.routerConfigVersion,
		logger:              cfg.logger,
		exportEnabled:       cfg.exportEnabled,

		promSchemaUsageEnabled:             cfg.promSchemaUsageEnabled,
		promSchemaUsageIncludeOperationSha: cfg.promSchemaUsageIncludeOperationSha,
	}
}

// StartOperation starts the metrics for a new GraphQL operation. The returned value is a OperationMetrics
// where the caller must always call Finish() (usually via defer()). If the metrics are disabled, this
// returns nil, but OperationMetrics is safe to call with a nil receiver.
func (m *routerMetrics) StartOperation(logger *zap.Logger, requestContentLength int64, sliceAttr []attribute.KeyValue, inFlightAddOption otelmetric.AddOption) *OperationMetrics {
	metrics := newOperationMetrics(OperationMetricsOptions{
		RouterMetrics:        m,
		Logger:               logger,
		RequestContentLength: requestContentLength,
		RouterConfigVersion:  m.routerConfigVersion,
		TrackUsageInfo:       m.exportEnabled,
		InFlightAddOption:    inFlightAddOption,
		SliceAttributes:      sliceAttr,

		PrometheusSchemaUsageEnabled:    m.promSchemaUsageEnabled,
		PrometheusSchemaUsageIncludeSha: m.promSchemaUsageIncludeOperationSha,
	})
	return metrics
}

func (m *routerMetrics) MetricStore() metric.Store {
	return m.metrics
}

func (m *routerMetrics) GqlMetricsExporter() *graphqlmetrics.Exporter {
	return m.gqlMetricsExporter
}

func (m *routerMetrics) ExportSchemaUsageInfo(operationContext *operationContext, statusCode int, hasError bool, exportSynchronous bool) {
	if !m.exportEnabled {
		return
	}

	var opType graphqlmetricsv1.OperationType
	switch operationContext.opType {
	case OperationTypeQuery:
		opType = graphqlmetricsv1.OperationType_QUERY
	case OperationTypeMutation:
		opType = graphqlmetricsv1.OperationType_MUTATION
	case OperationTypeSubscription:
		opType = graphqlmetricsv1.OperationType_SUBSCRIPTION
	}

	// If you refactor the code below or code within the exporter,
	// make sure to never "mutate" SchemaUsageInfo
	// We're re-using typeFieldUsageInfo and argumentUsageInfo across requests
	// they are being cached across requests using the planner cache
	// because the two are unique for each plan and can be re-used
	// If you need to modify them, make a copy
	// However, in the current form, the aggregation layer adds an envelope around Schema Usage with the RequestCount
	// This allows batching / aggregation without having to modify the original slices,
	// which seems to be efficient in terms of memory usage and CPU
	item := &graphqlmetricsv1.SchemaUsageInfo{
		RequestDocument:  operationContext.content,
		TypeFieldMetrics: operationContext.typeFieldUsageInfo.IntoGraphQLMetrics(),
		ArgumentMetrics:  operationContext.argumentUsageInfo,
		InputMetrics:     operationContext.inputUsageInfo,
		OperationInfo: &graphqlmetricsv1.OperationInfo{
			Type: opType,
			Hash: operationContext.HashString(),
			// parsed operation names are re-used across requests
			// for that reason, we need to copy the name, or it might get corrupted
			Name: m.strCopy(operationContext.name),
		},
		SchemaInfo: &graphqlmetricsv1.SchemaInfo{
			Version: m.routerConfigVersion,
		},
		ClientInfo: &graphqlmetricsv1.ClientInfo{
			Name:    operationContext.clientInfo.Name,
			Version: operationContext.clientInfo.Version,
		},
		RequestInfo: &graphqlmetricsv1.RequestInfo{
			Error:      hasError,
			StatusCode: int32(statusCode),
		},
	}

	m.gqlMetricsExporter.RecordUsage(item, exportSynchronous)
}

func (m *routerMetrics) strCopy(s string) string {
	b := make([]byte, len(s))
	copy(b, s)
	return unsafebytes.BytesToString(b)
}
