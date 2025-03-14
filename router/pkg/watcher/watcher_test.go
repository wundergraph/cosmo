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
	watchInterval = 10 * time.Millisecond
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

		_, err := watcher.New(watcher.Options{
			Interval: watchInterval,
			Logger:   zap.NewNop(),
			Path:     "",
		})
		if assert.Error(t, err) {
			assert.ErrorContains(t, err, "path must be provided")
		}
	})

	t.Run("callback not provided", func(t *testing.T) {
		t.Parallel()

		_, err := watcher.New(watcher.Options{
			Interval: watchInterval,
			Logger:   zap.NewNop(),
			Path:     "valid_path.txt",
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
			Path:     tempFile,
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
			Path:     tempFile,
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
			Path:     tempFile,
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
			Path:     tempFile,
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
			Path:     watchedFile,
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
		Path:     tempFile,
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
