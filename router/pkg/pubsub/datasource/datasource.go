package datasource

import (
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
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
}
