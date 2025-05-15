package nats

import (
	"context"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"go.uber.org/zap"
)

const providerId = "nats"

type PubSubProvider struct {
	id      string
	Adapter AdapterInterface
	Logger  *zap.Logger
}

func (c *PubSubProvider) ID() string {
	return c.id
}

func (c *PubSubProvider) Startup(ctx context.Context) error {
	return c.Adapter.Startup(ctx)
}

func (c *PubSubProvider) Shutdown(ctx context.Context) error {
	return c.Adapter.Shutdown(ctx)
}

func BuildProvidersAndDataSources(ctx context.Context, in *nodev1.DataSourceConfiguration, dsMeta *plan.DataSourceMetadata, config config.EventsConfiguration, logger *zap.Logger, hostName string, routerListenAddr string) ([]datasource.PubSubProvider, []plan.DataSource, error) {
	natsData := make([]datasource.EngineEventConfiguration, 0, len(in.GetCustomEvents().GetNats()))
	for _, natsEvent := range in.GetCustomEvents().GetNats() {
		natsData = append(natsData, natsEvent)
	}
	providerBuilder := &PubSubProviderBuilder{
		ctx:              ctx,
		config:           config,
		logger:           logger,
		hostName:         hostName,
		routerListenAddr: routerListenAddr,
	}
	return datasource.BuildProvidersAndDataSources(providerBuilder, ctx, in, dsMeta, natsData)
}
