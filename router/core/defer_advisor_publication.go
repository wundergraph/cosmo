package core

import "fmt"

func finalizeAdvisorResult(result *deferAdvisorResult, optimizedQuery string, aggregate *advisorValidationAggregate, outcome deferAdvisorOutcome, reason string) error {
	if result == nil {
		return fmt.Errorf("defer advisor cannot finalize a nil result")
	}

	switch outcome {
	case deferAdvisorOutcomeRecommended:
		if aggregate == nil {
			return fmt.Errorf("defer advisor recommended outcome requires measured validation")
		}
		if len(result.Suggestions) == 0 {
			return fmt.Errorf("defer advisor recommended outcome requires at least one suggestion")
		}
		if optimizedQuery == "" {
			return fmt.Errorf("defer advisor recommended outcome requires an optimized query")
		}
		result.Outcome = outcome
		result.Reason = ""
		result.OptimizedQuery = optimizedQuery
		result.Validation = publishAdvisorValidation(aggregate)
		return nil

	case deferAdvisorOutcomeNoGain, deferAdvisorOutcomeRegression:
		if aggregate == nil {
			return fmt.Errorf("defer advisor %s outcome requires measured validation", outcome)
		}
		result.Validation = publishAdvisorValidation(aggregate)

	case deferAdvisorOutcomeNoCandidates,
		deferAdvisorOutcomeInconclusive,
		deferAdvisorOutcomeUnvalidated:
		result.Validation = nil

	default:
		return fmt.Errorf("defer advisor cannot publish unknown outcome %q", outcome)
	}

	result.Outcome = outcome
	result.Reason = reason
	if result.Reason == "" {
		result.Reason = defaultAdvisorOutcomeReason(outcome)
	}
	result.Suggestions = make([]deferAdvisorSuggestion, 0)
	result.OptimizedQuery = ""
	return nil
}

func publishAdvisorValidation(aggregate *advisorValidationAggregate) *deferAdvisorValidation {
	if aggregate == nil {
		return nil
	}
	validation := &deferAdvisorValidation{
		Runs:                    aggregate.runs,
		InitialResponseMs:       aggregate.initialResponseMs,
		TotalResponseMs:         aggregate.totalResponseMs,
		InitialResponseSavingMs: aggregate.initialResponseSavingMs,
		DeferredParts:           make([]deferAdvisorValidationPart, 0, len(aggregate.deferredParts)),
	}
	for _, part := range aggregate.deferredParts {
		validation.DeferredParts = append(validation.DeferredParts, deferAdvisorValidationPart{
			Label:       part.label,
			ArrivedAtMs: part.arrivedAtMs,
		})
	}
	return validation
}

func defaultAdvisorOutcomeReason(outcome deferAdvisorOutcome) string {
	switch outcome {
	case deferAdvisorOutcomeNoCandidates:
		return "No field met the conservative defer thresholds."
	case deferAdvisorOutcomeNoGain:
		return "The measured optimized stream did not improve the initial response consistently enough."
	case deferAdvisorOutcomeRegression:
		return "The measured optimized stream regressed initial or total response time."
	case deferAdvisorOutcomeInconclusive:
		return "The advisor could not validate an optimization safely."
	case deferAdvisorOutcomeUnvalidated:
		return "Optimized stream validation was skipped, so no suggestion is actionable."
	default:
		return ""
	}
}
