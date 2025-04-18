package datasource

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// VerifyPubSubDataSourceImplementation is a common test function to verify any PubSubDataSource implementation
// This function can be used by other packages to test their PubSubDataSource implementations
func VerifyPubSubDataSourceImplementation(t *testing.T, pubSub PubSubDataSource) {
	// Test GetEngineEventConfiguration
	engineEventConfig := pubSub.GetEngineEventConfiguration()
	require.NotNil(t, engineEventConfig, "Expected non-nil EngineEventConfiguration")

	// Test GetResolveDataSource
	dataSource, err := pubSub.GetResolveDataSource()
	require.NoError(t, err, "Expected no error from GetResolveDataSource")
	require.NotNil(t, dataSource, "Expected non-nil DataSource")

	// Test GetResolveDataSourceInput with sample event data
	testEvent := []byte(`{"test":"data"}`)
	input, err := pubSub.GetResolveDataSourceInput(testEvent)
	require.NoError(t, err, "Expected no error from GetResolveDataSourceInput")
	assert.NotEmpty(t, input, "Expected non-empty input")

	// Make sure the input is valid JSON
	var result interface{}
	err = json.Unmarshal([]byte(input), &result)
	assert.NoError(t, err, "Expected valid JSON from GetResolveDataSourceInput")

	// Test GetResolveDataSourceSubscription
	subscription, err := pubSub.GetResolveDataSourceSubscription()
	require.NoError(t, err, "Expected no error from GetResolveDataSourceSubscription")
	require.NotNil(t, subscription, "Expected non-nil SubscriptionDataSource")

	// Test GetResolveDataSourceSubscriptionInput
	subscriptionInput, err := pubSub.GetResolveDataSourceSubscriptionInput()
	require.NoError(t, err, "Expected no error from GetResolveDataSourceSubscriptionInput")
	assert.NotEmpty(t, subscriptionInput, "Expected non-empty subscription input")

	// Make sure the subscription input is valid JSON
	err = json.Unmarshal([]byte(subscriptionInput), &result)
	assert.NoError(t, err, "Expected valid JSON from GetResolveDataSourceSubscriptionInput")
}
