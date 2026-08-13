package core

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestShouldSuperviseSubscriptionRequest(t *testing.T) {
	for _, test := range []struct {
		name     string
		opType   OperationType
		expected bool
	}{
		{name: "query bypasses supervision", opType: OperationTypeQuery, expected: false},
		{name: "mutation bypasses supervision", opType: OperationTypeMutation, expected: false},
		{name: "subscription is supervised", opType: OperationTypeSubscription, expected: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			req, _ := createRequestWithContext(test.opType)
			require.Equal(t, test.expected, shouldSuperviseSubscriptionRequest(req))
		})
	}

	req, err := http.NewRequest(http.MethodPost, "http://example.com/graphql", nil)
	require.NoError(t, err)
	require.False(t, shouldSuperviseSubscriptionRequest(req))
}

func TestSubscriptionRequestLimitUsesSubgraphOverride(t *testing.T) {
	req, requestContext := createRequestWithContext(OperationTypeSubscription)
	requestContext.subgraphResolver = NewSubgraphResolver([]Subgraph{
		{Id: "products-id", Name: "products", UrlString: req.URL.String()},
	})

	factory := TransportFactory{subgraphTransportOptions: &SubgraphTransportOptions{
		TransportRequestOptions: &TransportRequestOptions{MaxConcurrentSubscriptionRequests: 128},
		SubgraphMap: map[string]*TransportRequestOptions{
			"products": {MaxConcurrentSubscriptionRequests: 8},
		},
	}}

	require.Equal(t, 8, factory.subscriptionRequestLimit(req))
	require.Equal(t, "products-id", subscriptionRequestKey(req))
}
