package datasource

import (
	"context"
	"fmt"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/kafka"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/nats"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
)

type PubSubImplementer[F any] interface {
	VerifyConfig(in *nodev1.DataSourceConfiguration, dsMeta *plan.DataSourceMetadata, config config.EventsConfiguration) error
	GetFactory(executionContext context.Context, config config.EventsConfiguration) F
}

func GetDataSourcesFromConfig(ctx context.Context, in *nodev1.DataSourceConfiguration, dsMeta *plan.DataSourceMetadata, config config.EventsConfiguration) (plan.DataSource, error) {
	var pubSubs []any
	if natsData := in.GetCustomEvents().GetNats(); natsData != nil {
		n := nats.NewPubSub()
		err := n.VerifyConfig(in, dsMeta, config)
		if err != nil {
			return nil, err
		}
		factory := nats.NewFactory(ctx, config)
		ds, err := plan.NewDataSourceConfiguration[nats.Configuration](
			in.Id,
			factory,
			dsMeta,
			nats.Configuration{},
		)
		if err != nil {
			return nil, err
		}
		pubSubs = append(pubSubs, ds)
	}
	if kafkaData := in.GetCustomEvents().GetKafka(); kafkaData != nil {
		k := kafka.NewPubSub()
		err := k.VerifyConfig(in, dsMeta, config)
		if err != nil {
			return nil, err
		}
		factory := k.GetFactory(ctx, config)
		ds, err := plan.NewDataSourceConfiguration[kafka.Configuration](
			in.Id,
			factory,
			dsMeta,
			kafka.Configuration{},
		)

		if err != nil {
			return nil, err
		}

		pubSubs = append(pubSubs, ds)
	}

	if len(pubSubs) == 0 {
		return nil, fmt.Errorf("no pubsub data sources found for data source %s", in.Id)
	}

	factory := NewFactory(ctx, pubSubs)
	return plan.NewDataSourceConfiguration[Configuration](
		in.Id,
		factory,
		dsMeta,
		Configuration{},
	)
}
