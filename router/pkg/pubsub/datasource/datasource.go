package datasource

import (
	"slices"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

// PubSubDataSource is the interface that all pubsub data sources must implement.
// It serves three main purposes:
//  1. Resolving the data source and subscription data source
//  2. Generating the appropriate input for these data sources
//  3. Providing access to the engine event configuration
//
// For detailed implementation guidelines, see:
// https://github.com/wundergraph/cosmo/blob/main/router/pkg/pubsub/README.md
type PubSubDataSource interface {
	// ResolveDataSource returns the engine DataSource implementation that contains
	// methods which will be called by the Planner when resolving a field
	ResolveDataSource() (resolve.DataSource, error)
	// ResolveDataSourceInput build the input that will be passed to the engine DataSource
	ResolveDataSourceInput(event []byte) (string, error)
	// EngineEventConfiguration get the engine event configuration, contains the provider id, type, type name and field name
	EngineEventConfiguration() *nodev1.EngineEventConfiguration
	// ResolveDataSourceSubscription returns the engine SubscriptionDataSource implementation
	// that contains methods to start a subscription, which will be called by the Planner
	// when a subscription is initiated
	ResolveDataSourceSubscription() (resolve.SubscriptionDataSource, error)
	// ResolveDataSourceSubscriptionInput build the input that will be passed to the engine SubscriptionDataSource
	ResolveDataSourceSubscriptionInput() (string, error)
	// TransformEventData allows the data source to transform the event data using the extractFn
	TransformEventData(extractFn ArgumentTemplateCallback) error
}

type EngineEventConfiguration interface {
	GetEngineEventConfiguration() *nodev1.EngineEventConfiguration
}

func GetFilteredDataSourceMetadata[E EngineEventConfiguration](event E, dsMeta *plan.DataSourceMetadata) *plan.DataSourceMetadata {
	// find used root types and fields
	rootFields := make(map[string][]string)

	typeName := event.GetEngineEventConfiguration().GetTypeName()
	fieldName := event.GetEngineEventConfiguration().GetFieldName()
	if _, ok := rootFields[typeName]; !ok {
		rootFields[typeName] = []string{}
	}
	rootFields[typeName] = append(rootFields[typeName], fieldName)

	// filter dsMeta.RootNodes
	newRootNodes := []plan.TypeField{}
	for _, node := range dsMeta.RootNodes {
		newRootNode := plan.TypeField{
			TypeName:           node.TypeName,
			FieldNames:         []string{},
			ExternalFieldNames: node.ExternalFieldNames,
		}
		for _, fieldName := range node.FieldNames {
			if slices.Contains(rootFields[node.TypeName], fieldName) {
				newRootNode.FieldNames = append(newRootNode.FieldNames, fieldName)
			}
		}
		newRootNodes = append(newRootNodes, newRootNode)
	}
	newDsMets := *dsMeta
	newDsMets.RootNodes = newRootNodes

	return &newDsMets
}
