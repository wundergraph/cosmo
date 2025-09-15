package tracing

import (
	"context"
	"errors"
	"fmt"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

func CreateTracingInterceptor(tracingOpts TracingOptions) (func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error), error) {
	if tracingOpts.TracingConfig == nil {
		return nil, errors.New("nil tracing config not supported")
	}

	// TODO: We currently don't have a shutdown logic in the plugin which could call tp.Shutdown
	tp, err := initTracer(context.Background(), tracingOpts)
	if err != nil {
		return nil, err
	}

	tracer := tp.Tracer(fmt.Sprintf("wundergraph/cosmo/router-plugin/%s", tracingOpts.ServiceName))

	return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
		if md, ok := metadata.FromIncomingContext(ctx); ok {
			// Extract headers from the incoming context
			carrier := propagation.MapCarrier{}
			for key, values := range md {
				if len(values) > 0 {
					carrier[key] = values[0]
				}
			}
			propagator := otel.GetTextMapPropagator()
			ctx = propagator.Extract(ctx, carrier)

			var span trace.Span
			ctx, span = tracer.Start(ctx, "Router Plugin - "+info.FullMethod)
			defer span.End()

			result, err := handler(ctx, req)
			if err != nil {
				span.SetStatus(codes.Error, err.Error())
				span.RecordError(err)
			}
			return result, err
		}

		return handler(ctx, req)
	}, nil
}
