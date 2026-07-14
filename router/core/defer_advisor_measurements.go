package core

import (
	"fmt"
	"math"
	"slices"
	"strings"
)

// Result types rendered into extensions.deferAdvisor.
type deferAdvisorStat struct {
	AvgMs float64 `json:"avgMs"`
	MinMs float64 `json:"minMs"`
	MaxMs float64 `json:"maxMs"`
}

type deferAdvisorFetchStats struct {
	FetchID    int              `json:"fetchId"`
	Subgraph   string           `json:"subgraph"`
	Path       string           `json:"path,omitempty"`
	DependsOn  []int            `json:"dependsOn,omitempty"`
	DurationMs deferAdvisorStat `json:"durationMs"`
	Fields     []string         `json:"fields"`
}

type deferAdvisorFieldStats struct {
	Path      string           `json:"path"`
	Subgraph  string           `json:"subgraph"`
	LatencyMs deferAdvisorStat `json:"latencyMs"`
}

type deferAdvisorSuggestion struct {
	Label    string   `json:"label"`
	Path     string   `json:"path,omitempty"`
	Subgraph string   `json:"subgraph"`
	Fields   []string `json:"fields"`
}

type deferAdvisorValidationPart struct {
	Label       string           `json:"label"`
	ArrivedAtMs deferAdvisorStat `json:"arrivedAtMs"`
}

type deferAdvisorValidation struct {
	Runs                    int                          `json:"runs"`
	InitialResponseMs       deferAdvisorStat             `json:"initialResponseMs"`
	TotalResponseMs         deferAdvisorStat             `json:"totalResponseMs"`
	InitialResponseSavingMs deferAdvisorStat             `json:"initialResponseSavingMs"`
	DeferredParts           []deferAdvisorValidationPart `json:"deferredParts"`
}

type deferAdvisorResult struct {
	Outcome         deferAdvisorOutcome      `json:"outcome"`
	Reason          string                   `json:"reason,omitempty"`
	Runs            int                      `json:"runs"`
	TotalDurationMs deferAdvisorStat         `json:"totalDurationMs"`
	Fetches         []deferAdvisorFetchStats `json:"fetches"`
	Fields          []deferAdvisorFieldStats `json:"fields"`
	Suggestions     []deferAdvisorSuggestion `json:"suggestions"`
	OptimizedQuery  string                   `json:"optimizedQuery,omitempty"`
	Validation      *deferAdvisorValidation  `json:"validation,omitempty"`
}

func statOf(values []float64) deferAdvisorStat {
	if len(values) == 0 {
		return deferAdvisorStat{}
	}
	var sum float64
	for _, value := range values {
		sum += value
	}
	return deferAdvisorStat{
		AvgMs: roundMs(sum / float64(len(values))),
		MinMs: roundMs(slices.Min(values)),
		MaxMs: roundMs(slices.Max(values)),
	}
}

func roundMs(value float64) float64 {
	return math.Round(value*100) / 100
}

func avgOf(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	var sum float64
	for _, value := range values {
		sum += value
	}
	return sum / float64(len(values))
}

// advisorLatencyFloor estimates the request's base source-load cost from data
// production always records. Root fetches are not split, so baseline fetch
// durations must participate alongside field delivery measurements.
func advisorLatencyFloor(fetches []*advisorFetch) float64 {
	var floor float64
	seen := false
	consider := func(value float64) {
		if !seen || value < floor {
			floor = value
			seen = true
		}
	}
	for _, fetch := range fetches {
		if len(fetch.durationsMs) != 0 {
			consider(avgOf(fetch.durationsMs))
		}
		for _, field := range fetch.fields {
			if samples := fetch.fieldLatenciesMs[field]; len(samples) != 0 {
				consider(avgOf(samples))
			}
		}
	}
	return floor
}

func validateAdvisorMeasurements(runs int, totalsMs []float64, fetches []*advisorFetch) error {
	if runs < 1 {
		return fmt.Errorf("advisor runs must be positive")
	}
	if len(fetches) == 0 {
		return fmt.Errorf("advisor fetch model is empty")
	}
	if len(totalsMs) != runs {
		return fmt.Errorf("advisor total sample count %d does not match runs %d", len(totalsMs), runs)
	}
	for i, sample := range totalsMs {
		if !isFiniteNonNegative(sample) {
			return fmt.Errorf("advisor total sample %d must be finite and non-negative", i+1)
		}
	}
	byID := make(map[int]*advisorFetch, len(fetches))
	for i, fetch := range fetches {
		if fetch == nil {
			return fmt.Errorf("advisor fetch %d is nil", i+1)
		}
		if _, exists := byID[fetch.fetchID]; exists {
			return fmt.Errorf("advisor fetch model contains duplicate fetch id %d", fetch.fetchID)
		}
		byID[fetch.fetchID] = fetch
	}
	for _, fetch := range fetches {
		for _, dependencyID := range fetch.dependsOn {
			if _, exists := byID[dependencyID]; !exists {
				return fmt.Errorf("advisor fetch %d (%s) depends on missing fetch %d", fetch.fetchID, fetch.subgraph, dependencyID)
			}
		}
	}
	if err := validateAdvisorFetchDAG(fetches, byID); err != nil {
		return fmt.Errorf("advisor fetch model is invalid: %w", err)
	}

	fieldOwner := make(map[advisorFieldKey]int)
	for _, fetch := range fetches {
		if len(fetch.durationsMs) != runs {
			return fmt.Errorf("fetch %d (%s) duration sample count %d does not match runs %d", fetch.fetchID, fetch.subgraph, len(fetch.durationsMs), runs)
		}
		for sampleIndex, sample := range fetch.durationsMs {
			if !isFiniteNonNegative(sample) {
				return fmt.Errorf("fetch %d (%s) duration sample %d must be finite and non-negative", fetch.fetchID, fetch.subgraph, sampleIndex+1)
			}
		}

		knownFields := make(map[string]struct{}, len(fetch.fields))
		for _, field := range fetch.fields {
			knownFields[field] = struct{}{}
		}
		measurementFields := make([]string, 0, len(fetch.fieldLatenciesMs))
		for field := range fetch.fieldLatenciesMs {
			measurementFields = append(measurementFields, field)
		}
		slices.Sort(measurementFields)
		for _, field := range measurementFields {
			if _, exists := knownFields[field]; !exists {
				return fmt.Errorf("fetch %d (%s) has samples for unknown field %q", fetch.fetchID, fetch.subgraph, field)
			}
		}
		if len(fetch.dependsOn) == 0 && len(measurementFields) != 0 {
			return fmt.Errorf("root fetch %d (%s) has unexpected field samples", fetch.fetchID, fetch.subgraph)
		}

		if len(measurementFields) == 0 {
			continue
		}
		measuredFields := 0
		for _, field := range fetch.fields {
			samples, present := fetch.fieldLatenciesMs[field]
			if !present {
				continue
			}
			measuredFields++
			if len(samples) != runs {
				return fmt.Errorf("fetch %d (%s) field %q sample count %d does not match runs %d", fetch.fetchID, fetch.subgraph, field, len(samples), runs)
			}
			for sampleIndex, sample := range samples {
				if !isFiniteNonNegative(sample) {
					return fmt.Errorf("fetch %d (%s) field %q sample %d must be finite and non-negative", fetch.fetchID, fetch.subgraph, field, sampleIndex+1)
				}
			}
		}
		if measuredFields != len(fetch.fields) {
			return fmt.Errorf("fetch %d (%s) has incomplete field measurements: %d of %d fields sampled", fetch.fetchID, fetch.subgraph, measuredFields, len(fetch.fields))
		}
		for _, field := range fetch.fields {
			identity := advisorFieldIdentity(fetch, field)
			if previousFetchID, exists := fieldOwner[identity]; exists {
				return fmt.Errorf("fetches %d and %d share advisor field identity %q", previousFetchID, fetch.fetchID, identity.String())
			}
			fieldOwner[identity] = fetch.fetchID
		}
	}
	return nil
}

type advisorFieldKey struct {
	subgraph string
	path     string
	field    string
}

func advisorFieldIdentity(fetch *advisorFetch, field string) advisorFieldKey {
	return advisorFieldKey{
		subgraph: fetch.subgraph,
		path:     strings.Join(fetch.clientParentPath, "."),
		field:    field,
	}
}

func (k advisorFieldKey) String() string {
	if k.path == "" {
		return k.subgraph + ":" + k.field
	}
	return k.subgraph + ":" + k.path + ":" + k.field
}

func isFiniteNonNegative(value float64) bool {
	return value >= 0 && !math.IsNaN(value) && !math.IsInf(value, 0)
}
