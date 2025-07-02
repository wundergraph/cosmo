package employees

import (
	"github.com/99designs/gqlgen/graphql"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/employees/subgraph"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/employees/subgraph/generated"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/pubsub_datasource"
)

func NewSchema(natsPubSubByProviderID map[string]pubsub_datasource.NatsPubSub) graphql.ExecutableSchema {
	return generated.NewExecutableSchema(generated.Config{Resolvers: &subgraph.Resolver{
		NatsPubSubByProviderID: natsPubSubByProviderID,
		EmployeesData:          subgraph.Employees,
	}})
}
