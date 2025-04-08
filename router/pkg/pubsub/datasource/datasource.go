package datasource

import (
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type PubSubDataSource interface {
	GetResolveDataSource() (resolve.DataSource, error)
	GetResolveDataSourceInput(event []byte) (string, error)
	GetEngineEventConfiguration() *nodev1.EngineEventConfiguration
	GetResolveDataSourceSubscription() (resolve.SubscriptionDataSource, error)
	GetResolveDataSourceSubscriptionInput() (string, error)
}
