package core

import (
	"math"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func advisorValidationRun(initialMs, terminalMs, closedMs float64, arrivals map[string]float64) *advisorDeferRun {
	run := &advisorDeferRun{
		initialAt:  time.Duration(initialMs * float64(time.Millisecond)),
		terminalAt: time.Duration(terminalMs * float64(time.Millisecond)),
		closedAt:   time.Duration(closedMs * float64(time.Millisecond)),
		arrivals:   make(map[string]time.Duration, len(arrivals)),
	}
	for label, arrivedAtMs := range arrivals {
		run.arrivals[label] = time.Duration(arrivedAtMs * float64(time.Millisecond))
	}
	return run
}

func TestAggregateAdvisorValidationMeasuresTheWholePortfolio(t *testing.T) {
	t.Parallel()

	aggregate, outcome, err := aggregateAdvisorValidation(
		3,
		[]float64{100, 110, 90},
		[]*advisorDeferRun{
			advisorValidationRun(20, 105, 106, map[string]float64{"reviews": 60, "history": 100}),
			advisorValidationRun(30, 115, 116, map[string]float64{"reviews": 70, "history": 110}),
			advisorValidationRun(25, 95, 96, map[string]float64{"reviews": 65, "history": 90}),
		},
		[]string{"reviews", "history"},
	)

	require.NoError(t, err)
	assert.Equal(t, deferAdvisorOutcomeRecommended, outcome)
	assert.Equal(t, 3, aggregate.runs)
	assert.Equal(t, deferAdvisorStat{AvgMs: 25, MinMs: 20, MaxMs: 30}, aggregate.initialResponseMs)
	assert.Equal(t, deferAdvisorStat{AvgMs: 105, MinMs: 95, MaxMs: 115}, aggregate.totalResponseMs)
	assert.Equal(t, deferAdvisorStat{AvgMs: 75, MinMs: 60, MaxMs: 90}, aggregate.initialResponseSavingMs)
	assert.Equal(t, []advisorValidationPartAggregate{
		{label: "reviews", arrivedAtMs: deferAdvisorStat{AvgMs: 65, MinMs: 60, MaxMs: 70}},
		{label: "history", arrivedAtMs: deferAdvisorStat{AvgMs: 100, MinMs: 90, MaxMs: 110}},
	}, aggregate.deferredParts)
}

func TestAggregateAdvisorValidationClassifiesMeasuredGain(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		baseline float64
		initial  float64
		outcome  deferAdvisorOutcome
	}{
		{name: "absolute noise floor", baseline: 100, initial: 98, outcome: deferAdvisorOutcomeNoGain},
		{name: "relative noise floor", baseline: 1_000, initial: 960, outcome: deferAdvisorOutcomeNoGain},
		{name: "minimum useful gain", baseline: 100, initial: 95, outcome: deferAdvisorOutcomeRecommended},
		{name: "regression", baseline: 100, initial: 105, outcome: deferAdvisorOutcomeRegression},
		{name: "no change", baseline: 100, initial: 100, outcome: deferAdvisorOutcomeRegression},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			aggregate, outcome, err := aggregateAdvisorValidation(
				1,
				[]float64{test.baseline},
				[]*advisorDeferRun{advisorValidationRun(test.initial, test.initial+10, test.initial+11, map[string]float64{"slow": test.initial + 5})},
				[]string{"slow"},
			)

			require.NoError(t, err)
			require.NotNil(t, aggregate)
			assert.Equal(t, test.outcome, outcome)
		})
	}
}

func TestAggregateAdvisorValidationRequiresAConservativeGainWithoutLargeTotalRegression(t *testing.T) {
	t.Parallel()

	t.Run("overlapping timing ranges", func(t *testing.T) {
		t.Parallel()

		_, outcome, err := aggregateAdvisorValidation(
			2,
			[]float64{90, 110},
			[]*advisorDeferRun{
				advisorValidationRun(80, 105, 106, map[string]float64{"slow": 100}),
				advisorValidationRun(100, 115, 116, map[string]float64{"slow": 110}),
			},
			[]string{"slow"},
		)

		require.NoError(t, err)
		assert.Equal(t, deferAdvisorOutcomeNoGain, outcome)
	})

	t.Run("large total response regression", func(t *testing.T) {
		t.Parallel()

		_, outcome, err := aggregateAdvisorValidation(
			1,
			[]float64{100},
			[]*advisorDeferRun{advisorValidationRun(20, 140, 141, map[string]float64{"slow": 130})},
			[]string{"slow"},
		)

		require.NoError(t, err)
		assert.Equal(t, deferAdvisorOutcomeRegression, outcome)
	})
}

func TestAggregateAdvisorValidationRejectsInconsistentMeasurements(t *testing.T) {
	t.Parallel()

	valid := advisorValidationRun(20, 100, 101, map[string]float64{"slow": 90})
	tests := []struct {
		name      string
		runs      int
		baselines []float64
		streams   []*advisorDeferRun
		labels    []string
		err       string
	}{
		{
			name:      "invalid run count",
			baselines: []float64{100},
			streams:   []*advisorDeferRun{valid},
			labels:    []string{"slow"},
			err:       "defer advisor validation runs must be positive",
		},
		{
			name:      "baseline count",
			runs:      2,
			baselines: []float64{100},
			streams:   []*advisorDeferRun{valid, valid},
			labels:    []string{"slow"},
			err:       "defer advisor validation has 1 baseline measurements; expected 2",
		},
		{
			name:      "stream count",
			runs:      2,
			baselines: []float64{100, 100},
			streams:   []*advisorDeferRun{valid},
			labels:    []string{"slow"},
			err:       "defer advisor validation has 1 optimized measurements; expected 2",
		},
		{
			name:      "non-finite baseline",
			runs:      1,
			baselines: []float64{math.Inf(1)},
			streams:   []*advisorDeferRun{valid},
			labels:    []string{"slow"},
			err:       "defer advisor validation baseline measurement 1 is not finite and non-negative",
		},
		{
			name:      "empty label",
			runs:      1,
			baselines: []float64{100},
			streams:   []*advisorDeferRun{valid},
			labels:    []string{""},
			err:       "defer advisor validation expected label 1 is empty",
		},
		{
			name:      "duplicate label",
			runs:      1,
			baselines: []float64{100},
			streams:   []*advisorDeferRun{valid},
			labels:    []string{"slow", "slow"},
			err:       `defer advisor validation repeats expected label "slow"`,
		},
		{
			name:      "nil stream",
			runs:      1,
			baselines: []float64{100},
			streams:   []*advisorDeferRun{nil},
			labels:    []string{"slow"},
			err:       "defer advisor validation optimized measurement 1 is nil",
		},
		{
			name:      "initial after terminal",
			runs:      1,
			baselines: []float64{100},
			streams:   []*advisorDeferRun{advisorValidationRun(50, 40, 60, map[string]float64{"slow": 40})},
			labels:    []string{"slow"},
			err:       "defer advisor validation optimized measurement 1 has invalid initial, terminal, or close timing",
		},
		{
			name:      "terminal after close",
			runs:      1,
			baselines: []float64{100},
			streams:   []*advisorDeferRun{advisorValidationRun(20, 60, 50, map[string]float64{"slow": 40})},
			labels:    []string{"slow"},
			err:       "defer advisor validation optimized measurement 1 has invalid initial, terminal, or close timing",
		},
		{
			name:      "missing label",
			runs:      1,
			baselines: []float64{100},
			streams:   []*advisorDeferRun{advisorValidationRun(20, 100, 101, nil)},
			labels:    []string{"slow"},
			err:       `defer advisor validation optimized measurement 1 is missing label "slow"`,
		},
		{
			name:      "unexpected label",
			runs:      1,
			baselines: []float64{100},
			streams:   []*advisorDeferRun{advisorValidationRun(20, 100, 101, map[string]float64{"slow": 90, "other": 80})},
			labels:    []string{"slow"},
			err:       `defer advisor validation optimized measurement 1 contains unexpected label "other"`,
		},
		{
			name:      "arrival before initial",
			runs:      1,
			baselines: []float64{100},
			streams:   []*advisorDeferRun{advisorValidationRun(20, 100, 101, map[string]float64{"slow": 10})},
			labels:    []string{"slow"},
			err:       `defer advisor validation optimized measurement 1 label "slow" arrives outside the stream lifetime`,
		},
		{
			name:      "arrival after terminal",
			runs:      1,
			baselines: []float64{100},
			streams:   []*advisorDeferRun{advisorValidationRun(20, 100, 101, map[string]float64{"slow": 101})},
			labels:    []string{"slow"},
			err:       `defer advisor validation optimized measurement 1 label "slow" arrives outside the stream lifetime`,
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			aggregate, _, err := aggregateAdvisorValidation(test.runs, test.baselines, test.streams, test.labels)

			assert.Nil(t, aggregate)
			require.EqualError(t, err, test.err)
		})
	}
}
