package core

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"slices"
	"time"

	"github.com/wundergraph/cosmo/router/internal/httpclient"

	"github.com/expr-lang/expr/vm"
	"github.com/wundergraph/cosmo/router/internal/expr"
	"github.com/wundergraph/cosmo/router/internal/requestlogger"
	"github.com/wundergraph/cosmo/router/internal/unique"
	"github.com/wundergraph/cosmo/router/pkg/metric"
	rotel "github.com/wundergraph/cosmo/router/pkg/otel"
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
	tracer                    trace.Tracer
	metricStore               metric.Store
	accessLogger              *requestlogger.SubgraphAccessLogger
	mappedSubgraphExpressions map[string]*vm.Program
}

type engineLoaderHooksRequestContext struct {
	startTime time.Time
}

func NewEngineRequestHooks(metricStore metric.Store, logger *requestlogger.SubgraphAccessLogger, tracerProvider *sdktrace.TracerProvider, expressions map[string]*vm.Program) resolve.LoaderHooks {
	if tracerProvider != nil {
		return &engineLoaderHooks{
			tracer: tracerProvider.Tracer(
				EngineLoaderHooksScopeName,
				trace.WithInstrumentationVersion(EngineLoaderHooksScopeVersion),
			),
			metricStore:               metricStore,
			accessLogger:              logger,
			mappedSubgraphExpressions: expressions,
		}
	}

	return &engineLoaderHooks{
		tracer: otel.GetTracerProvider().Tracer(
			EngineLoaderHooksScopeName,
			trace.WithInstrumentationVersion(EngineLoaderHooksScopeVersion),
		),
		metricStore:               metricStore,
		accessLogger:              logger,
		mappedSubgraphExpressions: expressions,
	}
}

func ProcessEngineHookExpressions(subgraphTracingAttributes []ExpressionAttribute, exprManager *expr.Manager) (map[string]*vm.Program, error) {
	mappedSubgraphExpressions := make(map[string]*vm.Program)

	for _, attr := range subgraphTracingAttributes {
		returnType, err := exprManager.ValidateAnyExpression(attr.Expression)
		if err != nil {
			return nil, err
		}
		if returnType == nil {
			return nil, errors.New("disallowed nil")
		}
		// We don't want to allow user to specify these return types for expressions
		// at this moment
		switch *returnType {
		case reflect.Complex64, reflect.Complex128, reflect.Map, reflect.UnsafePointer:
			return nil, fmt.Errorf("disallowed type: %s", *returnType)
		}

		expression, err := exprManager.CompileAnyExpression(attr.Expression)
		if err != nil {
			return nil, err
		}
		mappedSubgraphExpressions[attr.Key] = expression
	}

	return mappedSubgraphExpressions, nil
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

	ctx = httpclient.InitTraceContext(ctx)

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

func (f *engineLoaderHooks) OnFinished(ctx context.Context, ds resolve.DataSourceInfo, responseInfo *resolve.ResponseInfo) {

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

	if responseInfo == nil {
		responseInfo = &resolve.ResponseInfo{}
	}

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

	fromTrace := httpclient.GetClientTraceFromContext(ctx)

	// Note: This copy still points to the same maps like requestClaims etc
	exprCtx := reqContext.expressionContext
	exprCtx.Subgraph = expr.Subgraph{
		Id:      ds.ID,
		Name:    ds.Name,
		Request: expr.SubgraphRequest{},
	}
	exprCtx.Subgraph.Request.ClientTrace = *expr.ConvertToExprTrace(fromTrace)
	exprCtx.Subgraph.Request.Error = &expr.WrapError{Err: responseInfo.Err}

	for key, expression := range f.mappedSubgraphExpressions {
		result, err := expr.ResolveAnyExpression(expression, exprCtx)
		// If the expression fails, we don't want to add it to the attributes but also not block
		if err != nil {
			reqContext.Logger().Warn(
				"failed to resolve expression",
				zap.Error(err),
				zap.String("key", key),
			)
			continue
		}
		if toAttribute := convertToAttribute(key, result); toAttribute != nil {
			traceAttrs = append(traceAttrs, *toAttribute)
		}
	}

	metricAttrs := *reqContext.telemetry.AcquireAttributes()
	defer reqContext.telemetry.ReleaseAttributes(&metricAttrs)
	metricAttrs = append(metricAttrs, reqContext.telemetry.metricAttrs...)
	metricAttrs = append(metricAttrs, commonAttrs...)

	metricAddOpt := otelmetric.WithAttributeSet(attribute.NewSet(metricAttrs...))

	if f.accessLogger != nil {
		fields := []zap.Field{
			zap.String("subgraph_name", ds.Name),
			zap.String("subgraph_id", ds.ID),
			zap.Int("status", responseInfo.StatusCode),
			zap.Duration("latency", latency),
		}
		path := ds.Name
		if responseInfo.Request != nil {
			fields = append(fields, f.accessLogger.RequestFields(responseInfo, &exprCtx)...)
			if responseInfo.Request.URL != nil {
				path = responseInfo.Request.URL.Path
			}
		}
		f.accessLogger.Info(path, fields)
	}

	if responseInfo.Err != nil {
		// Set error status. This is the fetch error from the engine
		// Downstream errors are extracted from the subgraph response
		span.SetStatus(codes.Error, responseInfo.Err.Error())
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
		f.metricStore.MeasureLatency(ctx, latency, metricSliceAttrs, attrOpt)
	} else {
		f.metricStore.MeasureRequestCount(ctx, reqContext.telemetry.metricSliceAttrs, metricAddOpt)
		f.metricStore.MeasureLatency(ctx, latency, reqContext.telemetry.metricSliceAttrs, metricAddOpt)
	}

	span.SetAttributes(traceAttrs...)
}

func convertToAttribute(key string, val any) *attribute.KeyValue {
	if val == nil {
		return nil
	}

	switch v := val.(type) {
	case int:
		return &attribute.KeyValue{Key: attribute.Key(key), Value: attribute.IntValue(v)}
	case string:
		return &attribute.KeyValue{Key: attribute.Key(key), Value: attribute.StringValue(v)}
	case bool:
		return &attribute.KeyValue{Key: attribute.Key(key), Value: attribute.BoolValue(v)}
	default:
		return &attribute.KeyValue{Key: attribute.Key(key), Value: attribute.StringValue(fmt.Sprintf("%v", v))}
	}
}
