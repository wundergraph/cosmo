package core

import (
	"encoding/json"
	"slices"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func repeatedAdvisorSamples(runs int, value float64) []float64 {
	values := make([]float64, runs)
	for i := range values {
		values[i] = value
	}
	return values
}

func advisorAnalysisFetch(id int, subgraph string, dependsOn []int, parentPath []string, duration float64, fields map[string]float64, runs int) *advisorFetch {
	names := make([]string, 0, len(fields))
	latencies := make(map[string][]float64, len(fields))
	for name, value := range fields {
		names = append(names, name)
		latencies[name] = repeatedAdvisorSamples(runs, value)
	}
	slices.Sort(names)
	return &advisorFetch{
		fetchID:          id,
		subgraph:         subgraph,
		dependsOn:        slices.Clone(dependsOn),
		fields:           names,
		clientParentPath: slices.Clone(parentPath),
		durationsMs:      repeatedAdvisorSamples(runs, duration),
		fieldLatenciesMs: latencies,
	}
}

func advisorDemoFetches(base float64, runs int) []*advisorFetch {
	return []*advisorFetch{
		{fetchID: 0, subgraph: "catalog", fields: []string{"storefront"}, durationsMs: repeatedAdvisorSamples(runs, base+10)},
		advisorAnalysisFetch(1, "pricing", []int{0}, []string{"storefront"}, base+700, map[string]float64{"price": base + 30, "priceHistory": base + 700}, runs),
		advisorAnalysisFetch(2, "reviews", []int{0}, []string{"storefront"}, base+250, map[string]float64{"reviews": base + 250, "ratingSummary": base + 40}, runs),
	}
}

func TestBuildAdvisorResultSelectsSlowFields(t *testing.T) {
	t.Parallel()

	fetches := advisorDemoFetches(0, 1)
	result, err := buildAdvisorResult(1, []float64{710}, fetches)
	require.NoError(t, err)

	assert.Equal(t, []deferAdvisorSuggestion{
		{Label: "pricing:storefront:priceHistory", Path: "storefront", Subgraph: "pricing", Fields: []string{"priceHistory"}},
		{Label: "reviews:storefront:reviews", Path: "storefront", Subgraph: "reviews", Fields: []string{"reviews"}},
	}, result.Suggestions)
	assert.Equal(t, deferAdvisorStat{AvgMs: 710, MinMs: 710, MaxMs: 710}, result.TotalDurationMs)
	assert.Equal(t, []deferAdvisorFieldStats{
		{Path: "storefront.priceHistory", Subgraph: "pricing", LatencyMs: deferAdvisorStat{AvgMs: 700, MinMs: 700, MaxMs: 700}},
		{Path: "storefront.reviews", Subgraph: "reviews", LatencyMs: deferAdvisorStat{AvgMs: 250, MinMs: 250, MaxMs: 250}},
		{Path: "storefront.ratingSummary", Subgraph: "reviews", LatencyMs: deferAdvisorStat{AvgMs: 40, MinMs: 40, MaxMs: 40}},
		{Path: "storefront.price", Subgraph: "pricing", LatencyMs: deferAdvisorStat{AvgMs: 30, MinMs: 30, MaxMs: 30}},
	}, result.Fields)

	result.Fetches[1].DependsOn[0] = 99
	result.Fetches[1].Fields[0] = "changed"
	assert.Equal(t, []int{0}, fetches[1].dependsOn)
	assert.Equal(t, []string{"price", "priceHistory"}, fetches[1].fields)

	encoded, err := json.Marshal(result)
	require.NoError(t, err)
	assert.NotContains(t, string(encoded), "estimatedInitialResponseSavingMs")
	assert.NotContains(t, string(encoded), "estimatedOptimizedInitialResponseMs")
}

func TestBuildAdvisorResultIsInvariantToUniformNetworkBase(t *testing.T) {
	t.Parallel()

	for _, base := range []float64{0, 3_000} {
		base := base
		t.Run(roundTripBaseName(base), func(t *testing.T) {
			t.Parallel()

			result, err := buildAdvisorResult(1, []float64{710 + 2*base}, advisorDemoFetches(base, 1))
			require.NoError(t, err)
			assert.Equal(t, []deferAdvisorSuggestion{
				{Label: "pricing:storefront:priceHistory", Path: "storefront", Subgraph: "pricing", Fields: []string{"priceHistory"}},
				{Label: "reviews:storefront:reviews", Path: "storefront", Subgraph: "reviews", Fields: []string{"reviews"}},
			}, result.Suggestions)
		})
	}
}

func roundTripBaseName(base float64) string {
	if base == 0 {
		return "base_zero"
	}
	return "large_base"
}

func TestBuildAdvisorResultOrdersEqualCandidatesDeterministically(t *testing.T) {
	t.Parallel()

	fetches := []*advisorFetch{
		{fetchID: 0, subgraph: "catalog", fields: []string{"root"}, durationsMs: []float64{0}},
		advisorAnalysisFetch(1, "subA", []int{0}, []string{"root"}, 50, map[string]float64{"a": 50}, 1),
		advisorAnalysisFetch(2, "subB", []int{0}, []string{"root"}, 50, map[string]float64{"b": 50}, 1),
		advisorAnalysisFetch(3, "subC", []int{0}, []string{"root"}, 50, map[string]float64{"c": 50}, 1),
	}
	result, err := buildAdvisorResult(1, []float64{50}, fetches)
	require.NoError(t, err)

	assert.Equal(t, []deferAdvisorSuggestion{
		{Label: "subA:root:a", Path: "root", Subgraph: "subA", Fields: []string{"a"}},
		{Label: "subB:root:b", Path: "root", Subgraph: "subB", Fields: []string{"b"}},
		{Label: "subC:root:c", Path: "root", Subgraph: "subC", Fields: []string{"c"}},
	}, result.Suggestions)
}

func TestBuildAdvisorResultClustersByExcessLatency(t *testing.T) {
	t.Parallel()

	for _, base := range []float64{0, 3_000} {
		joined, err := buildAdvisorResult(1, []float64{510 + 2*base}, []*advisorFetch{
			{fetchID: 0, subgraph: "root", fields: []string{"root"}, durationsMs: []float64{base + 10}},
			advisorAnalysisFetch(1, "details", []int{0}, []string{"root"}, base+500, map[string]float64{"a": base + 500, "b": base + 390}, 1),
		})
		require.NoError(t, err)
		assert.Equal(t, []deferAdvisorSuggestion{{
			Label: "details:root:a", Path: "root", Subgraph: "details", Fields: []string{"a", "b"},
		}}, joined.Suggestions)

		separate, err := buildAdvisorResult(1, []float64{510 + 2*base}, []*advisorFetch{
			{fetchID: 0, subgraph: "root", fields: []string{"root"}, durationsMs: []float64{base + 10}},
			advisorAnalysisFetch(1, "details", []int{0}, []string{"root"}, base+500, map[string]float64{"a": base + 500, "b": base + 350}, 1),
		})
		require.NoError(t, err)
		assert.Equal(t, []deferAdvisorSuggestion{
			{Label: "details:root:a", Path: "root", Subgraph: "details", Fields: []string{"a"}},
			{Label: "details:root:b", Path: "root", Subgraph: "details", Fields: []string{"b"}},
		}, separate.Suggestions)
	}
}

func TestBuildAdvisorResultRejectsInvalidMeasurements(t *testing.T) {
	t.Parallel()

	result, err := buildAdvisorResult(0, nil, nil)

	assert.Nil(t, result)
	require.EqualError(t, err, "advisor runs must be positive")
}

func TestBuildAdvisorResultRejectsInvalidFetchGraph(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		fetches []*advisorFetch
		err     string
	}{
		{
			name: "duplicate fetch id",
			fetches: []*advisorFetch{
				{fetchID: 1, subgraph: "a", fields: []string{"a"}, durationsMs: []float64{5}},
				{fetchID: 1, subgraph: "b", fields: []string{"b"}, durationsMs: []float64{5}},
			},
			err: "advisor fetch model contains duplicate fetch id 1",
		},
		{
			name: "missing dependency",
			fetches: []*advisorFetch{
				{fetchID: 1, subgraph: "a", dependsOn: []int{9}, fields: []string{"a"}, durationsMs: []float64{5}},
			},
			err: "advisor fetch 1 (a) depends on missing fetch 9",
		},
		{
			name: "dependency cycle",
			fetches: []*advisorFetch{
				{fetchID: 1, subgraph: "a", dependsOn: []int{2}, fields: []string{"a"}, durationsMs: []float64{5}},
				{fetchID: 2, subgraph: "b", dependsOn: []int{1}, fields: []string{"b"}, durationsMs: []float64{5}},
			},
			err: "advisor fetch model is invalid: query plan fetch dependency cycle: 1 -> 2 -> 1",
		},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			result, err := buildAdvisorResult(1, []float64{10}, test.fetches)

			assert.Nil(t, result)
			require.EqualError(t, err, test.err)
		})
	}
}

func TestBuildAdvisorResultHandlesFallbackAndUnsupportedDepthConservatively(t *testing.T) {
	t.Parallel()

	t.Run("fetch-only fallback", func(t *testing.T) {
		t.Parallel()

		fetches := []*advisorFetch{
			{fetchID: 0, subgraph: "catalog", fields: []string{"root"}, durationsMs: []float64{10}},
			{fetchID: 1, subgraph: "pricing", dependsOn: []int{0}, fields: []string{"price"}, durationsMs: []float64{500}},
		}
		result, err := buildAdvisorResult(1, []float64{510}, fetches)
		require.NoError(t, err)
		assert.Empty(t, result.Fields)
		assert.Empty(t, result.Suggestions)
	})

	t.Run("depth two fields are reported but not suggested", func(t *testing.T) {
		t.Parallel()

		fetches := []*advisorFetch{
			{fetchID: 0, subgraph: "root", fields: []string{"root"}, durationsMs: []float64{10}},
			advisorAnalysisFetch(1, "parent", []int{0}, []string{"root"}, 20, map[string]float64{"child": 20}, 1),
			advisorAnalysisFetch(2, "deep", []int{1}, []string{"root", "child"}, 700, map[string]float64{"slow": 700}, 1),
		}
		result, err := buildAdvisorResult(1, []float64{730}, fetches)
		require.NoError(t, err)
		assert.Len(t, result.Fields, 2)
		assert.Empty(t, result.Suggestions)
	})
}

func TestBuildAdvisorResultCapsSplitLatencyAtBaselineFetchDuration(t *testing.T) {
	t.Parallel()

	fetches := []*advisorFetch{
		{fetchID: 0, subgraph: "root", fields: []string{"root"}, durationsMs: []float64{10}},
		advisorAnalysisFetch(1, "details", []int{0}, []string{"root"}, 100, map[string]float64{"keep": 200, "slow": 500}, 1),
	}
	result, err := buildAdvisorResult(1, []float64{110}, fetches)
	require.NoError(t, err)
	assert.Equal(t, []deferAdvisorSuggestion{{
		Label: "details:root:keep", Path: "root", Subgraph: "details", Fields: []string{"keep", "slow"},
	}}, result.Suggestions)
}

func TestBuildAdvisorResultDoesNotPublishModeledSavings(t *testing.T) {
	t.Parallel()

	// Isolated max-split timings cannot prove how long b+c take when fetched
	// together, so they select a but must never become a public TTFB estimate.
	fetches := []*advisorFetch{
		{fetchID: 0, subgraph: "root", fields: []string{"root"}, durationsMs: []float64{10}},
		advisorAnalysisFetch(1, "details", []int{0}, []string{"root"}, 500, map[string]float64{"a": 500, "b": 80, "c": 80}, 1),
	}
	result, err := buildAdvisorResult(1, []float64{510}, fetches)
	require.NoError(t, err)
	assert.Equal(t, []deferAdvisorSuggestion{{
		Label: "details:root:a", Path: "root", Subgraph: "details", Fields: []string{"a"},
	}}, result.Suggestions)

	encoded, err := json.Marshal(result)
	require.NoError(t, err)
	assert.NotContains(t, string(encoded), "estimated")
}

func TestBuildAdvisorResultDropsZeroMarginalSuggestions(t *testing.T) {
	t.Parallel()

	t.Run("keeps only the candidate that shortens the critical path", func(t *testing.T) {
		t.Parallel()

		fetches := []*advisorFetch{
			{fetchID: 0, subgraph: "root", fields: []string{"root"}, durationsMs: []float64{10}},
			advisorAnalysisFetch(1, "critical", []int{0}, []string{"root"}, 500, map[string]float64{"a": 500}, 1),
			advisorAnalysisFetch(2, "shorter", []int{0}, []string{"root"}, 400, map[string]float64{"b": 400}, 1),
			{fetchID: 3, subgraph: "blocker", dependsOn: []int{0}, fields: []string{"c"}, durationsMs: []float64{450}},
		}
		result, err := buildAdvisorResult(1, []float64{510}, fetches)
		require.NoError(t, err)

		assert.Equal(t, []deferAdvisorSuggestion{{
			Label: "critical:root:a", Path: "root", Subgraph: "critical", Fields: []string{"a"},
		}}, result.Suggestions)
	})

	t.Run("drops every candidate when an unsupported fetch remains critical", func(t *testing.T) {
		t.Parallel()

		fetches := []*advisorFetch{
			{fetchID: 0, subgraph: "root", fields: []string{"root"}, durationsMs: []float64{10}},
			advisorAnalysisFetch(1, "shorter", []int{0}, []string{"root"}, 500, map[string]float64{"a": 500}, 1),
			{fetchID: 2, subgraph: "blocker", dependsOn: []int{0}, fields: []string{"b"}, durationsMs: []float64{600}},
		}
		result, err := buildAdvisorResult(1, []float64{610}, fetches)
		require.NoError(t, err)

		assert.Empty(t, result.Suggestions)
	})
}

func TestBuildAdvisorResultMinimizesTheJointlyUsefulPortfolio(t *testing.T) {
	t.Parallel()

	t.Run("keeps complementary candidates", func(t *testing.T) {
		t.Parallel()

		fetches := []*advisorFetch{
			{fetchID: 0, subgraph: "rootA", fields: []string{"rootA"}, durationsMs: []float64{0}},
			advisorAnalysisFetch(1, "childA", []int{0}, []string{"rootA"}, 500, map[string]float64{"a": 500}, 1),
			{fetchID: 2, subgraph: "rootB", fields: []string{"rootB"}, durationsMs: []float64{200}},
			advisorAnalysisFetch(3, "childB", []int{2}, []string{"rootB"}, 300, map[string]float64{"b": 300}, 1),
		}
		result, err := buildAdvisorResult(1, []float64{500}, fetches)
		require.NoError(t, err)

		assert.Equal(t, []deferAdvisorSuggestion{
			{Label: "childA:rootA:a", Path: "rootA", Subgraph: "childA", Fields: []string{"a"}},
			{Label: "childB:rootB:b", Path: "rootB", Subgraph: "childB", Fields: []string{"b"}},
		}, result.Suggestions)
	})

	t.Run("removes a redundant candidate inside a tied tier", func(t *testing.T) {
		t.Parallel()

		root := &advisorFetch{fetchID: 0, subgraph: "root", fields: []string{"root"}, durationsMs: []float64{10}}
		standalone := advisorAnalysisFetch(1, "standalone", []int{0}, []string{"root"}, 100, map[string]float64{"a": 100}, 1)
		parent := advisorAnalysisFetch(2, "parent", []int{0}, []string{"root"}, 100, map[string]float64{"b": 100}, 1)
		descendant := &advisorFetch{fetchID: 3, subgraph: "descendant", dependsOn: []int{2}, fields: []string{"c"}, durationsMs: []float64{1_000}}
		expected := []deferAdvisorSuggestion{{
			Label: "parent:root:b", Path: "root", Subgraph: "parent", Fields: []string{"b"},
		}}

		for _, fetches := range [][]*advisorFetch{
			{root, standalone, parent, descendant},
			{descendant, parent, standalone, root},
		} {
			result, err := buildAdvisorResult(1, []float64{1_110}, fetches)
			require.NoError(t, err)
			assert.Equal(t, expected, result.Suggestions)
		}
	})
}

func TestCriticalPathMs(t *testing.T) {
	t.Parallel()

	root := &advisorFetch{fetchID: 0, durationsMs: []float64{10}}
	left := &advisorFetch{fetchID: 1, dependsOn: []int{0}, durationsMs: []float64{40}}
	right := &advisorFetch{fetchID: 2, dependsOn: []int{0}, durationsMs: []float64{30}}
	join := &advisorFetch{fetchID: 3, dependsOn: []int{1, 2}, durationsMs: []float64{5}}
	weight := func(fetch *advisorFetch) float64 { return avgOf(fetch.durationsMs) }

	assert.Equal(t, 55.0, criticalPathMs([]*advisorFetch{root, left, right, join}, weight))
	assert.Equal(t, 55.0, criticalPathMs([]*advisorFetch{join, right, left, root}, weight))
}

func TestDeferSuggestionLabelEscapesSubgraphDelimiter(t *testing.T) {
	t.Parallel()

	assert.Equal(t, "reviews:storefront:stars", deferSuggestionLabel("reviews", "storefront", "stars"))
	assert.Equal(t, "a%3Ab:c", deferSuggestionLabel("a:b", "", "c"))
	assert.NotEqual(t, deferSuggestionLabel("a:b", "", "c"), deferSuggestionLabel("a", "b", "c"))
	assert.NotEqual(t, deferSuggestionLabel("a:b", "", "c"), deferSuggestionLabel("a%3Ab", "", "c"))
}
