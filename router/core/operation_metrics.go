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

func (m *OperationMetrics) Finish(ctx context.Context, err error, statusCode int, responseSize int, exportSynchronous bool, opContext *operationContext, attr []attribute.KeyValue) {
	latency := time.Since(m.operationStartTime)

	m.inflightMetric()

	rm := m.routerMetrics.MetricStore()

	if err != nil {
		// We don't store false values in the metrics, so only add the error attribute if it's true
		attr = append(attr, otel.WgRequestError.Bool(true))
		rm.MeasureRequestError(ctx, attr...)
	}

	attr = append(attr, semconv.HTTPStatusCode(statusCode))
	rm.MeasureRequestCount(ctx, attr...)
	rm.MeasureRequestSize(ctx, m.requestContentLength, attr...)
	rm.MeasureLatency(ctx, latency, attr...)
	rm.MeasureResponseSize(ctx, int64(responseSize), attr...)

	if m.trackUsageInfo && opContext != nil {
		m.routerMetrics.ExportSchemaUsageInfo(opContext, statusCode, err != nil, exportSynchronous)
	}
}

type OperationMetricsOptions struct {
	Attributes           []attribute.KeyValue
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

	inflightMetric := opts.RouterMetrics.MetricStore().MeasureInFlight(context.Background(), opts.Attributes...)
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
