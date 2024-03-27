package core

import (
	"errors"
	"github.com/wundergraph/cosmo/router/pkg/metric"
	rotel "github.com/wundergraph/cosmo/router/pkg/otel"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

var (
	_ resolve.RequestHooks = (*EngineRequestHooks)(nil)
)

type EngineRequestHooks struct {
	metricStore metric.Store
}

const ScopeName = "cosmo-router.engine.requests"

func NewEngineRequestHooks(metricStore metric.Store) resolve.RequestHooks {
	return &EngineRequestHooks{
		metricStore: metricStore,
	}
}

func (f *EngineRequestHooks) OnRequest(resolveCtx *resolve.Context, dataSourceID string) *resolve.Context {
	tracer := otel.GetTracerProvider().Tracer(ScopeName)
	ctx, span := tracer.Start(resolveCtx.Context(), "EngineRequestHooks.OnRequest")

	span.SetAttributes(rotel.WgSubgraphID.String(dataSourceID))

	return resolveCtx.WithContext(ctx)
}

func (f *EngineRequestHooks) OnResponse(resolveCtx *resolve.Context, dataSourceID string, err error) *resolve.Context {
	span := trace.SpanFromContext(resolveCtx.Context())
	defer span.End()

	if err != nil {
		span.SetStatus(codes.Error, err.Error())
		span.RecordError(err)

		var subgraphError *resolve.SubgraphError
		if errors.As(err, &subgraphError) {
			if len(subgraphError.DownstreamErrors) > 0 {
				span.SetAttributes(rotel.WgSubgraphError.String(subgraphError.DownstreamErrors[0].Message))
				if subgraphError.DownstreamErrors[0].Extensions != nil {
					span.SetAttributes(rotel.WgSubgraphErrorCode.String(subgraphError.DownstreamErrors[0].Extensions.Code))
				}
			}
		}
	}

	return resolveCtx
}
