package core

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFinalizeAdvisorResultPublishesOnlyMeasuredRecommendations(t *testing.T) {
	t.Parallel()

	aggregate := &advisorValidationAggregate{
		runs:                    3,
		initialResponseMs:       deferAdvisorStat{AvgMs: 20, MinMs: 18, MaxMs: 22},
		totalResponseMs:         deferAdvisorStat{AvgMs: 105, MinMs: 100, MaxMs: 110},
		initialResponseSavingMs: deferAdvisorStat{AvgMs: 80, MinMs: 70, MaxMs: 90},
		deferredParts: []advisorValidationPartAggregate{
			{label: "reviews", arrivedAtMs: deferAdvisorStat{AvgMs: 60, MinMs: 58, MaxMs: 62}},
			{label: "history", arrivedAtMs: deferAdvisorStat{AvgMs: 100, MinMs: 98, MaxMs: 102}},
		},
	}
	result := advisorPublicationResult()

	err := finalizeAdvisorResult(result, "query { optimized }", aggregate, deferAdvisorOutcomeRecommended, "")

	require.NoError(t, err)
	assert.Equal(t, deferAdvisorOutcomeRecommended, result.Outcome)
	assert.Empty(t, result.Reason)
	assert.Equal(t, "query { optimized }", result.OptimizedQuery)
	require.Len(t, result.Suggestions, 1)
	assert.Equal(t, &deferAdvisorValidation{
		Runs:                    3,
		InitialResponseMs:       deferAdvisorStat{AvgMs: 20, MinMs: 18, MaxMs: 22},
		TotalResponseMs:         deferAdvisorStat{AvgMs: 105, MinMs: 100, MaxMs: 110},
		InitialResponseSavingMs: deferAdvisorStat{AvgMs: 80, MinMs: 70, MaxMs: 90},
		DeferredParts: []deferAdvisorValidationPart{
			{Label: "reviews", ArrivedAtMs: deferAdvisorStat{AvgMs: 60, MinMs: 58, MaxMs: 62}},
			{Label: "history", ArrivedAtMs: deferAdvisorStat{AvgMs: 100, MinMs: 98, MaxMs: 102}},
		},
	}, result.Validation)
}

func TestFinalizeAdvisorResultSuppressesEveryNonRecommendedPortfolio(t *testing.T) {
	t.Parallel()

	aggregate := &advisorValidationAggregate{
		runs:                    1,
		initialResponseMs:       deferAdvisorStat{AvgMs: 90, MinMs: 90, MaxMs: 90},
		totalResponseMs:         deferAdvisorStat{AvgMs: 110, MinMs: 110, MaxMs: 110},
		initialResponseSavingMs: deferAdvisorStat{AvgMs: 10, MinMs: 10, MaxMs: 10},
		deferredParts: []advisorValidationPartAggregate{
			{label: "slow", arrivedAtMs: deferAdvisorStat{AvgMs: 100, MinMs: 100, MaxMs: 100}},
		},
	}
	tests := []struct {
		name           string
		outcome        deferAdvisorOutcome
		aggregate      *advisorValidationAggregate
		reason         string
		expectedReason string
		hasValidation  bool
	}{
		{
			name:           "no candidates",
			outcome:        deferAdvisorOutcomeNoCandidates,
			expectedReason: "No field met the conservative defer thresholds.",
		},
		{
			name:           "no gain",
			outcome:        deferAdvisorOutcomeNoGain,
			aggregate:      aggregate,
			expectedReason: "The measured optimized stream did not improve the initial response consistently enough.",
			hasValidation:  true,
		},
		{
			name:           "regression",
			outcome:        deferAdvisorOutcomeRegression,
			aggregate:      aggregate,
			expectedReason: "The measured optimized stream regressed initial or total response time.",
			hasValidation:  true,
		},
		{
			name:           "inconclusive default",
			outcome:        deferAdvisorOutcomeInconclusive,
			expectedReason: "The advisor could not validate an optimization safely.",
		},
		{
			name:           "inconclusive detail",
			outcome:        deferAdvisorOutcomeInconclusive,
			reason:         "optimized replay ended before its terminal part",
			expectedReason: "optimized replay ended before its terminal part",
		},
		{
			name:           "unvalidated",
			outcome:        deferAdvisorOutcomeUnvalidated,
			expectedReason: "Optimized stream validation was skipped, so no suggestion is actionable.",
		},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			result := advisorPublicationResult()
			err := finalizeAdvisorResult(result, "query { unsafe }", test.aggregate, test.outcome, test.reason)

			require.NoError(t, err)
			assert.Equal(t, test.outcome, result.Outcome)
			assert.Equal(t, test.expectedReason, result.Reason)
			assert.Empty(t, result.Suggestions)
			assert.Empty(t, result.OptimizedQuery)
			if test.hasValidation {
				assert.NotNil(t, result.Validation)
			} else {
				assert.Nil(t, result.Validation)
			}
		})
	}
}

func TestFinalizeAdvisorResultRejectsInvalidPublicationState(t *testing.T) {
	t.Parallel()

	aggregate := &advisorValidationAggregate{runs: 1}
	tests := []struct {
		name      string
		result    *deferAdvisorResult
		query     string
		aggregate *advisorValidationAggregate
		outcome   deferAdvisorOutcome
		err       string
	}{
		{
			name:    "nil result",
			outcome: deferAdvisorOutcomeNoCandidates,
			err:     "defer advisor cannot finalize a nil result",
		},
		{
			name:    "recommended without validation",
			result:  advisorPublicationResult(),
			query:   "query { optimized }",
			outcome: deferAdvisorOutcomeRecommended,
			err:     "defer advisor recommended outcome requires measured validation",
		},
		{
			name:      "recommended without suggestions",
			result:    &deferAdvisorResult{Suggestions: []deferAdvisorSuggestion{}},
			query:     "query { optimized }",
			aggregate: aggregate,
			outcome:   deferAdvisorOutcomeRecommended,
			err:       "defer advisor recommended outcome requires at least one suggestion",
		},
		{
			name:      "recommended without query",
			result:    advisorPublicationResult(),
			aggregate: aggregate,
			outcome:   deferAdvisorOutcomeRecommended,
			err:       "defer advisor recommended outcome requires an optimized query",
		},
		{
			name:    "no gain without validation",
			result:  advisorPublicationResult(),
			outcome: deferAdvisorOutcomeNoGain,
			err:     "defer advisor no_gain outcome requires measured validation",
		},
		{
			name:      "unknown outcome",
			result:    advisorPublicationResult(),
			aggregate: aggregate,
			outcome:   deferAdvisorOutcome("future"),
			err:       `defer advisor cannot publish unknown outcome "future"`,
		},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			err := finalizeAdvisorResult(test.result, test.query, test.aggregate, test.outcome, "")

			require.EqualError(t, err, test.err)
		})
	}
}

func advisorPublicationResult() *deferAdvisorResult {
	return &deferAdvisorResult{
		Suggestions: []deferAdvisorSuggestion{{
			Label:    "slow",
			Subgraph: "details",
			Fields:   []string{"slow"},
		}},
	}
}
