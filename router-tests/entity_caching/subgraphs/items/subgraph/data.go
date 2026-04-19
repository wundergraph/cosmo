package subgraph

import (
	"sync/atomic"

	"github.com/wundergraph/cosmo/router-tests/entity_caching/subgraphs/items/subgraph/model"
)

var nextID atomic.Int64

func init() {
	nextID.Store(5)
}

var Items = []*model.Item{
	{ID: "1", Name: "Widget", Category: "tools"},
	{ID: "2", Name: "Gadget", Category: "electronics"},
	{ID: "3", Name: "Gizmo", Category: "electronics"},
	{ID: "4", Name: "Doohickey", Category: "misc"},
	{ID: "5", Name: "Thingamajig", Category: "misc"},
}

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
