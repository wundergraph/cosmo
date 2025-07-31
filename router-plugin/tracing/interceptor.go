package tracing

import (
	"context"
	"errors"
	"fmt"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

const traceparentHeader = "traceparent"

func CreateTracingInterceptor(tracingOpts TracingOptions) (func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error), error) {
	tracingConfig := tracingOpts.TracingConfig
	
	if tracingConfig == nil {
		return nil, errors.New("nil tracing config not supported")
	}

	// TODO: We currently don't have a shutdown logic in the plugin
	// which calls tp.Shutdown
	tp, err := initTracer(context.Background(), tracingOpts, *tracingConfig)
	if err != nil {
		return nil, err
	}

	tracer := tp.Tracer(fmt.Sprintf("wundergraph/cosmo/router-plugin/%s", tracingOpts.ServiceName))

	return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
		if md, ok := metadata.FromIncomingContext(ctx); ok {
			// We should only get one traceparent value
			// in case we get more drop the extras
			traceparent := md.Get(traceparentHeader)
			if len(traceparent) != 0 {
				carrier := propagation.MapCarrier{traceparentHeader: traceparent[0]}
				propagator := propagation.NewCompositeTextMapPropagator(
					propagation.TraceContext{},
					propagation.Baggage{},
				)
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
		}

		return handler(ctx, req)
	}, nil
}
