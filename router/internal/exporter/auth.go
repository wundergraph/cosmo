package exporter

import (
	"context"
	"fmt"

	"connectrpc.com/connect"
)

// WithBearerAuth returns a Connect client option that adds an
// `Authorization: Bearer <token>` header to every unary request.
func WithBearerAuth(token string) connect.ClientOption {
	return connect.WithInterceptors(
		connect.UnaryInterceptorFunc(func(next connect.UnaryFunc) connect.UnaryFunc {
			return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
				req.Header().Set("Authorization", fmt.Sprintf("Bearer %s", token))
				return next(ctx, req)
			}
		}),
	)
}
