package countries

import (
	"github.com/99designs/gqlgen/graphql"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/nats"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/countries/subgraph"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/countries/subgraph/generated"
)

func NewSchema(pubSubBySourceName map[string]nats.Adapter) graphql.ExecutableSchema {
	return generated.NewExecutableSchema(generated.Config{Resolvers: &subgraph.Resolver{
		NatsPubSubByProviderID: pubSubBySourceName,
	}})
}
