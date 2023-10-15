package core

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/wundergraph/cosmo/router/internal/metric"
	"github.com/wundergraph/cosmo/router/internal/otel"
	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.21.0"
	"go.opentelemetry.io/otel/trace"
)

type OperationProtocol int

const (
	OperationProtocolHTTP OperationProtocol = iota + 1
	OperationProtocolGraphQLWS
)

func (p OperationProtocol) String() string {
	switch p {
	case OperationProtocolHTTP:
		return "http"
	case OperationProtocolGraphQLWS:
		return "graphql-ws"
	default:
		return fmt.Sprintf("unknown operation protocol %d", int(p))
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

func (m *OperationMetrics) AddOperation(ctx context.Context, operation *ParsedOperation, protocol OperationProtocol) {
	if operation.Name != "" {
		m.metricBaseFields = append(m.metricBaseFields, otel.WgOperationName.String(operation.Name))
	}

	if operation.Type != "" {
		m.metricBaseFields = append(m.metricBaseFields, otel.WgOperationType.String(operation.Type))
	}

	// Add the operation to the trace span
	span := trace.SpanFromContext(ctx)
	// Set the span name to the operation name after we figured it out
	// TODO: Ask Dustin about this name
	span.SetName(GetSpanName(operation.Name, protocol.String()))

	span.SetAttributes(otel.WgOperationName.String(operation.Name))
	span.SetAttributes(otel.WgOperationType.String(operation.Type))
	span.SetAttributes(otel.WgOperationContent.String(operation.Query))
	span.SetAttributes(otel.WgOperationProtocol.String(protocol.String()))

	// Add the operation hash to the trace span attributes
	opHashID := otel.WgOperationHash.String(strconv.FormatUint(operation.ID, 10))
	span.SetAttributes(opHashID)

	// Add hash to metrics base fields
	m.metricBaseFields = append(m.metricBaseFields, opHashID)
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
