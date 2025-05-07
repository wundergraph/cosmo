package datasource

import (
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type PubSubDataSource interface {
	ResolveDataSource() (resolve.DataSource, error)
	ResolveDataSourceInput(event []byte) (string, error)
	EngineEventConfiguration() *nodev1.EngineEventConfiguration
	ResolveDataSourceSubscription() (resolve.SubscriptionDataSource, error)
	ResolveDataSourceSubscriptionInput() (string, error)
}
