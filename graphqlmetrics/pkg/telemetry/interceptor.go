package telemetry

import (
	"context"

	"connectrpc.com/connect"
	"go.opentelemetry.io/otel/attribute"
)

const (
	WgOperationName     = attribute.Key("wg.operation.name")
	WgOperationMethod   = attribute.Key("wg.operation.method")
	WgOperationProtocol = attribute.Key("wg.operation.protocol")
)

func defaultAttributes(req connect.AnyRequest) []attribute.KeyValue {
	return []attribute.KeyValue{
		WgOperationName.String(req.Spec().Procedure),
		WgOperationMethod.String(req.HTTPMethod()),
		WgOperationProtocol.String(req.Peer().Protocol),
	}
}

func (c *Config) ObservabilityInterceptor() connect.UnaryInterceptorFunc {
	return connect.UnaryInterceptorFunc(
		func(next connect.UnaryFunc) connect.UnaryFunc {
			return connect.UnaryFunc(func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
				res, err := next(ctx, req)
				attributes := defaultAttributes(req)
				c.MetricStore.MeasureRequestCount(ctx, attributes...)
				return res, err
			})
		},
	)
}
