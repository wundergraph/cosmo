package pricing

import (
	"github.com/99designs/gqlgen/graphql"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/deferdemo"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/pricing/subgraph"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/pricing/subgraph/generated"
)

func NewSchema(latencies deferdemo.Latencies) graphql.ExecutableSchema {
	return generated.NewExecutableSchema(generated.Config{Resolvers: &subgraph.Resolver{Latencies: latencies}})
}
