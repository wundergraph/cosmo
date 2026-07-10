package core

import (
	"math"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAdvisorStats(t *testing.T) {
	t.Parallel()

	assert.Equal(t, deferAdvisorStat{}, statOf(nil))
	assert.Equal(t, deferAdvisorStat{AvgMs: 2.35, MinMs: 1.11, MaxMs: 3.59}, statOf([]float64{1.111, 2.345, 3.594}))
	assert.Equal(t, 0.0, avgOf(nil))
	assert.Equal(t, 2.5, avgOf([]float64{2, 3}))
	assert.Equal(t, 1.24, roundMs(1.236))
}

func TestAdvisorLatencyFloorUsesProductionMeasurements(t *testing.T) {
	t.Parallel()

	fetches := []*advisorFetch{
		{fetchID: 0, subgraph: "catalog", durationsMs: []float64{110, 110}},
		{
			fetchID: 1, subgraph: "pricing", dependsOn: []int{0}, durationsMs: []float64{700, 700},
			fields: []string{"price", "history"},
			fieldLatenciesMs: map[string][]float64{
				"price":   {200, 200},
				"history": {730, 730},
			},
		},
	}

	assert.Equal(t, 110.0, advisorLatencyFloor(fetches))
	assert.Equal(t, 0.0, advisorLatencyFloor(nil))
}

func TestAdvisorFieldIdentityIncludesClientPath(t *testing.T) {
	t.Parallel()

	assert.Equal(t, "reviews:stars", advisorFieldIdentity(&advisorFetch{subgraph: "reviews"}, "stars").String())
	assert.Equal(t, "reviews:storefront.product:stars", advisorFieldIdentity(&advisorFetch{
		subgraph: "reviews", clientParentPath: []string{"storefront", "product"},
	}, "stars").String())
	assert.NotEqual(t,
		advisorFieldIdentity(&advisorFetch{subgraph: "a:b"}, "c"),
		advisorFieldIdentity(&advisorFetch{subgraph: "a", clientParentPath: []string{"b"}}, "c"),
	)
}

func TestValidateAdvisorMeasurementsAcceptsCompleteOrFetchOnlySamples(t *testing.T) {
	t.Parallel()

	t.Run("complete split samples", func(t *testing.T) {
		t.Parallel()

		err := validateAdvisorMeasurements(2, []float64{710, 712}, []*advisorFetch{
			{fetchID: 0, subgraph: "catalog", fields: []string{"storefront"}, durationsMs: []float64{10, 11}},
			{
				fetchID: 1, subgraph: "pricing", dependsOn: []int{0}, fields: []string{"price", "history"}, durationsMs: []float64{700, 701},
				fieldLatenciesMs: map[string][]float64{"price": {30, 31}, "history": {700, 701}},
			},
		})
		require.NoError(t, err)
	})

	t.Run("fetch-only fallback", func(t *testing.T) {
		t.Parallel()

		err := validateAdvisorMeasurements(1, []float64{710}, []*advisorFetch{
			{fetchID: 0, subgraph: "catalog", fields: []string{"storefront"}, durationsMs: []float64{10}},
			{fetchID: 1, subgraph: "pricing", dependsOn: []int{0}, fields: []string{"price", "history"}, durationsMs: []float64{700}},
		})
		require.NoError(t, err)
	})

	t.Run("fetch-only fallback does not require field identity ownership", func(t *testing.T) {
		t.Parallel()

		err := validateAdvisorMeasurements(1, []float64{710}, []*advisorFetch{
			{fetchID: 0, subgraph: "catalog", fields: []string{"storefront"}, durationsMs: []float64{10}},
			{fetchID: 1, subgraph: "reviews", dependsOn: []int{0}, fields: []string{"stars"}, clientParentPath: []string{"storefront"}, durationsMs: []float64{250}},
			{fetchID: 2, subgraph: "reviews", dependsOn: []int{0}, fields: []string{"stars"}, clientParentPath: []string{"storefront"}, durationsMs: []float64{260}},
		})
		require.NoError(t, err)
	})

	t.Run("typed identities distinguish colons in subgraph names", func(t *testing.T) {
		t.Parallel()

		err := validateAdvisorMeasurements(1, []float64{710}, []*advisorFetch{
			{fetchID: 0, subgraph: "catalog", fields: []string{"storefront"}, durationsMs: []float64{10}},
			{fetchID: 1, subgraph: "a:b", dependsOn: []int{0}, fields: []string{"c"}, durationsMs: []float64{250}, fieldLatenciesMs: map[string][]float64{"c": {250}}},
			{fetchID: 2, subgraph: "a", dependsOn: []int{0}, fields: []string{"c"}, clientParentPath: []string{"b"}, durationsMs: []float64{260}, fieldLatenciesMs: map[string][]float64{"c": {260}}},
		})
		require.NoError(t, err)
	})
}

func TestValidateAdvisorMeasurementsRejectsInvalidSamples(t *testing.T) {
	t.Parallel()

	validRoot := func() *advisorFetch {
		return &advisorFetch{fetchID: 0, subgraph: "catalog", fields: []string{"storefront"}, durationsMs: []float64{10, 11}}
	}
	validDependent := func() *advisorFetch {
		return &advisorFetch{
			fetchID: 1, subgraph: "pricing", dependsOn: []int{0}, fields: []string{"price", "history"}, durationsMs: []float64{700, 701},
			fieldLatenciesMs: map[string][]float64{"price": {30, 31}, "history": {700, 701}},
		}
	}

	t.Run("runs", func(t *testing.T) {
		t.Parallel()
		err := validateAdvisorMeasurements(0, nil, []*advisorFetch{validRoot()})
		require.EqualError(t, err, "advisor runs must be positive")
	})

	t.Run("empty model", func(t *testing.T) {
		t.Parallel()
		err := validateAdvisorMeasurements(1, []float64{1}, nil)
		require.EqualError(t, err, "advisor fetch model is empty")
	})

	t.Run("total count", func(t *testing.T) {
		t.Parallel()
		err := validateAdvisorMeasurements(2, []float64{710}, []*advisorFetch{validRoot()})
		require.EqualError(t, err, "advisor total sample count 1 does not match runs 2")
	})

	t.Run("total value", func(t *testing.T) {
		t.Parallel()
		err := validateAdvisorMeasurements(2, []float64{710, math.NaN()}, []*advisorFetch{validRoot()})
		require.EqualError(t, err, "advisor total sample 2 must be finite and non-negative")
	})

	t.Run("nil fetch", func(t *testing.T) {
		t.Parallel()
		err := validateAdvisorMeasurements(2, []float64{710, 711}, []*advisorFetch{validRoot(), nil})
		require.EqualError(t, err, "advisor fetch 2 is nil")
	})

	t.Run("duration count", func(t *testing.T) {
		t.Parallel()
		dependent := validDependent()
		dependent.durationsMs = []float64{700}
		err := validateAdvisorMeasurements(2, []float64{710, 711}, []*advisorFetch{validRoot(), dependent})
		require.EqualError(t, err, "fetch 1 (pricing) duration sample count 1 does not match runs 2")
	})

	t.Run("duration value", func(t *testing.T) {
		t.Parallel()
		dependent := validDependent()
		dependent.durationsMs[1] = math.Inf(1)
		err := validateAdvisorMeasurements(2, []float64{710, 711}, []*advisorFetch{validRoot(), dependent})
		require.EqualError(t, err, "fetch 1 (pricing) duration sample 2 must be finite and non-negative")
	})

	t.Run("unknown field", func(t *testing.T) {
		t.Parallel()
		dependent := validDependent()
		dependent.fieldLatenciesMs["missing"] = []float64{1, 1}
		err := validateAdvisorMeasurements(2, []float64{710, 711}, []*advisorFetch{validRoot(), dependent})
		require.EqualError(t, err, `fetch 1 (pricing) has samples for unknown field "missing"`)
	})

	t.Run("root field samples", func(t *testing.T) {
		t.Parallel()
		root := validRoot()
		root.fieldLatenciesMs = map[string][]float64{"storefront": {10, 11}}
		err := validateAdvisorMeasurements(2, []float64{710, 711}, []*advisorFetch{root, validDependent()})
		require.EqualError(t, err, "root fetch 0 (catalog) has unexpected field samples")
	})

	t.Run("partial field count", func(t *testing.T) {
		t.Parallel()
		dependent := validDependent()
		dependent.fieldLatenciesMs["price"] = []float64{30}
		err := validateAdvisorMeasurements(2, []float64{710, 711}, []*advisorFetch{validRoot(), dependent})
		require.EqualError(t, err, `fetch 1 (pricing) field "price" sample count 1 does not match runs 2`)
	})

	t.Run("mixed measured and unmeasured fields", func(t *testing.T) {
		t.Parallel()
		dependent := validDependent()
		delete(dependent.fieldLatenciesMs, "price")
		err := validateAdvisorMeasurements(2, []float64{710, 711}, []*advisorFetch{validRoot(), dependent})
		require.EqualError(t, err, "fetch 1 (pricing) has incomplete field measurements: 1 of 2 fields sampled")
	})

	t.Run("explicit empty field samples are not fetch-only", func(t *testing.T) {
		t.Parallel()
		dependent := validDependent()
		dependent.fieldLatenciesMs = map[string][]float64{"price": {}, "history": {}}
		err := validateAdvisorMeasurements(2, []float64{710, 711}, []*advisorFetch{validRoot(), dependent})
		require.EqualError(t, err, `fetch 1 (pricing) field "price" sample count 0 does not match runs 2`)
	})

	t.Run("field value", func(t *testing.T) {
		t.Parallel()
		dependent := validDependent()
		dependent.fieldLatenciesMs["price"][0] = -1
		err := validateAdvisorMeasurements(2, []float64{710, 711}, []*advisorFetch{validRoot(), dependent})
		require.EqualError(t, err, `fetch 1 (pricing) field "price" sample 1 must be finite and non-negative`)
	})

	t.Run("duplicate public field identity", func(t *testing.T) {
		t.Parallel()
		left := validDependent()
		left.fields = []string{"price"}
		left.fieldLatenciesMs = map[string][]float64{"price": {30, 31}}
		right := validDependent()
		right.fetchID = 2
		right.fields = []string{"price"}
		right.fieldLatenciesMs = map[string][]float64{"price": {32, 33}}
		err := validateAdvisorMeasurements(2, []float64{710, 711}, []*advisorFetch{validRoot(), left, right})
		require.EqualError(t, err, `fetches 1 and 2 share advisor field identity "pricing:price"`)
	})
}
