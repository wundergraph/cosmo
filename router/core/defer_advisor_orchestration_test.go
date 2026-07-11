package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

type fakeDeferAdvisorPhases struct {
	calls         []string
	fetches       []*advisorFetch
	planErr       error
	baseline      *advisorBaselinePhaseResult
	baselineErr   error
	splitErr      error
	optimized     []*advisorDeferRun
	optimizedErr  error
	sawDeadline   bool
	sawBudget     bool
	optimizedRuns int
}

func (f *fakeDeferAdvisorPhases) observe(request *http.Request) {
	_, f.sawDeadline = request.Context().Deadline()
	f.sawBudget = deferAdvisorReplayBudgetFromContext(request.Context()) != nil
}

func (f *fakeDeferAdvisorPhases) fetchPlanModel(parent *http.Request, _ []byte) ([]*advisorFetch, error) {
	f.calls = append(f.calls, "plan")
	f.observe(parent)
	return f.fetches, f.planErr
}

func (f *fakeDeferAdvisorPhases) runBaseline(parent *http.Request, _ []byte, _ int, _ []*advisorFetch) (*advisorBaselinePhaseResult, error) {
	f.calls = append(f.calls, "baseline")
	f.observe(parent)
	return f.baseline, f.baselineErr
}

func (f *fakeDeferAdvisorPhases) runMaxSplit(parent *http.Request, _ graphqlRequestBody, _ string, _ int, _ []*advisorFetch) error {
	f.calls = append(f.calls, "split")
	f.observe(parent)
	return f.splitErr
}

func (f *fakeDeferAdvisorPhases) runOptimized(parent *http.Request, _ graphqlRequestBody, _ string, runs int) ([]*advisorDeferRun, error) {
	f.calls = append(f.calls, "optimized")
	f.observe(parent)
	f.optimizedRuns = runs
	return f.optimized, f.optimizedErr
}

func TestDeferAdvisorOrchestrationPublishesARepeatedlyMeasuredPortfolio(t *testing.T) {
	t.Parallel()

	const runs = 3
	phases := recommendedAdvisorPhases(runs)

	response, result := executeAdvisorWithFakePhases(t, phases, runs, nil)

	assert.Equal(t, http.StatusOK, response.Code)
	assert.Equal(t, []string{"plan", "baseline", "split", "optimized"}, phases.calls)
	assert.True(t, phases.sawDeadline)
	assert.True(t, phases.sawBudget)
	assert.Equal(t, runs, phases.optimizedRuns)
	require.NotNil(t, result)
	assert.Equal(t, deferAdvisorOutcomeRecommended, result.Outcome)
	assert.Empty(t, result.Reason)
	require.Len(t, result.Suggestions, 2)
	assert.NotEmpty(t, result.OptimizedQuery)
	require.NotNil(t, result.Validation)
	assert.Equal(t, runs, result.Validation.Runs)
	assert.Equal(t, deferAdvisorStat{AvgMs: 50, MinMs: 50, MaxMs: 50}, result.Validation.InitialResponseMs)
	assert.Equal(t, deferAdvisorStat{AvgMs: 750, MinMs: 750, MaxMs: 750}, result.Validation.TotalResponseMs)
	assert.Equal(t, deferAdvisorStat{AvgMs: 660, MinMs: 660, MaxMs: 660}, result.Validation.InitialResponseSavingMs)
}

func TestDeferAdvisorOrchestrationSuppressesUnvalidatedAndRegressingPortfolios(t *testing.T) {
	t.Parallel()

	t.Run("validation skipped", func(t *testing.T) {
		t.Parallel()

		phases := recommendedAdvisorPhases(1)
		headers := http.Header{DeferAdvisorSkipValidationHeader: []string{"true"}}

		_, result := executeAdvisorWithFakePhases(t, phases, 1, headers)

		assert.Equal(t, []string{"plan", "baseline", "split"}, phases.calls)
		assert.Equal(t, deferAdvisorOutcomeUnvalidated, result.Outcome)
		assert.Empty(t, result.Suggestions)
		assert.Empty(t, result.OptimizedQuery)
		assert.Nil(t, result.Validation)
	})

	t.Run("measured regression", func(t *testing.T) {
		t.Parallel()

		phases := recommendedAdvisorPhases(1)
		phases.optimized = []*advisorDeferRun{advisorValidationRun(720, 760, 761, map[string]float64{
			"pricing:storefront:priceHistory": 750,
			"reviews:storefront:reviews":      740,
		})}

		_, result := executeAdvisorWithFakePhases(t, phases, 1, nil)

		assert.Equal(t, []string{"plan", "baseline", "split", "optimized"}, phases.calls)
		assert.Equal(t, deferAdvisorOutcomeRegression, result.Outcome)
		assert.Empty(t, result.Suggestions)
		assert.Empty(t, result.OptimizedQuery)
		assert.NotNil(t, result.Validation)
	})

	t.Run("optimized stream failed", func(t *testing.T) {
		t.Parallel()

		phases := recommendedAdvisorPhases(1)
		phases.optimized = nil
		phases.optimizedErr = errors.New("terminal part was missing")

		_, result := executeAdvisorWithFakePhases(t, phases, 1, nil)

		assert.Equal(t, deferAdvisorOutcomeInconclusive, result.Outcome)
		assert.Equal(t, "terminal part was missing", result.Reason)
		assert.Empty(t, result.Suggestions)
		assert.Empty(t, result.OptimizedQuery)
		assert.Nil(t, result.Validation)
	})
}

func TestDeferAdvisorOrchestrationStopsOnBaselineGraphQLErrors(t *testing.T) {
	t.Parallel()

	phases := &fakeDeferAdvisorPhases{
		fetches: advisorDemoFetches(0, 1),
		baseline: &advisorBaselinePhaseResult{
			lastResponse: advisorReplayGraphQLResponse{
				data:   json.RawMessage(`{"storefront":null}`),
				errors: json.RawMessage(`[{"message":"upstream failed","extensions":{"code":"UPSTREAM"}}]`),
			},
			inconclusiveReason: advisorBaselineInconclusiveGraphQLErrors,
		},
	}

	response, result := executeAdvisorWithFakePhases(t, phases, 1, nil)

	assert.Equal(t, http.StatusOK, response.Code)
	assert.Equal(t, []string{"plan", "baseline"}, phases.calls)
	assert.Equal(t, deferAdvisorOutcomeInconclusive, result.Outcome)
	assert.Zero(t, result.Runs)
	assert.Empty(t, result.Suggestions)
	assert.JSONEq(t, `[{"message":"upstream failed","extensions":{"code":"UPSTREAM"}}]`, advisorResponseErrors(t, response))
	assert.NotContains(t, response.Body.String(), `"trace"`)
	assert.NotContains(t, response.Body.String(), `"queryPlan"`)
}

func TestDeferAdvisorOrchestrationReportsNoCandidatesWithoutStreamingReplays(t *testing.T) {
	t.Parallel()

	const runs = 2
	fetch := &advisorFetch{
		fetchID:     0,
		subgraph:    "catalog",
		fields:      []string{"storefront"},
		durationsMs: repeatedAdvisorSamples(runs, 10),
	}
	phases := &fakeDeferAdvisorPhases{
		fetches: []*advisorFetch{fetch},
		baseline: &advisorBaselinePhaseResult{
			lastResponse: advisorReplayGraphQLResponse{data: json.RawMessage(`{"storefront":[]}`)},
			totalsMs:     repeatedAdvisorSamples(runs, 10),
		},
	}

	_, result := executeAdvisorWithFakePhases(t, phases, runs, nil)

	assert.Equal(t, []string{"plan", "baseline"}, phases.calls)
	assert.Equal(t, deferAdvisorOutcomeNoCandidates, result.Outcome)
	assert.Empty(t, result.Suggestions)
	assert.Empty(t, result.OptimizedQuery)
	assert.Nil(t, result.Validation)
}

func TestDeferAdvisorOrchestrationMakesSplitFailuresNonActionable(t *testing.T) {
	t.Parallel()

	phases := recommendedAdvisorPhases(1)
	phases.splitErr = errors.New("max-split label set changed")

	response, result := executeAdvisorWithFakePhases(t, phases, 1, nil)

	assert.Equal(t, http.StatusOK, response.Code)
	assert.Equal(t, []string{"plan", "baseline", "split"}, phases.calls)
	assert.Equal(t, deferAdvisorOutcomeInconclusive, result.Outcome)
	assert.Equal(t, "max-split label set changed", result.Reason)
	assert.Empty(t, result.Suggestions)
	assert.Empty(t, result.OptimizedQuery)
}

func TestWriteDeferAdvisorPhaseErrorUsesStableGatewayStatuses(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		err    error
		status int
	}{
		{name: "downstream", err: errors.New("bad response"), status: http.StatusBadGateway},
		{name: "deadline", err: fmt.Errorf("wrapped: %w", context.DeadlineExceeded), status: http.StatusGatewayTimeout},
		{name: "replay timeout", err: fmt.Errorf("wrapped: %w", errDeferAdvisorReplayTimeout), status: http.StatusGatewayTimeout},
		{name: "canceled", err: fmt.Errorf("wrapped: %w", context.Canceled), status: http.StatusRequestTimeout},
		{name: "budget", err: fmt.Errorf("wrapped: %w", errDeferAdvisorReplayBudgetExhausted), status: http.StatusInternalServerError},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			response := httptest.NewRecorder()
			writeDeferAdvisorPhaseError(response, test.err)

			assert.Equal(t, test.status, response.Code)
			assert.Equal(t, deferAdvisorErrorBody(test.err.Error()), response.Body.String())
		})
	}
}

func TestDeferAdvisorOrchestrationPreservesLateOperationalFailureStatuses(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		phase  string
		err    error
		status int
		calls  []string
	}{
		{
			name:   "split deadline",
			phase:  "split",
			err:    fmt.Errorf("split: %w", context.DeadlineExceeded),
			status: http.StatusGatewayTimeout,
			calls:  []string{"plan", "baseline", "split"},
		},
		{
			name:   "split budget",
			phase:  "split",
			err:    fmt.Errorf("split: %w", errDeferAdvisorReplayBudgetExhausted),
			status: http.StatusInternalServerError,
			calls:  []string{"plan", "baseline", "split"},
		},
		{
			name:   "optimized cancellation",
			phase:  "optimized",
			err:    fmt.Errorf("optimized: %w", context.Canceled),
			status: http.StatusRequestTimeout,
			calls:  []string{"plan", "baseline", "split", "optimized"},
		},
		{
			name:   "optimized replay timeout",
			phase:  "optimized",
			err:    fmt.Errorf("optimized: %w", errDeferAdvisorReplayTimeout),
			status: http.StatusGatewayTimeout,
			calls:  []string{"plan", "baseline", "split", "optimized"},
		},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			phases := recommendedAdvisorPhases(1)
			if test.phase == "split" {
				phases.splitErr = test.err
			} else {
				phases.optimizedErr = test.err
			}
			response := executeAdvisorRequestWithFakePhases(t, phases, 1, nil)

			assert.Equal(t, test.status, response.Code)
			assert.Equal(t, deferAdvisorErrorBody(test.err.Error()), response.Body.String())
			assert.Equal(t, test.calls, phases.calls)
		})
	}
}

func TestDeferAdvisorOrchestrationPropagatesPlanAndBaselineFailures(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		phase  string
		err    error
		status int
		calls  []string
	}{
		{
			name:   "plan",
			phase:  "plan",
			err:    errors.New("plan response was malformed"),
			status: http.StatusBadGateway,
			calls:  []string{"plan"},
		},
		{
			name:   "baseline",
			phase:  "baseline",
			err:    fmt.Errorf("baseline: %w", errDeferAdvisorReplayTimeout),
			status: http.StatusGatewayTimeout,
			calls:  []string{"plan", "baseline"},
		},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			phases := recommendedAdvisorPhases(1)
			if test.phase == "plan" {
				phases.planErr = test.err
			} else {
				phases.baselineErr = test.err
			}

			response := executeAdvisorRequestWithFakePhases(t, phases, 1, nil)
			assert.Equal(t, test.status, response.Code)
			assert.Equal(t, deferAdvisorErrorBody(test.err.Error()), response.Body.String())
			assert.Equal(t, test.calls, phases.calls)
		})
	}
}

func recommendedAdvisorPhases(runs int) *fakeDeferAdvisorPhases {
	fetches := advisorDemoFetches(0, runs)
	optimized := make([]*advisorDeferRun, 0, runs)
	for range runs {
		optimized = append(optimized, advisorValidationRun(50, 750, 751, map[string]float64{
			"pricing:storefront:priceHistory": 750,
			"reviews:storefront:reviews":      300,
		}))
	}
	return &fakeDeferAdvisorPhases{
		fetches: fetches,
		baseline: &advisorBaselinePhaseResult{
			lastResponse: advisorReplayGraphQLResponse{data: json.RawMessage(`{"storefront":[]}`)},
			totalsMs:     repeatedAdvisorSamples(runs, 710),
		},
		optimized: optimized,
	}
}

func executeAdvisorWithFakePhases(t *testing.T, phases *fakeDeferAdvisorPhases, runs int, headers http.Header) (*httptest.ResponseRecorder, *deferAdvisorResult) {
	t.Helper()
	response := executeAdvisorRequestWithFakePhases(t, phases, runs, headers)

	var body struct {
		Extensions struct {
			DeferAdvisor *deferAdvisorResult `json:"deferAdvisor"`
		} `json:"extensions"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
	require.NotNil(t, body.Extensions.DeferAdvisor)
	return response, body.Extensions.DeferAdvisor
}

func executeAdvisorRequestWithFakePhases(t *testing.T, phases *fakeDeferAdvisorPhases, runs int, headers http.Header) *httptest.ResponseRecorder {
	t.Helper()
	advisor := NewDeferAdvisor(DeferAdvisorOptions{
		EnableRequestTracing: true,
		DevelopmentMode:      true,
		Logger:               zap.NewNop(),
	})
	advisor.SetTarget(http.NotFoundHandler())
	advisor.phases = phases
	request := httptest.NewRequest(http.MethodPost, "http://router.example/graphql", bytes.NewBufferString(`{
		"query":"query Storefront { storefront { price priceHistory reviews ratingSummary } }",
		"operationName":"Storefront"
	}`))
	request.Header.Set(DeferAdvisorHeader, "true")
	request.Header.Set(DeferAdvisorRunsHeader, strconv.Itoa(runs))
	request.Header.Set("Content-Type", "application/json")
	for key, values := range headers {
		for _, value := range values {
			request.Header.Add(key, value)
		}
	}
	response := httptest.NewRecorder()

	advisor.Middleware(http.NotFoundHandler()).ServeHTTP(response, request)
	return response
}

func advisorResponseErrors(t *testing.T, response *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		Errors json.RawMessage `json:"errors"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
	return string(body.Errors)
}
