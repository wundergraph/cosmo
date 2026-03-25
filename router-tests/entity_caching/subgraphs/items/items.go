package items

import (
	"github.com/99designs/gqlgen/graphql"

	"github.com/wundergraph/cosmo/router-tests/entity_caching/subgraphs/items/subgraph"
	"github.com/wundergraph/cosmo/router-tests/entity_caching/subgraphs/items/subgraph/generated"
	"github.com/wundergraph/cosmo/router-tests/entity_caching/subgraphs/items/subgraph/model"
)

func NewSchema(itemUpdatedCh chan *model.Item, itemCreatedCh chan *model.Item) graphql.ExecutableSchema {
	return generated.NewExecutableSchema(generated.Config{
		Resolvers: &subgraph.Resolver{
			ItemUpdatedCh: itemUpdatedCh,
			ItemCreatedCh: itemCreatedCh,
		},
	})
}
