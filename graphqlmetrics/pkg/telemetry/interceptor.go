package telemetry

import (
	"context"
	"strings"

	"connectrpc.com/connect"
	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

func splitRequestSpec(procedure string) (string, string) {
	parts := strings.Split(procedure, "/")
	var serviceName, methodName string
	if len(parts) > 1 {
		// /wg.cosmo.graphqlmetrics.v1.GraphQLMetricsService/
		serviceName = parts[1]
		methodName = parts[2]
	} else {
		methodName = procedure
	}
	return serviceName, methodName
}

func defaultAttributes(req connect.AnyRequest) []attribute.KeyValue {
	serviceName, methodName := splitRequestSpec(req.Spec().Procedure)
	host := req.Header().Get("Host")
	httpMethod := req.HTTPMethod()
	protocol := req.Peer().Protocol

	return []attribute.KeyValue{
		semconv.RPCSystemConnectRPC,
		semconv.RPCServiceKey.String(serviceName),
		semconv.RPCMethodKey.String(methodName),
		semconv.HostName(host),
		semconv.NetworkProtocolName(protocol),
		semconv.HTTPRequestMethodKey.String(httpMethod),
	}
}

func (c *Config) ObservabilityInterceptor() connect.UnaryInterceptorFunc {
	return connect.UnaryInterceptorFunc(
		func(next connect.UnaryFunc) connect.UnaryFunc {
			return connect.UnaryFunc(func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
				res, err := next(ctx, req)

				// connect.CodeOK does not exist
				var statusCode int = 0
				if err != nil {
					statusCode = int(connect.CodeOf(err))
				}

				attributes := defaultAttributes(req)
				attributes = append(attributes, semconv.RPCGRPCStatusCodeKey.Int(statusCode))
				c.MetricStore.MeasureRequestCount(ctx, attributes...)

				return res, err
			})
		},
	)
}
