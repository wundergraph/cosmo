package telemetry

import (
	"context"
	"strings"

	"connectrpc.com/connect"
	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"

	utils "github.com/wundergraph/cosmo/graphqlmetrics/pkg/utils"
)

const (
	WgFederatedGraphId = attribute.Key("wg.federated_graph.id")
	WgOrganizationId   = attribute.Key("wg.organization.id")
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

func checkIfClaimsAreSet(claims *utils.GraphAPITokenClaims) bool {
	return claims.FederatedGraphID == "" || claims.OrganizationID == ""
}

func (c *Config) ObservabilityInterceptor() connect.UnaryInterceptorFunc {
	return connect.UnaryInterceptorFunc(
		func(next connect.UnaryFunc) connect.UnaryFunc {
			return connect.UnaryFunc(func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
				attributes := defaultAttributes(req)
				// connect.CodeOK does not exist
				var statusCode int = 0

				claims, err := utils.GetClaims(ctx)
				if err != nil || checkIfClaimsAreSet(claims) {
					// handling this error will happen in the service itself
					statusCode = int(connect.CodeInvalidArgument)

					attributes = append(attributes, WgFederatedGraphId.String(claims.FederatedGraphID))
					attributes = append(attributes, WgOrganizationId.String(claims.OrganizationID))
				} else {
					attributes = append(attributes, WgFederatedGraphId.String(claims.FederatedGraphID))
					attributes = append(attributes, WgOrganizationId.String(claims.OrganizationID))
				}

				res, err := next(ctx, req)

				if err != nil {
					statusCode = int(connect.CodeOf(err))
				}

				attributes = append(attributes, semconv.RPCGRPCStatusCodeKey.Int(statusCode))
				c.MetricStore.MeasureRequestCount(ctx, attributes...)

				return res, err
			})
		},
	)
}
