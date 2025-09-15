package middleware

import (
	"context"

	"github.com/hashicorp/go-hclog"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Recovery is a middleware that recovers from panics and logs the error.
// It is used to ensure that the panic is logged and the request is not aborted.
func Recovery(ctx context.Context, req any, _ *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (resp any, err error) {
	defer func() {
		if r := recover(); r != nil {
			hclog.FromContext(ctx).Error("panic", "error", r, "plugin_stack", hclog.Stacktrace())
			resp = nil
			err = status.Errorf(codes.Internal, "internal server error")
		}
	}()

	return handler(ctx, req)
}
