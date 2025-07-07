package tracing

import (
	"context"
	"fmt"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

func CreateTracingInterceptor(tracingOpts TracingOptions) (func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error), error) {
	// TODO: We need to add shutdown logic (if needed?)
	// We could maybe listen for a shutdown signal from the host
	// tp.Shutdown()
	tp, err := initTracer(context.Background(), tracingOpts)
	if err != nil {
		return nil, err
	}

	tracer := tp.Tracer(fmt.Sprintf("wundergraph/cosmo/router-plugin/%s", tracingOpts.ServiceName))

	return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
		if md, ok := metadata.FromIncomingContext(ctx); ok {
			// We should only get one traceparent value
			// in case we get more drop the extras
			traceparent := md.Get("traceparent")
			if len(traceparent) != 0 {
				carrier := propagation.MapCarrier{"traceparent": traceparent[0]}
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
