package cachegraph_ext

import (
	"github.com/99designs/gqlgen/graphql"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/cachegraph_ext/subgraph"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/cachegraph_ext/subgraph/generated"
)

func NewSchema() graphql.ExecutableSchema {
	return generated.NewExecutableSchema(generated.Config{Resolvers: &subgraph.Resolver{}})
}
