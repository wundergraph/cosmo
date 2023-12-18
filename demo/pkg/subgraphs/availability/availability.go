package availability

import (
	"github.com/99designs/gqlgen/graphql"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/availability/subgraph"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/availability/subgraph/generated"
)

func NewSchema() graphql.ExecutableSchema {
	return generated.NewExecutableSchema(generated.Config{Resolvers: &subgraph.Resolver{}})
}
