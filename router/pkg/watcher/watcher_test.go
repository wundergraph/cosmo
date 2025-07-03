package watcher_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/test"
	"github.com/wundergraph/cosmo/router/pkg/watcher"
	"go.uber.org/goleak"
	"go.uber.org/zap"
	"golang.org/x/sync/errgroup"
)

func TestMain(m *testing.M) {
	goleak.VerifyTestMain(m)
}

var (
	// The watch interval does not matter technically since we control when we send the ticks
	watchInterval = 50 * time.Millisecond
	testTimeout   = 5 * time.Second
)

func TestOptionsValidation(t *testing.T) {
	t.Parallel()

	t.Run("interval is zero", func(t *testing.T) {
		t.Parallel()

		_, err := watcher.New(watcher.Options{
			Interval: 0,
		})
		if assert.Error(t, err) {
			assert.ErrorContains(t, err, "interval must be greater than zero")
		}
	})

	t.Run("logger not provided", func(t *testing.T) {
		t.Parallel()

		_, err := watcher.New(watcher.Options{
			Interval: watchInterval,
			Logger:   nil,
		})
		if assert.Error(t, err) {
			assert.ErrorContains(t, err, "logger must be provided")
		}
	})

	t.Run("path not provided", func(t *testing.T) {
		t.Parallel()

		t.Run("nil path slice", func(t *testing.T) {
			_, err := watcher.New(watcher.Options{
				Interval: watchInterval,
				Logger:   zap.NewNop(),
				Paths:    nil,
			})
			if assert.Error(t, err) {
				assert.ErrorContains(t, err, "path must be provided")
			}
		})

		t.Run("empty path slice", func(t *testing.T) {
			_, err := watcher.New(watcher.Options{
				Interval: watchInterval,
				Logger:   zap.NewNop(),
				Paths:    []string{},
			})
			if assert.Error(t, err) {
				assert.ErrorContains(t, err, "path must be provided")
			}
		})
	})

	t.Run("callback not provided", func(t *testing.T) {
		t.Parallel()

		_, err := watcher.New(watcher.Options{
			Interval: watchInterval,
			Logger:   zap.NewNop(),
			Paths:    []string{"valid_path.txt"},
			Callback: nil,
		})
		if assert.Error(t, err) {
			assert.ErrorContains(t, err, "callback must be provided")
		}
	})
}

func TestWatch(t *testing.T) {
	t.Parallel()

	t.Run("create and move", func(t *testing.T) {
		t.Parallel()
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		dir := t.TempDir()
		tempFile := filepath.Join(dir, "config.json")
		require.NoError(t, os.WriteFile(tempFile, []byte("a"), 0o600))

		spy := test.NewCallSpy()

		tickerChan := make(chan time.Time)
		watchFunc, err := watcher.New(watcher.Options{
			Interval:   watchInterval,
			Logger:     zap.NewNop(),
			Paths:      []string{tempFile},
			Callback:   spy.Call,
			TickSource: tickerChan,
		})
		require.NoError(t, err)

		go func() {
			_ = watchFunc(ctx)
		}()

		// Wait for the first two cycles to complete to set baseline
		sendTick(tickerChan)
		sendTick(tickerChan)

		tempFile2 := filepath.Join(dir, "config2.json")

		require.NoError(t, os.WriteFile(tempFile2, []byte("b"), 0o600))
		sendTick(tickerChan)

		// Move new file ontop of the old file
		require.NoError(t, os.Rename(tempFile2, tempFile))
		sendTick(tickerChan)
		spy.AssertCalled(t, 0)

		// Trigger callback
		sendTick(tickerChan)
		spy.AssertCalled(t, 1)

	})

	t.Run("create and move for multiple files", func(t *testing.T) {
		t.Parallel()
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		dir := t.TempDir()
		tempFileA1 := filepath.Join(dir, "config_a_1.json")
		require.NoError(t, os.WriteFile(tempFileA1, []byte("a"), 0o600))

		tempFileB1 := filepath.Join(dir, "config_b_1.json")
		require.NoError(t, os.WriteFile(tempFileB1, []byte("ee"), 0o600))

		tempFileC1 := filepath.Join(dir, "config_c_1.json")
		require.NoError(t, os.WriteFile(tempFileC1, []byte("ee"), 0o600))

		spy := test.NewCallSpy()

		tickerChan := make(chan time.Time)
		watchFunc, err := watcher.New(watcher.Options{
			Interval:   watchInterval,
			Logger:     zap.NewNop(),
			Paths:      []string{tempFileA1, tempFileB1, tempFileC1},
			Callback:   spy.Call,
			TickSource: tickerChan,
		})
		require.NoError(t, err)

		go func() {
			_ = watchFunc(ctx)
		}()

		sendTick(tickerChan)
		sendTick(tickerChan)

		tempFileA2 := filepath.Join(dir, "config_a_2.json")
		tempFileB2 := filepath.Join(dir, "config_b_2.json")

		require.NoError(t, os.WriteFile(tempFileA2, []byte("ab1"), 0o600))
		require.NoError(t, os.WriteFile(tempFileB2, []byte("ab2"), 0o600))

		sendTick(tickerChan)

		require.NoError(t, os.Rename(tempFileA2, tempFileA1))
		sendTick(tickerChan)
		sendTick(tickerChan)
		spy.AssertCalled(t, 1)

		require.NoError(t, os.Rename(tempFileB2, tempFileB1))
		sendTick(tickerChan)
		sendTick(tickerChan)
		spy.AssertCalled(t, 2)
	})

	t.Run("modify an existing file", func(t *testing.T) {
		t.Parallel()

		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		dir := t.TempDir()
		tempFile := filepath.Join(dir, "config.json")

		require.NoError(t, os.WriteFile(tempFile, []byte("a"), 0o600))

		spy := test.NewCallSpy()

		tickerChan := make(chan time.Time)
		watchFunc, err := watcher.New(watcher.Options{
			Interval:   watchInterval,
			Logger:     zap.NewNop(),
			Paths:      []string{tempFile},
			Callback:   spy.Call,
			TickSource: tickerChan,
		})
		require.NoError(t, err)

		go func() {
			_ = watchFunc(ctx)
		}()

		// Wait for the first two cycles to complete to set baseline
		sendTick(tickerChan)
		sendTick(tickerChan)

		require.NoError(t, os.WriteFile(tempFile, []byte("b"), 0o600))

		sendTick(tickerChan)
		sendTick(tickerChan)

		spy.AssertCalled(t, 1)
	})

	t.Run("modify multiple existing files", func(t *testing.T) {
		t.Parallel()

		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		dir := t.TempDir()
		tempFile1 := filepath.Join(dir, "config_1.json")
		tempFile2 := filepath.Join(dir, "config_2.json")
		tempFile3 := filepath.Join(dir, "config_3.json")

		require.NoError(t, os.WriteFile(tempFile1, []byte("a1"), 0o600))
		require.NoError(t, os.WriteFile(tempFile2, []byte("a2"), 0o600))
		require.NoError(t, os.WriteFile(tempFile3, []byte("a3"), 0o600))

		spy := test.NewCallSpy()

		tickerChan := make(chan time.Time)
		watchFunc, err := watcher.New(watcher.Options{
			Interval:   watchInterval,
			Logger:     zap.NewNop(),
			Paths:      []string{tempFile1, tempFile2, tempFile3},
			Callback:   spy.Call,
			TickSource: tickerChan,
		})
		require.NoError(t, err)

		go func() {
			_ = watchFunc(ctx)
		}()

		sendTick(tickerChan)
		sendTick(tickerChan)

		require.NoError(t, os.WriteFile(tempFile1, []byte("b1"), 0o600))
		sendTick(tickerChan)
		sendTick(tickerChan)
		spy.AssertCalled(t, 1)

		require.NoError(t, os.WriteFile(tempFile3, []byte("b2"), 0o600))
		sendTick(tickerChan)
		sendTick(tickerChan)
		spy.AssertCalled(t, 2)
	})

	t.Run("delete and replace a file", func(t *testing.T) {
		t.Parallel()

		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		dir := t.TempDir()
		tempFile := filepath.Join(dir, "config.json")

		require.NoError(t, os.WriteFile(tempFile, []byte("a"), 0o600))

		spy := test.NewCallSpy()

		tickerChan := make(chan time.Time)
		watchFunc, err := watcher.New(watcher.Options{
			Interval:   watchInterval,
			Logger:     zap.NewNop(),
			Paths:      []string{tempFile},
			Callback:   spy.Call,
			TickSource: tickerChan,
		})
		require.NoError(t, err)

		go func() {
			_ = watchFunc(ctx)
		}()

		// Wait for the first two cycles to complete to set baseline
		sendTick(tickerChan)
		sendTick(tickerChan)

		// Delete the file, wait a cycle and then recreate it
		require.NoError(t, os.Remove(tempFile))

		// Two cycles will trigger the callback if applicable=
		sendTick(tickerChan)
		sendTick(tickerChan)

		require.NoError(t, os.WriteFile(tempFile, []byte("b"), 0o600))

		sendTick(tickerChan)
		sendTick(tickerChan)

		spy.AssertCalled(t, 1)
	})

	t.Run("delete and replace multiple files", func(t *testing.T) {
		t.Parallel()

		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		dir := t.TempDir()
		tempFile1 := filepath.Join(dir, "config_1.json")
		tempFile2 := filepath.Join(dir, "config_2.json")
		tempFile3 := filepath.Join(dir, "config_3.json")

		require.NoError(t, os.WriteFile(tempFile1, []byte("a"), 0o600))
		require.NoError(t, os.WriteFile(tempFile2, []byte("a"), 0o600))
		require.NoError(t, os.WriteFile(tempFile3, []byte("a"), 0o600))

		spy := test.NewCallSpy()

		tickerChan := make(chan time.Time)
		watchFunc, err := watcher.New(watcher.Options{
			Interval:   watchInterval,
			Logger:     zap.NewNop(),
			Paths:      []string{tempFile1, tempFile2, tempFile3},
			Callback:   spy.Call,
			TickSource: tickerChan,
		})
		require.NoError(t, err)

		go func() {
			_ = watchFunc(ctx)
		}()

		sendTick(tickerChan)

		require.NoError(t, os.Remove(tempFile1))
		sendTick(tickerChan)
		sendTick(tickerChan)
		// File is removed so we should not have a change
		spy.AssertCalled(t, 0)

		require.NoError(t, os.WriteFile(tempFile1, []byte("b"), 0o600))
		sendTick(tickerChan)
		spy.AssertCalled(t, 0)
		sendTick(tickerChan)
		spy.AssertCalled(t, 1)

		require.NoError(t, os.Remove(tempFile3))
		sendTick(tickerChan)

		require.NoError(t, os.WriteFile(tempFile3, []byte("b"), 0o600))
		sendTick(tickerChan)
		sendTick(tickerChan)
		spy.AssertCalled(t, 2)
	})

	t.Run("move and replace a file", func(t *testing.T) {
		t.Parallel()

		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		dir := t.TempDir()
		tempFile := filepath.Join(dir, "config.json")
		tempFile2 := filepath.Join(dir, "config2.json")

		require.NoError(t, os.WriteFile(tempFile, []byte("a"), 0o600))

		spy := test.NewCallSpy()

		tickerChan := make(chan time.Time)
		watchFunc, err := watcher.New(watcher.Options{
			Interval:   watchInterval,
			Logger:     zap.NewNop(),
			Paths:      []string{tempFile},
			Callback:   spy.Call,
			TickSource: tickerChan,
		})
		require.NoError(t, err)

		go func() {
			_ = watchFunc(ctx)
		}()

		sendTick(tickerChan)

		// Move the file away, wait a cycle and then move it back
		require.NoError(t, os.Rename(tempFile, tempFile2))
		sendTick(tickerChan)

		require.NoError(t, os.Rename(tempFile2, tempFile))

		// Two ticks are needed to run the callback
		sendTick(tickerChan)
		sendTick(tickerChan)

		spy.AssertCalled(t, 1)
	})

	t.Run("move and replace multiple files", func(t *testing.T) {
		t.Parallel()

		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		dir := t.TempDir()
		tempFileA1 := filepath.Join(dir, "config_a_1.json")
		tempFileA2 := filepath.Join(dir, "config_a_2.json")

		tempFileB1 := filepath.Join(dir, "config_b_1.json")
		tempFileB2 := filepath.Join(dir, "config_b_2.json")

		tempFileC1 := filepath.Join(dir, "config_c_1.json")

		require.NoError(t, os.WriteFile(tempFileA1, []byte("a"), 0o600))
		require.NoError(t, os.WriteFile(tempFileB1, []byte("a"), 0o600))
		require.NoError(t, os.WriteFile(tempFileC1, []byte("a"), 0o600))

		spy := test.NewCallSpy()

		tickerChan := make(chan time.Time)
		watchFunc, err := watcher.New(watcher.Options{
			Interval:   watchInterval,
			Logger:     zap.NewNop(),
			Paths:      []string{tempFileA1, tempFileB1, tempFileC1},
			Callback:   spy.Call,
			TickSource: tickerChan,
		})
		require.NoError(t, err)

		go func() {
			_ = watchFunc(ctx)
		}()

		sendTick(tickerChan)

		// Single tick, means no callback run
		require.NoError(t, os.Rename(tempFileA1, tempFileA2))
		sendTick(tickerChan)
		spy.AssertCalled(t, 0)

		// Since there were more changes after the first tick, no callback run
		require.NoError(t, os.Rename(tempFileA2, tempFileA1))
		sendTick(tickerChan)
		spy.AssertCalled(t, 0)

		// Trigger callback
		sendTick(tickerChan)
		spy.AssertCalled(t, 1)

		require.NoError(t, os.Rename(tempFileB1, tempFileB2))
		sendTick(tickerChan)
		spy.AssertCalled(t, 1)

		require.NoError(t, os.Rename(tempFileB2, tempFileB1))
		sendTick(tickerChan)
		spy.AssertCalled(t, 1)

		// Trigger callback again
		sendTick(tickerChan)
		spy.AssertCalled(t, 2)
	})

	t.Run("kubernetes-like symlinks", func(t *testing.T) {
		t.Parallel()

		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

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

		spy := test.NewCallSpy()

		tickerChan := make(chan time.Time)

		watchFunc, err := watcher.New(watcher.Options{
			Interval:   watchInterval,
			Logger:     zap.NewNop(),
			Paths:      []string{watchedFile},
			Callback:   spy.Call,
			TickSource: tickerChan,
		})
		require.NoError(t, err)

		go func() {
			_ = watchFunc(ctx)
		}()

		// Wait for the first two cycles to complete to set baseline
		sendTick(tickerChan)
		sendTick(tickerChan)

		require.NoError(t, os.WriteFile(realFile, []byte("b"), 0o600))

		// Change detection tick
		sendTick(tickerChan)

		spy.AssertCalled(t, 0)

		// Callback run tick
		sendTick(tickerChan)

		spy.AssertCalled(t, 1)
	})

	t.Run("kubernetes-like symlinks for multiple files", func(t *testing.T) {
		t.Parallel()

		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		createLinkedFile := func(t *testing.T, dir string, prefix string) (string, string) {
			watchedFile := filepath.Join(dir, prefix+"_config.json")

			linkedFolder := filepath.Join(dir, prefix+"linked_folder")
			linkedFile := filepath.Join(linkedFolder, prefix+"config.json")

			realFolder := filepath.Join(dir, prefix+"real_folder")
			realFile := filepath.Join(realFolder, prefix+"config.json")

			require.NoError(t, os.Mkdir(realFolder, 0o700))
			require.NoError(t, os.WriteFile(realFile, []byte("a"), 0o600))

			require.NoError(t, os.Symlink(realFolder, linkedFolder))
			require.NoError(t, os.Symlink(linkedFile, watchedFile))
			return watchedFile, realFile
		}

		watchedFile1, realFile1 := createLinkedFile(t, t.TempDir(), "file1")
		watchedFile2, _ := createLinkedFile(t, t.TempDir(), "file2")
		watchedFile3, realFile3 := createLinkedFile(t, t.TempDir(), "file3")

		spy := test.NewCallSpy()

		tickerChan := make(chan time.Time)
		watchFunc, err := watcher.New(watcher.Options{
			Interval:   watchInterval,
			Logger:     zap.NewNop(),
			Paths:      []string{watchedFile1, watchedFile2, watchedFile3},
			Callback:   spy.Call,
			TickSource: tickerChan,
		})
		require.NoError(t, err)

		go func() {
			_ = watchFunc(ctx)
		}()

		sendTick(tickerChan)

		require.NoError(t, os.WriteFile(realFile1, []byte("b"), 0o600))

		// Changes detection tick
		sendTick(tickerChan)

		spy.AssertCalled(t, 0)

		// Callback run tick
		sendTick(tickerChan)

		spy.AssertCalled(t, 1)

		require.NoError(t, os.WriteFile(realFile3, []byte("b"), 0o600))

		// Send two ticks, one to detect changes, and one to execute callback
		sendTick(tickerChan)
		sendTick(tickerChan)

		spy.AssertCalled(t, 2)
	})

	t.Run("modify multiple existing files at once in one tick", func(t *testing.T) {
		t.Parallel()

		customWatchInterval := 100 * time.Millisecond

		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		dir := t.TempDir()
		tempFile1 := filepath.Join(dir, "config_1.json")
		tempFile2 := filepath.Join(dir, "config_2.json")
		tempFile3 := filepath.Join(dir, "config_3.json")

		require.NoError(t, os.WriteFile(tempFile1, []byte("a1"), 0o600))
		require.NoError(t, os.WriteFile(tempFile2, []byte("a2"), 0o600))
		require.NoError(t, os.WriteFile(tempFile3, []byte("a3"), 0o600))

		spy := test.NewCallSpy()

		tickerChan := make(chan time.Time)

		watchFunc, err := watcher.New(watcher.Options{
			Interval:   customWatchInterval,
			Logger:     zap.NewNop(),
			Paths:      []string{tempFile1, tempFile2, tempFile3},
			Callback:   spy.Call,
			TickSource: tickerChan,
		})
		require.NoError(t, err)

		go func() {
			_ = watchFunc(ctx)
		}()

		sendTick(tickerChan)

		require.NoError(t, os.WriteFile(tempFile1, []byte("b1"), 0o600))
		require.NoError(t, os.WriteFile(tempFile3, []byte("b2"), 0o600))

		// Send two ticks as we need two ticks to trigger the callback
		sendTick(tickerChan)
		sendTick(tickerChan)

		spy.AssertCalled(t, 1)
	})

	t.Run("modify existing single file in multiple subsequent ticks", func(t *testing.T) {
		t.Parallel()

		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		dir := t.TempDir()
		tempFile1 := filepath.Join(dir, "config_1.json")

		require.NoError(t, os.WriteFile(tempFile1, []byte("a1"), 0o600))

		spy := test.NewCallSpy()

		tickerChan := make(chan time.Time)

		watchFunc, err := watcher.New(watcher.Options{
			Interval:   watchInterval,
			Logger:     zap.NewNop(),
			Paths:      []string{tempFile1},
			Callback:   spy.Call,
			TickSource: tickerChan,
		})
		require.NoError(t, err)

		go func() {
			_ = watchFunc(ctx)
		}()

		tickerChan <- time.Now()

		t.Log("Modifying file at tick 1")
		require.NoError(t, os.WriteFile(tempFile1, []byte("b1"), 0o600))
		sendTick(tickerChan)

		t.Log("Modifying file at tick 2")
		require.NoError(t, os.WriteFile(tempFile1, []byte("b2"), 0o600))
		sendTick(tickerChan)

		t.Log("Modifying file at tick 3")
		require.NoError(t, os.WriteFile(tempFile1, []byte("b2"), 0o600))
		sendTick(tickerChan)

		t.Log("Modifying file at tick 4")
		require.NoError(t, os.WriteFile(tempFile1, []byte("b1"), 0o600))
		sendTick(tickerChan)

		t.Log("Modifying file at tick 5")
		require.NoError(t, os.WriteFile(tempFile1, []byte("b1"), 0o600))
		sendTick(tickerChan)

		// No Modifications should have happened because we still haven't
		// gotten a subsequent tick with no modifications
		spy.AssertCalled(t, 0)

		t.Log("Run callback at tick 6")
		sendTick(tickerChan)

		spy.AssertCalled(t, 1)
	})

	t.Run("modify multiple existing files in multiple subsequent ticks", func(t *testing.T) {
		t.Parallel()

		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		dir := t.TempDir()
		tempFile1 := filepath.Join(dir, "config_1.json")
		tempFile2 := filepath.Join(dir, "config_2.json")
		tempFile3 := filepath.Join(dir, "config_3.json")

		require.NoError(t, os.WriteFile(tempFile1, []byte("a1"), 0o600))
		require.NoError(t, os.WriteFile(tempFile2, []byte("a2"), 0o600))
		require.NoError(t, os.WriteFile(tempFile3, []byte("a3"), 0o600))

		spy := test.NewCallSpy()

		ticker := make(chan time.Time)
		watchFunc, err := watcher.New(watcher.Options{
			Interval:   watchInterval,
			Logger:     zap.NewNop(),
			Paths:      []string{tempFile1, tempFile2, tempFile3},
			Callback:   spy.Call,
			TickSource: ticker,
		})
		require.NoError(t, err)

		go func() {
			_ = watchFunc(ctx)
		}()

		sendTick(ticker)

		t.Log("Modifying file 1 at tick 1")
		require.NoError(t, os.WriteFile(tempFile1, []byte("b1"), 0o600))
		sendTick(ticker)

		t.Log("Modifying file 2 at tick 2")
		require.NoError(t, os.WriteFile(tempFile3, []byte("b2"), 0o600))
		sendTick(ticker)
		spy.AssertCalled(t, 0)

		t.Log("Run callback at tick 3")
		sendTick(ticker)
		spy.AssertCalled(t, 1)

		t.Log("Tick 4, nothing should happen")
		sendTick(ticker)
		spy.AssertCalled(t, 1)
	})
}

func TestCancel(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	dir := t.TempDir()
	tempFile := filepath.Join(dir, "config.json")

	require.NoError(t, os.WriteFile(tempFile, []byte("a"), 0o600))

	ctx, cancel := context.WithTimeout(ctx, testTimeout)

	watchFunc, err := watcher.New(watcher.Options{
		Interval: watchInterval,
		Logger:   zap.NewNop(),
		Paths:    []string{tempFile},
		Callback: func() {},
	})
	require.NoError(t, err)

	eg, ctx := errgroup.WithContext(ctx)
	eg.Go(func() error {
		return watchFunc(ctx)
	})

	cancel()

	require.ErrorIs(t, eg.Wait(), context.Canceled)
}

// sendTick helper function which adds a sleep timeout
// so users don't need to manually add sleep to every test
func sendTick(channel chan time.Time) {
	channel <- time.Now()
	time.Sleep(10 * time.Millisecond)
}
