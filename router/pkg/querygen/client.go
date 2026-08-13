package querygen

import (
	"context"
	"net/http"

	"connectrpc.com/connect"

	"github.com/wundergraph/cosmo/router/gen/proto/yoko/v1/yokov1connect"
)

// newClient builds a Connect client for the discovery service.
//
// The service speaks Connect over HTTP/1.1. Plain gRPC over cleartext does not
// work, because the server runs no h2c handler.
//
// The transport carries no retry. A GenerateQuery call costs 10 to 30 seconds,
// so a silent retry doubles the wait of the caller. The index poll loop is the
// only retry in this package.
func newClient(cfg Config) yokov1connect.YokoServiceClient {
	httpClient := &http.Client{Timeout: cfg.RequestTimeout}

	opts := []connect.ClientOption{}
	if cfg.Token != "" {
		opts = append(opts, connect.WithInterceptors(bearerInterceptor(cfg.Token)))
	}

	return yokov1connect.NewYokoServiceClient(httpClient, cfg.URL, opts...)
}

// bearerInterceptor sets the Authorization header on every outgoing call.
func bearerInterceptor(token string) connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			if req.Spec().IsClient {
				req.Header().Set("Authorization", "Bearer "+token)
			}
			return next(ctx, req)
		}
	}
}
