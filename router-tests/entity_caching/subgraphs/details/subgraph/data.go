package subgraph

import (
	"github.com/wundergraph/cosmo/router-tests/entity_caching/subgraphs/details/subgraph/model"
)

var ItemDetails = map[string]*model.Item{
	"1": {ID: "1", Description: "A versatile widget for everyday use", Rating: 4.5, Tags: []string{"popular", "tools"}},
	"2": {ID: "2", Description: "A high-tech gadget with many features", Rating: 4.8, Tags: []string{"new", "electronics"}},
	"3": {ID: "3", Description: "A compact gizmo that fits in your pocket", Rating: 3.9, Tags: []string{"compact", "electronics"}},
	"4": {ID: "4", Description: "A mysterious doohickey of unknown purpose", Rating: 3.2, Tags: []string{"misc"}},
	"5": {ID: "5", Description: "An elaborate thingamajig for advanced users", Rating: 4.1, Tags: []string{"advanced", "misc"}},
}
