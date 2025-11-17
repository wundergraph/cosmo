package core

import (
	"context"
	"math/rand/v2"
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
	OperationProtocolGRPC = OperationProtocol("grpc")
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

	promSchemaUsageEnabled      bool
	promSchemaUsageIncludeOpSha bool
	promSchemaUsageSampleRate   float64
}

type usageKey struct {
	fieldName  string
	parentType string
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
	if m.promSchemaUsageEnabled && reqContext.operation != nil {

		if !m.shouldSampleOperation() {
			return
		}

		opAttrs := []attribute.KeyValue{
			rotel.WgOperationName.String(reqContext.operation.name),
			rotel.WgOperationType.String(reqContext.operation.opType),
		}

		// Include operation SHA256 if enabled
		if m.promSchemaUsageIncludeOpSha && reqContext.operation.sha256Hash != "" {
			opAttrs = append(opAttrs, rotel.WgOperationSha256.String(reqContext.operation.sha256Hash))
		}

		usageCounts := make(map[usageKey]int)

		for _, field := range reqContext.operation.typeFieldUsageInfo {
			if field.ExactParentTypeName == "" || len(field.Path) == 0 {
				continue
			}

			key := usageKey{
				fieldName:  field.Path[len(field.Path)-1],
				parentType: field.ExactParentTypeName,
			}

			usageCounts[key]++
		}

		for key, count := range usageCounts {
			fieldAttrs := []attribute.KeyValue{
				rotel.WgGraphQLFieldName.String(key.fieldName),
				rotel.WgGraphQLParentType.String(key.parentType),
			}

			rm.MeasureSchemaFieldUsage(ctx, int64(count), []attribute.KeyValue{}, otelmetric.WithAttributeSet(attribute.NewSet(slices.Concat(opAttrs, fieldAttrs)...)))
		}

	}
}

type OperationMetricsOptions struct {
	InFlightAddOption    otelmetric.AddOption
	SliceAttributes      []attribute.KeyValue
	RouterConfigVersion  string
	RequestContentLength int64
	RouterMetrics        RouterMetrics
	Logger               *zap.Logger
	TrackUsageInfo       bool

	PrometheusSchemaUsageEnabled      bool
	PrometheusSchemaUsageIncludeOpSha bool
	PrometheusSchemaUsageSampleRate   float64
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

		promSchemaUsageEnabled:      opts.PrometheusSchemaUsageEnabled,
		promSchemaUsageIncludeOpSha: opts.PrometheusSchemaUsageIncludeOpSha,
		promSchemaUsageSampleRate:   opts.PrometheusSchemaUsageSampleRate,
	}
}

// shouldSampleOperation determines if a request should be sampled for schema field usage metrics.
// Uses probabilistic random sampling to ensure uniform distribution across all operations.
//
// This ensures:
// - All operations get statistical coverage (~X% of requests per operation)
// - Uniform distribution regardless of request ID format
// - Supports ANY sample rate (0.0 to 1.0), including arbitrary values like 0.8, 0.156, etc.
//
// Note: Uses non-deterministic random sampling rather than hash-based sampling because
// sequential request IDs produce clustered hash values that break deterministic sampling.
func (m *OperationMetrics) shouldSampleOperation() bool {
	if m.promSchemaUsageSampleRate >= 1.0 {
		return true
	}
	if m.promSchemaUsageSampleRate <= 0.0 {
		return false
	}

	// Probabilistic sampling: simple, reliable, and guaranteed uniform distribution
	return rand.Float64() < m.promSchemaUsageSampleRate
}
