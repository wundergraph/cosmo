package subgraph

import (
	"github.com/wundergraph/cosmo/router-tests/entity_caching/subgraphs/items/subgraph/model"
)

type Resolver struct {
	ItemUpdatedCh chan *model.Item
	ItemCreatedCh chan *model.Item

	// Store is a per-resolver Item store. Each subgraph server constructs a
	// fresh Resolver (and thus a fresh Store) so mutations in one test do not
	// leak into parallel tests.
	Store *itemStore
}

// NewResolver constructs a Resolver with a freshly seeded Item store and the
// subscription channels. Tests should call NewResolver (via NewSchema) rather
// than instantiating Resolver directly so the store is always non-nil.
func NewResolver(itemUpdatedCh chan *model.Item, itemCreatedCh chan *model.Item) *Resolver {
	return &Resolver{
		ItemUpdatedCh: itemUpdatedCh,
		ItemCreatedCh: itemCreatedCh,
		Store:         newItemStore(),
	}
}
