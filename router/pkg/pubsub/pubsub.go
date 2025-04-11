package pubsub

import (
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"

	"github.com/wundergraph/cosmo/router/pkg/pubsub/kafka"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/nats"
)

var additionalProviders []datasource.ProviderFactory

// RegisterAdditionalProvider registers an additional PubSub provider
func RegisterAdditionalProvider(provider datasource.ProviderFactory) {
	additionalProviders = append(additionalProviders, provider)
}

// GetProviderFactories returns a list of all PubSub implementations
func GetProviderFactories() []datasource.ProviderFactory {
	return append([]datasource.ProviderFactory{
		kafka.GetProvider,
		nats.GetProvider,
	}, additionalProviders...)
}
