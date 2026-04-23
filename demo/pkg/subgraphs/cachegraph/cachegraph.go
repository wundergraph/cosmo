package cachegraph

import (
	"github.com/99designs/gqlgen/graphql"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/cachegraph/subgraph"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/cachegraph/subgraph/generated"
)

func NewSchema() graphql.ExecutableSchema {
	return generated.NewExecutableSchema(generated.Config{Resolvers: subgraph.NewResolver()})
}
