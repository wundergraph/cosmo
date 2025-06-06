package datasource

import (
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

// EngineDataSourceFactory is the interface that all pubsub data sources must implement.
// It serves three main purposes:
//  1. Resolving the data source and subscription data source
//  2. Generating the appropriate input for these data sources
//  3. Providing access to the engine event configuration
//
// For detailed implementation guidelines, see:
// https://github.com/wundergraph/cosmo/blob/main/router/pkg/pubsub/README.md
type EngineDataSourceFactory interface {
	// GetFieldName get the field name where the data source is defined
	GetFieldName() string
	// ResolveDataSource returns the engine DataSource implementation that contains
	// methods which will be called by the Planner when resolving a field
	ResolveDataSource() (resolve.DataSource, error)
	// ResolveDataSourceInput build the input that will be passed to the engine DataSource
	ResolveDataSourceInput(event []byte) (string, error)
	// ResolveDataSourceSubscription returns the engine SubscriptionDataSource implementation
	// that contains methods to start a subscription, which will be called by the Planner
	// when a subscription is initiated
	ResolveDataSourceSubscription() (resolve.SubscriptionDataSource, error)
	// ResolveDataSourceSubscriptionInput build the input that will be passed to the engine SubscriptionDataSource
	ResolveDataSourceSubscriptionInput() (string, error)
	// TransformEventData allows the data source to transform the event data using the extractFn
	TransformEventData(extractFn ArgumentTemplateCallback) error
}
