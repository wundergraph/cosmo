package datasource

import (
	"context"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"go.uber.org/zap"
)

type Getter func(ctx context.Context, in *nodev1.DataSourceConfiguration, dsMeta *plan.DataSourceMetadata, config config.EventsConfiguration, logger *zap.Logger, hostName string, routerListenAddr string) (PubSubGeneralImplementer, error)

var pubSubs []Getter

func RegisterPubSub(pubSub Getter) {
	pubSubs = append(pubSubs, pubSub)
}

func GetRegisteredPubSubs() []Getter {
	return pubSubs
}

type ArgumentTemplateCallback func(tpl string) (string, error)

type PubSubImplementer interface {
	PrepareProviders(ctx context.Context, in *nodev1.DataSourceConfiguration, dsMeta *plan.DataSourceMetadata, config config.EventsConfiguration) error
}
