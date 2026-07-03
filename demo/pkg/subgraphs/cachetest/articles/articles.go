package articles

import (
	"github.com/99designs/gqlgen/graphql"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/cachetest/articles/subgraph"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/cachetest/articles/subgraph/generated"
)

func NewSchema() graphql.ExecutableSchema {
	return generated.NewExecutableSchema(generated.Config{
		Resolvers: &subgraph.Resolver{},
	})
}
