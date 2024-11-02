package core

import (
	"context"
	"time"

	"github.com/wundergraph/cosmo/router/pkg/otel"

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

// OperationMetrics is a struct that holds the metrics for an operation. It should be created on the parent router request
// subgraph metrics are created in the transport or engine loader hooks.
type OperationMetrics struct {
	requestContentLength int64
	routerMetrics        RouterMetrics
	operationStartTime   time.Time
	inflightMetric       func()
	routerConfigVersion  string
	logger               *zap.Logger
	trackUsageInfo       bool
}

func (m *OperationMetrics) Finish(reqContext *requestContext, statusCode int, responseSize int, exportSynchronous bool) {
	ctx := context.Background()

	m.inflightMetric()

	attrs := reqContext.telemetry.MetricAttributes()

	attrs = append(attrs, semconv.HTTPStatusCode(statusCode))

	rm := m.routerMetrics.MetricStore()

	latency := time.Since(m.operationStartTime)

	sliceAttrs := reqContext.telemetry.MetricSliceAttributes()

	if reqContext.error != nil {
		// We don't store false values in the metrics, so only add the error attribute if it's true
		attrs = append(attrs, otel.WgRequestError.Bool(true))
		rm.MeasureRequestError(ctx, sliceAttrs, attrs)
	}

	rm.MeasureRequestCount(ctx, sliceAttrs, attrs)
	rm.MeasureRequestSize(ctx, m.requestContentLength, sliceAttrs, attrs)
	rm.MeasureLatency(ctx, latency, sliceAttrs, attrs)
	rm.MeasureResponseSize(ctx, int64(responseSize), sliceAttrs, attrs)

	if m.trackUsageInfo && reqContext.operation != nil && !reqContext.operation.executionOptions.SkipLoader {
		m.routerMetrics.ExportSchemaUsageInfo(reqContext.operation, statusCode, reqContext.error != nil, exportSynchronous)
	}
}

type OperationMetricsOptions struct {
	InFlightAttrs        []attribute.KeyValue
	SliceAttributes      []attribute.KeyValue
	RouterConfigVersion  string
	RequestContentLength int64
	RouterMetrics        RouterMetrics
	Logger               *zap.Logger
	TrackUsageInfo       bool
}

// newOperationMetrics creates a new OperationMetrics struct and starts the operation metrics.
// routerMetrics.StartOperation()
func newOperationMetrics(opts OperationMetricsOptions) *OperationMetrics {
	operationStartTime := time.Now()

	inflightMetric := opts.RouterMetrics.MetricStore().MeasureInFlight(context.Background(), opts.SliceAttributes, opts.InFlightAttrs)
	return &OperationMetrics{
		requestContentLength: opts.RequestContentLength,
		operationStartTime:   operationStartTime,
		inflightMetric:       inflightMetric,
		routerConfigVersion:  opts.RouterConfigVersion,
		routerMetrics:        opts.RouterMetrics,
		logger:               opts.Logger,
		trackUsageInfo:       opts.TrackUsageInfo,
	}
}
