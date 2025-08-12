package middleware

import (
	"context"

	"github.com/hashicorp/go-hclog"
	"google.golang.org/grpc"
)

// Recovery is a middleware that recovers from panics and logs the error.
// It is used to ensure that the panic is logged and the request is not aborted.
func Recovery(ctx context.Context, req interface{}, _ *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
	defer func() {
		if r := recover(); r != nil {
			hclog.FromContext(ctx).Error("panic", "error", r)
		}
	}()

	return handler(ctx, req)
}
