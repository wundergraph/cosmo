package core

import (
	"context"
	semconv "go.opentelemetry.io/otel/semconv/v1.21.0"
	"strconv"
	"time"

	graphqlmetricsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"github.com/wundergraph/cosmo/router/internal/graphqlmetrics"
	"github.com/wundergraph/cosmo/router/internal/metric"
	"github.com/wundergraph/cosmo/router/internal/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

type OperationProtocol string

const (
	OperationProtocolHTTP      = OperationProtocol("http")
	OperationProtocolGraphQLWS = OperationProtocol("graphql-ws")
)

func (p OperationProtocol) String() string {
	return string(p)
}

type OperationMetrics struct {
	requestContentLength int64
	metrics              *metric.Metrics
	operationStartTime   time.Time
	metricBaseFields     []attribute.KeyValue
	inflightMetric       func()
	gqlMetricsExporter   *graphqlmetrics.Exporter
	routerConfigVersion  string
	opContext            *operationContext
}

func (m *OperationMetrics) exportSchemaUsageInfo(operationContext *operationContext, attributes graphqlmetrics.Attributes) {
	if m.gqlMetricsExporter == nil {
		return
	}

	fieldUsageInfos := make([]*graphqlmetricsv1.TypeFieldUsageInfo, len(operationContext.preparedPlan.schemaUsageInfo.TypeFields))

	for i := range operationContext.preparedPlan.schemaUsageInfo.TypeFields {
		fieldUsageInfos[i] = &graphqlmetricsv1.TypeFieldUsageInfo{
			Count:       1,
			Path:        operationContext.preparedPlan.schemaUsageInfo.TypeFields[i].Path,
			TypeNames:   operationContext.preparedPlan.schemaUsageInfo.TypeFields[i].TypeNames,
			SubgraphIDs: operationContext.preparedPlan.schemaUsageInfo.TypeFields[i].Source.IDs,
		}
	}

	var opType graphqlmetricsv1.OperationType
	switch operationContext.opType {
	case "query":
		opType = graphqlmetricsv1.OperationType_QUERY
	case "mutation":
		opType = graphqlmetricsv1.OperationType_MUTATION
	case "subscription":
		opType = graphqlmetricsv1.OperationType_SUBSCRIPTION
	}

	// Non-blocking
	m.gqlMetricsExporter.Record(&graphqlmetricsv1.SchemaUsageInfo{
		RequestDocument:  operationContext.content,
		TypeFieldMetrics: fieldUsageInfos,
		OperationInfo: &graphqlmetricsv1.OperationInfo{
			Type: opType,
			Hash: strconv.FormatUint(operationContext.hash, 10),
			Name: operationContext.name,
		},
		SchemaInfo: &graphqlmetricsv1.SchemaInfo{
			Version: m.routerConfigVersion,
		},
		ClientInfo: &graphqlmetricsv1.ClientInfo{
			Name:    operationContext.clientInfo.Name,
			Version: operationContext.clientInfo.Version,
		},
		Attributes: attributes,
	})
}

func (m *OperationMetrics) Finish(ctx context.Context, hasErrored bool, statusCode int, responseSize int64) {
	if m == nil {
		return
	}
	m.inflightMetric()

	if hasErrored {
		m.metricBaseFields = append(m.metricBaseFields, otel.WgRequestError.Bool(hasErrored))
	}

	m.metricBaseFields = append(m.metricBaseFields, semconv.HTTPStatusCode(statusCode))
	m.metrics.MeasureRequestCount(ctx, m.metricBaseFields...)
	m.metrics.MeasureRequestSize(ctx, m.requestContentLength, m.metricBaseFields...)
	m.metrics.MeasureLatency(ctx,
		m.operationStartTime,
		m.metricBaseFields...,
	)
	m.metrics.MeasureResponseSize(ctx, responseSize, m.metricBaseFields...)

	if m.opContext != nil {
		m.exportSchemaUsageInfo(m.opContext, graphqlmetrics.Attributes{
			graphqlmetrics.HTTPStatusCodeAttribute: strconv.Itoa(statusCode),
		})
	}
}

func (m *OperationMetrics) AddSpanAttributes(kv ...attribute.KeyValue) {
	m.metricBaseFields = append(m.metricBaseFields, kv...)
}

// AddClientInfo adds the client info to the operation metrics. If OperationMetrics
// is nil, it's a no-op.
func (m *OperationMetrics) AddClientInfo(ctx context.Context, info *ClientInfo) {
	if m == nil {
		return
	}
	span := trace.SpanFromContext(ctx)

	// Add client info to trace span attributes
	span.SetAttributes(otel.WgClientName.String(info.Name))
	span.SetAttributes(otel.WgClientVersion.String(info.Version))

	// Add client info to metrics base fields
	m.metricBaseFields = append(m.metricBaseFields, otel.WgClientName.String(info.Name))
	m.metricBaseFields = append(m.metricBaseFields, otel.WgClientVersion.String(info.Version))
}

// startOperationMetrics starts the metrics for an operation. This should only be called by
// RouterMetrics.StartOperation()
func startOperationMetrics(ctx context.Context, mtr *metric.Metrics, requestContentLength int64, gqlMetricsExporter *graphqlmetrics.Exporter, routerConfigVersion string) *OperationMetrics {
	operationStartTime := time.Now()

	inflightMetric := mtr.MeasureInFlight(ctx)
	return &OperationMetrics{
		metrics:              mtr,
		requestContentLength: requestContentLength,
		operationStartTime:   operationStartTime,
		inflightMetric:       inflightMetric,
		gqlMetricsExporter:   gqlMetricsExporter,
		routerConfigVersion:  routerConfigVersion,
	}
}

func SetSpanOperationAttributes(ctx context.Context, operation *ParsedOperation, protocol OperationProtocol) []attribute.KeyValue {
	var baseMetricAttributeValues []attribute.KeyValue

	// Set the operation name as early as possible so that it is available in the trace
	span := trace.SpanFromContext(ctx)
	span.SetName(GetSpanName(operation.Name, operation.Type))
	baseMetricAttributeValues = append(baseMetricAttributeValues, otel.WgOperationName.String(operation.Name))
	baseMetricAttributeValues = append(baseMetricAttributeValues, otel.WgOperationType.String(operation.Type))
	baseMetricAttributeValues = append(baseMetricAttributeValues, otel.WgOperationContent.String(operation.Query))
	baseMetricAttributeValues = append(baseMetricAttributeValues, otel.WgOperationProtocol.String(protocol.String()))

	// Add the operation hash to the trace span attributes
	opHashID := otel.WgOperationHash.String(strconv.FormatUint(operation.ID, 10))
	baseMetricAttributeValues = append(baseMetricAttributeValues, opHashID)

	span.SetAttributes(baseMetricAttributeValues...)

	return baseMetricAttributeValues
}
