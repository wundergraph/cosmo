package products

import (
	"github.com/99designs/gqlgen/graphql"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/pubsub_datasource"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/products/subgraph"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/products/subgraph/generated"
)

func NewSchema(natsPubSubByProviderID map[string]pubsub_datasource.NatsPubSub) graphql.ExecutableSchema {
	return generated.NewExecutableSchema(generated.Config{Resolvers: &subgraph.Resolver{
		NatsPubSubByProviderID: natsPubSubByProviderID,
	}})
}
