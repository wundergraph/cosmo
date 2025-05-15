package pubsub

import (
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/kafka"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/nats"
)

// ProvidersAndDataSourcesBuilders returns a list of all PubSub builders
func ProviderBuilderFactories() []datasource.PubSubProviderBuilderFactory {
	return []datasource.PubSubProviderBuilderFactory{
		kafka.PubSubProviderBuilderFactory,
		nats.PubSubProviderBuilderFactory,
	}
}
