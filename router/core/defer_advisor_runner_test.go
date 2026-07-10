package core

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func advisorRunnerRequest(t *testing.T, ctx context.Context) *http.Request {
	t.Helper()
	return httptest.NewRequest(http.MethodPost, "http://router.example/graphql", nil).WithContext(ctx)
}

func TestDeferAdvisorLoopbackRunnerConsumesBudgetAndExecutesTheTarget(t *testing.T) {
	t.Parallel()

	budget := newDeferAdvisorReplayBudget(1)
	ctx := withDeferAdvisorReplayBudget(context.Background(), budget)
	var targetCalls int
	runner := newDeferAdvisorLoopbackRunner(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		targetCalls++
		assert.Equal(t, "configured", r.Header.Get("X-Test"))
		assert.Equal(t, "application/json", r.Header.Get("Accept"))
		body := new(bytes.Buffer)
		_, err := body.ReadFrom(r.Body)
		require.NoError(t, err)
		assert.JSONEq(t, `{"query":"query { value }"}`, body.String())
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"data":{"value":true}}`))
	}))

	recorder, elapsed, err := runner.run(
		advisorRunnerRequest(t, ctx),
		[]byte(`{"query":"query { value }"}`),
		func(request *http.Request) { request.Header.Set("X-Test", "configured") },
	)

	require.NoError(t, err)
	require.NotNil(t, recorder)
	assert.Equal(t, http.StatusCreated, recorder.status)
	assert.JSONEq(t, `{"data":{"value":true}}`, string(recorder.fullBody()))
	assert.GreaterOrEqual(t, elapsed, time.Duration(0))
	assert.Equal(t, 1, targetCalls)
	assert.Equal(t, uint32(1), budget.used.Load())
}

func TestDeferAdvisorLoopbackRunnerRejectsMissingOrExhaustedBudgets(t *testing.T) {
	t.Parallel()

	var targetCalls int
	runner := newDeferAdvisorLoopbackRunner(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		targetCalls++
	}))

	_, _, err := runner.run(advisorRunnerRequest(t, context.Background()), nil, nil)
	require.EqualError(t, err, "defer advisor replay budget is not configured")

	budget := newDeferAdvisorReplayBudget(0)
	ctx := withDeferAdvisorReplayBudget(context.Background(), budget)
	_, _, err = runner.run(advisorRunnerRequest(t, ctx), nil, nil)
	assert.ErrorIs(t, err, errDeferAdvisorReplayBudgetExhausted)
	assert.Zero(t, targetCalls)
}

func TestDeferAdvisorLoopbackRunnerDoesNotSpendBudgetAfterCancellation(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	budget := newDeferAdvisorReplayBudget(1)
	ctx = withDeferAdvisorReplayBudget(ctx, budget)
	runner := newDeferAdvisorLoopbackRunner(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("target must not run")
	}))

	_, _, err := runner.run(advisorRunnerRequest(t, ctx), nil, nil)

	assert.ErrorIs(t, err, context.Canceled)
	assert.Equal(t, uint32(0), budget.used.Load())
}

func TestDeferAdvisorLoopbackRunnerTimesOutAReplay(t *testing.T) {
	t.Parallel()

	budget := newDeferAdvisorReplayBudget(1)
	ctx := withDeferAdvisorReplayBudget(context.Background(), budget)
	runner := newDeferAdvisorLoopbackRunner(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	runner.timeout = 10 * time.Millisecond

	_, _, err := runner.run(advisorRunnerRequest(t, ctx), nil, nil)

	assert.ErrorIs(t, err, errDeferAdvisorReplayTimeout)
	assert.Equal(t, uint32(1), budget.used.Load())
}

func TestDeferAdvisorLoopbackRunnerCancelsOnRecorderOverflow(t *testing.T) {
	t.Parallel()

	budget := newDeferAdvisorReplayBudget(1)
	ctx := withDeferAdvisorReplayBudget(context.Background(), budget)
	contextCanceled := make(chan struct{})
	runner := newDeferAdvisorLoopbackRunner(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, err := w.Write([]byte("too large"))
		assert.ErrorIs(t, err, errLoopbackResponseTooLarge)
		if errors.Is(r.Context().Err(), context.Canceled) {
			close(contextCanceled)
		}
	}))
	runner.limits = loopbackRecorderLimits{maxBytes: 1, maxSegments: 1}

	recorder, _, err := runner.run(advisorRunnerRequest(t, ctx), nil, nil)

	assert.ErrorIs(t, err, errLoopbackResponseTooLarge)
	require.NotNil(t, recorder)
	assert.ErrorIs(t, recorder.err, errLoopbackResponseTooLarge)
	assert.Equal(t, uint32(1), budget.used.Load())
	select {
	case <-contextCanceled:
	default:
		t.Fatal("overflow did not cancel the replay context")
	}
}

func TestDeferAdvisorLoopbackRunnerRequiresATarget(t *testing.T) {
	t.Parallel()

	budget := newDeferAdvisorReplayBudget(1)
	ctx := withDeferAdvisorReplayBudget(context.Background(), budget)
	runner := newDeferAdvisorLoopbackRunner(nil)

	_, _, err := runner.run(advisorRunnerRequest(t, ctx), nil, nil)

	require.EqualError(t, err, "defer advisor loopback target is not configured")
	assert.Equal(t, uint32(0), budget.used.Load())
}
