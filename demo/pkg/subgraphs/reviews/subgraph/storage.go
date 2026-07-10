package subgraph

import (
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/reviews/subgraph/model"
)

func reviewsByProductID(id string) []*model.Review {
	return []*model.Review{
		{ID: id + "-1", Body: "Great", Stars: 5},
		{ID: id + "-2", Body: "Solid", Stars: 4},
	}
}
