package employees

import (
	"context"

	"github.com/99designs/gqlgen/graphql"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/employees/subgraph"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/employees/subgraph/generated"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/nats"
)

func NewSchema(natsPubSubByProviderID map[string]nats.Adapter) graphql.ExecutableSchema {
	return generated.NewExecutableSchema(generated.Config{
		Resolvers: &subgraph.Resolver{
			NatsPubSubByProviderID: natsPubSubByProviderID,
			EmployeesData:          subgraph.Employees,
		},
		Directives: generated.DirectiveRoot{
			Openfed__requireFetchReasons: func(ctx context.Context, obj any, next graphql.Resolver) (res any, err error) {
				return next(context.WithValue(ctx, "Openfed__requireFetchReasons", obj))
			},
		},
	})
}
