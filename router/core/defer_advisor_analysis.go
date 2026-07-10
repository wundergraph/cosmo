package core

import (
	"cmp"
	"math"
	"slices"
	"strings"
)

const (
	// Fields must contribute at least this much latency above the request floor.
	deferAdvisorMinExcessMs = 50.0
	// Fields must also contribute this share of the supported avoidable path.
	deferAdvisorMinExcessRatio = 0.2
	// Similar sibling fields share one defer group to avoid extra round trips.
	deferAdvisorClusterRatio = 0.25
)

func deferSuggestionLabel(subgraph, path, field string) string {
	// Path and field are GraphQL response names and cannot contain ':' or '%'.
	// Locally composed subgraph names are less constrained, so escape their two
	// delimiters while preserving the existing labels for ordinary names.
	escapedSubgraph := strings.NewReplacer("%", "%25", ":", "%3A").Replace(subgraph)
	if path == "" {
		return escapedSubgraph + ":" + field
	}
	return escapedSubgraph + ":" + path + ":" + field
}

// criticalPathMs computes the longest dependency chain over a fetch model that
// has already passed buildFetchModel validation.
func criticalPathMs(fetches []*advisorFetch, effective func(*advisorFetch) float64) float64 {
	byID := make(map[int]*advisorFetch, len(fetches))
	for _, fetch := range fetches {
		byID[fetch.fetchID] = fetch
	}
	memo := make(map[int]float64, len(fetches))
	var end func(fetch *advisorFetch) float64
	end = func(fetch *advisorFetch) float64 {
		if value, ok := memo[fetch.fetchID]; ok {
			return value
		}
		var start float64
		for _, dependencyID := range fetch.dependsOn {
			start = max(start, end(byID[dependencyID]))
		}
		value := start + effective(fetch)
		memo[fetch.fetchID] = value
		return value
	}
	var total float64
	for _, fetch := range fetches {
		total = max(total, end(fetch))
	}
	return total
}

func advisorFetchDepths(fetches []*advisorFetch) map[*advisorFetch]int {
	byID := make(map[int]*advisorFetch, len(fetches))
	for _, fetch := range fetches {
		byID[fetch.fetchID] = fetch
	}
	depths := make(map[*advisorFetch]int, len(fetches))
	var depthOf func(fetch *advisorFetch) int
	depthOf = func(fetch *advisorFetch) int {
		if depth, ok := depths[fetch]; ok {
			return depth
		}
		depth := 0
		for _, dependencyID := range fetch.dependsOn {
			depth = max(depth, depthOf(byID[dependencyID])+1)
		}
		depths[fetch] = depth
		return depth
	}
	for _, fetch := range fetches {
		depthOf(fetch)
	}
	return depths
}

func effectiveAdvisorFieldLatency(fetch *advisorFetch, field string) float64 {
	// Split delivery can be slower than the measured baseline fetch because the
	// synthetic operation changes scheduling. Cap that artifact before using
	// the isolated timing as candidate-ranking evidence.
	return min(avgOf(fetch.fieldLatenciesMs[field]), avgOf(fetch.durationsMs))
}

type advisorSuggestionCandidate struct {
	fetch      *advisorFetch
	suggestion deferAdvisorSuggestion
	excessMs   float64
}

func buildAdvisorResult(runs int, totalsMs []float64, fetches []*advisorFetch) (*deferAdvisorResult, error) {
	if err := validateAdvisorMeasurements(runs, totalsMs, fetches); err != nil {
		return nil, err
	}

	result := &deferAdvisorResult{
		Runs:            runs,
		TotalDurationMs: statOf(totalsMs),
		Fetches:         make([]deferAdvisorFetchStats, 0, len(fetches)),
		Fields:          []deferAdvisorFieldStats{},
		Suggestions:     []deferAdvisorSuggestion{},
	}
	for _, fetch := range fetches {
		result.Fetches = append(result.Fetches, deferAdvisorFetchStats{
			FetchID:    fetch.fetchID,
			Subgraph:   fetch.subgraph,
			Path:       fetch.path,
			DependsOn:  slices.Clone(fetch.dependsOn),
			DurationMs: statOf(fetch.durationsMs),
			Fields:     slices.Clone(fetch.fields),
		})
		for _, field := range fetch.fields {
			if samples := fetch.fieldLatenciesMs[field]; len(samples) != 0 {
				result.Fields = append(result.Fields, deferAdvisorFieldStats{
					Path:      fetch.clientFieldPath(field),
					Subgraph:  fetch.subgraph,
					LatencyMs: statOf(samples),
				})
			}
		}
	}
	slices.SortFunc(result.Fields, func(left, right deferAdvisorFieldStats) int {
		if order := cmp.Compare(right.LatencyMs.AvgMs, left.LatencyMs.AvgMs); order != 0 {
			return order
		}
		if order := strings.Compare(left.Path, right.Path); order != 0 {
			return order
		}
		return strings.Compare(left.Subgraph, right.Subgraph)
	})

	depths := advisorFetchDepths(fetches)
	floor := advisorLatencyFloor(fetches)
	avoidablePathMs := criticalPathMs(fetches, func(fetch *advisorFetch) float64 {
		if depths[fetch] != 1 {
			return 0
		}
		return max(0, avgOf(fetch.durationsMs)-floor)
	})
	thresholdMs := max(deferAdvisorMinExcessMs, avoidablePathMs*deferAdvisorMinExcessRatio)

	var candidates []*advisorSuggestionCandidate
	for _, fetch := range fetches {
		// Split part arrivals are local weights only for direct children of the
		// primary fetch. Deeper arrivals include ancestor work; report their stats
		// but do not turn them into misleading generalized savings estimates.
		if depths[fetch] != 1 || len(fetch.fieldLatenciesMs) == 0 {
			continue
		}
		var slowFields []string
		for _, field := range fetch.fields {
			excess := max(0, effectiveAdvisorFieldLatency(fetch, field)-floor)
			if excess >= thresholdMs {
				slowFields = append(slowFields, field)
			}
		}
		slices.SortFunc(slowFields, func(left, right string) int {
			leftExcess := max(0, effectiveAdvisorFieldLatency(fetch, left)-floor)
			rightExcess := max(0, effectiveAdvisorFieldLatency(fetch, right)-floor)
			if order := cmp.Compare(rightExcess, leftExcess); order != 0 {
				return order
			}
			return strings.Compare(left, right)
		})
		for len(slowFields) != 0 {
			groupFields := []string{slowFields[0]}
			groupExcess := max(0, effectiveAdvisorFieldLatency(fetch, slowFields[0])-floor)
			remainingFields := slowFields[1:]
			slowFields = nil
			for _, field := range remainingFields {
				fieldExcess := max(0, effectiveAdvisorFieldLatency(fetch, field)-floor)
				if groupExcess-fieldExcess <= groupExcess*deferAdvisorClusterRatio {
					groupFields = append(groupFields, field)
				} else {
					slowFields = append(slowFields, field)
				}
			}
			path := strings.Join(fetch.clientParentPath, ".")
			candidates = append(candidates, &advisorSuggestionCandidate{
				fetch:    fetch,
				excessMs: groupExcess,
				suggestion: deferAdvisorSuggestion{
					Label:    deferSuggestionLabel(fetch.subgraph, path, groupFields[0]),
					Path:     path,
					Subgraph: fetch.subgraph,
					Fields:   slices.Clone(groupFields),
				},
			})
		}
	}
	if len(candidates) == 0 {
		return result, nil
	}

	baselineCriticalPathMs := criticalPathMs(fetches, func(fetch *advisorFetch) float64 {
		return avgOf(fetch.durationsMs)
	})
	active := minimizeAdvisorCandidates(fetches, baselineCriticalPathMs, candidates)
	if len(active) == 0 {
		return result, nil
	}

	result.Suggestions = make([]deferAdvisorSuggestion, 0, len(active))
	slices.SortFunc(active, func(left, right *advisorSuggestionCandidate) int {
		if order := cmp.Compare(right.excessMs, left.excessMs); order != 0 {
			return order
		}
		return strings.Compare(left.suggestion.Label, right.suggestion.Label)
	})
	for _, candidate := range active {
		result.Suggestions = append(result.Suggestions, candidate.suggestion)
	}
	return result, nil
}

func advisorPortfolioCriticalPathMs(fetches []*advisorFetch, candidates []*advisorSuggestionCandidate) float64 {
	deferred := make(map[*advisorFetch]map[string]bool)
	for _, candidate := range candidates {
		if deferred[candidate.fetch] == nil {
			deferred[candidate.fetch] = make(map[string]bool)
		}
		for _, field := range candidate.suggestion.Fields {
			deferred[candidate.fetch][field] = true
		}
	}

	return criticalPathMs(fetches, func(fetch *advisorFetch) float64 {
		selected := deferred[fetch]
		if len(selected) == 0 {
			return avgOf(fetch.durationsMs)
		}
		var remainingMs float64
		for _, field := range fetch.fields {
			if !selected[field] {
				remainingMs = max(remainingMs, effectiveAdvisorFieldLatency(fetch, field))
			}
		}
		return min(avgOf(fetch.durationsMs), remainingMs)
	})
}

func advisorMillisecondsToCent(value float64) int64 {
	return int64(math.Round(value * 100))
}

// minimizeAdvisorCandidates returns a deterministic inclusion-minimal
// portfolio that preserves the full portfolio's modeled critical path. It is
// deliberately not a globally minimum-cardinality search. Max-split timings
// only rank and select candidates; public TTFB claims require a measured
// optimized streaming run.
func minimizeAdvisorCandidates(fetches []*advisorFetch, baselineCriticalPathMs float64, candidates []*advisorSuggestionCandidate) []*advisorSuggestionCandidate {
	active := slices.Clone(candidates)
	optimizedCent := advisorMillisecondsToCent(advisorPortfolioCriticalPathMs(fetches, active))
	if optimizedCent >= advisorMillisecondsToCent(baselineCriticalPathMs) {
		return nil
	}

	for {
		removalOrder := slices.Clone(active)
		slices.SortFunc(removalOrder, func(left, right *advisorSuggestionCandidate) int {
			if order := cmp.Compare(left.excessMs, right.excessMs); order != 0 {
				return order
			}
			// For equally ranked interchangeable candidates, preserve the
			// lexicographically smaller stable label.
			return strings.Compare(right.suggestion.Label, left.suggestion.Label)
		})

		removed := false
		for _, candidate := range removalOrder {
			trial := make([]*advisorSuggestionCandidate, 0, len(active)-1)
			for _, current := range active {
				if current != candidate {
					trial = append(trial, current)
				}
			}
			trialCent := advisorMillisecondsToCent(advisorPortfolioCriticalPathMs(fetches, trial))
			if trialCent <= optimizedCent {
				active = trial
				optimizedCent = trialCent
				removed = true
				break
			}
		}
		if !removed {
			return active
		}
	}
}
