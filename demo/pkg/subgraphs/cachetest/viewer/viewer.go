package viewer

import (
	"github.com/99designs/gqlgen/graphql"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/cachetest/viewer/subgraph"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/cachetest/viewer/subgraph/generated"
)

func NewSchema() graphql.ExecutableSchema {
	return generated.NewExecutableSchema(generated.Config{
		Resolvers: &subgraph.Resolver{},
	})
}
