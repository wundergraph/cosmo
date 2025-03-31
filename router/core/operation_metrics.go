package core

import (
	"context"
	"slices"
	"time"

	rotel "github.com/wundergraph/cosmo/router/pkg/otel"
	otelmetric "go.opentelemetry.io/otel/metric"

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
	promUsageInfo        bool
}

func (m *OperationMetrics) Finish(reqContext *requestContext, statusCode int, responseSize int, exportSynchronous bool) {
	ctx := context.Background()

	m.inflightMetric()

	sliceAttrs := reqContext.telemetry.metricSliceAttrs

	attrs := *reqContext.telemetry.AcquireAttributes()
	defer reqContext.telemetry.ReleaseAttributes(&attrs)

	attrs = append(attrs, semconv.HTTPStatusCode(statusCode))
	attrs = append(attrs, reqContext.telemetry.metricAttrs...)

	rm := m.routerMetrics.MetricStore()

	latency := time.Since(m.operationStartTime)

	o := otelmetric.WithAttributeSet(attribute.NewSet(attrs...))

	if reqContext.error != nil {
		rm.MeasureRequestError(ctx, sliceAttrs, o)

		attrs = append(attrs, rotel.WgRequestError.Bool(true))
		attrOpt := otelmetric.WithAttributeSet(attribute.NewSet(attrs...))

		rm.MeasureRequestCount(ctx, sliceAttrs, attrOpt)
		rm.MeasureLatency(ctx, latency, sliceAttrs, attrOpt)
	} else {
		rm.MeasureRequestCount(ctx, sliceAttrs, o)
		rm.MeasureLatency(ctx, latency, sliceAttrs, o)
	}

	rm.MeasureRequestSize(ctx, m.requestContentLength, sliceAttrs, o)
	rm.MeasureResponseSize(ctx, int64(responseSize), sliceAttrs, o)

	if m.trackUsageInfo && reqContext.operation != nil && !reqContext.operation.executionOptions.SkipLoader {
		m.routerMetrics.ExportSchemaUsageInfo(reqContext.operation, statusCode, reqContext.error != nil, exportSynchronous)
	}

	// Prometheus usage metrics, disabled by default
	if m.promUsageInfo && reqContext.operation != nil && !reqContext.operation.executionOptions.SkipLoader {
		opAttrs := []attribute.KeyValue{
			rotel.WgOperationName.String(reqContext.operation.name),
			rotel.WgOperationType.String(reqContext.operation.opType),
		}

		if reqContext.operation.sha256Hash != "" {
			opAttrs = append(opAttrs, rotel.WgOperationSha256.String(reqContext.operation.sha256Hash))
		}

		for _, field := range reqContext.operation.typeFieldUsageInfo {
			fieldAttrs := []attribute.KeyValue{
				rotel.WgGraphQLFieldName.String(field.Path[len(field.Path)-1]),
			}

			fieldSliceAttrs := []attribute.KeyValue{
				rotel.WgGraphQLFieldParentType.StringSlice(field.TypeNames),
			}

			rm.MeasureSchemaFieldUsage(ctx, 1, fieldSliceAttrs, otelmetric.WithAttributeSet(attribute.NewSet(slices.Concat(opAttrs, fieldAttrs)...)))
		}
	}
}

type OperationMetricsOptions struct {
	InFlightAddOption     otelmetric.AddOption
	SliceAttributes       []attribute.KeyValue
	RouterConfigVersion   string
	RequestContentLength  int64
	RouterMetrics         RouterMetrics
	Logger                *zap.Logger
	TrackUsageInfo        bool
	PrometheusSchemaUsage bool
}

// newOperationMetrics creates a new OperationMetrics struct and starts the operation metrics.
// routerMetrics.StartOperation()
func newOperationMetrics(opts OperationMetricsOptions) *OperationMetrics {
	operationStartTime := time.Now()

	inflightMetric := opts.RouterMetrics.MetricStore().MeasureInFlight(context.Background(), opts.SliceAttributes, opts.InFlightAddOption)
	return &OperationMetrics{
		requestContentLength: opts.RequestContentLength,
		operationStartTime:   operationStartTime,
		inflightMetric:       inflightMetric,
		routerConfigVersion:  opts.RouterConfigVersion,
		routerMetrics:        opts.RouterMetrics,
		logger:               opts.Logger,
		trackUsageInfo:       opts.TrackUsageInfo,
		promUsageInfo:        opts.PrometheusSchemaUsage,
	}
}
