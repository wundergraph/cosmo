package middleware

import (
	"context"

	"github.com/hashicorp/go-hclog"
	"google.golang.org/grpc"
)

// Logging ensures that the default logger is available in the context.
// This is useful for logging in the service implementation.
func Logging(logger hclog.Logger) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
		logger.Trace("LoggingInterceptor", "method", info.FullMethod)
		ctx = hclog.WithContext(ctx, logger)
		return handler(ctx, req)
	}
}
