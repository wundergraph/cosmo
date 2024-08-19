package watcher_test

import (
	"context"
	"errors"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/watcher"
	"go.uber.org/zap"
	"os"
	"path/filepath"
	"testing"
	"time"
)

var waitForEvents = 500 * time.Millisecond

func getEvent(event <-chan []watcher.Event) ([]watcher.Event, error) {
	select {
	case events := <-event:
		return events, nil
	case <-time.After(1 * time.Second):
		return nil, errors.New("timed out while waiting for watcher events")
	}
}

func TestChange(t *testing.T) {
	dir, err := os.MkdirTemp("", "watcher-tests")
	require.NoError(t, err)
	tempFile := filepath.Join(dir, "config.json")
	defer os.RemoveAll(dir)

	err = os.WriteFile(tempFile, []byte("a"), 0644)
	require.NoError(t, err)

	eventCh := make(chan []watcher.Event)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	w, err := watcher.NewWatcher(zap.NewNop())
	require.NoError(t, err)
	err = w.Watch(ctx, tempFile, func(events []watcher.Event) error {
		select {
		case eventCh <- events:
		case <-ctx.Done():
		}
		return nil
	})
	require.NoError(t, err)

	time.Sleep(waitForEvents)
	err = os.WriteFile(tempFile, []byte("b"), 0644)
	require.NoError(t, err)

	require.Eventually(t, func() bool {
		events, err := getEvent(eventCh)
		require.NoError(t, err)
		require.Len(t, events, 1)
		require.Equal(t, events[0].Path, tempFile)
		require.Equal(t, events[0].Op, watcher.OpUpdate)
		return true
	}, waitForEvents, 10*time.Millisecond)

	cancel()
	require.NoError(t, w.Wait())
}

func TestCreate(t *testing.T) {
	dir := t.TempDir()
	defer os.RemoveAll(dir)
	eventCh := make(chan []watcher.Event)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	w, err := watcher.NewWatcher(zap.NewNop())
	require.NoError(t, err)
	err = w.Watch(ctx, dir, func(events []watcher.Event) error {
		select {
		case eventCh <- events:
		case <-ctx.Done():
		}
		return nil
	})
	require.NoError(t, err)

	tempFile := filepath.Join(dir, "config.json")
	err = os.WriteFile(filepath.Join(dir, "config.json"), []byte("b"), 0644)
	require.NoError(t, err)

	require.Eventually(t, func() bool {
		events, err := getEvent(eventCh)
		require.NoError(t, err)
		require.Len(t, events, 1)
		require.Equal(t, events[0].Path, tempFile)
		require.Equal(t, events[0].Op, watcher.OpCreate)
		return true
	}, waitForEvents, 10*time.Millisecond)

	cancel()
	require.NoError(t, w.Wait())
}
