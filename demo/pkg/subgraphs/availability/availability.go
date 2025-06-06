package availability

import (
	"github.com/99designs/gqlgen/graphql"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/nats"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/availability/subgraph"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/availability/subgraph/generated"
)

func NewSchema(pubSubBySourceName map[string]nats.Adapter, pubSubName func(string) string) graphql.ExecutableSchema {
	return generated.NewExecutableSchema(generated.Config{Resolvers: &subgraph.Resolver{
		NatsPubSubByProviderID: pubSubBySourceName,
		GetPubSubName:          pubSubName,
	}})
}
