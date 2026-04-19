package subgraph

import (
	"fmt"
	"sync"
	"sync/atomic"

	"github.com/wundergraph/cosmo/router-tests/entity_caching/subgraphs/items/subgraph/model"
)

var nextID atomic.Int64

func init() {
	nextID.Store(5)
}

// defaultItems is the seed data for a fresh item store. Each Resolver clones
// this into its own store so mutations are isolated between parallel tests.
var defaultItems = []*model.Item{
	{ID: "1", Name: "Widget", Category: "tools"},
	{ID: "2", Name: "Gadget", Category: "electronics"},
	{ID: "3", Name: "Gizmo", Category: "electronics"},
	{ID: "4", Name: "Doohickey", Category: "misc"},
	{ID: "5", Name: "Thingamajig", Category: "misc"},
}

// Items is kept for backward compatibility with any external readers. It is a
// snapshot of the seed data and MUST NOT be mutated. Tests mutate the per-
// resolver store via itemStore.
var Items = cloneItems(defaultItems)

var Products = []*model.Product{
	{ID: "p1", Region: "US", Sku: "SKU-001", Name: "Alpha"},
	{ID: "p2", Region: "US", Sku: "SKU-002", Name: "Beta"},
	{ID: "p3", Region: "EU", Sku: "SKU-003", Name: "Gamma"},
	{ID: "p4", Region: "EU", Sku: "SKU-004", Name: "Delta"},
}

var Warehouses = []*model.Warehouse{
	{Location: &model.Location{ID: "w1"}, Name: "Main Depot"},
	{Location: &model.Location{ID: "w2"}, Name: "East Hub"},
	{Location: &model.Location{ID: "w3"}, Name: "West Hub"},
}

// itemStore is a per-resolver mutable Item store. Tests create one per
// subgraph server so mutations in one test don't affect parallel tests.
type itemStore struct {
	mu    sync.RWMutex
	items []*model.Item
}

func newItemStore() *itemStore {
	return &itemStore{items: cloneItems(defaultItems)}
}

func (s *itemStore) all() []*model.Item {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneItems(s.items)
}

func (s *itemStore) find(id string) *model.Item {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, it := range s.items {
		if it.ID == id {
			return cloneItem(it)
		}
	}
	return nil
}

func (s *itemStore) byIDs(ids []string) []*model.Item {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []*model.Item
	for _, id := range ids {
		for _, it := range s.items {
			if it.ID == id {
				out = append(out, cloneItem(it))
				break
			}
		}
	}
	return out
}

func (s *itemStore) update(id, name string) (*model.Item, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, it := range s.items {
		if it.ID == id {
			it.Name = name
			return cloneItem(it), true
		}
	}
	return nil, false
}

func (s *itemStore) delete(id string) (*model.Item, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, it := range s.items {
		if it.ID == id {
			removed := cloneItem(it)
			s.items = append(s.items[:i], s.items[i+1:]...)
			return removed, true
		}
	}
	return nil, false
}

func (s *itemStore) create(name, category string) *model.Item {
	id := atomicNextID()
	s.mu.Lock()
	defer s.mu.Unlock()
	it := &model.Item{ID: id, Name: name, Category: category}
	s.items = append(s.items, it)
	return cloneItem(it)
}

func atomicNextID() string {
	return fmt.Sprintf("%d", nextID.Add(1))
}

func cloneItem(it *model.Item) *model.Item {
	if it == nil {
		return nil
	}
	c := *it
	return &c
}

func cloneItems(in []*model.Item) []*model.Item {
	out := make([]*model.Item, len(in))
	for i, it := range in {
		out[i] = cloneItem(it)
	}
	return out
}
