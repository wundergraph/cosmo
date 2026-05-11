package mcpserver

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap/zaptest"
)

func TestWatchOperationsDir_LeadingEdgeFiresOnFirstChange(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "seed.graphql"), []byte("query Seed { id }"), 0o600))

	fired := make(chan time.Time, 8)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	interval := 50 * time.Millisecond
	require.NoError(t, WatchOperationsDir(ctx, dir, interval, func() {
		fired <- time.Now()
	}, zaptest.NewLogger(t)))

	// Allow the watcher to take its baseline snapshot.
	time.Sleep(interval)

	writeAt := time.Now()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "new.graphql"), []byte("query New { id }"), 0o600))

	select {
	case firedAt := <-fired:
		// Leading-edge: should fire on the first tick that detects the change
		// (roughly within one interval), not after a separate settle tick.
		latency := firedAt.Sub(writeAt)
		require.Less(t, latency, 2*interval, "first fire should arrive within ~1 interval, got %s", latency)
	case <-time.After(time.Second):
		t.Fatal("watcher did not fire after a file was added")
	}
}

func TestWatchOperationsDir_BurstCoalescedWithTrailingFire(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()

	var calls atomic.Int32
	var firedAt []time.Time
	var mu sync.Mutex

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	interval := 50 * time.Millisecond
	require.NoError(t, WatchOperationsDir(ctx, dir, interval, func() {
		mu.Lock()
		firedAt = append(firedAt, time.Now())
		mu.Unlock()
		calls.Add(1)
	}, zaptest.NewLogger(t)))

	// Baseline snapshot.
	time.Sleep(interval)

	// Simulate an editor that touches the file several times in quick
	// succession (formatter rewrite, atomic rename, autosave).
	path := filepath.Join(dir, "ops.graphql")
	for i := 0; i < 5; i++ {
		require.NoError(t, os.WriteFile(path, []byte("query A { x }"), 0o600))
		time.Sleep(interval / 2)
	}

	// Wait long enough for the trailing fire to land.
	time.Sleep(4 * interval)

	got := calls.Load()
	// Leading fire + at most one trailing fire — bursts must not produce one
	// fire per touch.
	require.GreaterOrEqual(t, got, int32(1), "should have fired at least once")
	require.LessOrEqual(t, got, int32(2), "burst should be coalesced into ≤2 fires, got %d", got)
}

func TestWatchOperationsDir_NoFireWithoutChanges(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "seed.graphql"), []byte("query Seed { id }"), 0o600))

	var calls atomic.Int32
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	interval := 30 * time.Millisecond
	require.NoError(t, WatchOperationsDir(ctx, dir, interval, func() {
		calls.Add(1)
	}, zaptest.NewLogger(t)))

	time.Sleep(5 * interval)
	require.Zero(t, calls.Load(), "watcher must not fire when nothing changes")
}
