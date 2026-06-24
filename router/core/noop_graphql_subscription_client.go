package core

import (
	"errors"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/graphql_datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

var errUpstreamGraphQLSubscriptionsDisabled = errors.New("upstream GraphQL subscriptions are disabled")

// noopGraphQLSubscriptionClient satisfies graphql-go-tools NewFactory's non-nil
// subscription client requirement without initializing upstream WS/SSE transports.
type noopGraphQLSubscriptionClient struct{}

func (c *noopGraphQLSubscriptionClient) Subscribe(_ *resolve.Context, _ graphql_datasource.GraphQLSubscriptionOptions, _ resolve.SubscriptionUpdater) error {
	return errUpstreamGraphQLSubscriptionsDisabled
}

var noopGraphQLSubscriptionClientInstance graphql_datasource.GraphQLSubscriptionClient = &noopGraphQLSubscriptionClient{}

func shouldUseNoopUpstreamSubscriptionClient(
	graphqlSchema string,
	engineConfig *nodev1.EngineConfiguration,
	eventsConfig config.EventsConfiguration,
	webSocketConfiguration *config.WebSocketConfiguration,
) bool {
	if !schemaHasSubscriptionRootFields(graphqlSchema) {
		return true
	}
	if !clientWebSocketSubscriptionsEnabled(webSocketConfiguration) && !eventSubscriptionsEnabled(engineConfig, eventsConfig) {
		return true
	}
	return false
}

func schemaHasSubscriptionRootFields(graphqlSchema string) bool {
	if graphqlSchema == "" {
		return false
	}

	doc, report := astparser.ParseGraphqlDocumentString(graphqlSchema)
	if report.HasErrors() {
		return false
	}
	if err := asttransform.MergeDefinitionWithBaseSchema(&doc); err != nil {
		return false
	}

	return subscriptionRootFieldCount(&doc) > 0
}

func subscriptionRootFieldCount(doc *ast.Document) int {
	if doc.Index.SubscriptionTypeName == nil {
		return 0
	}

	node, ok := doc.Index.FirstNodeByNameBytes(doc.Index.SubscriptionTypeName)
	if !ok || node.Kind != ast.NodeKindObjectTypeDefinition {
		return 0
	}

	return len(doc.ObjectTypeDefinitions[node.Ref].FieldsDefinition.Refs)
}

func clientWebSocketSubscriptionsEnabled(webSocketConfiguration *config.WebSocketConfiguration) bool {
	if webSocketConfiguration == nil {
		return true
	}
	return webSocketConfiguration.Enabled
}

func eventSubscriptionsEnabled(engineConfig *nodev1.EngineConfiguration, eventsConfig config.EventsConfiguration) bool {
	if len(eventsConfig.Providers.Nats) > 0 ||
		len(eventsConfig.Providers.Kafka) > 0 ||
		len(eventsConfig.Providers.Redis) > 0 {
		return true
	}

	if engineConfig == nil {
		return false
	}

	for _, ds := range engineConfig.GetDatasourceConfigurations() {
		if ds.GetKind() == nodev1.DataSourceKind_PUBSUB {
			return true
		}
		customEvents := ds.GetCustomEvents()
		if customEvents == nil {
			continue
		}
		if len(customEvents.GetNats()) > 0 ||
			len(customEvents.GetKafka()) > 0 ||
			len(customEvents.GetRedis()) > 0 {
			return true
		}
	}

	return false
}
