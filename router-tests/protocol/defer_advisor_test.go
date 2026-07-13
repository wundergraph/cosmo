package integration

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// advisorMilestonesMs are the expected timing values of the defer demo, derived
// from demo/pkg/subgraphs/deferdemo latencies: catalog.storefront 10ms,
// pricing.price 30ms, pricing.priceHistory 700ms, reviews.reviews 250ms,
// reviews.ratingSummary 40ms. Derived values: optimized initial =
// 10+max(30,40) = 50; baseline total = 10+700 = 710; reviews part arrival =
// 50+250 = 300; priceHistory part arrival = 50+700 = 750; marginal saving of
// deferring only priceHistory = 710-(10+250) = 450.
var advisorMilestonesMs = []float64{0, 10, 30, 40, 50, 250, 300, 660, 700, 710, 750}

// normalizeAdvisorMs snaps a measured duration to the nearest milestone when
// within tolerance (30% + 20ms of scheduling/transport overhead); out-of-range
// values stay raw so the full-struct equality assertion fails with the actual
// number.
func normalizeAdvisorMs(v float64) float64 {
	best, bestDistance := v, -1.0
	for _, m := range advisorMilestonesMs {
		distance := max(v-m, m-v)
		if distance <= m*0.3+20 && (bestDistance < 0 || distance < bestDistance) {
			best, bestDistance = m, distance
		}
	}
	return best
}

type advisorStatView struct {
	AvgMs float64 `json:"avgMs"`
	MinMs float64 `json:"minMs"`
	MaxMs float64 `json:"maxMs"`
}

type advisorExtension struct {
	Outcome         string          `json:"outcome"`
	Reason          string          `json:"reason"`
	Runs            int             `json:"runs"`
	TotalDurationMs advisorStatView `json:"totalDurationMs"`
	Fetches         []struct {
		FetchID    int             `json:"fetchId"`
		Subgraph   string          `json:"subgraph"`
		Path       string          `json:"path"`
		DependsOn  []int           `json:"dependsOn"`
		DurationMs advisorStatView `json:"durationMs"`
		Fields     []string        `json:"fields"`
	} `json:"fetches"`
	Fields []struct {
		Path      string          `json:"path"`
		Subgraph  string          `json:"subgraph"`
		LatencyMs advisorStatView `json:"latencyMs"`
	} `json:"fields"`
	Suggestions []struct {
		Label    string   `json:"label"`
		Path     string   `json:"path"`
		Subgraph string   `json:"subgraph"`
		Fields   []string `json:"fields"`
	} `json:"suggestions"`
	OptimizedQuery string `json:"optimizedQuery"`
	Validation     struct {
		Runs                    int             `json:"runs"`
		InitialResponseMs       advisorStatView `json:"initialResponseMs"`
		TotalResponseMs         advisorStatView `json:"totalResponseMs"`
		InitialResponseSavingMs advisorStatView `json:"initialResponseSavingMs"`
		DeferredParts           []struct {
			Label       string          `json:"label"`
			ArrivedAtMs advisorStatView `json:"arrivedAtMs"`
		} `json:"deferredParts"`
	} `json:"validation"`
}

// advisorFetchView etc. are the normalized shapes the test asserts on: timings
// snapped to milestones, min/max jitter dropped.
type advisorFetchView struct {
	FetchID    int
	Subgraph   string
	Path       string
	DependsOn  []int
	DurationMs float64
	Fields     []string
}

type advisorFieldView struct {
	Path      string
	Subgraph  string
	LatencyMs float64
}

type advisorSuggestionView struct {
	Label    string
	Path     string
	Subgraph string
	Fields   []string
}

type advisorPartView struct {
	Label       string
	ArrivedAtMs float64
}

type advisorView struct {
	Outcome            string
	Runs               int
	TotalMs            float64
	Fetches            []advisorFetchView
	Fields             []advisorFieldView
	Suggestions        []advisorSuggestionView
	OptimizedInitialMs float64
	OptimizedQuery     string
	ValidationInitial  float64
	ValidationTotal    float64
	ValidationSaving   float64
	ValidationParts    []advisorPartView
}

// TestFlakyDeferAdvisor asserts timing-derived advisor milestones that can drift
// under parallel CI load (CPU contention), so it runs in the retried TestFlaky pass.
func TestFlakyDeferAdvisor(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{
		RouterConfigJSONTemplate: testenv.ConfigDeferDemoJSONTemplate,
		EnableDeferDemoSubgraphs: true,
		ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
			cfg.EnableRequestTracing = true
			cfg.ForceUnauthenticatedRequestTracing = true
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			Header: http.Header{
				"Content-Type":       []string{"application/json"},
				"X-WG-Defer-Advisor": []string{"enable"},
			},
			Query: `query Storefront { storefront { id name price priceHistory { date value } reviews { id body stars } ratingSummary { average count } } }`,
		})
		require.NoError(t, err)
		require.Equal(t, http.StatusOK, res.Response.StatusCode)

		var response struct {
			Data       json.RawMessage `json:"data"`
			Errors     json.RawMessage `json:"errors"`
			Extensions struct {
				DeferAdvisor *advisorExtension `json:"deferAdvisor"`
			} `json:"extensions"`
		}
		require.NoError(t, json.Unmarshal([]byte(res.Body), &response))
		require.Nil(t, response.Errors)
		require.NotNil(t, response.Extensions.DeferAdvisor)

		assert.Equal(t, `{"storefront":[{"id":"1","name":"Router","price":199,"priceHistory":[{"date":"2026-01-01","value":189},{"date":"2026-06-01","value":199}],"reviews":[{"id":"1-1","body":"Great","stars":5},{"id":"1-2","body":"Solid","stars":4}],"ratingSummary":{"average":4.5,"count":2}},{"id":"2","name":"Composer","price":299,"priceHistory":[{"date":"2026-01-01","value":289},{"date":"2026-06-01","value":299}],"reviews":[{"id":"2-1","body":"Great","stars":5},{"id":"2-2","body":"Solid","stars":4}],"ratingSummary":{"average":4.5,"count":2}},{"id":"3","name":"Studio","price":499,"priceHistory":[{"date":"2026-01-01","value":489},{"date":"2026-06-01","value":499}],"reviews":[{"id":"3-1","body":"Great","stars":5},{"id":"3-2","body":"Solid","stars":4}],"ratingSummary":{"average":4.5,"count":2}}]}`, string(response.Data))

		adv := response.Extensions.DeferAdvisor
		view := advisorView{
			Outcome:            adv.Outcome,
			Runs:               adv.Runs,
			TotalMs:            normalizeAdvisorMs(adv.TotalDurationMs.AvgMs),
			OptimizedInitialMs: normalizeAdvisorMs(adv.Validation.InitialResponseMs.AvgMs),
			OptimizedQuery:     adv.OptimizedQuery,
			ValidationInitial:  normalizeAdvisorMs(adv.Validation.InitialResponseMs.AvgMs),
			ValidationTotal:    normalizeAdvisorMs(adv.Validation.TotalResponseMs.AvgMs),
			ValidationSaving:   normalizeAdvisorMs(adv.Validation.InitialResponseSavingMs.AvgMs),
		}
		for _, f := range adv.Fetches {
			view.Fetches = append(view.Fetches, advisorFetchView{
				FetchID:    f.FetchID,
				Subgraph:   f.Subgraph,
				Path:       f.Path,
				DependsOn:  f.DependsOn,
				DurationMs: normalizeAdvisorMs(f.DurationMs.AvgMs),
				Fields:     f.Fields,
			})
		}
		for _, f := range adv.Fields {
			view.Fields = append(view.Fields, advisorFieldView{
				Path:      f.Path,
				Subgraph:  f.Subgraph,
				LatencyMs: normalizeAdvisorMs(f.LatencyMs.AvgMs),
			})
		}
		for _, s := range adv.Suggestions {
			view.Suggestions = append(view.Suggestions, advisorSuggestionView{
				Label:    s.Label,
				Path:     s.Path,
				Subgraph: s.Subgraph,
				Fields:   s.Fields,
			})
		}
		for _, p := range adv.Validation.DeferredParts {
			view.ValidationParts = append(view.ValidationParts, advisorPartView{
				Label:       p.Label,
				ArrivedAtMs: normalizeAdvisorMs(p.ArrivedAtMs.AvgMs),
			})
		}

		assert.Equal(t, advisorView{
			Outcome: "recommended",
			Runs:    3,
			TotalMs: 710,
			Fetches: []advisorFetchView{
				{FetchID: 0, Subgraph: "catalog", Path: "", DependsOn: nil, DurationMs: 10, Fields: []string{"storefront"}},
				{FetchID: 1, Subgraph: "pricing", Path: "storefront", DependsOn: []int{0}, DurationMs: 700, Fields: []string{"price", "priceHistory"}},
				{FetchID: 2, Subgraph: "reviews", Path: "storefront", DependsOn: []int{0}, DurationMs: 250, Fields: []string{"reviews", "ratingSummary"}},
			},
			Fields: []advisorFieldView{
				{Path: "storefront.priceHistory", Subgraph: "pricing", LatencyMs: 700},
				{Path: "storefront.reviews", Subgraph: "reviews", LatencyMs: 250},
				{Path: "storefront.ratingSummary", Subgraph: "reviews", LatencyMs: 40},
				{Path: "storefront.price", Subgraph: "pricing", LatencyMs: 30},
			},
			Suggestions: []advisorSuggestionView{
				{Label: "pricing:storefront:priceHistory", Path: "storefront", Subgraph: "pricing", Fields: []string{"priceHistory"}},
				{Label: "reviews:storefront:reviews", Path: "storefront", Subgraph: "reviews", Fields: []string{"reviews"}},
			},
			OptimizedInitialMs: 50,
			OptimizedQuery: `query Storefront {
  storefront {
    id
    name
    price
    ... @defer(label: "pricing:storefront:priceHistory") {
      priceHistory {
        date
        value
      }
    }
    ... @defer(label: "reviews:storefront:reviews") {
      reviews {
        id
        body
        stars
      }
    }
    ratingSummary {
      average
      count
    }
  }
}`,
			ValidationInitial: 50,
			ValidationTotal:   750,
			ValidationSaving:  660,
			ValidationParts: []advisorPartView{
				{Label: "reviews:storefront:reviews", ArrivedAtMs: 300},
				{Label: "pricing:storefront:priceHistory", ArrivedAtMs: 750},
			},
		}, view)
	})
}

func TestDeferAdvisorRequiresTracingAuthorization(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{
		RouterConfigJSONTemplate: testenv.ConfigDeferDemoJSONTemplate,
		EnableDeferDemoSubgraphs: true,
		RouterOptions: []core.Option{
			core.WithDevelopmentMode(false),
		},
		ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
			cfg.EnableRequestTracing = true
			cfg.ForceUnauthenticatedRequestTracing = false
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			Header: http.Header{
				"Content-Type":       []string{"application/json"},
				"X-WG-Defer-Advisor": []string{"enable"},
			},
			Query: `query { storefront { id } }`,
		})
		require.NoError(t, err)
		assert.Equal(t, http.StatusForbidden, res.Response.StatusCode)
		assert.Equal(t, `{"errors":[{"message":"defer advisor is not authorized for request tracing"}]}`, res.Body)
	})
}

func TestDeferAdvisorStripsExistingDefer(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{
		RouterConfigJSONTemplate: testenv.ConfigDeferDemoJSONTemplate,
		EnableDeferDemoSubgraphs: true,
		ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
			cfg.EnableRequestTracing = true
			cfg.ForceUnauthenticatedRequestTracing = true
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			Header: http.Header{
				"Content-Type":            []string{"application/json"},
				"X-WG-Defer-Advisor":      []string{"enable"},
				"X-WG-Defer-Advisor-Runs": []string{"1"},
			},
			Query: `query Storefront { storefront { id name price ratingSummary { average count } ... @defer(label: "a") { priceHistory { date value } } ... @defer(label: "b") { reviews { id body stars } } } }`,
		})
		require.NoError(t, err)
		require.Equal(t, http.StatusOK, res.Response.StatusCode)

		var response struct {
			Data       json.RawMessage `json:"data"`
			Errors     json.RawMessage `json:"errors"`
			Extensions struct {
				DeferAdvisor *advisorExtension `json:"deferAdvisor"`
			} `json:"extensions"`
		}
		require.NoError(t, json.Unmarshal([]byte(res.Body), &response))
		require.Nil(t, response.Errors)
		require.NotNil(t, response.Extensions.DeferAdvisor)

		// The pre-applied defers are stripped: the analysis matches the plain
		// operation, full data included.
		assert.Equal(t, `{"storefront":[{"id":"1","name":"Router","price":199,"ratingSummary":{"average":4.5,"count":2},"priceHistory":[{"date":"2026-01-01","value":189},{"date":"2026-06-01","value":199}],"reviews":[{"id":"1-1","body":"Great","stars":5},{"id":"1-2","body":"Solid","stars":4}]},{"id":"2","name":"Composer","price":299,"ratingSummary":{"average":4.5,"count":2},"priceHistory":[{"date":"2026-01-01","value":289},{"date":"2026-06-01","value":299}],"reviews":[{"id":"2-1","body":"Great","stars":5},{"id":"2-2","body":"Solid","stars":4}]},{"id":"3","name":"Studio","price":499,"ratingSummary":{"average":4.5,"count":2},"priceHistory":[{"date":"2026-01-01","value":489},{"date":"2026-06-01","value":499}],"reviews":[{"id":"3-1","body":"Great","stars":5},{"id":"3-2","body":"Solid","stars":4}]}]}`, string(response.Data))

		labels := make([]string, 0, 2)
		for _, s := range response.Extensions.DeferAdvisor.Suggestions {
			labels = append(labels, s.Label)
		}
		assert.Equal(t, []string{"pricing:storefront:priceHistory", "reviews:storefront:reviews"}, labels)
	})
}

func TestDeferAdvisorInvalidRunsHeader(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{
		RouterConfigJSONTemplate: testenv.ConfigDeferDemoJSONTemplate,
		EnableDeferDemoSubgraphs: true,
		ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
			cfg.EnableRequestTracing = true
			cfg.ForceUnauthenticatedRequestTracing = true
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			Header: http.Header{
				"Content-Type":            []string{"application/json"},
				"X-WG-Defer-Advisor":      []string{"enable"},
				"X-WG-Defer-Advisor-Runs": []string{"eleven"},
			},
			Query: `query { storefront { id } }`,
		})
		require.NoError(t, err)
		assert.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
		assert.Equal(t, `{"errors":[{"message":"X-WG-Defer-Advisor-Runs must be an integer between 1 and 10"}]}`, res.Body)
	})
}
