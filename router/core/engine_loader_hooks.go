package core

import (
	"context"
	"errors"
	"fmt"
	"github.com/wundergraph/cosmo/router/internal/unique"
	"github.com/wundergraph/cosmo/router/pkg/metric"
	rotel "github.com/wundergraph/cosmo/router/pkg/otel"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	otelmetric "go.opentelemetry.io/otel/metric"
	semconv "go.opentelemetry.io/otel/semconv/v1.21.0"
	"go.opentelemetry.io/otel/trace"
	"slices"
	"time"
)

var (
	_ resolve.LoaderHooks = (*engineLoaderHooks)(nil)
)

type multiError = interface{ Unwrap() []error }

const EngineLoaderHooksScopeName = "wundergraph/cosmo/router/engine/loader"
const EngineLoaderHooksScopeVersion = "0.0.1"

// engineLoaderHooks implements resolve.LoaderHooks
// It is used to trace and measure the performance of the engine loader
type engineLoaderHooks struct {
	tracer      trace.Tracer
	metricStore metric.Store
}

type engineLoaderHooksRequestContext struct {
	startTime time.Time
}

func NewEngineRequestHooks(metricStore metric.Store) resolve.LoaderHooks {
	return &engineLoaderHooks{
		tracer: otel.GetTracerProvider().Tracer(
			EngineLoaderHooksScopeName,
			trace.WithInstrumentationVersion(EngineLoaderHooksScopeVersion),
		),
		metricStore: metricStore,
	}
}

func (f *engineLoaderHooks) OnLoad(ctx context.Context, ds resolve.DataSourceInfo) context.Context {

	if resolve.IsIntrospectionDataSource(ds.ID) {
		return ctx
	}

	start := time.Now()

	reqContext := getRequestContext(ctx)
	if reqContext == nil {
		return ctx
	}

	ctx, _ = f.tracer.Start(ctx, "Engine - Fetch",
		trace.WithAttributes([]attribute.KeyValue{
			rotel.WgSubgraphName.String(ds.Name),
			rotel.WgSubgraphID.String(ds.ID),
		}...),
	)

	return context.WithValue(ctx, engineLoaderHooksContextKey, &engineLoaderHooksRequestContext{
		startTime: start,
	})
}

func (f *engineLoaderHooks) OnFinished(ctx context.Context, statusCode int, ds resolve.DataSourceInfo, err error) {

	if resolve.IsIntrospectionDataSource(ds.ID) {
		return
	}

	reqContext := getRequestContext(ctx)

	if reqContext == nil {
		return
	}

	hookCtx, ok := ctx.Value(engineLoaderHooksContextKey).(*engineLoaderHooksRequestContext)
	if !ok {
		return
	}

	latency := time.Since(hookCtx.startTime)

	span := trace.SpanFromContext(ctx)
	defer span.End()

	commonAttrs := []attribute.KeyValue{
		semconv.HTTPStatusCode(statusCode),
		rotel.WgSubgraphID.String(ds.ID),
		rotel.WgSubgraphName.String(ds.Name),
	}

	traceAttrs := *reqContext.telemetry.AcquireAttributes()
	defer reqContext.telemetry.ReleaseAttributes(&traceAttrs)
	traceAttrs = append(traceAttrs, reqContext.telemetry.traceAttrs...)
	traceAttrs = append(traceAttrs, rotel.WgComponentName.String("engine-loader"))
	traceAttrs = append(traceAttrs, commonAttrs...)

	metricAttrs := *reqContext.telemetry.AcquireAttributes()
	defer reqContext.telemetry.ReleaseAttributes(&metricAttrs)
	metricAttrs = append(metricAttrs, reqContext.telemetry.metricAttrs...)
	metricAttrs = append(metricAttrs, commonAttrs...)

	metricAddOpt := otelmetric.WithAttributeSet(attribute.NewSet(metricAttrs...))

	if err != nil {

		// Set error status. This is the fetch error from the engine
		// Downstream errors are extracted from the subgraph response
		span.SetStatus(codes.Error, err.Error())
		span.RecordError(err)

		var errorCodesAttr []string

		if unwrapped, ok := err.(multiError); ok {
			errs := unwrapped.Unwrap()
			for _, e := range errs {
				var subgraphError *resolve.SubgraphError
				if errors.As(e, &subgraphError) {
					for i, downstreamError := range subgraphError.DownstreamErrors {
						var errorCode string
						if downstreamError.Extensions != nil {
							if ok := downstreamError.Extensions["code"]; ok != nil {
								if code, ok := downstreamError.Extensions["code"].(string); ok {
									errorCode = code
								}
							}
						}

						if errorCode != "" {
							errorCodesAttr = append(errorCodesAttr, errorCode)
							span.AddEvent(fmt.Sprintf("Downstream error %d", i+1),
								trace.WithAttributes(
									rotel.WgSubgraphErrorExtendedCode.String(errorCode),
									rotel.WgSubgraphErrorMessage.String(downstreamError.Message),
								),
							)
						}
					}
				}
			}
		}

		errorCodesAttr = unique.SliceElements(errorCodesAttr)
		// Reduce cardinality of error codes
		slices.Sort(errorCodesAttr)

		metricSliceAttrs := *reqContext.telemetry.AcquireAttributes()
		defer reqContext.telemetry.ReleaseAttributes(&metricSliceAttrs)
		metricSliceAttrs = append(metricSliceAttrs, reqContext.telemetry.metricSliceAttrs...)

		// We can't add this earlier because this is done per subgraph response
		if v, ok := reqContext.telemetry.metricSetAttrs[ContextFieldGraphQLErrorCodes]; ok && len(errorCodesAttr) > 0 {
			metricSliceAttrs = append(metricSliceAttrs, attribute.StringSlice(v, errorCodesAttr))
		}

		f.metricStore.MeasureRequestError(ctx, metricSliceAttrs, metricAddOpt)

		metricAttrs = append(metricAttrs, rotel.WgRequestError.Bool(true))

		attrOpt := otelmetric.WithAttributeSet(attribute.NewSet(metricAttrs...))
		f.metricStore.MeasureRequestCount(ctx, metricSliceAttrs, attrOpt)
		f.metricStore.MeasureLatency(ctx, latency, metricSliceAttrs, attrOpt)
	} else {
		f.metricStore.MeasureRequestCount(ctx, reqContext.telemetry.metricSliceAttrs, metricAddOpt)
		f.metricStore.MeasureLatency(ctx, latency, reqContext.telemetry.metricSliceAttrs, metricAddOpt)
	}

	span.SetAttributes(traceAttrs...)
}
