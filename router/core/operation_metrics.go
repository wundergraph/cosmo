package core

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/wundergraph/cosmo/router/internal/metric"
	"github.com/wundergraph/cosmo/router/internal/otel"
	ctrace "github.com/wundergraph/cosmo/router/internal/trace"
	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.21.0"
	"go.opentelemetry.io/otel/trace"
)

type ClientMetricsInfo struct {
	Name    string
	Version string
}

func NewClientMetricsInfoFromRequest(r *http.Request) *ClientMetricsInfo {
	clientName := ctrace.GetClientInfo(r.Header, "graphql-client-name", "apollographql-client-name", "unknown")
	clientVersion := ctrace.GetClientInfo(r.Header, "graphql-client-version", "apollographql-client-version", "missing")
	return &ClientMetricsInfo{
		Name:    clientName,
		Version: clientVersion,
	}
}

type OperationMetrics struct {
	requestContentLength int64
	metrics              *metric.Metrics
	operationStartTime   time.Time
	metricBaseFields     []attribute.KeyValue
	inflightMetric       func()
}

func (m *OperationMetrics) Finish(ctx context.Context, statusCode int, responseSize int64) {
	m.inflightMetric()

	m.metricBaseFields = append(m.metricBaseFields, semconv.HTTPStatusCode(statusCode))
	m.metrics.MeasureRequestCount(ctx, m.metricBaseFields...)
	m.metrics.MeasureRequestSize(ctx, m.requestContentLength, m.metricBaseFields...)
	m.metrics.MeasureLatency(ctx,
		m.operationStartTime,
		m.metricBaseFields...,
	)
	m.metrics.MeasureResponseSize(ctx, int64(responseSize), m.metricBaseFields...)
}

func (m *OperationMetrics) AddOperation(ctx context.Context, operation *ParsedOperation) {
	if operation.Name != "" {
		m.metricBaseFields = append(m.metricBaseFields, otel.WgOperationName.String(operation.Name))
	}

	if operation.Type != "" {
		m.metricBaseFields = append(m.metricBaseFields, otel.WgOperationType.String(operation.Type))
	}

	// Add the operation to the trace span
	span := trace.SpanFromContext(ctx)
	// Set the span name to the operation name after we figured it out
	// TODO: DO NOT HARDCODE THIS
	span.SetName(GetSpanName(operation.Name, "POST"))

	span.SetAttributes(otel.WgOperationName.String(operation.Name))
	span.SetAttributes(otel.WgOperationType.String(operation.Type))
	span.SetAttributes(otel.WgOperationContent.String(operation.Query))

	// Add the operation hash to the trace span attributes
	opHashID := otel.WgOperationHash.String(strconv.FormatUint(operation.ID, 10))
	span.SetAttributes(opHashID)

	// Add hash to metrics base fields
	m.metricBaseFields = append(m.metricBaseFields, opHashID)
}

func (m *OperationMetrics) AddClientInfo(ctx context.Context, info *ClientMetricsInfo) {
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
