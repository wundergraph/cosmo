package subgraph

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/cachegraph_ext/subgraph/model"
)

func TestRelatedArticlesReturnsPopulatedArticleExtensions(t *testing.T) {
	t.Parallel()

	r := &Resolver{}

	related, err := r.Article().RelatedArticles(context.Background(), &model.Article{ID: "1"})
	require.NoError(t, err)
	require.Len(t, related, 2)

	require.Equal(t, "3", related[0].ID)
	require.Equal(t, 15678, related[0].ViewCount)
	require.Equal(t, 4.9, related[0].Rating)
	require.Equal(t, "The definitive guide to cache invalidation. Must read.", related[0].ReviewSummary)

	require.Equal(t, "4", related[1].ID)
	require.Equal(t, 6234, related[1].ViewCount)
	require.Equal(t, 4.1, related[1].Rating)
	require.Equal(t, "Practical tips for production caching. Solid advice.", related[1].ReviewSummary)
}
