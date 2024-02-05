package core

import (
	"context"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"strconv"
	"time"

	"go.uber.org/zap"

	semconv "go.opentelemetry.io/otel/semconv/v1.21.0"

	"go.opentelemetry.io/otel/attribute"
)

type OperationProtocol string

const (
	OperationProtocolHTTP = OperationProtocol("http")
	OperationProtocolWS   = OperationProtocol("ws")
)

func (p OperationProtocol) String() string {
	return string(p)
}

type OperationMetrics struct {
	requestContentLength int64
	routerMetrics        RouterMetrics
	operationStartTime   time.Time
	metricBaseFields     []attribute.KeyValue
	inflightMetric       func()
	routerConfigVersion  string
	opContext            *operationContext
	logger               *zap.Logger
}

func (m *OperationMetrics) exportSchemaUsageInfo(operationContext *operationContext, statusCode int, hasError bool) {
	m.routerMetrics.ExportSchemaUsageInfo(operationContext, statusCode, hasError)
}

func (m *OperationMetrics) AddOperationContext(opContext *operationContext) {
	m.opContext = opContext
}

func (m *OperationMetrics) Finish(err error, statusCode int, responseSize int) {
	m.inflightMetric()

	ctx := context.Background()

	if err != nil {
		// We don't store false values in the metrics, so only add the error attribute if it's true, DON'T CHANGE THIS
		m.metricBaseFields = append(m.metricBaseFields, otel.WgRequestError.Bool(true))
	}

	rm := m.routerMetrics.MetricStore()

	m.metricBaseFields = append(m.metricBaseFields, semconv.HTTPStatusCode(statusCode))
	rm.MeasureRequestCount(ctx, m.metricBaseFields...)
	rm.MeasureRequestSize(ctx, m.requestContentLength, m.metricBaseFields...)
	rm.MeasureLatency(ctx,
		m.operationStartTime,
		m.metricBaseFields...,
	)
	rm.MeasureResponseSize(ctx, int64(responseSize), m.metricBaseFields...)

	if m.opContext != nil {
		m.exportSchemaUsageInfo(m.opContext, statusCode, err != nil)
	}
}

func (m *OperationMetrics) AddAttributes(kv ...attribute.KeyValue) {
	m.metricBaseFields = append(m.metricBaseFields, kv...)
}

// AddClientInfo adds the client info to the operation metrics. If OperationMetrics
// is nil, it's a no-op.
func (m *OperationMetrics) AddClientInfo(info *ClientInfo) {
	if info == nil {
		return
	}
	// Add client info to metrics base fields
	m.metricBaseFields = append(m.metricBaseFields, otel.WgClientName.String(info.Name))
	m.metricBaseFields = append(m.metricBaseFields, otel.WgClientVersion.String(info.Version))
}

// startOperationMetrics starts the metrics for an operation. This should only be called by
// routerMetrics.StartOperation()
func startOperationMetrics(rMetrics RouterMetrics, logger *zap.Logger, requestContentLength int64, routerConfigVersion string) *OperationMetrics {
	operationStartTime := time.Now()

	inflightMetric := rMetrics.MetricStore().MeasureInFlight(context.Background())
	return &OperationMetrics{
		requestContentLength: requestContentLength,
		operationStartTime:   operationStartTime,
		inflightMetric:       inflightMetric,
		routerConfigVersion:  routerConfigVersion,
		routerMetrics:        rMetrics,
		logger:               logger,
	}
}

// setAttributesFromOperationContext returns the attributes that are common to both metrics and traces.
func setAttributesFromOperationContext(operationContext *operationContext) []attribute.KeyValue {
	if operationContext == nil {
		return nil
	}

	var baseMetricAttributeValues []attribute.KeyValue

	// Fields that are always present in the metrics and traces
	baseMetricAttributeValues = append(baseMetricAttributeValues, otel.WgClientName.String(operationContext.clientInfo.Name))
	baseMetricAttributeValues = append(baseMetricAttributeValues, otel.WgClientVersion.String(operationContext.clientInfo.Version))
	baseMetricAttributeValues = append(baseMetricAttributeValues, otel.WgOperationName.String(operationContext.Name()))
	baseMetricAttributeValues = append(baseMetricAttributeValues, otel.WgOperationType.String(operationContext.Type()))
	baseMetricAttributeValues = append(baseMetricAttributeValues, otel.WgOperationProtocol.String(operationContext.Protocol().String()))
	baseMetricAttributeValues = append(baseMetricAttributeValues, otel.WgOperationHash.String(strconv.FormatUint(operationContext.Hash(), 10)))

	// Common Field that will be present in both metrics and traces if not empty
	if operationContext.PersistedID() != "" {
		baseMetricAttributeValues = append(baseMetricAttributeValues, otel.WgOperationPersistedID.String(operationContext.PersistedID()))
	}

	return baseMetricAttributeValues
}
