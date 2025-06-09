package mood

import (
	"github.com/99designs/gqlgen/graphql"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/nats"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/mood/subgraph"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/mood/subgraph/generated"
)

func NewSchema(natsPubSubByProviderID map[string]nats.Adapter, getPubSubName func(string) string) graphql.ExecutableSchema {
	return generated.NewExecutableSchema(generated.Config{Resolvers: &subgraph.Resolver{
		NatsPubSubByProviderID: natsPubSubByProviderID,
		GetPubSubName:          getPubSubName,
	}})
}
