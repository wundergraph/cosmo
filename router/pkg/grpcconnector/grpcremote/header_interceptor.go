package grpcremote

import (
	"context"
	"net/http"

	"go.opentelemetry.io/otel"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

// metadataCarrier adapts metadata.MD to the TextMapCarrier interface for OTEL propagation
type metadataCarrier struct {
	metadata.MD
}

func (mc metadataCarrier) Get(key string) string {
	values := mc.MD.Get(key)
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func (mc metadataCarrier) Set(key string, value string) {
	mc.MD.Set(key, value)
}

func (mc metadataCarrier) Keys() []string {
	keys := make([]string, 0, len(mc.MD))
	for k := range mc.MD {
		keys = append(keys, k)
	}
	return keys
}

// httpHeadersKey is the context key for storing HTTP headers to forward
type httpHeadersKey struct{}

// HeaderForwardingInterceptor creates a gRPC unary client interceptor that:
// 1. Extracts headers stored in the context
// 2. Forwards configured headers as gRPC metadata
// 3. Injects OTEL trace context into gRPC metadata
func HeaderForwardingInterceptor(headersToForward []string) grpc.UnaryClientInterceptor {
	return func(
		ctx context.Context,
		method string,
		req, reply interface{},
		cc *grpc.ClientConn,
		invoker grpc.UnaryInvoker,
		opts ...grpc.CallOption,
	) error {
		md := make(metadata.MD)

		// Inject OTEL trace context
		otel.GetTextMapPropagator().Inject(ctx, metadataCarrier{md})

		// Extract HTTP headers from context if available
		if httpHeaders, ok := ctx.Value(httpHeadersKey{}).(http.Header); ok && httpHeaders != nil {
			// Forward configured headers from HTTP headers to gRPC metadata
			for _, headerName := range headersToForward {
				if values := httpHeaders.Values(headerName); len(values) > 0 {
					// gRPC metadata keys are lowercase
					md.Append(headerName, values...)
				}
			}
		}

		// Create outgoing context with metadata
		ctx = metadata.NewOutgoingContext(ctx, md)

		return invoker(ctx, method, req, reply, cc, opts...)
	}
}

// WithHTTPHeaders stores HTTP headers in the context for later use by the interceptor
func WithHTTPHeaders(ctx context.Context, headers http.Header) context.Context {
	return context.WithValue(ctx, httpHeadersKey{}, headers)
}
