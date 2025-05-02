package subgraph

import (
	"github.com/99designs/gqlgen/graphql"
	"github.com/wundergraph/benchmark-services/graphs/accounts/subgraph/generated"
)

// This file will not be regenerated automatically.
//
// It serves as dependency injection for your app, add any dependencies you require here.

type Resolver struct {
	userManager *UserManager
}

func NewSchema(userManager *UserManager) graphql.ExecutableSchema {
	return generated.NewExecutableSchema(generated.Config{
		Resolvers: &Resolver{
			userManager: userManager,
		},
	})
}
