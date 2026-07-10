package core

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDeferAdvisorReplayBudget(t *testing.T) {
	t.Parallel()

	budget := newDeferAdvisorReplayBudget(2)
	require.NoError(t, budget.take())
	require.NoError(t, budget.take())
	err := budget.take()
	assert.True(t, errors.Is(err, errDeferAdvisorReplayBudgetExhausted))
	require.EqualError(t, err, "defer advisor replay budget exhausted after 2 loopbacks")
	assert.Equal(t, uint32(2), budget.used.Load())

	zero := newDeferAdvisorReplayBudget(0)
	require.EqualError(t, zero.take(), "defer advisor replay budget exhausted after 0 loopbacks")
	assert.Equal(t, uint32(0), zero.used.Load())
}

func TestDeferAdvisorReplayBudgetIsAtomic(t *testing.T) {
	t.Parallel()

	const (
		limit    = 10
		attempts = 100
	)
	budget := newDeferAdvisorReplayBudget(uint32(limit))
	var successes atomic.Int64
	var waitGroup sync.WaitGroup
	for range attempts {
		waitGroup.Go(func() {
			if budget.take() == nil {
				successes.Add(1)
			}
		})
	}
	waitGroup.Wait()

	assert.Equal(t, int64(limit), successes.Load())
}

func TestDeferAdvisorMaximumReplayBudgetMatchesEveryMeasuredPhase(t *testing.T) {
	t.Parallel()

	assert.Equal(t, 31, deferAdvisorMaxLoopbacks)
	assert.Equal(t, 1+3*deferAdvisorMaxRuns, deferAdvisorMaxLoopbacks)
}

func TestDeferAdvisorReplayBudgetContext(t *testing.T) {
	t.Parallel()

	budget := newDeferAdvisorReplayBudget(1)
	ctx := withDeferAdvisorReplayBudget(context.Background(), budget)

	assert.Same(t, budget, deferAdvisorReplayBudgetFromContext(ctx))
	assert.Nil(t, deferAdvisorReplayBudgetFromContext(context.Background()))
}
