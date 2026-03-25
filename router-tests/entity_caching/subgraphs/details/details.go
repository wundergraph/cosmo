package details

import (
	"github.com/99designs/gqlgen/graphql"

	"github.com/wundergraph/cosmo/router-tests/entity_caching/subgraphs/details/subgraph"
	"github.com/wundergraph/cosmo/router-tests/entity_caching/subgraphs/details/subgraph/generated"
)

func NewSchema() graphql.ExecutableSchema {
	return generated.NewExecutableSchema(generated.Config{
		Resolvers: &subgraph.Resolver{},
	})
}
