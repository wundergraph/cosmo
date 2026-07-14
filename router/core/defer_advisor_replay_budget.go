package core

import (
	"context"
	"errors"
	"fmt"
	"sync/atomic"
)

// The publishable workflow performs one plan replay plus runs baseline,
// max-split, and measured optimized-stream replays.
const deferAdvisorMaxLoopbacks = 1 + 3*deferAdvisorMaxRuns

var errDeferAdvisorReplayBudgetExhausted = errors.New("defer advisor replay budget exhausted")

type deferAdvisorReplayBudget struct {
	limit uint32
	used  atomic.Uint32
}

func newDeferAdvisorReplayBudget(limit uint32) *deferAdvisorReplayBudget {
	return &deferAdvisorReplayBudget{limit: limit}
}

func (b *deferAdvisorReplayBudget) take() error {
	for {
		used := b.used.Load()
		if used >= b.limit {
			return fmt.Errorf("%w after %d loopbacks", errDeferAdvisorReplayBudgetExhausted, b.limit)
		}
		if b.used.CompareAndSwap(used, used+1) {
			return nil
		}
	}
}

type deferAdvisorReplayBudgetContextKey struct{}

func withDeferAdvisorReplayBudget(ctx context.Context, budget *deferAdvisorReplayBudget) context.Context {
	return context.WithValue(ctx, deferAdvisorReplayBudgetContextKey{}, budget)
}

func deferAdvisorReplayBudgetFromContext(ctx context.Context) *deferAdvisorReplayBudget {
	budget, _ := ctx.Value(deferAdvisorReplayBudgetContextKey{}).(*deferAdvisorReplayBudget)
	return budget
}
