package subgraph

import (
	"github.com/99designs/gqlgen/graphql"
	"github.com/wundergraph/benchmark-services/graphs/products/subgraph/generated"
)

// This file will not be regenerated automatically.
//
// It serves as dependency injection for your app, add any dependencies you require here.

type Resolver struct {
	productManager *ProductManager
}

func NewSchema(productManager *ProductManager) graphql.ExecutableSchema {
	return generated.NewExecutableSchema(generated.Config{
		Resolvers: &Resolver{
			productManager: productManager,
		},
	})
}
