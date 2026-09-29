package responsecaching

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/caching"

	"github.com/wundergraph/cosmo/router/pkg/metric"
)

type fakeStore struct {
	found   map[string]caching.Item
	removed int
	err     error
	closed  bool
}

func (f *fakeStore) GetMany(context.Context, []string) (map[string]caching.Item, error) {
	return f.found, f.err
}
func (f *fakeStore) SetMany(context.Context, []caching.Item) error { return f.err }
func (f *fakeStore) InvalidateByTags(context.Context, []string) (int, error) {
	return f.removed, f.err
}
func (f *fakeStore) Close() error {
	f.closed = true
	return nil
}

type operation struct {
	name      string
	errorType string
}

// recorder keeps what the store measured.
type recorder struct {
	metric.NoopResponseCacheMetricStore
	operations []operation
	keys       map[string]int64
	ttls       []time.Duration
}

func newRecorder() *recorder {
	return &recorder{keys: map[string]int64{}}
}

func (r *recorder) MeasureOperation(_ context.Context, name string, _ time.Duration, errorType string) {
	r.operations = append(r.operations, operation{name: name, errorType: errorType})
}

func (r *recorder) MeasureKeys(_ context.Context, operation, result string, count int64) {
	if count > 0 {
		r.keys[operation+"/"+result] += count
	}
}

func (r *recorder) MeasureWriteTTL(_ context.Context, ttl time.Duration) {
	r.ttls = append(r.ttls, ttl)
}

type timeoutError struct{}

func (timeoutError) Error() string   { return "i/o timeout" }
func (timeoutError) Timeout() bool   { return true }
func (timeoutError) Temporary() bool { return true }

func TestInstrumentedStore(t *testing.T) {
	t.Parallel()

	ctx := context.Background()

	t.Run("a lookup counts the keys it found and missed", func(t *testing.T) {
		t.Parallel()

		rec := newRecorder()
		store := NewInstrumentedStore(&fakeStore{found: map[string]caching.Item{"a": {Key: "a"}}}, rec)

		found, err := store.GetMany(ctx, []string{"a", "b", "c"})
		require.NoError(t, err)
		require.Len(t, found, 1)

		require.Equal(t, []operation{{name: metric.ResponseCacheOperationLookup}}, rec.operations)
		require.Equal(t, map[string]int64{"lookup/found": 1, "lookup/missing": 2}, rec.keys)
	})

	t.Run("a failed lookup counts no keys", func(t *testing.T) {
		t.Parallel()

		failure := errors.New("connection reset")
		rec := newRecorder()
		store := NewInstrumentedStore(&fakeStore{err: failure}, rec)

		_, err := store.GetMany(ctx, []string{"a"})
		require.ErrorIs(t, err, failure)
		require.Equal(t, failure.Error(), err.Error())
		require.True(t, IsMeasured(fmt.Errorf("response cache lookup of 1 keys: %w", err)))

		require.Equal(t, []operation{{
			name:      metric.ResponseCacheOperationLookup,
			errorType: metric.ResponseCacheErrorOther,
		}}, rec.operations)
		require.Empty(t, rec.keys)
	})

	t.Run("a write counts its entries and shortest lifetime", func(t *testing.T) {
		t.Parallel()

		rec := newRecorder()
		store := NewInstrumentedStore(&fakeStore{}, rec)

		err := store.SetMany(ctx, []caching.Item{
			{Key: "a", Value: []byte("1234"), TTL: time.Minute},
			{Key: "b", Value: []byte("12"), TTL: 30 * time.Second},
		})
		require.NoError(t, err)

		require.Equal(t, []operation{{name: metric.ResponseCacheOperationWrite}}, rec.operations)
		require.Equal(t, map[string]int64{"write/stored": 2}, rec.keys)
		require.Equal(t, []time.Duration{30 * time.Second}, rec.ttls)
	})

	t.Run("a failed write counts every entry as failed", func(t *testing.T) {
		t.Parallel()

		rec := newRecorder()
		store := NewInstrumentedStore(&fakeStore{err: timeoutError{}}, rec)

		err := store.SetMany(ctx, []caching.Item{{Key: "a", TTL: time.Minute}, {Key: "b", TTL: time.Minute}})
		require.Error(t, err)
		require.True(t, IsMeasured(err))

		require.Equal(t, []operation{{
			name:      metric.ResponseCacheOperationWrite,
			errorType: metric.ResponseCacheErrorTimeout,
		}}, rec.operations)
		require.Equal(t, map[string]int64{"write/failed": 2}, rec.keys)
		require.Empty(t, rec.ttls)
	})

	t.Run("a partial write tells the stored entries from the failed ones", func(t *testing.T) {
		t.Parallel()

		partial := &caching.SetManyError{KnownStoredKeys: []string{"a"}, Err: errors.New("connection reset")}
		rec := newRecorder()
		store := NewInstrumentedStore(&fakeStore{err: partial}, rec)

		err := store.SetMany(ctx, []caching.Item{
			{Key: "a", TTL: time.Minute},
			{Key: "b", TTL: time.Minute},
			{Key: "c", TTL: time.Minute},
		})

		var got *caching.SetManyError
		require.ErrorAs(t, err, &got)
		require.Equal(t, []string{"a"}, got.KnownStoredKeys)

		require.Equal(t, []operation{{
			name:      metric.ResponseCacheOperationWrite,
			errorType: metric.ResponseCacheErrorPartialWrite,
		}}, rec.operations)
		require.Equal(t, map[string]int64{"write/stored": 1, "write/failed": 2}, rec.keys)
	})

	t.Run("an invalidation counts the entries it removed", func(t *testing.T) {
		t.Parallel()

		rec := newRecorder()
		store := NewInstrumentedStore(&fakeStore{removed: 5}, rec)

		removed, err := store.InvalidateByTags(ctx, []string{"type:employees:Employee", "subgraph:mood"})
		require.NoError(t, err)
		require.Equal(t, 5, removed)

		require.Equal(t, []operation{{name: metric.ResponseCacheOperationInvalidate}}, rec.operations)
		require.Equal(t, map[string]int64{"invalidate/removed": 5}, rec.keys)
	})

	t.Run("a failed invalidation still counts what it removed", func(t *testing.T) {
		t.Parallel()

		rec := newRecorder()
		store := NewInstrumentedStore(&fakeStore{removed: 3, err: context.DeadlineExceeded}, rec)

		removed, err := store.InvalidateByTags(ctx, []string{"subgraph:mood"})
		require.ErrorIs(t, err, context.DeadlineExceeded)
		require.Equal(t, 3, removed)

		require.Equal(t, []operation{{
			name:      metric.ResponseCacheOperationInvalidate,
			errorType: metric.ResponseCacheErrorTimeout,
		}}, rec.operations)
		require.Equal(t, map[string]int64{"invalidate/removed": 3}, rec.keys)
	})

	t.Run("close reaches the store", func(t *testing.T) {
		t.Parallel()

		inner := &fakeStore{}
		require.NoError(t, NewInstrumentedStore(inner, newRecorder()).Close())
		require.True(t, inner.closed)
	})
}

func TestErrorType(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		err  error
		want string
	}{
		{name: "no error", err: nil, want: ""},
		{name: "a client that went away", err: fmt.Errorf("get: %w", context.Canceled), want: metric.ResponseCacheErrorCanceled},
		{name: "a deadline", err: context.DeadlineExceeded, want: metric.ResponseCacheErrorTimeout},
		{name: "a network timeout", err: fmt.Errorf("get: %w", timeoutError{}), want: metric.ResponseCacheErrorTimeout},
		{
			name: "a partial write",
			err:  &caching.SetManyError{KnownStoredKeys: []string{"a"}, Err: timeoutError{}},
			want: metric.ResponseCacheErrorPartialWrite,
		},
		{name: "a missing TTL", err: fmt.Errorf("%w: key a", caching.ErrMissingTTL), want: metric.ResponseCacheErrorInvalidArgument},
		{name: "no keys", err: caching.ErrNoKeys, want: metric.ResponseCacheErrorInvalidArgument},
		{name: "anything else", err: errors.New("connection reset"), want: metric.ResponseCacheErrorOther},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			require.Equal(t, tt.want, errorType(tt.err))
		})
	}

	t.Run("an error the store did not return is not measured", func(t *testing.T) {
		t.Parallel()
		require.False(t, IsMeasured(errors.New("wrong response cache value")))
	})
}
