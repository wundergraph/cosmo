package batchprocessor

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// Push must report that the processor is stopped instead of panicking. The
// manager closes the queue when it exits, so a select that still offers
// "send to queue" can choose the closed channel and panic.
func TestPushAfterStopReturnsError(t *testing.T) {
	bp := New(Options[int]{
		MaxQueueSize:  4,
		CostFunc:      func(batch []int) int { return len(batch) },
		CostThreshold: 100,
		Dispatcher:    func(context.Context, []int) {},
		Interval:      time.Hour,
	})

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	require.NoError(t, bp.StopAndWait(ctx))

	for range 100 {
		require.Error(t, bp.Push(1), "Push after StopAndWait must fail")
	}
}
