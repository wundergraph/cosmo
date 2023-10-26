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

func (m *OperationMetrics) exportSchemaUsageInfo(operationContext *operationContext, statusCode int, hasError bool) {
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
		RequestInfo: &graphqlmetricsv1.RequestInfo{
			Error:      hasError,
			StatusCode: int32(statusCode),
		},
	})
}

func (m *OperationMetrics) AddOperationContext(opContext *operationContext) {
	if m == nil {
		return
	}
	m.opContext = opContext
}

func (m *OperationMetrics) Finish(ctx context.Context, hasErrored bool, statusCode int, responseSize int) {
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
	m.metrics.MeasureResponseSize(ctx, int64(responseSize), m.metricBaseFields...)

	if m.opContext != nil {
		m.exportSchemaUsageInfo(m.opContext, statusCode, hasErrored)
	}
}

func (m *OperationMetrics) AddAttributes(kv ...attribute.KeyValue) {
	if m == nil {
		return
	}
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

// commonMetricAttributes returns the attributes that are common to both metrics and traces.
func commonMetricAttributes(operation *ParsedOperation, protocol OperationProtocol) []attribute.KeyValue {
	if operation == nil {
		return nil
	}

	var baseMetricAttributeValues []attribute.KeyValue

	// Fields that are always present in the metrics and traces
	baseMetricAttributeValues = append(baseMetricAttributeValues, otel.WgOperationName.String(operation.Name))
	baseMetricAttributeValues = append(baseMetricAttributeValues, otel.WgOperationType.String(operation.Type))
	baseMetricAttributeValues = append(baseMetricAttributeValues, otel.WgOperationProtocol.String(protocol.String()))
	baseMetricAttributeValues = append(baseMetricAttributeValues, otel.WgOperationHash.String(strconv.FormatUint(operation.ID, 10)))

	return baseMetricAttributeValues
}
