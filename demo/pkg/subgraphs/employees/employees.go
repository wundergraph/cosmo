package employees

import (
	"github.com/99designs/gqlgen/graphql"
	"github.com/nats-io/nats.go"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/employees/subgraph"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/employees/subgraph/generated"
)

func NewSchema(natsConnectionBySourceName map[string]*nats.Conn) graphql.ExecutableSchema {
	return generated.NewExecutableSchema(generated.Config{Resolvers: &subgraph.Resolver{
		NatsConnectionBySourceName: natsConnectionBySourceName,
	}})
}
