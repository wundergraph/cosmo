package datasource

import (
	"context"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
)

type Getter func(ctx context.Context, in *nodev1.DataSourceConfiguration, dsMeta *plan.DataSourceMetadata, config config.EventsConfiguration, logger *zap.Logger) (plan.DataSource, error)

var pubSubs []Getter

func RegisterPubSub(pubSub Getter) {
	pubSubs = append(pubSubs, pubSub)
}

func GetRegisteredPubSubs() []Getter {
	return pubSubs
}

type ArgumentTemplateCallback func(tpl string) (string, error)

type PubSubImplementer[F any] interface {
	PrepareProviders(ctx context.Context, in *nodev1.DataSourceConfiguration, dsMeta *plan.DataSourceMetadata, config config.EventsConfiguration) error
	//	ConnectProviders(ctx context.Context) error
	GetFactory(executionContext context.Context, config config.EventsConfiguration) F
}

type EventConfigType interface {
	GetEngineEventConfiguration() *nodev1.EngineEventConfiguration
}

// Create an interface for Configuration
type Implementer[EC EventConfigType, P any] interface {
	GetResolveDataSource(eventConfig EC, pubsub P) (resolve.DataSource, error)
	GetResolveDataSourceSubscription(eventConfig EC, pubsub P) (resolve.SubscriptionDataSource, error)
	GetResolveDataSourceSubscriptionInput(eventConfig EC, pubsub P) (string, error)
	//GetResolveDataSourceInput(eventConfig EC, ref int, visitor *plan.Visitor, variables *resolve.Variables) (string, error)
	GetResolveDataSourceInput(eventConfig EC, event []byte) (string, error)
	GetProviderId(eventConfig EC) string
	FindEventConfig(eventConfigs []EC, typeName string, fieldName string, fn ArgumentTemplateCallback) (EC, error)
	GetEventsDataConfigurations() []EC
}
