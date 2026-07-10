package core

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"
)

const deferAdvisorDefaultReplayTimeout = 30 * time.Second

var errDeferAdvisorReplayTimeout = errors.New("defer advisor replay timed out")

type deferAdvisorLoopbackRunner struct {
	target  http.Handler
	timeout time.Duration
	limits  loopbackRecorderLimits
}

func newDeferAdvisorLoopbackRunner(target http.Handler) deferAdvisorLoopbackRunner {
	return deferAdvisorLoopbackRunner{
		target:  target,
		timeout: deferAdvisorDefaultReplayTimeout,
		limits: loopbackRecorderLimits{
			maxBytes:    deferAdvisorMaxLoopbackResponseBytes,
			maxSegments: deferAdvisorMaxLoopbackSegments,
		},
	}
}

func (r deferAdvisorLoopbackRunner) run(parent *http.Request, body []byte, configure func(*http.Request)) (*loopbackRecorder, time.Duration, error) {
	if r.target == nil {
		return nil, 0, fmt.Errorf("defer advisor loopback target is not configured")
	}
	if err := parent.Context().Err(); err != nil {
		return nil, 0, fmt.Errorf("defer advisor replay canceled before execution: %w", err)
	}
	budget := deferAdvisorReplayBudgetFromContext(parent.Context())
	if budget == nil {
		return nil, 0, fmt.Errorf("defer advisor replay budget is not configured")
	}
	if err := budget.take(); err != nil {
		return nil, 0, err
	}

	request, err := newDeferAdvisorLoopbackRequest(parent, body)
	if err != nil {
		return nil, 0, err
	}
	if configure != nil {
		configure(request)
	}
	timeout := r.timeout
	if timeout <= 0 {
		timeout = deferAdvisorDefaultReplayTimeout
	}
	replayCtx, cancel := context.WithTimeout(request.Context(), timeout)
	defer cancel()
	request = request.WithContext(replayCtx)

	limits := r.limits
	if limits.maxBytes <= 0 {
		limits.maxBytes = deferAdvisorMaxLoopbackResponseBytes
	}
	if limits.maxSegments <= 0 {
		limits.maxSegments = deferAdvisorMaxLoopbackSegments
	}
	start := time.Now()
	recorder := newLoopbackRecorderWithLimitsAndCancel(start, limits, cancel)
	r.target.ServeHTTP(recorder, request)
	elapsed := time.Since(start)
	if recorder.err != nil {
		return recorder, elapsed, recorder.err
	}
	if err := replayCtx.Err(); err != nil {
		if errors.Is(err, context.DeadlineExceeded) && parent.Context().Err() == nil {
			return recorder, elapsed, fmt.Errorf("%w after %s", errDeferAdvisorReplayTimeout, timeout)
		}
		return recorder, elapsed, fmt.Errorf("defer advisor replay canceled during execution: %w", err)
	}
	return recorder, elapsed, nil
}
