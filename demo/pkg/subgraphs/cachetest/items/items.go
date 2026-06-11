package items

import (
	"github.com/99designs/gqlgen/graphql"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/cachetest/items/subgraph"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/cachetest/items/subgraph/generated"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/cachetest/items/subgraph/model"
)

func NewSchema(itemUpdatedCh chan *model.Item, itemCreatedCh chan *model.Item) graphql.ExecutableSchema {
	return generated.NewExecutableSchema(generated.Config{
		Resolvers: subgraph.NewResolver(itemUpdatedCh, itemCreatedCh),
	})
}
