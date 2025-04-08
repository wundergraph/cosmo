package datasource

import (
	"context"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"go.uber.org/zap"
)

type ProviderFactory func(ctx context.Context, in *nodev1.DataSourceConfiguration, dsMeta *plan.DataSourceMetadata, config config.EventsConfiguration, logger *zap.Logger, hostName string, routerListenAddr string) (PubSubProvider, error)

var pubSubsFactories []ProviderFactory

func RegisterProviderFactory(pubSub ProviderFactory) {
	pubSubsFactories = append(pubSubsFactories, pubSub)
}

func GetRegisteredProviderFactories() []ProviderFactory {
	return pubSubsFactories
}

type ArgumentTemplateCallback func(tpl string) (string, error)

type PubSubProvider interface {
	FindPubSubDataSource(typeName string, fieldName string, extractFn ArgumentTemplateCallback) (PubSubDataSource, error)
}
