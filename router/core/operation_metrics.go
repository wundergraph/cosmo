package core

import (
	"context"
	"go.uber.org/zap"
	"strconv"
	"time"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	semconv "go.opentelemetry.io/otel/semconv/v1.21.0"

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
	logger               *zap.Logger
}

func (m *OperationMetrics) exportSchemaUsageInfo(operationContext *operationContext, statusCode int, hasError bool) {
	if m.gqlMetricsExporter == nil {
		return
	}

	usageInfo, err := plan.GetSchemaUsageInfo(
		operationContext.preparedPlan.preparedPlan,
		operationContext.preparedPlan.operationDocument,
		operationContext.preparedPlan.schemaDocument,
		operationContext.Variables(),
	)
	if err != nil {
		m.logger.Error("failed to get schema usage info", zap.Error(err))
		return
	}

	fieldUsageInfos := make([]*graphqlmetricsv1.TypeFieldUsageInfo, len(usageInfo.TypeFields))
	argumentUsageInfos := make([]*graphqlmetricsv1.ArgumentUsageInfo, len(usageInfo.Arguments))
	inputUsageInfos := make([]*graphqlmetricsv1.InputUsageInfo, len(usageInfo.InputTypeFields))

	for i := range usageInfo.TypeFields {
		fieldUsageInfos[i] = &graphqlmetricsv1.TypeFieldUsageInfo{
			Count:       1,
			Path:        usageInfo.TypeFields[i].Path,
			TypeNames:   usageInfo.TypeFields[i].EnclosingTypeNames,
			SubgraphIDs: usageInfo.TypeFields[i].Source.IDs,
			NamedType:   usageInfo.TypeFields[i].FieldTypeName,
		}
	}

	for i := range usageInfo.Arguments {
		argumentUsageInfos[i] = &graphqlmetricsv1.ArgumentUsageInfo{
			Count:     1,
			Path:      []string{usageInfo.Arguments[i].FieldName, usageInfo.Arguments[i].ArgumentName},
			TypeName:  usageInfo.Arguments[i].EnclosingTypeName,
			NamedType: usageInfo.Arguments[i].ArgumentTypeName,
		}
	}

	for i := range usageInfo.InputTypeFields {
		// In that case it is a top level input field usage e.g employee(id: 1)
		if len(usageInfo.InputTypeFields[i].EnclosingTypeNames) == 0 {
			inputUsageInfos[i] = &graphqlmetricsv1.InputUsageInfo{
				Count:     uint64(usageInfo.InputTypeFields[i].Count),
				NamedType: usageInfo.InputTypeFields[i].FieldTypeName,
				// Root input fields have no enclosing type name and no path
			}
		} else {
			inputUsageInfos[i] = &graphqlmetricsv1.InputUsageInfo{
				Path:      []string{usageInfo.InputTypeFields[i].EnclosingTypeNames[0], usageInfo.InputTypeFields[i].FieldName},
				Count:     uint64(usageInfo.InputTypeFields[i].Count),
				TypeName:  usageInfo.InputTypeFields[i].EnclosingTypeNames[0],
				NamedType: usageInfo.InputTypeFields[i].FieldTypeName,
			}
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
		ArgumentMetrics: argumentUsageInfos,
		InputMetrics:    inputUsageInfos,
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

func (m *OperationMetrics) Finish(hasErrored bool, statusCode int, responseSize int) {
	if m == nil {
		return
	}
	m.inflightMetric()

	ctx := context.Background()

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
func (m *OperationMetrics) AddClientInfo(info *ClientInfo) {
	if m == nil {
		return
	}

	// Add client info to metrics base fields
	m.metricBaseFields = append(m.metricBaseFields, otel.WgClientName.String(info.Name))
	m.metricBaseFields = append(m.metricBaseFields, otel.WgClientVersion.String(info.Version))
}

// startOperationMetrics starts the metrics for an operation. This should only be called by
// RouterMetrics.StartOperation()
func startOperationMetrics(mtr *metric.Metrics, logger *zap.Logger, requestContentLength int64, gqlMetricsExporter *graphqlmetrics.Exporter, routerConfigVersion string) *OperationMetrics {
	operationStartTime := time.Now()

	inflightMetric := mtr.MeasureInFlight(context.Background())
	return &OperationMetrics{
		metrics:              mtr,
		requestContentLength: requestContentLength,
		operationStartTime:   operationStartTime,
		inflightMetric:       inflightMetric,
		gqlMetricsExporter:   gqlMetricsExporter,
		routerConfigVersion:  routerConfigVersion,
		logger:               logger,
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

// initializeSpan sets the correct span name and attributes for the operation on the current span.
func initializeSpan(ctx context.Context, operation *ParsedOperation, clientInfo *ClientInfo, commonAttributeValues []attribute.KeyValue) {
	if operation == nil {
		return
	}

	span := trace.SpanFromContext(ctx)
	span.SetName(GetSpanName(operation.Name, operation.Type))
	span.SetAttributes(commonAttributeValues...)
	// Only set the query content on the span
	span.SetAttributes(otel.WgOperationContent.String(operation.NormalizedRepresentation))

	// Add client info to trace span attributes
	span.SetAttributes(otel.WgClientName.String(clientInfo.Name))
	span.SetAttributes(otel.WgClientVersion.String(clientInfo.Version))
}
