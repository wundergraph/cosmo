package pqlmanifest

import (
	"context"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestStorageFetcher(t *testing.T) {
	t.Parallel()

	t.Run("first fetch with empty revision returns manifest", func(t *testing.T) {
		t.Parallel()

		manifest := &Manifest{
			Version:    1,
			Revision:   "rev-1",
			Operations: map[string]string{"h1": "query { a }"},
		}
		fetcher := NewStorageFetcher(
			func(_ context.Context, _ string, _ time.Time) (*Manifest, error) {
				return manifest, nil
			},
			"ops/manifest.json",
			zap.NewNop(),
		)

		result, changed, err := fetcher.Fetch(context.Background(), "")
		require.NoError(t, err)
		require.True(t, changed)
		require.Equal(t, manifest, result)
	})

	t.Run("same revision returns no change", func(t *testing.T) {
		t.Parallel()

		fetcher := NewStorageFetcher(
			func(_ context.Context, _ string, _ time.Time) (*Manifest, error) {
				return &Manifest{
					Version:    1,
					Revision:   "rev-1",
					Operations: map[string]string{"h1": "query { a }"},
				}, nil
			},
			"ops/manifest.json",
			zap.NewNop(),
		)

		result, changed, err := fetcher.Fetch(context.Background(), "rev-1")
		require.NoError(t, err)
		require.False(t, changed)
		require.Nil(t, result)
	})

	t.Run("different revision returns updated manifest", func(t *testing.T) {
		t.Parallel()

		manifest := &Manifest{
			Version:    1,
			Revision:   "rev-2",
			Operations: map[string]string{"h1": "query { a }", "h2": "query { b }"},
		}
		fetcher := NewStorageFetcher(
			func(_ context.Context, _ string, _ time.Time) (*Manifest, error) {
				return manifest, nil
			},
			"ops/manifest.json",
			zap.NewNop(),
		)

		result, changed, err := fetcher.Fetch(context.Background(), "rev-1")
		require.NoError(t, err)
		require.True(t, changed)
		require.Equal(t, manifest, result)
	})

	t.Run("read error is propagated", func(t *testing.T) {
		t.Parallel()

		fetcher := NewStorageFetcher(
			func(_ context.Context, _ string, _ time.Time) (*Manifest, error) {
				return nil, fmt.Errorf("s3 connection refused")
			},
			"ops/manifest.json",
			zap.NewNop(),
		)

		result, changed, err := fetcher.Fetch(context.Background(), "rev-1")
		require.Error(t, err)
		require.Contains(t, err.Error(), "s3 connection refused")
		require.False(t, changed)
		require.Nil(t, result)
	})

	t.Run("passes correct object path", func(t *testing.T) {
		t.Parallel()

		var receivedPath string
		fetcher := NewStorageFetcher(
			func(_ context.Context, objectPath string, _ time.Time) (*Manifest, error) {
				receivedPath = objectPath
				return &Manifest{
					Version:    1,
					Revision:   "rev-1",
					Operations: map[string]string{},
				}, nil
			},
			"my-prefix/operations/manifest.json",
			zap.NewNop(),
		)

		_, _, err := fetcher.Fetch(context.Background(), "")
		require.NoError(t, err)
		require.Equal(t, "my-prefix/operations/manifest.json", receivedPath)
	})

	t.Run("nil manifest means not modified", func(t *testing.T) {
		t.Parallel()

		fetcher := NewStorageFetcher(
			func(_ context.Context, _ string, _ time.Time) (*Manifest, error) {
				return nil, nil // S3 returned 304
			},
			"ops/manifest.json",
			zap.NewNop(),
		)

		result, changed, err := fetcher.Fetch(context.Background(), "rev-1")
		require.NoError(t, err)
		require.False(t, changed)
		require.Nil(t, result)
	})

	t.Run("first fetch passes zero modifiedSince", func(t *testing.T) {
		t.Parallel()

		var receivedModifiedSince time.Time
		fetcher := NewStorageFetcher(
			func(_ context.Context, _ string, modifiedSince time.Time) (*Manifest, error) {
				receivedModifiedSince = modifiedSince
				return &Manifest{Version: 1, Revision: "rev-1", Operations: map[string]string{}}, nil
			},
			"ops/manifest.json",
			zap.NewNop(),
		)

		_, _, err := fetcher.Fetch(context.Background(), "")
		require.NoError(t, err)
		require.True(t, receivedModifiedSince.IsZero())
	})

	t.Run("subsequent fetch passes non-zero modifiedSince", func(t *testing.T) {
		t.Parallel()

		var callCount int
		var receivedModifiedSince time.Time
		fetcher := NewStorageFetcher(
			func(_ context.Context, _ string, modifiedSince time.Time) (*Manifest, error) {
				callCount++
				receivedModifiedSince = modifiedSince
				return &Manifest{
					Version:    1,
					Revision:   fmt.Sprintf("rev-%d", callCount),
					Operations: map[string]string{},
				}, nil
			},
			"ops/manifest.json",
			zap.NewNop(),
		)

		// First fetch — modifiedSince should be zero
		_, _, err := fetcher.Fetch(context.Background(), "")
		require.NoError(t, err)
		require.True(t, receivedModifiedSince.IsZero())

		// Second fetch — modifiedSince should be non-zero
		_, _, err = fetcher.Fetch(context.Background(), "rev-1")
		require.NoError(t, err)
		require.False(t, receivedModifiedSince.IsZero())
	})
}

// TestStorageFetcherPollingLifecycle wires a StorageFetcher into a Poller with
// a mock S3 backend to exercise the full polling flow: initial fetch, 304 not-modified
// polls, manifest update detection, modifiedSince advancement, and store callbacks.
func TestStorageFetcherPollingLifecycle(t *testing.T) {
	t.Parallel()

	manifestV1 := &Manifest{
		Version:    1,
		Revision:   "rev-1",
		Operations: map[string]string{"h1": "query { employees { id } }"},
	}
	manifestV2 := &Manifest{
		Version:    1,
		Revision:   "rev-2",
		Operations: map[string]string{"h1": "query { employees { id } }", "h2": "query { products { id } }"},
	}

	// Mock S3 backend: serves currentManifest, returns nil (304) when modifiedSince is
	// non-zero and the manifest hasn't changed.
	var currentManifest atomic.Pointer[Manifest]
	currentManifest.Store(manifestV1)

	var lastModified atomic.Value  // stores time.Time of last manifest change
	lastModified.Store(time.Now()) // object already exists on S3 before the test starts

	var fetchCount atomic.Int32
	var lastReceivedModifiedSince atomic.Value
	lastReceivedModifiedSince.Store(time.Time{})

	mockReader := func(_ context.Context, _ string, modifiedSince time.Time) (*Manifest, error) {
		fetchCount.Add(1)
		lastReceivedModifiedSince.Store(modifiedSince)

		m := currentManifest.Load()
		modified := lastModified.Load().(time.Time)

		// Simulate S3 If-Modified-Since: if the caller has a timestamp and the
		// manifest hasn't been updated since, return 304.
		if !modifiedSince.IsZero() && !modified.IsZero() && !modified.After(modifiedSince) {
			return nil, nil // 304 Not Modified
		}

		return m, nil
	}

	store := NewStore(zap.NewNop())
	storageFetcher := NewStorageFetcher(mockReader, "ops/manifest.json", zap.NewNop())
	poller := NewPoller(storageFetcher, store, 50*time.Millisecond, 1*time.Millisecond, zap.NewNop())

	// Track store update callbacks.
	var updateCallbackCount atomic.Int32
	store.SetOnUpdate(func() {
		updateCallbackCount.Add(1)
	})

	// 1. Initial fetch loads manifest v1.
	err := poller.FetchInitial(context.Background())
	require.NoError(t, err)
	require.True(t, store.IsLoaded())
	require.Equal(t, "rev-1", store.Revision())
	require.Equal(t, 1, store.OperationCount())

	// Wait for the update callback from initial load.
	require.Eventually(t, func() bool {
		return updateCallbackCount.Load() >= 1
	}, 2*time.Second, 10*time.Millisecond)

	// 2. Start polling — manifest unchanged, polls should get 304s.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go poller.Poll(ctx)

	// Let a few poll cycles run. Store should stay at rev-1.
	time.Sleep(200 * time.Millisecond)
	require.Equal(t, "rev-1", store.Revision())
	require.Equal(t, 1, store.OperationCount())

	// Verify modifiedSince is being passed (non-zero after initial fetch).
	ms := lastReceivedModifiedSince.Load().(time.Time)
	require.False(t, ms.IsZero(), "poll should pass non-zero modifiedSince after initial fetch")

	fetchCountBefore304 := fetchCount.Load()
	require.Greater(t, fetchCountBefore304, int32(1), "poller should have made multiple fetch attempts")

	// No additional update callbacks beyond the initial one.
	require.Equal(t, int32(1), updateCallbackCount.Load())

	// 3. Simulate manifest update on S3.
	currentManifest.Store(manifestV2)
	lastModified.Store(time.Now())

	// Poller should detect the change.
	require.Eventually(t, func() bool {
		return store.Revision() == "rev-2"
	}, 2*time.Second, 10*time.Millisecond)

	require.Equal(t, 2, store.OperationCount())

	// 4. Update callback should have fired again.
	require.Eventually(t, func() bool {
		return updateCallbackCount.Load() >= 2
	}, 2*time.Second, 10*time.Millisecond)

	// 5. After the update, subsequent polls should get 304s again.
	revisionAfterUpdate := store.Revision()
	time.Sleep(200 * time.Millisecond)
	require.Equal(t, revisionAfterUpdate, store.Revision(), "revision should be stable after update")
	require.Equal(t, int32(2), updateCallbackCount.Load(), "no extra callbacks after stabilization")

	cancel()
}
