package subgraph

import (
	"github.com/wundergraph/cosmo/router-tests/entity_caching/subgraphs/inventory/subgraph/model"
)

var ItemInventory = map[string]*model.Item{
	"1": {ID: "1", Available: true, Count: 100},
	"2": {ID: "2", Available: true, Count: 50},
	"3": {ID: "3", Available: false, Count: 0},
	"4": {ID: "4", Available: true, Count: 25},
	"5": {ID: "5", Available: true, Count: 10},
}
