package watcher_test

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/watcher"
	"go.uber.org/zap"
	"golang.org/x/sync/errgroup"
)

var (
	watchInterval = 10 * time.Millisecond
)

type CallbackSpy struct {
	calls int
	mu    sync.Mutex
}

func (c *CallbackSpy) Call() {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.calls++
}

func TestWatch(t *testing.T) {
	t.Parallel()

	t.Run("create and move", func(t *testing.T) {
		t.Parallel()

		var err error

		dir := t.TempDir()
		tempFile := filepath.Join(dir, "config.json")
		tempFile2 := filepath.Join(dir, "config2.json")

		err = os.WriteFile(tempFile, []byte("a"), 0o600)
		require.NoError(t, err)

		err = os.WriteFile(tempFile2, []byte("b"), 0o600)
		require.NoError(t, err)

		wg := sync.WaitGroup{}

		eg, ctx := errgroup.WithContext(context.Background())
		eg.Go(func() error {
			return watcher.SimpleWatch(ctx, zap.NewNop(), watchInterval, tempFile, func() {
				wg.Done()
			})
		})

		// Wait for the first cycle to complete to set baseline
		time.Sleep(2 * watchInterval)

		wg.Add(1)

		// Move the file away, wait a cycle and then move it back
		err = os.Rename(tempFile2, tempFile)
		require.NoError(t, err)

		// Should get an event for the new file
		waitTimeout(&wg, waitForEvents)
	})

	t.Run("modify an existing file", func(t *testing.T) {
		t.Parallel()
		ctx := context.Background()

		dir := t.TempDir()
		tempFile := filepath.Join(dir, "config.json")

		err := os.WriteFile(tempFile, []byte("a"), 0o600)
		require.NoError(t, err)

		wg := sync.WaitGroup{}

		eg, ctx := errgroup.WithContext(ctx)
		eg.Go(func() error {
			return watcher.SimpleWatch(ctx, zap.NewNop(), watchInterval, tempFile, func() {
				wg.Done()
			})
		})

		// Wait for the first cycle to complete to set baseline
		time.Sleep(2 * watchInterval)

		wg.Add(1)

		err = os.WriteFile(tempFile, []byte("b"), 0o600)
		require.NoError(t, err)

		waitTimeout(&wg, waitForEvents)
	})

	t.Run("delete and replace a file", func(t *testing.T) {
		t.Parallel()
		ctx := context.Background()

		dir := t.TempDir()
		tempFile := filepath.Join(dir, "config.json")

		err := os.WriteFile(tempFile, []byte("a"), 0o600)
		require.NoError(t, err)

		wg := sync.WaitGroup{}

		eg, ctx := errgroup.WithContext(ctx)
		eg.Go(func() error {
			return watcher.SimpleWatch(ctx, zap.NewNop(), watchInterval, tempFile, func() {
				wg.Done()
			})
		})

		// Wait for the first cycle to complete to set baseline
		time.Sleep(2 * watchInterval)

		wg.Add(1)

		// Delete the file, wait a cycle and then recreate it
		os.Remove(tempFile)

		time.Sleep(2 * watchInterval)

		err = os.WriteFile(tempFile, []byte("b"), 0o600)
		require.NoError(t, err)

		// Should get an event for the new file
		waitTimeout(&wg, waitForEvents)
	})

	t.Run("move and replace a file", func(t *testing.T) {
		t.Parallel()
		ctx := context.Background()

		dir := t.TempDir()
		tempFile := filepath.Join(dir, "config.json")
		tempFile2 := filepath.Join(dir, "config2.json")

		err := os.WriteFile(tempFile, []byte("a"), 0o600)
		require.NoError(t, err)

		wg := sync.WaitGroup{}

		eg, ctx := errgroup.WithContext(ctx)
		eg.Go(func() error {
			return watcher.SimpleWatch(ctx, zap.NewNop(), watchInterval, tempFile, func() {
				wg.Done()
			})
		})

		// Wait for the first cycle to complete to set baseline
		time.Sleep(2 * watchInterval)

		wg.Add(1)

		// Move the file away, wait a cycle and then move it back
		err = os.Rename(tempFile, tempFile2)
		require.NoError(t, err)

		time.Sleep(2 * watchInterval)

		err = os.Rename(tempFile2, tempFile)
		require.NoError(t, err)

		// Should get an event for the moved file, even if its identical
		waitTimeout(&wg, waitForEvents)
	})

	t.Run("kubernetes-like symlinks", func(t *testing.T) {
		t.Parallel()
		ctx := context.Background()
		dir := t.TempDir()

		/*
			In this test, we set up a symlink chain like this:

				config.json -> linked_folder/config.json
				linked_folder -> actual_folder
				actual_folder/config.json is real file

			This mimics what Kubernetes does when you mount a ConfigMap as a file.
			We want to ensure that changes to the real file beneath multiple layers
			of symlinks are still detected.
		*/

		watchedFile := filepath.Join(dir, "config.json")

		linkedFolder := filepath.Join(dir, "linked_folder")
		linkedFile := filepath.Join(linkedFolder, "config.json")

		realFolder := filepath.Join(dir, "real_folder")
		realFile := filepath.Join(realFolder, "config.json")

		require.NoError(t, os.Mkdir(realFolder, 0o700))
		require.NoError(t, os.WriteFile(realFile, []byte("a"), 0o600))

		require.NoError(t, os.Symlink(realFolder, linkedFolder))
		require.NoError(t, os.Symlink(linkedFile, watchedFile))

		wg := sync.WaitGroup{}

		eg, ctx := errgroup.WithContext(ctx)
		eg.Go(func() error {
			return watcher.SimpleWatch(ctx, zap.NewNop(), watchInterval, watchedFile, func() {
				wg.Done()
			})
		})

		// Wait for the first cycle to complete to set baseline
		time.Sleep(2 * watchInterval)

		wg.Add(1)

		require.NoError(t, os.WriteFile(realFile, []byte("b"), 0o600))

		waitTimeout(&wg, waitForEvents)
	})
}

func TestCancel(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	dir := t.TempDir()
	tempFile := filepath.Join(dir, "config.json")

	err := os.WriteFile(tempFile, []byte("a"), 0o600)
	require.NoError(t, err)

	ctx, cancel := context.WithTimeout(ctx, waitForEvents)

	eg, ctx := errgroup.WithContext(ctx)
	eg.Go(func() error {
		return watcher.SimpleWatch(ctx, zap.NewNop(), watchInterval, tempFile, func() {})
	})

	cancel()
	err = eg.Wait()
	require.ErrorIs(t, err, context.Canceled)
}

// !! THIS FUNCTION LEAKS GOROUTINES !!
// In a timeout scenario, the "monitor" goroutine will be leaked.
func waitTimeout(wg *sync.WaitGroup, timeout time.Duration) bool {
	completed := make(chan struct{})

	// Leaks in a fail case
	go func() {
		defer close(completed)
		wg.Wait()
	}()

	select {
	case <-completed:
		return true // completed
	case <-time.After(timeout):
		return false // timed out
	}
}
