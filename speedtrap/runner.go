package speedtrap

import "time"

const defaultTimeout = 5 * time.Second

// RunScenario executes a single scenario against the configured proxy and backends.
// It returns the result including pass/fail status, duration, and any collected failures.
func RunScenario(cfg HarnessConfig, s Scenario) ScenarioResult {
	timeout := cfg.Timeout
	if timeout == 0 {
		timeout = defaultTimeout
	}

	t := &S{
		targetAddr: cfg.TargetAddr,
		backends:   cfg.Backends,
		timeout:    timeout,
	}

	start := time.Now()

	done := make(chan struct{})
	go func() {
		defer close(done)
		s.Run(t)
	}()
	<-done

	t.cleanup()

	for _, b := range cfg.Backends {
		b.drain()
	}

	return ScenarioResult{
		Name:     s.Name,
		Passed:   !t.failed(),
		Duration: time.Since(start),
		Failures: t.failures,
	}
}
