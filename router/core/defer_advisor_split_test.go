package core

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMaxSplitGroupsBuildsOneGroupPerDependentField(t *testing.T) {
	t.Parallel()

	root := &advisorFetch{
		fetchID: 0, subgraph: "catalog", fields: []string{"storefront"},
	}
	pricing := &advisorFetch{
		fetchID:          1,
		subgraph:         "pricing",
		dependsOn:        []int{0},
		fields:           []string{"price", "price_history"},
		clientParentPath: []string{"storefront", "products"},
	}
	reviews := &advisorFetch{
		fetchID:          2,
		subgraph:         "reviews",
		dependsOn:        []int{0},
		fields:           []string{"reviews"},
		clientParentPath: []string{"storefront"},
	}

	groups := maxSplitGroups([]*advisorFetch{root, pricing, reviews})
	require.Equal(t, []deferGroup{
		{ParentPath: []string{"storefront", "products"}, Fields: []string{"price"}, Label: "adv_1_price"},
		{ParentPath: []string{"storefront", "products"}, Fields: []string{"price_history"}, Label: "adv_1_price_history"},
		{ParentPath: []string{"storefront"}, Fields: []string{"reviews"}, Label: "adv_2_reviews"},
	}, groups)

	// Suggestions own their paths; UI/result code cannot mutate the plan model.
	groups[0].ParentPath[0] = "changed"
	assert.Equal(t, []string{"storefront", "products"}, pricing.clientParentPath)
}

func TestMaxSplitGroupsSkipsRootAndEmptyFetches(t *testing.T) {
	t.Parallel()

	groups := maxSplitGroups([]*advisorFetch{
		{fetchID: 0, fields: []string{"root"}},
		{fetchID: 1, dependsOn: []int{0}},
	})
	assert.Empty(t, groups)
}

func TestMaxSplitLabelUsesFetchIdentityAndResponseName(t *testing.T) {
	t.Parallel()

	assert.Equal(t, "adv_42_stars_count", maxSplitLabel(&advisorFetch{fetchID: 42}, "stars_count"))
}
