package inventory

import (
	"github.com/99designs/gqlgen/graphql"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/cachetest/inventory/subgraph"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/cachetest/inventory/subgraph/generated"
)

func NewSchema() graphql.ExecutableSchema {
	return generated.NewExecutableSchema(generated.Config{
		Resolvers: &subgraph.Resolver{},
	})
}
