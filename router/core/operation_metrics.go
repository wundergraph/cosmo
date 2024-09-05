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
	metricBaseFields     []attribute.KeyValue
	inflightMetric       func()
	routerConfigVersion  string
	opContext            *operationContext
	logger               *zap.Logger
	trackUsageInfo       bool
}

func (m *OperationMetrics) AddOperationContext(opContext *operationContext) {
	m.opContext = opContext
}

func (m *OperationMetrics) Finish(err error, statusCode int, responseSize int, exportSynchronous bool) {
	m.inflightMetric()

	ctx := context.Background()

	rm := m.routerMetrics.MetricStore()

	if err != nil {
		// We don't store false values in the metrics, so only add the error attribute if it's true
		m.metricBaseFields = append(m.metricBaseFields, otel.WgRequestError.Bool(true))
		rm.MeasureRequestError(ctx, m.metricBaseFields...)
	}

	m.metricBaseFields = append(m.metricBaseFields, semconv.HTTPStatusCode(statusCode))
	rm.MeasureRequestCount(ctx, m.metricBaseFields...)
	rm.MeasureRequestSize(ctx, m.requestContentLength, m.metricBaseFields...)
	rm.MeasureLatency(ctx,
		m.operationStartTime,
		m.metricBaseFields...,
	)
	rm.MeasureResponseSize(ctx, int64(responseSize), m.metricBaseFields...)

	if m.trackUsageInfo && m.opContext != nil {
		m.routerMetrics.ExportSchemaUsageInfo(m.opContext, statusCode, err != nil, exportSynchronous)
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
		metricBaseFields:     opts.Attributes,
		requestContentLength: opts.RequestContentLength,
		operationStartTime:   operationStartTime,
		inflightMetric:       inflightMetric,
		routerConfigVersion:  opts.RouterConfigVersion,
		routerMetrics:        opts.RouterMetrics,
		logger:               opts.Logger,
		trackUsageInfo:       opts.TrackUsageInfo,
	}
}
