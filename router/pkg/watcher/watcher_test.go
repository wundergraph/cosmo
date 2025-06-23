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
	watchInterval = 50 * time.Millisecond
	testTimeout   = 5 * time.Second

	assertTimeout      = 500 * time.Millisecond
	assertPollInterval = 10 * time.Millisecond
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

		watchFunc, err := watcher.New(watcher.Options{
			Interval: watchInterval,
			Logger:   zap.NewNop(),
			Paths:    []string{tempFile},
			Callback: spy.Call,
		})
		require.NoError(t, err)

		eg, ctx := errgroup.WithContext(ctx)
		eg.Go(func() error {
			return watchFunc(ctx)
		})

		// Wait for the first cycle to complete to set baseline
		time.Sleep(2 * watchInterval)

		tempFile2 := filepath.Join(dir, "config2.json")

		// Careful, this is subtly timing dependent. If we create
		// the new file too quickly after the first, some filesystems
		// will not record a different timestamp between the two files.
		// The sleep above should be adequate, but if you're not
		// seeing the event, try increasing it.
		require.NoError(t, os.WriteFile(tempFile2, []byte("b"), 0o600))

		// Move new file ontop of the old file
		require.NoError(t, os.Rename(tempFile2, tempFile))

		// Should get an event for the new file
		require.EventuallyWithT(t, func(t *assert.CollectT) {
			spy.AssertCalled(t, 1)
		}, assertTimeout, assertPollInterval)
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

		watchFunc, err := watcher.New(watcher.Options{
			Interval: watchInterval,
			Logger:   zap.NewNop(),
			Paths:    []string{tempFileA1, tempFileB1, tempFileC1},
			Callback: spy.Call,
		})
		require.NoError(t, err)

		eg, ctx := errgroup.WithContext(ctx)
		eg.Go(func() error {
			return watchFunc(ctx)
		})

		time.Sleep(2 * watchInterval)

		tempFileA2 := filepath.Join(dir, "config_a_2.json")
		tempFileB2 := filepath.Join(dir, "config_b_2.json")

		require.NoError(t, os.WriteFile(tempFileA2, []byte("ab1"), 0o600))
		require.NoError(t, os.WriteFile(tempFileB2, []byte("ab2"), 0o600))

		require.NoError(t, os.Rename(tempFileA2, tempFileA1))

		require.EventuallyWithT(t, func(t *assert.CollectT) {
			spy.AssertCalled(t, 1)
		}, assertTimeout, assertPollInterval)

		require.NoError(t, os.Rename(tempFileB2, tempFileB1))
		require.EventuallyWithT(t, func(t *assert.CollectT) {
			spy.AssertCalled(t, 2)
		}, assertTimeout, assertPollInterval)
	})

	t.Run("modify an existing file", func(t *testing.T) {
		t.Parallel()

		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		dir := t.TempDir()
		tempFile := filepath.Join(dir, "config.json")

		require.NoError(t, os.WriteFile(tempFile, []byte("a"), 0o600))

		spy := test.NewCallSpy()

		watchFunc, err := watcher.New(watcher.Options{
			Interval: watchInterval,
			Logger:   zap.NewNop(),
			Paths:    []string{tempFile},
			Callback: spy.Call,
		})
		require.NoError(t, err)

		eg, ctx := errgroup.WithContext(ctx)
		eg.Go(func() error {
			return watchFunc(ctx)
		})

		// Wait for the first cycle to complete to set baseline
		time.Sleep(2 * watchInterval)

		require.NoError(t, os.WriteFile(tempFile, []byte("b"), 0o600))

		require.EventuallyWithT(t, func(t *assert.CollectT) {
			spy.AssertCalled(t, 1)
		}, assertTimeout, assertPollInterval)
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

		watchFunc, err := watcher.New(watcher.Options{
			Interval: watchInterval,
			Logger:   zap.NewNop(),
			Paths:    []string{tempFile1, tempFile2, tempFile3},
			Callback: spy.Call,
		})
		require.NoError(t, err)

		eg, ctx := errgroup.WithContext(ctx)
		eg.Go(func() error {
			return watchFunc(ctx)
		})

		time.Sleep(2 * watchInterval)

		require.NoError(t, os.WriteFile(tempFile1, []byte("b1"), 0o600))
		require.EventuallyWithT(t, func(t *assert.CollectT) {
			spy.AssertCalled(t, 1)
		}, assertTimeout, assertPollInterval)

		time.Sleep(2 * watchInterval)

		require.NoError(t, os.WriteFile(tempFile3, []byte("b2"), 0o600))
		require.EventuallyWithT(t, func(t *assert.CollectT) {
			spy.AssertCalled(t, 2)
		}, assertTimeout, assertPollInterval)
	})

	t.Run("delete and replace a file", func(t *testing.T) {
		t.Parallel()

		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		dir := t.TempDir()
		tempFile := filepath.Join(dir, "config.json")

		require.NoError(t, os.WriteFile(tempFile, []byte("a"), 0o600))

		spy := test.NewCallSpy()

		watchFunc, err := watcher.New(watcher.Options{
			Interval: watchInterval,
			Logger:   zap.NewNop(),
			Paths:    []string{tempFile},
			Callback: spy.Call,
		})
		require.NoError(t, err)

		eg, ctx := errgroup.WithContext(ctx)
		eg.Go(func() error {
			return watchFunc(ctx)
		})

		// Wait for the first cycle to complete to set baseline
		time.Sleep(2 * watchInterval)

		// Delete the file, wait a cycle and then recreate it
		require.NoError(t, os.Remove(tempFile))

		time.Sleep(2 * watchInterval)

		require.NoError(t, os.WriteFile(tempFile, []byte("b"), 0o600))

		require.EventuallyWithT(t, func(t *assert.CollectT) {
			spy.AssertCalled(t, 1)
		}, assertTimeout, assertPollInterval)
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

		watchFunc, err := watcher.New(watcher.Options{
			Interval: watchInterval,
			Logger:   zap.NewNop(),
			Paths:    []string{tempFile1, tempFile2, tempFile3},
			Callback: spy.Call,
		})
		require.NoError(t, err)

		eg, ctx := errgroup.WithContext(ctx)
		eg.Go(func() error {
			return watchFunc(ctx)
		})

		time.Sleep(2 * watchInterval)

		require.NoError(t, os.Remove(tempFile1))

		time.Sleep(2 * watchInterval)

		require.NoError(t, os.WriteFile(tempFile1, []byte("b"), 0o600))
		require.EventuallyWithT(t, func(t *assert.CollectT) {
			spy.AssertCalled(t, 1)
		}, assertTimeout, assertPollInterval)

		require.NoError(t, os.Remove(tempFile3))

		time.Sleep(2 * watchInterval)

		require.NoError(t, os.WriteFile(tempFile3, []byte("b"), 0o600))
		require.EventuallyWithT(t, func(t *assert.CollectT) {
			spy.AssertCalled(t, 2)
		}, assertTimeout, assertPollInterval)
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

		watchFunc, err := watcher.New(watcher.Options{
			Interval: watchInterval,
			Logger:   zap.NewNop(),
			Paths:    []string{tempFile},
			Callback: spy.Call,
		})
		require.NoError(t, err)

		eg, ctx := errgroup.WithContext(ctx)
		eg.Go(func() error {
			return watchFunc(ctx)
		})

		// Wait for the first cycle to complete to set baseline
		time.Sleep(2 * watchInterval)

		// Move the file away, wait a cycle and then move it back
		require.NoError(t, os.Rename(tempFile, tempFile2))

		time.Sleep(2 * watchInterval)

		require.NoError(t, os.Rename(tempFile2, tempFile))

		require.EventuallyWithT(t, func(t *assert.CollectT) {
			spy.AssertCalled(t, 1)
		}, assertTimeout, assertPollInterval)
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

		watchFunc, err := watcher.New(watcher.Options{
			Interval: watchInterval,
			Logger:   zap.NewNop(),
			Paths:    []string{tempFileA1, tempFileB1, tempFileC1},
			Callback: spy.Call,
		})
		require.NoError(t, err)

		eg, ctx := errgroup.WithContext(ctx)
		eg.Go(func() error {
			return watchFunc(ctx)
		})

		time.Sleep(2 * watchInterval)

		require.NoError(t, os.Rename(tempFileA1, tempFileA2))
		time.Sleep(2 * watchInterval)
		require.NoError(t, os.Rename(tempFileA2, tempFileA1))
		require.EventuallyWithT(t, func(t *assert.CollectT) {
			spy.AssertCalled(t, 1)
		}, assertTimeout, assertPollInterval)

		time.Sleep(2 * watchInterval)

		require.NoError(t, os.Rename(tempFileB1, tempFileB2))
		time.Sleep(2 * watchInterval)
		require.NoError(t, os.Rename(tempFileB2, tempFileB1))
		require.EventuallyWithT(t, func(t *assert.CollectT) {
			spy.AssertCalled(t, 2)
		}, assertTimeout, assertPollInterval)
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

		watchFunc, err := watcher.New(watcher.Options{
			Interval: watchInterval,
			Logger:   zap.NewNop(),
			Paths:    []string{watchedFile},
			Callback: spy.Call,
		})
		require.NoError(t, err)

		eg, ctx := errgroup.WithContext(ctx)
		eg.Go(func() error {
			return watchFunc(ctx)
		})

		// Wait for the first cycle to complete to set baseline
		time.Sleep(2 * watchInterval)

		require.NoError(t, os.WriteFile(realFile, []byte("b"), 0o600))

		require.EventuallyWithT(t, func(t *assert.CollectT) {
			spy.AssertCalled(t, 1)
		}, assertTimeout, assertPollInterval)
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

		watchFunc, err := watcher.New(watcher.Options{
			Interval: watchInterval,
			Logger:   zap.NewNop(),
			Paths:    []string{watchedFile1, watchedFile2, watchedFile3},
			Callback: spy.Call,
		})
		require.NoError(t, err)

		eg, ctx := errgroup.WithContext(ctx)
		eg.Go(func() error {
			return watchFunc(ctx)
		})

		time.Sleep(2 * watchInterval)

		require.NoError(t, os.WriteFile(realFile1, []byte("b"), 0o600))
		require.EventuallyWithT(t, func(t *assert.CollectT) {
			spy.AssertCalled(t, 1)
		}, assertTimeout, assertPollInterval)

		time.Sleep(2 * watchInterval)

		require.NoError(t, os.WriteFile(realFile3, []byte("b"), 0o600))
		require.EventuallyWithT(t, func(t *assert.CollectT) {
			spy.AssertCalled(t, 2)
		}, assertTimeout, assertPollInterval)
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

		watchFunc, err := watcher.New(watcher.Options{
			Interval: customWatchInterval,
			Logger:   zap.NewNop(),
			Paths:    []string{tempFile1, tempFile2, tempFile3},
			Callback: spy.Call,
		})
		require.NoError(t, err)

		eg, ctx := errgroup.WithContext(ctx)
		eg.Go(func() error {
			return watchFunc(ctx)
		})

		time.Sleep(2 * customWatchInterval)

		require.NoError(t, os.WriteFile(tempFile1, []byte("b1"), 0o600))
		require.NoError(t, os.WriteFile(tempFile3, []byte("b2"), 0o600))

		time.Sleep(2 * customWatchInterval)

		// Since we track if a modification happened, not how many modifications happened
		// for N number of modified files there should only be one callback call
		require.EventuallyWithT(t, func(t *assert.CollectT) {
			spy.AssertCalled(t, 1)
		}, assertTimeout, assertPollInterval)
	})

	t.Run("modify existing single file in multiple subsequent ticks", func(t *testing.T) {
		t.Parallel()

		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		dir := t.TempDir()
		tempFile1 := filepath.Join(dir, "config_1.json")

		require.NoError(t, os.WriteFile(tempFile1, []byte("a1"), 0o600))

		spy := test.NewCallSpy()

		ticker := watcher.NewManualTicker()
		watchFunc, err := watcher.New(watcher.Options{
			Interval:   100 * time.Millisecond,
			Logger:     zap.NewNop(),
			Paths:      []string{tempFile1},
			Callback:   spy.Call,
			TickSource: ticker,
		})
		require.NoError(t, err)

		eg, ctx := errgroup.WithContext(ctx)
		eg.Go(func() error {
			return watchFunc(ctx)
		})

		ticker.Tick(time.Now())

		t.Log("Modifying file at tick 1")
		require.NoError(t, os.WriteFile(tempFile1, []byte("b1"), 0o600))
		ticker.Tick(time.Now())

		t.Log("Modifying file at tick 2")
		require.NoError(t, os.WriteFile(tempFile1, []byte("b2"), 0o600))
		ticker.Tick(time.Now())

		t.Log("Modifying file at tick 3")
		require.NoError(t, os.WriteFile(tempFile1, []byte("b2"), 0o600))
		ticker.Tick(time.Now())

		t.Log("Modifying file at tick 4")
		require.NoError(t, os.WriteFile(tempFile1, []byte("b1"), 0o600))
		ticker.Tick(time.Now())

		t.Log("Modifying file at tick 5")
		require.NoError(t, os.WriteFile(tempFile1, []byte("b1"), 0o600))
		ticker.Tick(time.Now())

		// No Modifications should have happened because we still haven't
		// gotten a subsequent tick with no modifications
		spy.AssertCalled(t, 0)

		t.Log("Run callback at tick 6")
		ticker.Tick(time.Now())

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

		ticker := watcher.NewManualTicker()
		watchFunc, err := watcher.New(watcher.Options{
			Interval:   500 * time.Millisecond,
			Logger:     zap.NewNop(),
			Paths:      []string{tempFile1, tempFile2, tempFile3},
			Callback:   spy.Call,
			TickSource: ticker,
		})
		require.NoError(t, err)

		eg, ctx := errgroup.WithContext(ctx)
		eg.Go(func() error {
			return watchFunc(ctx)
		})

		ticker.Tick(time.Now())

		t.Log("Modifying file 1 at tick 1")
		require.NoError(t, os.WriteFile(tempFile1, []byte("b1"), 0o600))
		ticker.Tick(time.Now())

		t.Log("Modifying file 2 at tick 2")
		require.NoError(t, os.WriteFile(tempFile3, []byte("b2"), 0o600))
		ticker.Tick(time.Now())
		spy.AssertCalled(t, 0)

		t.Log("Run callback at tick 3")
		ticker.Tick(time.Now())
		spy.AssertCalled(t, 1)

		t.Log("Tick 4, nothing should happen")
		ticker.Tick(time.Now())
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
