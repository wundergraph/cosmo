package subgraph

import (
	"github.com/wundergraph/cosmo/router-tests/entity_caching/subgraphs/items/subgraph/model"
)

var Items = []*model.Item{
	{ID: "1", Name: "Widget", Category: "tools"},
	{ID: "2", Name: "Gadget", Category: "electronics"},
	{ID: "3", Name: "Gizmo", Category: "electronics"},
	{ID: "4", Name: "Doohickey", Category: "misc"},
	{ID: "5", Name: "Thingamajig", Category: "misc"},
}
