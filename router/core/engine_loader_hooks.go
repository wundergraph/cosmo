package core

import (
	"context"
	"errors"
	"fmt"
	"github.com/wundergraph/cosmo/router/pkg/metric"
	rotel "github.com/wundergraph/cosmo/router/pkg/otel"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.21.0"
	"go.opentelemetry.io/otel/trace"
	"slices"
	"strings"
)

var (
	_ resolve.LoaderHooks = (*EngineLoaderHooks)(nil)
)

const EngineLoaderHooksScopeName = "wundergraph/cosmo/router/engine/loader"
const EngineLoaderHooksScopeVersion = "0.0.1"

// EngineLoaderHooks implements resolve.LoaderHooks
// It is used to trace and measure the performance of the engine loader
type EngineLoaderHooks struct {
	tracer      trace.Tracer
	metricStore metric.Store
}

func NewEngineRequestHooks(metricStore metric.Store) resolve.LoaderHooks {
	return &EngineLoaderHooks{
		tracer: otel.GetTracerProvider().Tracer(
			EngineLoaderHooksScopeName,
			trace.WithInstrumentationVersion(EngineLoaderHooksScopeVersion),
		),
		metricStore: metricStore,
	}
}

func (f *EngineLoaderHooks) OnLoad(ctx context.Context, dataSourceID string) context.Context {

	if resolve.IsIntrospectionDataSource(dataSourceID) {
		return ctx
	}

	reqContext := getRequestContext(ctx)
	if reqContext == nil {
		return ctx
	}

	ctx, span := f.tracer.Start(ctx, "Engine - Fetch")

	subgraph := reqContext.SubgraphByID(dataSourceID)
	if subgraph != nil {
		span.SetAttributes(rotel.WgSubgraphName.String(subgraph.Name))
	}

	span.SetAttributes(
		rotel.WgSubgraphID.String(dataSourceID),
	)

	return ctx
}

func (f *EngineLoaderHooks) OnFinished(ctx context.Context, statusCode int, dataSourceID string, err error) {

	if resolve.IsIntrospectionDataSource(dataSourceID) {
		return
	}

	reqContext := getRequestContext(ctx)

	if reqContext == nil {
		return
	}

	span := trace.SpanFromContext(ctx)
	defer span.End()

	activeSubgraph := reqContext.SubgraphByID(dataSourceID)

	baseAttributes := []attribute.KeyValue{
		// Subgraph response status code
		semconv.HTTPStatusCode(statusCode),
		rotel.WgComponentName.String("engine-loader"),
		rotel.WgSubgraphID.String(activeSubgraph.Id),
		rotel.WgSubgraphName.String(activeSubgraph.Name),
	}

	// Ensure common attributes are set
	baseAttributes = append(baseAttributes, setAttributesFromOperationContext(reqContext.operation)...)

	if err != nil {

		// Set error status. This is the fetch error from the engine
		// Downstream errors are extracted from the subgraph response
		span.SetStatus(codes.Error, err.Error())
		span.RecordError(err)

		var errorCodesAttr []string

		var subgraphError *resolve.SubgraphError

		if errors.As(err, &subgraphError) {

			// Extract downstream errors
			if len(subgraphError.DownstreamErrors) > 0 {
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

		// Reduce cardinality of error codes
		slices.Sort(errorCodesAttr)

		if len(errorCodesAttr) > 0 {

			// Create individual metrics for each error code
			for _, code := range errorCodesAttr {
				f.metricStore.MeasureRequestError(ctx,
					// Add only the error code as an attribute
					append(baseAttributes, rotel.WgSubgraphErrorExtendedCode.String(code))...,
				)
			}

			// Add this after the metrics have been created
			// The list might be used for post-processing
			baseAttributes = append(baseAttributes, rotel.WgSubgraphErrorExtendedCode.String(strings.Join(errorCodesAttr, ",")))
		}
	}

	span.SetAttributes(baseAttributes...)
}
