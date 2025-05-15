package kafka

import (
	"context"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"go.uber.org/zap"
)

const providerId = "kafka"

type PubSubProvider struct {
	id      string
	Logger  *zap.Logger
	Adapter AdapterInterface
}

func (c *PubSubProvider) ID() string {
	return c.id
}

func (c *PubSubProvider) Startup(ctx context.Context) error {
	if err := c.Adapter.Startup(ctx); err != nil {
		return err
	}
	return nil
}

func (c *PubSubProvider) Shutdown(ctx context.Context) error {
	if err := c.Adapter.Shutdown(ctx); err != nil {
		return err
	}
	return nil
}

func BuildProvidersAndDataSources(ctx context.Context, in *nodev1.DataSourceConfiguration, dsMeta *plan.DataSourceMetadata, config config.EventsConfiguration, logger *zap.Logger, hostName string, routerListenAddr string) ([]datasource.PubSubProvider, []plan.DataSource, error) {
	kafkaData := make([]datasource.EngineEventConfiguration, 0, len(in.GetCustomEvents().GetKafka()))
	for _, kafkaEvent := range in.GetCustomEvents().GetKafka() {
		kafkaData = append(kafkaData, kafkaEvent)
	}
	providerBuilder := &PubSubProviderBuilder{
		ctx:              ctx,
		config:           config,
		logger:           logger,
		hostName:         hostName,
		routerListenAddr: routerListenAddr,
	}
	return datasource.BuildProvidersAndDataSources(providerBuilder, ctx, in, dsMeta, kafkaData)
}
