package catalog

import (
	"github.com/99designs/gqlgen/graphql"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/catalog/subgraph"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/catalog/subgraph/generated"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/deferdemo"
)

func NewSchema(latencies deferdemo.Latencies) graphql.ExecutableSchema {
	return generated.NewExecutableSchema(generated.Config{Resolvers: &subgraph.Resolver{Latencies: latencies}})
}
