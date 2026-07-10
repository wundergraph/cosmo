package core

import (
	"fmt"
	"slices"
	"sort"
	"time"
)

const (
	deferAdvisorMinValidatedSavingMs    = 5.0
	deferAdvisorMinValidatedSavingRatio = 0.05
	deferAdvisorMaxTotalOverheadMs      = 25.0
	deferAdvisorMaxTotalOverheadRatio   = 0.10
)

type deferAdvisorOutcome string

const (
	deferAdvisorOutcomeRecommended  deferAdvisorOutcome = "recommended"
	deferAdvisorOutcomeNoCandidates deferAdvisorOutcome = "no_candidates"
	deferAdvisorOutcomeNoGain       deferAdvisorOutcome = "no_gain"
	deferAdvisorOutcomeRegression   deferAdvisorOutcome = "regression"
	deferAdvisorOutcomeInconclusive deferAdvisorOutcome = "inconclusive"
	deferAdvisorOutcomeUnvalidated  deferAdvisorOutcome = "unvalidated"
)

type advisorValidationPartAggregate struct {
	label       string
	arrivedAtMs deferAdvisorStat
}

type advisorValidationAggregate struct {
	runs                    int
	initialResponseMs       deferAdvisorStat
	totalResponseMs         deferAdvisorStat
	initialResponseSavingMs deferAdvisorStat
	deferredParts           []advisorValidationPartAggregate
}

// aggregateAdvisorValidation validates and summarizes repeated executions of
// the complete suggested defer portfolio. Baseline totals and optimized TTFB
// samples are independent, so the saving range is conservative: its minimum
// compares the fastest baseline to the slowest optimized initial response and
// its maximum compares the slowest baseline to the fastest optimized initial
// response.
func aggregateAdvisorValidation(runs int, baselineTotalsMs []float64, optimizedRuns []*advisorDeferRun, expectedLabels []string) (*advisorValidationAggregate, deferAdvisorOutcome, error) {
	if runs <= 0 {
		return nil, "", fmt.Errorf("defer advisor validation runs must be positive")
	}
	if len(baselineTotalsMs) != runs {
		return nil, "", fmt.Errorf("defer advisor validation has %d baseline measurements; expected %d", len(baselineTotalsMs), runs)
	}
	if len(optimizedRuns) != runs {
		return nil, "", fmt.Errorf("defer advisor validation has %d optimized measurements; expected %d", len(optimizedRuns), runs)
	}
	for i, value := range baselineTotalsMs {
		if !isFiniteNonNegative(value) {
			return nil, "", fmt.Errorf("defer advisor validation baseline measurement %d is not finite and non-negative", i+1)
		}
	}

	expected := make(map[string]struct{}, len(expectedLabels))
	for i, label := range expectedLabels {
		if label == "" {
			return nil, "", fmt.Errorf("defer advisor validation expected label %d is empty", i+1)
		}
		if _, exists := expected[label]; exists {
			return nil, "", fmt.Errorf("defer advisor validation repeats expected label %q", label)
		}
		expected[label] = struct{}{}
	}
	if len(expected) == 0 {
		return nil, "", fmt.Errorf("defer advisor validation has no expected labels")
	}
	sortedLabels := slices.Clone(expectedLabels)
	slices.Sort(sortedLabels)

	initialSamples := make([]float64, 0, runs)
	totalSamples := make([]float64, 0, runs)
	arrivalSamples := make(map[string][]float64, len(expected))
	for _, label := range sortedLabels {
		arrivalSamples[label] = make([]float64, 0, runs)
	}
	for i, run := range optimizedRuns {
		if run == nil {
			return nil, "", fmt.Errorf("defer advisor validation optimized measurement %d is nil", i+1)
		}
		if run.initialAt < 0 || run.terminalAt < run.initialAt || run.closedAt < run.terminalAt {
			return nil, "", fmt.Errorf("defer advisor validation optimized measurement %d has invalid initial, terminal, or close timing", i+1)
		}
		for _, label := range sortedLabels {
			if _, exists := run.arrivals[label]; !exists {
				return nil, "", fmt.Errorf("defer advisor validation optimized measurement %d is missing label %q", i+1, label)
			}
		}
		unexpected := make([]string, 0)
		for label := range run.arrivals {
			if _, exists := expected[label]; !exists {
				unexpected = append(unexpected, label)
			}
		}
		if len(unexpected) != 0 {
			slices.Sort(unexpected)
			return nil, "", fmt.Errorf("defer advisor validation optimized measurement %d contains unexpected label %q", i+1, unexpected[0])
		}

		initialSamples = append(initialSamples, advisorDurationMilliseconds(run.initialAt))
		totalSamples = append(totalSamples, advisorDurationMilliseconds(run.terminalAt))
		for _, label := range sortedLabels {
			arrivedAt := run.arrivals[label]
			if arrivedAt < run.initialAt || arrivedAt > run.terminalAt {
				return nil, "", fmt.Errorf("defer advisor validation optimized measurement %d label %q arrives outside the stream lifetime", i+1, label)
			}
			arrivalSamples[label] = append(arrivalSamples[label], advisorDurationMilliseconds(arrivedAt))
		}
	}

	initialStat := statOf(initialSamples)
	savingStat := deferAdvisorStat{
		AvgMs: roundMs(avgOf(baselineTotalsMs) - avgOf(initialSamples)),
		MinMs: roundMs(slices.Min(baselineTotalsMs) - slices.Max(initialSamples)),
		MaxMs: roundMs(slices.Max(baselineTotalsMs) - slices.Min(initialSamples)),
	}
	totalStat := statOf(totalSamples)
	aggregate := &advisorValidationAggregate{
		runs:                    runs,
		initialResponseMs:       initialStat,
		totalResponseMs:         totalStat,
		initialResponseSavingMs: savingStat,
		deferredParts:           make([]advisorValidationPartAggregate, 0, len(sortedLabels)),
	}
	for _, label := range sortedLabels {
		aggregate.deferredParts = append(aggregate.deferredParts, advisorValidationPartAggregate{
			label:       label,
			arrivedAtMs: statOf(arrivalSamples[label]),
		})
	}
	sort.Slice(aggregate.deferredParts, func(i, j int) bool {
		if aggregate.deferredParts[i].arrivedAtMs.AvgMs == aggregate.deferredParts[j].arrivedAtMs.AvgMs {
			return aggregate.deferredParts[i].label < aggregate.deferredParts[j].label
		}
		return aggregate.deferredParts[i].arrivedAtMs.AvgMs < aggregate.deferredParts[j].arrivedAtMs.AvgMs
	})

	baselineAverage := avgOf(baselineTotalsMs)
	conservativeGain := slices.Min(baselineTotalsMs) - slices.Max(initialSamples)
	minimumGain := max(deferAdvisorMinValidatedSavingMs, baselineAverage*deferAdvisorMinValidatedSavingRatio)
	maximumTotalOverhead := max(deferAdvisorMaxTotalOverheadMs, baselineAverage*deferAdvisorMaxTotalOverheadRatio)
	switch {
	case avgOf(totalSamples)-baselineAverage > maximumTotalOverhead:
		return aggregate, deferAdvisorOutcomeRegression, nil
	case conservativeGain >= minimumGain:
		return aggregate, deferAdvisorOutcomeRecommended, nil
	case savingStat.AvgMs > 0:
		return aggregate, deferAdvisorOutcomeNoGain, nil
	default:
		return aggregate, deferAdvisorOutcomeRegression, nil
	}
}

func advisorDurationMilliseconds(duration time.Duration) float64 {
	return float64(duration) / float64(time.Millisecond)
}
