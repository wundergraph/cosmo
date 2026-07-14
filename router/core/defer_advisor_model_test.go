package core

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuildFetchModelFlattensPlanAndNormalizesPaths(t *testing.T) {
	t.Parallel()

	root := &advisorQueryPlanNode{
		Kind: "Sequence",
		Children: []*advisorQueryPlanNode{
			{Kind: "Single", Fetch: &advisorQueryPlanFetch{
				Kind:         "Single",
				SubgraphName: "catalog",
				FetchID:      0,
				Query:        `query { storefront: products { id } }`,
			}},
			{Kind: "Parallel", Children: []*advisorQueryPlanNode{
				{Kind: "Single", Fetch: &advisorQueryPlanFetch{
					Kind:              "Entity",
					Path:              "storefront.@.details",
					SubgraphName:      "pricing",
					FetchID:           1,
					DependsOnFetchIDs: []int{0},
					Query: `query ($representations: [_Any!]!) {
  _entities(representations: $representations) {
    ... on Product {
      displayPrice: price
      history { value }
      __typename
    }
  }
}`,
				}},
				{Kind: "Single", Fetch: &advisorQueryPlanFetch{
					Kind:              "Entity",
					Path:              "storefront.@",
					SubgraphName:      "reviews",
					FetchID:           2,
					DependsOnFetchIDs: []int{0},
					Query:             `query { reviewSummary: reviews { id } }`,
				}},
			}},
		},
	}

	got, err := buildFetchModel(root)
	require.NoError(t, err)
	require.Equal(t, []*advisorFetch{
		{
			fetchID:          0,
			kind:             "Single",
			subgraph:         "catalog",
			fields:           []string{"storefront"},
			clientParentPath: nil,
		},
		{
			fetchID:          1,
			kind:             "Entity",
			subgraph:         "pricing",
			path:             "storefront.@.details",
			dependsOn:        []int{0},
			fields:           []string{"displayPrice", "history"},
			clientParentPath: []string{"storefront", "details"},
		},
		{
			fetchID:          2,
			kind:             "Entity",
			subgraph:         "reviews",
			path:             "storefront.@",
			dependsOn:        []int{0},
			fields:           []string{"reviewSummary"},
			clientParentPath: []string{"storefront"},
		},
	}, got)
	assert.Equal(t, "displayPrice", got[0].clientFieldPath("displayPrice"))
	assert.Equal(t, "storefront.details.displayPrice", got[1].clientFieldPath("displayPrice"))

	// The model owns its dependency slice; later plan mutation cannot alter it.
	root.Children[1].Children[0].Fetch.DependsOnFetchIDs[0] = 99
	assert.Equal(t, []int{0}, got[1].dependsOn)
}

func TestBuildFetchModelRejectsMalformedPlans(t *testing.T) {
	t.Parallel()

	validQuery := `query { product { id } }`
	tests := []struct {
		name string
		root *advisorQueryPlanNode
		err  string
	}{
		{name: "nil root", err: "query plan contains no fetches"},
		{name: "no fetches", root: &advisorQueryPlanNode{Kind: "Sequence"}, err: "query plan contains no fetches"},
		{
			name: "duplicate fetch ids",
			root: &advisorQueryPlanNode{Kind: "Parallel", Children: []*advisorQueryPlanNode{
				{Fetch: &advisorQueryPlanFetch{FetchID: 1, SubgraphName: "a", Query: validQuery}},
				{Fetch: &advisorQueryPlanFetch{FetchID: 1, SubgraphName: "b", Query: validQuery}},
			}},
			err: "query plan contains duplicate fetch id 1",
		},
		{
			name: "missing dependency",
			root: &advisorQueryPlanNode{Fetch: &advisorQueryPlanFetch{
				FetchID: 2, SubgraphName: "reviews", DependsOnFetchIDs: []int{9}, Query: validQuery,
			}},
			err: "fetch 2 (reviews) depends on missing fetch 9",
		},
		{
			name: "dependency cycle",
			root: &advisorQueryPlanNode{Kind: "Sequence", Children: []*advisorQueryPlanNode{
				{Fetch: &advisorQueryPlanFetch{FetchID: 1, SubgraphName: "a", DependsOnFetchIDs: []int{2}, Query: validQuery}},
				{Fetch: &advisorQueryPlanFetch{FetchID: 2, SubgraphName: "b", DependsOnFetchIDs: []int{1}, Query: validQuery}},
			}},
			err: "query plan fetch dependency cycle: 1 -> 2 -> 1",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			_, err := buildFetchModel(tt.root)
			require.EqualError(t, err, tt.err)
		})
	}
}

func TestTopLevelFieldsOfFetchQuery(t *testing.T) {
	t.Parallel()

	t.Run("uses response names and removes duplicates and typename", func(t *testing.T) {
		t.Parallel()

		fields, err := topLevelFieldsOfFetchQuery(`query {
  displayName: name
  displayName: name
  nested { id }
  __typename
}`)
		require.NoError(t, err)
		assert.Equal(t, []string{"displayName", "nested"}, fields)
	})

	t.Run("collects entity fields from inline fragments", func(t *testing.T) {
		t.Parallel()

		fields, err := topLevelFieldsOfFetchQuery(`query ($representations: [_Any!]!) {
  _entities(representations: $representations) {
    ... on Product { price aliasReviews: reviews __typename }
    ... on Service { aliasReviews: reviews status }
  }
}`)
		require.NoError(t, err)
		assert.Equal(t, []string{"price", "aliasReviews", "status"}, fields)
	})

	t.Run("detects entities by field name rather than response name", func(t *testing.T) {
		t.Parallel()

		fields, err := topLevelFieldsOfFetchQuery(`query ($representations: [_Any!]!) {
  entities: _entities(representations: $representations) {
    ... on Product { price }
  }
}`)
		require.NoError(t, err)
		assert.Equal(t, []string{"price"}, fields)

		fields, err = topLevelFieldsOfFetchQuery(`query { _entities: products { id } }`)
		require.NoError(t, err)
		assert.Equal(t, []string{"_entities"}, fields)
	})

	t.Run("accepts fetches with no advisor fields", func(t *testing.T) {
		t.Parallel()

		fields, err := topLevelFieldsOfFetchQuery(`query { __typename }`)
		require.NoError(t, err)
		assert.Empty(t, fields)

		fields, err = topLevelFieldsOfFetchQuery(`query ($representations: [_Any!]!) {
  _entities(representations: $representations) {
    ... on Product { __typename }
  }
}`)
		require.NoError(t, err)
		assert.Empty(t, fields)
	})

	t.Run("rejects invalid or ambiguous operations", func(t *testing.T) {
		t.Parallel()

		_, err := topLevelFieldsOfFetchQuery(`query Broken {`)
		require.EqualError(t, err, "failed to parse fetch query: external: unexpected token - got: EOF want one of: [RBRACE IDENT SPREAD], locations: [{Line:0 Column:0}], path: []")

		_, err = topLevelFieldsOfFetchQuery(`query A { a } query B { b }`)
		require.EqualError(t, err, "fetch query must contain exactly one operation, got 2")

		_, err = topLevelFieldsOfFetchQuery(`fragment Only on Product { id }`)
		require.EqualError(t, err, "fetch query must contain exactly one operation, got 0")
	})

	t.Run("rejects entities without a selection set", func(t *testing.T) {
		t.Parallel()

		_, err := topLevelFieldsOfFetchQuery(`query { _entities }`)
		require.EqualError(t, err, "_entities has no selections")
	})
}

func TestMergeTraceDurationsJoinsByPlanIdentity(t *testing.T) {
	t.Parallel()

	fetches := []*advisorFetch{
		{fetchID: 0, kind: "Single", subgraph: "catalog", durationsMs: []float64{8}},
		{fetchID: 1, kind: "Entity", subgraph: "pricing", path: "storefront.@"},
	}
	trace := &advisorTraceNode{Kind: "Sequence", Children: []*advisorTraceNode{
		{Kind: "Single", Fetch: &advisorTraceFetch{
			Kind: "Single", SourceName: "catalog", Trace: &advisorLoadTrace{DurationLoadNano: 10_000_000},
		}},
		{Kind: "Single", Fetch: &advisorTraceFetch{
			Kind: "Entity", Path: "storefront.@", SourceName: "pricing", Trace: &advisorLoadTrace{DurationLoadNano: 250_500_000},
		}},
	}}

	require.NoError(t, mergeTraceDurations(fetches, trace))
	assert.Equal(t, []float64{8, 10}, fetches[0].durationsMs)
	assert.Equal(t, []float64{250.5}, fetches[1].durationsMs)
}

func TestMergeTraceDurationsUsesSingularBatchEntityTrace(t *testing.T) {
	t.Parallel()

	fetches := []*advisorFetch{{
		fetchID: 3, kind: "BatchEntity", subgraph: "products", path: "items.@",
	}}
	trace := &advisorTraceNode{Fetch: &advisorTraceFetch{
		Kind:       "BatchEntity",
		Path:       "items.@",
		SourceName: "products",
		Trace:      &advisorLoadTrace{DurationLoadNano: 12_250_000},
	}}

	require.NoError(t, mergeTraceDurations(fetches, trace))
	assert.Equal(t, []float64{12.25}, fetches[0].durationsMs)
}

func TestMergeTraceDurationsRejectsInvalidTraceWithoutPartialMutation(t *testing.T) {
	t.Parallel()

	t.Run("count mismatch", func(t *testing.T) {
		t.Parallel()

		err := mergeTraceDurations([]*advisorFetch{{fetchID: 1, subgraph: "a"}}, nil)
		require.EqualError(t, err, "trace has 0 fetches, query plan has 1")
	})

	t.Run("identity mismatch is atomic", func(t *testing.T) {
		t.Parallel()

		fetches := []*advisorFetch{
			{fetchID: 0, kind: "Single", subgraph: "catalog"},
			{fetchID: 1, kind: "Entity", subgraph: "pricing", path: "storefront.@"},
		}
		trace := &advisorTraceNode{Children: []*advisorTraceNode{
			{Fetch: &advisorTraceFetch{Kind: "Single", SourceName: "catalog", Trace: &advisorLoadTrace{DurationLoadNano: 1_000_000}}},
			{Fetch: &advisorTraceFetch{Kind: "Entity", Path: "storefront.@", SourceName: "reviews", Trace: &advisorLoadTrace{DurationLoadNano: 2_000_000}}},
		}}

		err := mergeTraceDurations(fetches, trace)
		require.EqualError(t, err, `trace fetch 2 identity (Entity, "storefront.@", "reviews") does not match query plan fetch 1 (Entity, "storefront.@", "pricing")`)
		assert.Nil(t, fetches[0].durationsMs)
		assert.Nil(t, fetches[1].durationsMs)
	})

	t.Run("equal-size reordered trace is rejected atomically", func(t *testing.T) {
		t.Parallel()

		fetches := []*advisorFetch{
			{fetchID: 0, kind: "Single", subgraph: "catalog"},
			{fetchID: 1, kind: "Entity", subgraph: "pricing", path: "storefront.@"},
		}
		trace := &advisorTraceNode{Children: []*advisorTraceNode{
			{Fetch: &advisorTraceFetch{Kind: "Entity", Path: "storefront.@", SourceName: "pricing", Trace: &advisorLoadTrace{DurationLoadNano: 2_000_000}}},
			{Fetch: &advisorTraceFetch{Kind: "Single", SourceName: "catalog", Trace: &advisorLoadTrace{DurationLoadNano: 1_000_000}}},
		}}

		err := mergeTraceDurations(fetches, trace)
		require.EqualError(t, err, `trace fetch 1 identity (Entity, "storefront.@", "pricing") does not match query plan fetch 0 (Single, "", "catalog")`)
		assert.Nil(t, fetches[0].durationsMs)
		assert.Nil(t, fetches[1].durationsMs)
	})

	t.Run("missing singular load trace", func(t *testing.T) {
		t.Parallel()

		fetches := []*advisorFetch{{fetchID: 4, kind: "BatchEntity", subgraph: "products", path: "items.@"}}
		trace := &advisorTraceNode{Fetch: &advisorTraceFetch{
			Kind: "BatchEntity", Path: "items.@", SourceName: "products",
			Traces: []*advisorLoadTrace{{DurationLoadNano: 3_000_000}},
		}}

		err := mergeTraceDurations(fetches, trace)
		require.EqualError(t, err, "fetch 4 (products) has no singular load trace")
		assert.Nil(t, fetches[0].durationsMs)
	})

	t.Run("singular and legacy plural load traces are ambiguous", func(t *testing.T) {
		t.Parallel()

		fetches := []*advisorFetch{{fetchID: 4, kind: "BatchEntity", subgraph: "products", path: "items.@"}}
		trace := &advisorTraceNode{Fetch: &advisorTraceFetch{
			Kind:       "BatchEntity",
			Path:       "items.@",
			SourceName: "products",
			Trace:      &advisorLoadTrace{DurationLoadNano: 2_000_000},
			Traces:     []*advisorLoadTrace{{DurationLoadNano: 3_000_000}},
		}}

		err := mergeTraceDurations(fetches, trace)
		require.EqualError(t, err, "fetch 4 (products) has both singular and legacy plural load traces")
		assert.Nil(t, fetches[0].durationsMs)
	})
}
