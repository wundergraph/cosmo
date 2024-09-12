package api

import (
	"github.com/wundergraph/cosmo/connect-go/wg/cosmo/common"
)

const (
	GraphQLWebsocketSubprotocolDefault            = "auto"
	GraphQLWebsocketSubprotocolGraphQLWS          = "graphql-ws"
	GraphQLWebsocketSubprotocolGraphQLTransportWS = "graphql-transport-ws"
)

func resolveWebsocketSubprotocol(protocol string) *common.GraphQLWebsocketSubprotocol {
	switch protocol {
	case GraphQLWebsocketSubprotocolGraphQLWS:
		return common.GraphQLWebsocketSubprotocol_GRAPHQL_WEBSOCKET_SUBPROTOCOL_WS.Enum()
	case GraphQLWebsocketSubprotocolGraphQLTransportWS:
		return common.GraphQLWebsocketSubprotocol_GRAPHQL_WEBSOCKET_SUBPROTOCOL_TRANSPORT_WS.Enum()
	// GraphQLWebsocketSubprotocolDefault
	default:
		return common.GraphQLWebsocketSubprotocol_GRAPHQL_WEBSOCKET_SUBPROTOCOL_AUTO.Enum()
	}
}

const (
	GraphQLSubscriptionProtocolWS      = "ws"
	GraphQLSubscriptionProtocolSSE     = "sse"
	GraphQLSubscriptionProtocolSSEPost = "sse_post"
)

func resolveSubscriptionProtocol(protocol string) *common.GraphQLSubscriptionProtocol {
	switch protocol {
	case GraphQLSubscriptionProtocolSSE:
		return common.GraphQLSubscriptionProtocol_GRAPHQL_SUBSCRIPTION_PROTOCOL_SSE.Enum()
	case GraphQLSubscriptionProtocolSSEPost:
		return common.GraphQLSubscriptionProtocol_GRAPHQL_SUBSCRIPTION_PROTOCOL_SSE_POST.Enum()
	// GraphQLSubscriptionProtocolWS
	default:
		return common.GraphQLSubscriptionProtocol_GRAPHQL_SUBSCRIPTION_PROTOCOL_WS.Enum()
	}
}
