package graphqlws

import (
	"github.com/tidwall/gjson"
	"github.com/wundergraph/cosmo/speedtrap"
)

// Scenarios contains all subscriptions-transport-ws ("graphql-ws" subprotocol)
// proxy scenarios. The test harness must register a backend named "subgraph-a"
// that speaks graphql-transport-ws (the router translates between protocols).
var Scenarios = []speedtrap.Scenario{
	// Connection phase
	ConnectionInitAndAck,
	DuplicateConnectionInitClosesSocket,
	SubscribeBeforeAckClosesSocket,
	UnknownMessageTypeClosesSocket,

	// Operation lifecycle
	StartDataCompleteRoundTrip,
	MultipleDataMessagesBeforeComplete,
	StopCancelsSubscription,
	ServerErrorInDataPayload,
	MultipleConcurrentSubscriptions,
	OneSubscriptionErrorDoesNotAffectAnother,
	DuplicateStartIDClosesSocket,
	ConnectionTerminateCleansUp,

	// Disruption
	BackendTCPDropDuringActiveSubscription,
	BackendCloseFrameDuringActiveSubscription,
	ClientTCPDropCleansUpBackendSubscription,
	ClientCloseFrameCleansUpBackendSubscription,
	BackendNeverAcksConnectionInitTimesOut,

	// Headers and init payload
	AllowlistedHeadersForwardedToBackend,
	NonAllowlistedHeadersFilteredOut,
	ConnectionInitPayloadForwardedToBackend,

	// Multiplexing
	MultipleSubscriptionsShareOneUpstreamConnection,
	DifferentInitPayloadsGetSeparateUpstreamConnections,
}

// extractID parses the "id" field from a JSON message.
func extractID(msg string) string {
	return gjson.Get(msg, "id").String()
}

// extractType parses the "type" field from a JSON message.
func extractType(msg string) string {
	return gjson.Get(msg, "type").String()
}
