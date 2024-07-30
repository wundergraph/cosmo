package telemetry

import (
	"context"

	"connectrpc.com/connect"
)

func (c *Config) PrometheusUnaryInterceptor() connect.UnaryInterceptorFunc {
	return connect.UnaryInterceptorFunc(
		func(next connect.UnaryFunc) connect.UnaryFunc {
			return connect.UnaryFunc(func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
				res, err := next(ctx, req)
				c.MetricStore.MeasureRequestCount(ctx)
				return res, err
			})
		},
	)
}
