package pubsubtest

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
)

// VerifyEngineDataSourceFactoryImplementation is a common test function to verify any EngineDataSourceFactory implementation
// This function can be used by other packages to test their EngineDataSourceFactory implementations
func VerifyEngineDataSourceFactoryImplementation(t *testing.T, pubSub datasource.EngineDataSourceFactory) {
	// Test GetFieldName
	fieldName := pubSub.GetFieldName()
	require.NotEmpty(t, fieldName, "Expected non-empty field name")

	// Test GetResolveDataSource
	dataSource, err := pubSub.ResolveDataSource()
	require.NoError(t, err, "Expected no error from GetResolveDataSource")
	require.NotNil(t, dataSource, "Expected non-nil DataSource")

	// Test GetResolveDataSourceInput with sample event data
	testEvent := []byte(`{"test":"data"}`)
	input, err := pubSub.ResolveDataSourceInput(testEvent)
	require.NoError(t, err, "Expected no error from GetResolveDataSourceInput")
	assert.NotEmpty(t, input, "Expected non-empty input")

	// Make sure the input is valid JSON
	var result interface{}
	err = json.Unmarshal([]byte(input), &result)
	assert.NoError(t, err, "Expected valid JSON from GetResolveDataSourceInput")

	// Test GetResolveDataSourceSubscription
	subscription, err := pubSub.ResolveDataSourceSubscription()
	require.NoError(t, err, "Expected no error from GetResolveDataSourceSubscription")
	require.NotNil(t, subscription, "Expected non-nil SubscriptionDataSource")

	// Test GetResolveDataSourceSubscriptionInput
	subscriptionInput, err := pubSub.ResolveDataSourceSubscriptionInput()
	require.NoError(t, err, "Expected no error from GetResolveDataSourceSubscriptionInput")
	assert.NotEmpty(t, subscriptionInput, "Expected non-empty subscription input")

	// Make sure the subscription input is valid JSON
	err = json.Unmarshal([]byte(subscriptionInput), &result)
	assert.NoError(t, err, "Expected valid JSON from GetResolveDataSourceSubscriptionInput")
}
