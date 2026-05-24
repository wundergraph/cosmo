package speedtrap

import "time"

// Failure represents a single test failure within a scenario.
type Failure struct {
	Message string `json:"message"`
	Fatal   bool   `json:"fatal"`
}

// ScenarioResult captures the outcome of running a single scenario.
type ScenarioResult struct {
	Name     string        `json:"name"`
	Passed   bool          `json:"passed"`
	Duration time.Duration `json:"duration"`
	Failures []Failure     `json:"failures,omitempty"`
}
