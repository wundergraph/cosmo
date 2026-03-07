package subgraph

import (
	"github.com/wundergraph/cosmo/router-tests/entity_caching/subgraphs/items/subgraph/model"
)

type Resolver struct {
	ItemUpdatedCh chan *model.Item
	ItemCreatedCh chan *model.Item
}
