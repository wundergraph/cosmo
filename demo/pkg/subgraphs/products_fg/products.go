package products_fg

import (
	"github.com/99designs/gqlgen/graphql"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/nats"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/products_fg/subgraph"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/products_fg/subgraph/generated"
)

func NewSchema(natsPubSubByProviderID map[string]nats.Adapter) graphql.ExecutableSchema {
	return generated.NewExecutableSchema(generated.Config{Resolvers: &subgraph.Resolver{
		NatsPubSubByProviderID:       natsPubSubByProviderID,
		TopSecretFederationFactsData: subgraph.TopSecretFederationFacts,
	}})
}
