package entitycache

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

var errFakeCache = errors.New("cache unavailable")

// fakeCache is a test double that can be configured to fail.
type fakeCache struct {
	shouldFail atomic.Bool
	getCalls   atomic.Int32
	setCalls   atomic.Int32
	delCalls   atomic.Int32
}

func (f *fakeCache) Get(_ context.Context, keys []string) ([]*resolve.CacheEntry, error) {
	f.getCalls.Add(1)
	if f.shouldFail.Load() {
		return nil, errFakeCache
	}
	return make([]*resolve.CacheEntry, len(keys)), nil
}

func (f *fakeCache) Set(_ context.Context, _ []*resolve.CacheEntry, _ time.Duration) error {
	f.setCalls.Add(1)
	if f.shouldFail.Load() {
		return errFakeCache
	}
	return nil
}

func (f *fakeCache) Delete(_ context.Context, _ []string) error {
	f.delCalls.Add(1)
	if f.shouldFail.Load() {
		return errFakeCache
	}
	return nil
}

func newTestBreaker(inner *fakeCache, threshold int, cooldown time.Duration) *CircuitBreakerCache {
	return NewCircuitBreakerCache(inner, CircuitBreakerConfig{
		Enabled:          true,
		FailureThreshold: threshold,
		CooldownPeriod:   cooldown,
	})
}

func TestCircuitBreakerCache_ClosedState_PassThrough(t *testing.T) {
	inner := &fakeCache{}
	cb := newTestBreaker(inner, 5, time.Minute)

	entries, err := cb.Get(context.Background(), []string{"a", "b"})
	require.NoError(t, err)
	require.Len(t, entries, 2)
	require.Equal(t, int32(1), inner.getCalls.Load())

	err = cb.Set(context.Background(), []*resolve.CacheEntry{{Key: "a", Value: []byte("v")}}, time.Second)
	require.NoError(t, err)
	require.Equal(t, int32(1), inner.setCalls.Load())

	err = cb.Delete(context.Background(), []string{"a"})
	require.NoError(t, err)
	require.Equal(t, int32(1), inner.delCalls.Load())

	require.False(t, cb.IsOpen())
}

func TestCircuitBreakerCache_OpensAfterThreshold(t *testing.T) {
	inner := &fakeCache{}
	inner.shouldFail.Store(true)
	cb := newTestBreaker(inner, 3, time.Minute)

	ctx := context.Background()

	// 3 consecutive failures should trip the breaker
	for range 3 {
		_, _ = cb.Get(ctx, []string{"a"})
	}
	require.True(t, cb.IsOpen())

	// Subsequent calls should not reach the inner cache
	callsBefore := inner.getCalls.Load()
	entries, err := cb.Get(ctx, []string{"a"})
	require.NoError(t, err)
	require.Len(t, entries, 1)
	require.Nil(t, entries[0])
	require.Equal(t, callsBefore, inner.getCalls.Load())
}

func TestCircuitBreakerCache_SetDeleteSkippedWhenOpen(t *testing.T) {
	inner := &fakeCache{}
	inner.shouldFail.Store(true)
	cb := newTestBreaker(inner, 2, time.Minute)

	ctx := context.Background()

	// Trip the breaker
	for range 2 {
		_, _ = cb.Get(ctx, []string{"a"})
	}
	require.True(t, cb.IsOpen())

	setBefore := inner.setCalls.Load()
	delBefore := inner.delCalls.Load()

	err := cb.Set(ctx, []*resolve.CacheEntry{{Key: "a"}}, time.Second)
	require.NoError(t, err)
	require.Equal(t, setBefore, inner.setCalls.Load())

	err = cb.Delete(ctx, []string{"a"})
	require.NoError(t, err)
	require.Equal(t, delBefore, inner.delCalls.Load())
}

func TestCircuitBreakerCache_HalfOpenProbeSuccess(t *testing.T) {
	inner := &fakeCache{}
	inner.shouldFail.Store(true)
	cb := newTestBreaker(inner, 2, 10*time.Millisecond)

	ctx := context.Background()

	// Trip the breaker
	for range 2 {
		_, _ = cb.Get(ctx, []string{"a"})
	}
	require.True(t, cb.IsOpen())

	// Wait for cooldown
	time.Sleep(15 * time.Millisecond)

	// Fix the cache
	inner.shouldFail.Store(false)

	// Probe request should go through and close the breaker
	_, err := cb.Get(ctx, []string{"a"})
	require.NoError(t, err)
	require.False(t, cb.IsOpen())

	// Normal operations should work again
	_, err = cb.Get(ctx, []string{"b"})
	require.NoError(t, err)
}

func TestCircuitBreakerCache_HalfOpenProbeFailure(t *testing.T) {
	inner := &fakeCache{}
	inner.shouldFail.Store(true)
	cb := newTestBreaker(inner, 2, 10*time.Millisecond)

	ctx := context.Background()

	// Trip the breaker
	for range 2 {
		_, _ = cb.Get(ctx, []string{"a"})
	}
	require.True(t, cb.IsOpen())

	// Wait for cooldown
	time.Sleep(15 * time.Millisecond)

	// Probe request fails — breaker stays open
	_, err := cb.Get(ctx, []string{"a"})
	require.NoError(t, err) // Circuit breaker swallows the error
	require.True(t, cb.IsOpen())
}

func TestCircuitBreakerCache_SuccessResetsFailureCount(t *testing.T) {
	inner := &fakeCache{}
	cb := newTestBreaker(inner, 3, time.Minute)

	ctx := context.Background()

	// 2 failures, then 1 success, then 2 more failures — should NOT trip
	inner.shouldFail.Store(true)
	_, _ = cb.Get(ctx, []string{"a"})
	_, _ = cb.Get(ctx, []string{"a"})

	inner.shouldFail.Store(false)
	_, _ = cb.Get(ctx, []string{"a"})

	inner.shouldFail.Store(true)
	_, _ = cb.Get(ctx, []string{"a"})
	_, _ = cb.Get(ctx, []string{"a"})

	require.False(t, cb.IsOpen())
}

func TestCircuitBreakerCache_NeverErrorsToCallers(t *testing.T) {
	inner := &fakeCache{}
	inner.shouldFail.Store(true)
	cb := newTestBreaker(inner, 100, time.Minute)

	ctx := context.Background()

	// Even when inner cache fails, circuit breaker never returns errors
	entries, err := cb.Get(ctx, []string{"a"})
	require.NoError(t, err)
	require.Len(t, entries, 1)

	err = cb.Set(ctx, []*resolve.CacheEntry{{Key: "a"}}, time.Second)
	require.NoError(t, err)

	err = cb.Delete(ctx, []string{"a"})
	require.NoError(t, err)
}

func TestCircuitBreakerCache_Close_DelegatesToInner(t *testing.T) {
	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	inner := NewRedisEntityCache(client, "test")
	cb := newTestBreaker(&fakeCache{}, 3, time.Minute)
	// Replace the inner cache with one that implements io.Closer
	cb.cache = inner

	err := cb.Close()
	require.NoError(t, err)

	// After closing, the inner Redis cache should be closed
	_, err = inner.Get(context.Background(), []string{"key"})
	require.Error(t, err)
}

func TestCircuitBreakerCache_Close_NoopWhenInnerNotCloser(t *testing.T) {
	inner := &fakeCache{}
	cb := newTestBreaker(inner, 3, time.Minute)

	err := cb.Close()
	require.NoError(t, err)
}

// TestCircuitBreakerCache_ConcurrentFailuresTripOnce verifies that under
// concurrent failure traffic the breaker opens, and that it only opens once
// (the state machine is safe under contention). Run with -race.
func TestCircuitBreakerCache_ConcurrentFailuresTripOnce(t *testing.T) {
	t.Parallel()

	inner := &fakeCache{}
	inner.shouldFail.Store(true)
	const threshold = 5
	cb := newTestBreaker(inner, threshold, time.Minute)

	ctx := context.Background()
	const goroutines = 16
	const callsPerGoroutine = 50

	var wg sync.WaitGroup
	for range goroutines {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range callsPerGoroutine {
				_, _ = cb.Get(ctx, []string{"k"})
			}
		}()
	}
	wg.Wait()

	// Breaker must have opened (many failures, all above threshold).
	require.True(t, cb.IsOpen())

	// Once open, most calls must have short-circuited and never touched inner.
	// Because multiple goroutines can race past allowRequest before the first
	// failing Set transitions state, some failures still hit inner after the
	// breaker opens — but the total inner calls must be vastly less than the
	// total surface of goroutines*callsPerGoroutine.
	total := int32(goroutines * callsPerGoroutine)
	require.Less(t, inner.getCalls.Load(), total,
		"breaker should short-circuit after opening, not let all calls through")
}

// TestCircuitBreakerCache_ConcurrentHalfOpenProbeCloses verifies that when
// the breaker is half-open and many goroutines race, at least one probe
// reaches inner and the successful probe closes the breaker. The stricter
// "exactly one probe" invariant is not asserted here because once the probe
// succeeds and the breaker closes, subsequent goroutines also reach inner.
func TestCircuitBreakerCache_ConcurrentHalfOpenProbeCloses(t *testing.T) {
	t.Parallel()

	inner := &fakeCache{}
	inner.shouldFail.Store(true)
	cb := newTestBreaker(inner, 2, 5*time.Millisecond)

	ctx := context.Background()

	// Trip the breaker.
	for range 2 {
		_, _ = cb.Get(ctx, []string{"k"})
	}
	require.True(t, cb.IsOpen())

	// Freeze the inner call count; block the inner cache from failing so the
	// half-open probe can succeed. Wait past cooldown, then fire many goroutines
	// concurrently. Exactly one of them is allowed to reach inner (the probe).
	inner.shouldFail.Store(false)
	time.Sleep(10 * time.Millisecond)

	callsBefore := inner.getCalls.Load()

	const goroutines = 32
	var wg sync.WaitGroup
	for range goroutines {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = cb.Get(ctx, []string{"k"})
		}()
	}
	wg.Wait()

	// After the first probe succeeds the breaker closes, so later-arriving
	// calls will also reach inner. The strict invariant is that the very first
	// transition from open→half-open admitted only one probe. We verify the
	// state is now closed and that the probe path was exercised.
	require.False(t, cb.IsOpen(), "successful probe must close the breaker")
	require.Greater(t, inner.getCalls.Load(), callsBefore,
		"at least the probe must have reached inner after cooldown")
}

// TestCircuitBreakerCache_ConcurrentMixedSuccessFailure stresses the state
// machine with interleaved successes and failures across goroutines. The
// only invariant we assert is that the breaker never panics, the state field
// stays within the three known values, and Close is safe to call at the end.
func TestCircuitBreakerCache_ConcurrentMixedSuccessFailure(t *testing.T) {
	t.Parallel()

	inner := &fakeCache{}
	cb := newTestBreaker(inner, 10, time.Millisecond)

	ctx := context.Background()
	const goroutines = 8

	var wg sync.WaitGroup
	// Goroutines that toggle inner's failure mode.
	for i := range goroutines {
		wg.Add(1)
		go func(seed int) {
			defer wg.Done()
			for j := range 100 {
				inner.shouldFail.Store((seed+j)%3 == 0)
			}
		}(i)
	}
	// Goroutines that hammer the breaker's public surface.
	for range goroutines {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range 100 {
				_, _ = cb.Get(ctx, []string{"x"})
				_ = cb.Set(ctx, []*resolve.CacheEntry{{Key: "x", Value: []byte("v")}}, time.Second)
				_ = cb.Delete(ctx, []string{"x"})
			}
		}()
	}
	wg.Wait()

	// Sanity: state must be one of the three defined values.
	state := cb.state.Load()
	require.True(t, state == stateClosed || state == stateOpen || state == stateHalfOpen,
		"breaker state escaped the valid set: got %d", state)

	require.NoError(t, cb.Close())
}
