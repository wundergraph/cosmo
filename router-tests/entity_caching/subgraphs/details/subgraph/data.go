package subgraph

import (
	"github.com/wundergraph/cosmo/router-tests/entity_caching/subgraphs/details/subgraph/model"
)

// productKey creates a composite lookup key for Product entities.
func productKey(id, region string) string { return id + ":" + region }

var ProductDetails = map[string]*model.Product{
	productKey("p1", "US"): {ID: "p1", Region: "US", Info: "Alpha product details for US market"},
	productKey("p2", "US"): {ID: "p2", Region: "US", Info: "Beta product details for US market"},
	productKey("p3", "EU"): {ID: "p3", Region: "EU", Info: "Gamma product details for EU market"},
	productKey("p4", "EU"): {ID: "p4", Region: "EU", Info: "Delta product details for EU market"},
}

var WarehouseDetails = map[string]*model.Warehouse{
	"w1": {Location: &model.Location{ID: "w1"}, Capacity: 1000},
	"w2": {Location: &model.Location{ID: "w2"}, Capacity: 500},
	"w3": {Location: &model.Location{ID: "w3"}, Capacity: 750},
}

var ItemDetails = map[string]*model.Item{
	"1": {ID: "1", Description: "A versatile widget for everyday use", Rating: 4.5, Tags: []string{"popular", "tools"}},
	"2": {ID: "2", Description: "A high-tech gadget with many features", Rating: 4.8, Tags: []string{"new", "electronics"}},
	"3": {ID: "3", Description: "A compact gizmo that fits in your pocket", Rating: 3.9, Tags: []string{"compact", "electronics"}},
	"4": {ID: "4", Description: "A mysterious doohickey of unknown purpose", Rating: 3.2, Tags: []string{"misc"}},
	"5": {ID: "5", Description: "An elaborate thingamajig for advanced users", Rating: 4.1, Tags: []string{"advanced", "misc"}},
}
