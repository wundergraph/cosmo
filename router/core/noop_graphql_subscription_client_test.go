package core

import (
	"testing"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/graphql_datasource"
)

func TestShouldUseNoopUpstreamSubscriptionClient_NoSubscriptionRootFields(t *testing.T) {
	schema := `type Query { hello: String }`

	require.True(t, shouldUseNoopUpstreamSubscriptionClient(
		schema,
		nil,
		config.EventsConfiguration{},
		&config.WebSocketConfiguration{Enabled: true},
	))
}

func TestShouldUseNoopUpstreamSubscriptionClient_EmptySubscriptionType(t *testing.T) {
	schema := `type Query { hello: String }
type Subscription { }`

	require.True(t, shouldUseNoopUpstreamSubscriptionClient(
		schema,
		nil,
		config.EventsConfiguration{},
		&config.WebSocketConfiguration{Enabled: true},
	))
}

func TestShouldUseNoopUpstreamSubscriptionClient_ClientWSDisabledWithoutEvents(t *testing.T) {
	schema := `type Query { hello: String }
type Subscription { onUpdate: String }`

	require.True(t, shouldUseNoopUpstreamSubscriptionClient(
		schema,
		&nodev1.EngineConfiguration{},
		config.EventsConfiguration{},
		&config.WebSocketConfiguration{Enabled: false},
	))
}

func TestShouldUseNoopUpstreamSubscriptionClient_ClientWSDisabledWithPubSubDatasource(t *testing.T) {
	schema := `type Query { hello: String }
type Subscription { onUpdate: String }`

	engineConfig := &nodev1.EngineConfiguration{
		DatasourceConfigurations: []*nodev1.DataSourceConfiguration{
			{Kind: nodev1.DataSourceKind_PUBSUB},
		},
	}

	require.False(t, shouldUseNoopUpstreamSubscriptionClient(
		schema,
		engineConfig,
		config.EventsConfiguration{},
		&config.WebSocketConfiguration{Enabled: false},
	))
}

func TestShouldUseNoopUpstreamSubscriptionClient_UpstreamSubscriptionsNeeded(t *testing.T) {
	schema := `type Query { hello: String }
type Subscription { onUpdate: String }`

	require.False(t, shouldUseNoopUpstreamSubscriptionClient(
		schema,
		&nodev1.EngineConfiguration{},
		config.EventsConfiguration{},
		&config.WebSocketConfiguration{Enabled: true},
	))
}

func TestNoopGraphQLSubscriptionClient_SubscribeReturnsError(t *testing.T) {
	err := noopGraphQLSubscriptionClientInstance.Subscribe(nil, graphql_datasource.GraphQLSubscriptionOptions{}, nil)
	require.ErrorIs(t, err, errUpstreamGraphQLSubscriptionsDisabled)
}

func TestSharedSubscriptionClient_UsesNoopWhenConfigured(t *testing.T) {
	resolver := &DefaultFactoryResolver{
		useNoopSubscriptionClient: true,
	}

	client := resolver.sharedSubscriptionClient()
	require.Same(t, noopGraphQLSubscriptionClientInstance, client)
}
