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
	var attributes []attribute.KeyValue

	attributes = append(attributes, WgOperationName.String(req.Spec().Procedure))
	attributes = append(attributes, WgOperationMethod.String(req.HTTPMethod()))
	attributes = append(attributes, WgOperationProtocol.String(req.Peer().Protocol))

	return attributes
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
