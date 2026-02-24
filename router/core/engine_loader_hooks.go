package core

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"sync/atomic"
	"time"

	"github.com/wundergraph/cosmo/router/internal/expr"

	rcontext "github.com/wundergraph/cosmo/router/internal/context"
	"github.com/wundergraph/cosmo/router/internal/requestlogger"
	"github.com/wundergraph/cosmo/router/internal/unique"
	"github.com/wundergraph/cosmo/router/pkg/metric"
	rotel "github.com/wundergraph/cosmo/router/pkg/otel"
	rtrace "github.com/wundergraph/cosmo/router/pkg/trace"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	otelmetric "go.opentelemetry.io/otel/metric"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.21.0"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
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
	tracer       trace.Tracer
	metricStore  metric.Store
	accessLogger *requestlogger.SubgraphAccessLogger

	tracingAttributeExpressions   *attributeExpressions
	telemetryAttributeExpressions *attributeExpressions
	metricAttributeExpressions    *attributeExpressions

	storeSubgraphResponseBody bool
	headerPropagation         *HeaderPropagation
}

type engineLoaderHooksRequestContext struct {
	startTime time.Time
}

func NewEngineRequestHooks(
	metricStore metric.Store,
	logger *requestlogger.SubgraphAccessLogger,
	tracerProvider *sdktrace.TracerProvider,
	tracingAttributes *attributeExpressions,
	telemetryAttributes *attributeExpressions,
	metricAttributes *attributeExpressions,
	storeSubgraphResponseBody bool,
	headerPropagation *HeaderPropagation,
) resolve.LoaderHooks {
	var tracer trace.Tracer
	if tracerProvider != nil {
		tracer = tracerProvider.Tracer(
			EngineLoaderHooksScopeName,
			trace.WithInstrumentationVersion(EngineLoaderHooksScopeVersion),
		)
	} else {
		tracer = otel.GetTracerProvider().Tracer(
			EngineLoaderHooksScopeName,
			trace.WithInstrumentationVersion(EngineLoaderHooksScopeVersion),
		)
	}

	return &engineLoaderHooks{
		tracer:                        tracer,
		metricStore:                   metricStore,
		telemetryAttributeExpressions: telemetryAttributes,
		tracingAttributeExpressions:   tracingAttributes,
		metricAttributeExpressions:    metricAttributes,
		accessLogger:                  logger,
		storeSubgraphResponseBody:     storeSubgraphResponseBody,
		headerPropagation:             headerPropagation,
	}
}

func (f *engineLoaderHooks) OnLoad(ctx context.Context, ds resolve.DataSourceInfo) context.Context {

	if resolve.IsIntrospectionDataSource(ds.ID) {
		return ctx
	}

	start := time.Now()

	ctx = context.WithValue(ctx, rcontext.CurrentSubgraphContextKey{}, ds.Name)

	duration := atomic.Int64{}
	ctx = context.WithValue(ctx, rcontext.FetchTimingKey, &duration)

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

	return context.WithValue(ctx, rcontext.EngineLoaderHooksContextKey, &engineLoaderHooksRequestContext{
		startTime: start,
	})
}

func (f *engineLoaderHooks) OnFinished(ctx context.Context, ds resolve.DataSourceInfo, responseInfo *resolve.ResponseInfo) {

	if resolve.IsIntrospectionDataSource(ds.ID) {
		return
	}

	if responseInfo == nil {
		responseInfo = &resolve.ResponseInfo{}
	}

	// Apply response header rules for ALL fetches (primary, entity resolution,
	// singleflight leaders and followers). Must run before the tracing/metrics
	// early returns below, which may not pass for all fetch contexts.
	if f.headerPropagation != nil {
		headers := responseInfo.ResponseHeaders
		if headers == nil {
			headers = make(http.Header)
		}
		f.headerPropagation.ApplyResponseHeaderRules(ctx, headers, ds.Name, responseInfo.StatusCode, responseInfo.Request)
	}

	reqContext := getRequestContext(ctx)

	if reqContext == nil {
		return
	}

	hookCtx, ok := ctx.Value(rcontext.EngineLoaderHooksContextKey).(*engineLoaderHooksRequestContext)
	if !ok {
		return
	}

	latency := time.Since(hookCtx.startTime)
	span := trace.SpanFromContext(ctx)
	defer span.End()

	commonAttrs := []attribute.KeyValue{
		semconv.HTTPStatusCode(responseInfo.StatusCode),
		rotel.WgSubgraphID.String(ds.ID),
		rotel.WgSubgraphName.String(ds.Name),
	}

	traceAttrs := *reqContext.telemetry.AcquireAttributes()
	defer reqContext.telemetry.ReleaseAttributes(&traceAttrs)
	traceAttrs = append(traceAttrs, reqContext.telemetry.traceAttrs...)
	traceAttrs = append(traceAttrs, rotel.WgComponentName.String("engine-loader"))
	traceAttrs = append(traceAttrs, commonAttrs...)

	exprCtx := reqContext.expressionContext.Clone()
	exprCtx.Subgraph.Id = ds.ID
	exprCtx.Subgraph.Name = ds.Name
	exprCtx.Subgraph.Request.Error = WrapExprError(responseInfo.Err)

	var subgraphFetchLatency time.Duration
	if value := ctx.Value(rcontext.FetchTimingKey); value != nil {
		if fetchTiming, ok := value.(*atomic.Int64); ok {
			subgraphFetchLatency = time.Duration(fetchTiming.Load())
			exprCtx.Subgraph.Request.ClientTrace.FetchDuration = subgraphFetchLatency
		}
	}
	// If there is no fetch timing available, use the total latency as the subgraph fetch latency
	if subgraphFetchLatency == 0 {
		subgraphFetchLatency = latency
	}

	if f.storeSubgraphResponseBody {
		exprCtx.Subgraph.Response.Body.Raw = responseInfo.GetResponseBody()
	}

	metricAttrs := *reqContext.telemetry.AcquireAttributes()
	defer reqContext.telemetry.ReleaseAttributes(&metricAttrs)
	metricAttrs = append(metricAttrs, reqContext.telemetry.metricAttrs...)
	metricAttrs = append(metricAttrs, commonAttrs...)

	addExpressions(AddExprOpts{
		logger:      reqContext.logger,
		expressions: f.telemetryAttributeExpressions,
		key:         expr.BucketSubgraph,
		currSpan:    span,
		exprCtx:     exprCtx,
		attrAddFunc: func(telemetryValues ...attribute.KeyValue) {
			traceAttrs = append(traceAttrs, telemetryValues...)
			metricAttrs = append(metricAttrs, telemetryValues...)
		},
	})
	addExpressions(AddExprOpts{
		logger:      reqContext.logger,
		expressions: f.tracingAttributeExpressions,
		key:         expr.BucketSubgraph,
		currSpan:    span,
		exprCtx:     exprCtx,
		attrAddFunc: func(telemetryValues ...attribute.KeyValue) {
			traceAttrs = append(traceAttrs, telemetryValues...)
		},
	})
	addExpressions(AddExprOpts{
		logger:      reqContext.logger,
		expressions: f.metricAttributeExpressions,
		key:         expr.BucketSubgraph,
		exprCtx:     exprCtx,
		attrAddFunc: func(telemetryValues ...attribute.KeyValue) {
			metricAttrs = append(metricAttrs, telemetryValues...)
		},
	})

	metricAddOpt := otelmetric.WithAttributeSet(attribute.NewSet(metricAttrs...))

	if f.accessLogger != nil {
		fields := []zap.Field{
			zap.String("subgraph_name", ds.Name),
			zap.String("subgraph_id", ds.ID),
			zap.Int("status", responseInfo.StatusCode),
			zap.Duration("latency", subgraphFetchLatency),
		}
		path := ds.Name
		if responseInfo.Request != nil {
			fields = append(fields, f.accessLogger.RequestFields(responseInfo, exprCtx)...)
			if responseInfo.Request.URL != nil {
				path = responseInfo.Request.URL.Path
			}
		}

		if responseInfo.Err != nil {
			f.accessLogger.Error(path, fields)
		} else {
			f.accessLogger.Info(path, fields)
		}
	}

	if responseInfo.Err != nil {
		// Set error status. This is the fetch error from the engine
		// Downstream errors are extracted from the subgraph response
		rtrace.SetSanitizedSpanStatus(span, codes.Error, responseInfo.Err.Error())
		span.RecordError(responseInfo.Err)

		var errorCodesAttr []string

		if unwrapped, ok := responseInfo.Err.(multiError); ok {
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
		f.metricStore.MeasureLatency(ctx, subgraphFetchLatency, metricSliceAttrs, attrOpt)
	} else {
		f.metricStore.MeasureRequestCount(ctx, reqContext.telemetry.metricSliceAttrs, metricAddOpt)
		f.metricStore.MeasureLatency(ctx, subgraphFetchLatency, reqContext.telemetry.metricSliceAttrs, metricAddOpt)
	}

	span.SetAttributes(traceAttrs...)
}
