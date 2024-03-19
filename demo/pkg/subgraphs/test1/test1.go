package test1

import (
	"github.com/99designs/gqlgen/graphql"
	"github.com/nats-io/nats.go"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/test1/subgraph"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/test1/subgraph/generated"
)

func NewSchema(natsConnectionBySourceName map[string]*nats.Conn) graphql.ExecutableSchema {
	return generated.NewExecutableSchema(generated.Config{Resolvers: &subgraph.Resolver{
		NatsConnectionBySourceName: natsConnectionBySourceName,
	}})
}
