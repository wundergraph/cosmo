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

// fakeLoader serves manifest data from memory and counts fetches. Like the
// file loader, it returns the data on every fetch.
type fakeLoader struct {
	mu      sync.Mutex
	data    []byte
	err     error
	fetches int
}

func newFakeLoader(manifest *Manifest, err error) *fakeLoader {
	l := &fakeLoader{}
	l.set(manifest, err)
	return l
}

func (l *fakeLoader) Fetch(_ context.Context, _ string) ([]byte, bool, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.fetches++
	if l.err != nil {
		return nil, false, l.err
	}
	return l.data, true, nil
}

func (l *fakeLoader) set(manifest *Manifest, err error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.data, l.err = nil, err
	if manifest != nil {
		l.data = mustMarshalManifest(manifest)
	}
}

func (l *fakeLoader) setData(data []byte) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.data, l.err = data, nil
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

		loader := newFakeLoader(rev1, nil)
		store := NewStore(zap.NewNop())
		poller := NewPoller(loader, Parse, store, 10*time.Second, 0, zap.NewNop())

		require.NoError(t, poller.FetchInitial(t.Context()))
		require.Equal(t, rev1, store.Snapshot())
		require.Equal(t, 1, loader.fetchCount())
	})

	t.Run("FetchInitial returns the loader error and leaves the store empty", func(t *testing.T) {
		t.Parallel()

		loader := newFakeLoader(nil, errors.New("boom"))
		store := NewStore(zap.NewNop())
		poller := NewPoller(loader, Parse, store, 10*time.Second, 0, zap.NewNop())

		require.ErrorContains(t, poller.FetchInitial(t.Context()), "boom")
		require.False(t, store.IsLoaded())
	})

	t.Run("FetchInitial returns the parse error and leaves the store empty", func(t *testing.T) {
		t.Parallel()

		loader := &fakeLoader{data: []byte("{bad")}
		store := NewStore(zap.NewNop())
		poller := NewPoller(loader, Parse, store, 10*time.Second, 0, zap.NewNop())

		require.ErrorContains(t, poller.FetchInitial(t.Context()), "failed to parse manifest")
		require.False(t, store.IsLoaded())
	})

	t.Run("Poll skips a manifest whose revision matches the loaded one", func(t *testing.T) {
		t.Parallel()

		synctest.Test(t, func(t *testing.T) {
			loader := newFakeLoader(rev1, nil)
			store := NewStore(zap.NewNop())
			poller := NewPoller(loader, Parse, store, time.Second, 0, zap.NewNop())
			require.NoError(t, poller.FetchInitial(t.Context()))
			loaded := store.Snapshot()

			go poller.Poll(t.Context())

			time.Sleep(time.Second)
			synctest.Wait()
			require.Equal(t, 2, loader.fetchCount())
			require.Same(t, loaded, store.Snapshot())
		})
	})

	t.Run("Poll keeps the current manifest when the new one fails to parse", func(t *testing.T) {
		t.Parallel()

		synctest.Test(t, func(t *testing.T) {
			core, logs := observer.New(zap.WarnLevel)
			loader := newFakeLoader(rev1, nil)
			store := NewStore(zap.NewNop())
			poller := NewPoller(loader, Parse, store, time.Second, 0, zap.New(core))
			require.NoError(t, poller.FetchInitial(t.Context()))

			go poller.Poll(t.Context())

			loader.setData([]byte(`{"version":2,"revision":"rev-2","operations":{}}`))
			time.Sleep(time.Second)
			synctest.Wait()
			require.Equal(t, 1, logs.FilterMessage("Failed to fetch manifest").Len())
			require.Equal(t, rev1, store.Snapshot())

			loader.set(rev2, nil)
			time.Sleep(time.Second)
			synctest.Wait()
			require.Equal(t, rev2, store.Snapshot())
		})
	})

	t.Run("Poll fetches once per interval and loads a changed manifest", func(t *testing.T) {
		t.Parallel()

		synctest.Test(t, func(t *testing.T) {
			loader := newFakeLoader(rev1, nil)
			store := NewStore(zap.NewNop())
			poller := NewPoller(loader, Parse, store, time.Second, 0, zap.NewNop())
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
			loader := newFakeLoader(rev1, nil)
			store := NewStore(zap.NewNop())
			poller := NewPoller(loader, Parse, store, time.Second, 0, zap.NewNop())

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
			loader := newFakeLoader(nil, errors.New("boom"))
			store := NewStore(zap.NewNop())
			poller := NewPoller(loader, Parse, store, time.Second, 0, zap.New(core))

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
