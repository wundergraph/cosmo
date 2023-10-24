package core

import (
	"context"
	semconv "go.opentelemetry.io/otel/semconv/v1.21.0"
	"strconv"
	"time"

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
}

func (m *OperationMetrics) Finish(ctx context.Context, hasErrored bool, statusCode int, responseSize int64) {
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
}

func (m *OperationMetrics) AddSpanAttributes(kv ...attribute.KeyValue) {
	m.metricBaseFields = append(m.metricBaseFields, kv...)
}

func (m *OperationMetrics) AddClientInfo(ctx context.Context, info *ClientInfo) {
	span := trace.SpanFromContext(ctx)

	// Add client info to trace span attributes
	span.SetAttributes(otel.WgClientName.String(info.Name))
	span.SetAttributes(otel.WgClientVersion.String(info.Version))

	// Add client info to metrics base fields
	m.metricBaseFields = append(m.metricBaseFields, otel.WgClientName.String(info.Name))
	m.metricBaseFields = append(m.metricBaseFields, otel.WgClientVersion.String(info.Version))
}

func StartOperationMetrics(ctx context.Context, mtr *metric.Metrics, requestContentLength int64) *OperationMetrics {
	operationStartTime := time.Now()

	inflightMetric := mtr.MeasureInFlight(ctx)
	return &OperationMetrics{
		metrics:              mtr,
		requestContentLength: requestContentLength,
		operationStartTime:   operationStartTime,
		inflightMetric:       inflightMetric,
	}
}

func SetSpanOperationAttributes(ctx context.Context, operation *ParsedOperation) []attribute.KeyValue {
	var baseMetricAttributeValues []attribute.KeyValue

	// Set the operation name as early as possible so that it is available in the trace
	span := trace.SpanFromContext(ctx)
	span.SetName(GetSpanName(operation.Name, operation.Type))
	baseMetricAttributeValues = append(baseMetricAttributeValues, otel.WgOperationName.String(operation.Name))
	baseMetricAttributeValues = append(baseMetricAttributeValues, otel.WgOperationType.String(operation.Type))
	baseMetricAttributeValues = append(baseMetricAttributeValues, otel.WgOperationContent.String(operation.Query))
	baseMetricAttributeValues = append(baseMetricAttributeValues, otel.WgOperationProtocol.String(OperationProtocolHTTP.String()))

	// Add the operation hash to the trace span attributes
	opHashID := otel.WgOperationHash.String(strconv.FormatUint(operation.ID, 10))
	baseMetricAttributeValues = append(baseMetricAttributeValues, opHashID)

	span.SetAttributes(baseMetricAttributeValues...)

	return baseMetricAttributeValues
}
