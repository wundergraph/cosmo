package subgraph

import "github.com/wundergraph/cosmo/demo/pkg/subgraphs/cachegraph_ext/subgraph/model"

var articleExtensions = map[string]*articleExtData{
	"1": {
		ViewCount:     12453,
		Rating:        4.7,
		ReviewSummary: "Excellent introduction to caching concepts. Clear examples.",
		RelatedIDs:    []string{"3", "4"},
	},
	"2": {
		ViewCount:     8921,
		Rating:        4.3,
		ReviewSummary: "Deep dive into federation. Could use more diagrams.",
		RelatedIDs:    []string{"1", "3"},
	},
	"3": {
		ViewCount:     15678,
		Rating:        4.9,
		ReviewSummary: "The definitive guide to cache invalidation. Must read.",
		RelatedIDs:    []string{"1", "4"},
	},
	"4": {
		ViewCount:     6234,
		Rating:        4.1,
		ReviewSummary: "Practical tips for production caching. Solid advice.",
		RelatedIDs:    []string{"1", "2"},
	},
}

type articleExtData struct {
	ViewCount     int
	Rating        float64
	ReviewSummary string
	RelatedIDs    []string
}

// Catalog extension data — description and lastUpdated from this subgraph
var catalogExtensions = map[string]*model.Catalog{
	"c1": {ID: "c1", Description: "Consumer electronics, gadgets, and accessories.", LastUpdated: "2025-03-15T08:00:00Z"},
	"c2": {ID: "c2", Description: "Fiction, non-fiction, technical books, and audiobooks.", LastUpdated: "2025-03-20T12:00:00Z"},
	"c3": {ID: "c3", Description: "Men's, women's, and children's apparel.", LastUpdated: "2025-03-25T16:00:00Z"},
}

func toArticle(id string, ext *articleExtData) *model.Article {
	return &model.Article{
		ID:            id,
		ViewCount:     ext.ViewCount,
		Rating:        ext.Rating,
		ReviewSummary: ext.ReviewSummary,
	}
}
