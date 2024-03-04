package countries

import (
	"github.com/99designs/gqlgen/graphql"
	"github.com/nats-io/nats.go"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/countries/subgraph"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/countries/subgraph/generated"
)

func NewSchema(nc *nats.Conn) graphql.ExecutableSchema {
	return generated.NewExecutableSchema(generated.Config{Resolvers: &subgraph.Resolver{
		NC: nc,
	}})
}
