package responsecaching

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/caching"
)

var errDown = errors.New("down")

// countingStore fails with err and counts the calls that reached it.
type countingStore struct {
	calls  atomic.Int64
	err    atomic.Pointer[error]
	closed atomic.Bool
}

func (s *countingStore) fail(err error) { s.err.Store(&err) }

func (s *countingStore) result() error {
	s.calls.Add(1)
	if err := s.err.Load(); err != nil {
		return *err
	}
	return nil
}

func (s *countingStore) GetMany(context.Context, []string) (map[string]caching.Item, error) {
	return nil, s.result()
}
func (s *countingStore) SetMany(context.Context, []caching.Item) error { return s.result() }
func (s *countingStore) InvalidateByTags(context.Context, []string) (int, error) {
	return 0, s.result()
}
func (s *countingStore) Close() error {
	s.closed.Store(true)
	return nil
}

// pinger answers pings with up.
type pinger struct {
	up    atomic.Bool
	pings atomic.Int64
}

func (p *pinger) ping(context.Context) error {
	p.pings.Add(1)
	if p.up.Load() {
		return nil
	}
	return errDown
}

func newTestBreaker(t *testing.T, inner Store, p *pinger, startDown bool) Store {
	t.Helper()
	s := NewBreakerStore(inner, BreakerOptions{
		FailureThreshold: 3,
		ProbeInterval:    5 * time.Millisecond,
		Ping:             p.ping,
		IsFailure:        func(err error) bool { return errors.Is(err, errDown) },
		StartDown:        startDown,
	})
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestBreakerStore(t *testing.T) {
	t.Parallel()

	ctx := context.Background()

	t.Run("trips after consecutive failures and skips the store", func(t *testing.T) {
		t.Parallel()

		inner := &countingStore{}
		inner.fail(errDown)
		s := newTestBreaker(t, inner, &pinger{}, false)

		for range 3 {
			_, err := s.GetMany(ctx, []string{"a"})
			require.ErrorIs(t, err, errDown)
		}

		_, err := s.GetMany(ctx, []string{"a"})
		require.ErrorIs(t, err, ErrUnavailable)
		require.ErrorIs(t, s.SetMany(ctx, nil), ErrUnavailable)
		_, err = s.InvalidateByTags(ctx, nil)
		require.ErrorIs(t, err, ErrUnavailable)
		require.EqualValues(t, 3, inner.calls.Load())
	})

	t.Run("a success resets the count", func(t *testing.T) {
		t.Parallel()

		inner := &countingStore{}
		s := newTestBreaker(t, inner, &pinger{}, false)

		for range 5 {
			inner.fail(errDown)
			require.ErrorIs(t, s.SetMany(ctx, nil), errDown)
			require.ErrorIs(t, s.SetMany(ctx, nil), errDown)
			inner.fail(nil)
			require.NoError(t, s.SetMany(ctx, nil))
		}
		require.EqualValues(t, 15, inner.calls.Load())
	})

	t.Run("errors that are not failures do not count", func(t *testing.T) {
		t.Parallel()

		inner := &countingStore{}
		inner.fail(caching.ErrMissingTTL)
		s := newTestBreaker(t, inner, &pinger{}, false)

		for range 5 {
			require.ErrorIs(t, s.SetMany(ctx, nil), caching.ErrMissingTTL)
		}
		require.EqualValues(t, 5, inner.calls.Load())
	})

	t.Run("a cancelled caller does not count", func(t *testing.T) {
		t.Parallel()

		inner := &countingStore{}
		inner.fail(errDown)
		s := newTestBreaker(t, inner, &pinger{}, false)

		cancelled, cancel := context.WithCancel(ctx)
		cancel()
		for range 5 {
			_, err := s.GetMany(cancelled, nil)
			require.ErrorIs(t, err, errDown)
		}
		require.EqualValues(t, 5, inner.calls.Load())
	})

	t.Run("comes back once a ping succeeds", func(t *testing.T) {
		t.Parallel()

		inner := &countingStore{}
		p := &pinger{}
		s := newTestBreaker(t, inner, p, true)

		_, err := s.GetMany(ctx, nil)
		require.ErrorIs(t, err, ErrUnavailable)
		require.Eventually(t, func() bool { return p.pings.Load() >= 2 }, time.Second, time.Millisecond)

		p.up.Store(true)
		require.Eventually(t, func() bool {
			_, err := s.GetMany(ctx, nil)
			return err == nil
		}, time.Second, time.Millisecond)
	})

	t.Run("starting down skips the store at once", func(t *testing.T) {
		t.Parallel()

		inner := &countingStore{}
		s := newTestBreaker(t, inner, &pinger{}, true)

		_, err := s.GetMany(ctx, nil)
		require.ErrorIs(t, err, ErrUnavailable)
		require.Zero(t, inner.calls.Load())
	})

	t.Run("close stops probing and closes the store", func(t *testing.T) {
		t.Parallel()

		inner := &countingStore{}
		p := &pinger{}
		s := NewBreakerStore(inner, BreakerOptions{
			FailureThreshold: 1,
			ProbeInterval:    time.Millisecond,
			Ping:             p.ping,
			IsFailure:        func(error) bool { return true },
			StartDown:        true,
		})
		require.Eventually(t, func() bool { return p.pings.Load() > 0 }, time.Second, time.Millisecond)

		require.NoError(t, s.Close())
		require.True(t, inner.closed.Load())
		pings := p.pings.Load()
		time.Sleep(20 * time.Millisecond)
		require.Equal(t, pings, p.pings.Load())
	})
}
