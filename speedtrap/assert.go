package speedtrap

import "testing"

// reportFailures logs each failure as a t.Errorf call.
func reportFailures(t *testing.T, failures []Failure) {
	t.Helper()
	for _, f := range failures {
		t.Errorf("%s", f.Message)
	}
}

// AssertScenario runs a scenario and reports failures with t.Error (non-fatal).
// Returns the ScenarioResult for further inspection.
func AssertScenario(t *testing.T, cfg HarnessConfig, s Scenario) ScenarioResult {
	t.Helper()
	result := RunScenario(cfg, s)
	if !result.Passed {
		reportFailures(t, result.Failures)
	}
	return result
}

// RequireScenario runs a scenario and stops the test with t.FailNow if it fails.
func RequireScenario(t *testing.T, cfg HarnessConfig, s Scenario) {
	t.Helper()
	result := RunScenario(cfg, s)
	if !result.Passed {
		reportFailures(t, result.Failures)
		t.FailNow()
	}
}
