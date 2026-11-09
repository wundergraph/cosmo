package operationmanifest

import (
	"context"
	"errors"
	"sync"
	"testing"
	"testing/synctest"
	"time"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
)

// fakeLoader serves a manifest from memory and counts fetches. It compares
// revisions like the real loaders do.
type fakeLoader struct {
	mu       sync.Mutex
	manifest *Manifest
	err      error
	fetches  int
}

func (l *fakeLoader) Fetch(_ context.Context, currentRevision string) (*Manifest, bool, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.fetches++
	if l.err != nil {
		return nil, false, l.err
	}
	if l.manifest.Revision == currentRevision {
		return nil, false, nil
	}
	return l.manifest, true, nil
}

func (l *fakeLoader) set(manifest *Manifest, err error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.manifest, l.err = manifest, err
}

func (l *fakeLoader) fetchCount() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.fetches
}

func TestPoller(t *testing.T) {
	t.Parallel()

	rev1 := &Manifest{Version: 1, Revision: "rev-1", Operations: map[string]string{"h1": "query { a }"}}
	rev2 := &Manifest{Version: 1, Revision: "rev-2", Operations: map[string]string{"h1": "query { a }", "h2": "query { b }"}}

	t.Run("FetchInitial loads the manifest into the store", func(t *testing.T) {
		t.Parallel()

		loader := &fakeLoader{manifest: rev1}
		store := NewStore(zap.NewNop())
		poller := NewPoller(loader, store, 10*time.Second, 0, zap.NewNop())

		require.NoError(t, poller.FetchInitial(t.Context()))
		require.Equal(t, rev1, store.Snapshot())
		require.Equal(t, 1, loader.fetchCount())
	})

	t.Run("FetchInitial returns the loader error and leaves the store empty", func(t *testing.T) {
		t.Parallel()

		loader := &fakeLoader{err: errors.New("boom")}
		store := NewStore(zap.NewNop())
		poller := NewPoller(loader, store, 10*time.Second, 0, zap.NewNop())

		require.ErrorContains(t, poller.FetchInitial(t.Context()), "boom")
		require.False(t, store.IsLoaded())
	})

	t.Run("Poll fetches once per interval and loads a changed manifest", func(t *testing.T) {
		t.Parallel()

		synctest.Test(t, func(t *testing.T) {
			loader := &fakeLoader{manifest: rev1}
			store := NewStore(zap.NewNop())
			poller := NewPoller(loader, store, time.Second, 0, zap.NewNop())
			require.NoError(t, poller.FetchInitial(t.Context()))

			go poller.Poll(t.Context())

			// Three unchanged polls after the initial fetch.
			time.Sleep(3 * time.Second)
			synctest.Wait()
			require.Equal(t, 4, loader.fetchCount())
			require.Equal(t, rev1, store.Snapshot())

			loader.set(rev2, nil)
			time.Sleep(time.Second)
			synctest.Wait()
			require.Equal(t, 5, loader.fetchCount())
			require.Equal(t, rev2, store.Snapshot())
		})
	})

	t.Run("Poll stops fetching after the context is canceled", func(t *testing.T) {
		t.Parallel()

		synctest.Test(t, func(t *testing.T) {
			loader := &fakeLoader{manifest: rev1}
			store := NewStore(zap.NewNop())
			poller := NewPoller(loader, store, time.Second, 0, zap.NewNop())

			ctx, cancel := context.WithCancel(t.Context())
			go poller.Poll(ctx)

			time.Sleep(2 * time.Second)
			synctest.Wait()
			require.Equal(t, 2, loader.fetchCount())

			cancel()
			time.Sleep(10 * time.Second)
			synctest.Wait()
			require.Equal(t, 2, loader.fetchCount())
		})
	})

	t.Run("Poll logs a fetch error and keeps polling", func(t *testing.T) {
		t.Parallel()

		synctest.Test(t, func(t *testing.T) {
			core, logs := observer.New(zap.WarnLevel)
			loader := &fakeLoader{err: errors.New("boom")}
			store := NewStore(zap.NewNop())
			poller := NewPoller(loader, store, time.Second, 0, zap.New(core))

			go poller.Poll(t.Context())

			time.Sleep(2 * time.Second)
			synctest.Wait()
			require.Equal(t, 2, loader.fetchCount())
			require.Equal(t, 2, logs.FilterMessage("Failed to fetch manifest").Len())
			require.False(t, store.IsLoaded())

			loader.set(rev1, nil)
			time.Sleep(time.Second)
			synctest.Wait()
			require.Equal(t, 3, loader.fetchCount())
			require.Equal(t, rev1, store.Snapshot())
		})
	})
}
