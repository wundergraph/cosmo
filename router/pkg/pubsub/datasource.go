package pubsub

import (
	"context"
	"fmt"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"go.uber.org/zap"

	// Register all PubSub implementations
	_ "github.com/wundergraph/cosmo/router/pkg/pubsub/kafka"
	_ "github.com/wundergraph/cosmo/router/pkg/pubsub/nats"
)

func GetDataSourcesFromConfig(ctx context.Context, in *nodev1.DataSourceConfiguration, dsMeta *plan.DataSourceMetadata, config config.EventsConfiguration, logger *zap.Logger, hostName string, routerListenAddr string) ([]plan.DataSource, error) {
	var pubSubs datasource.PubSubGeneralImplementerList

	for _, pubSub := range datasource.GetRegisteredPubSubs() {
		pubSub, err := pubSub(ctx, in, dsMeta, config, logger, hostName, routerListenAddr)
		if err != nil {
			return nil, err
		}
		if pubSub != nil {
			pubSubs = append(pubSubs, pubSub)
		}
	}

	if len(pubSubs) == 0 {
		return nil, fmt.Errorf("no pubsub data sources found for data source %s", in.Id)
	}

	ds, err := plan.NewDataSourceConfiguration(
		in.Id,
		datasource.NewFactory(ctx, config, pubSubs),
		dsMeta,
		pubSubs,
	)
	if err != nil {
		return nil, err
	}

	return []plan.DataSource{ds}, nil
}
