package responsecaching

import (
	"context"
	"errors"
	"io"
	"net"
	"time"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/caching"

	"github.com/wundergraph/cosmo/router/pkg/metric"
)

// Store is a response cache with everything the router needs of it.
type Store interface {
	caching.Cache
	Invalidator
	io.Closer
}

// measuredError marks a store failure the instrumented store has counted already.
type measuredError struct {
	err error
}

func (e *measuredError) Error() string { return e.err.Error() }
func (e *measuredError) Unwrap() error { return e.err }

// IsMeasured reports whether err is a store failure that has been counted already.
func IsMeasured(err error) bool {
	var measured *measuredError
	return errors.As(err, &measured)
}

type instrumentedStore struct {
	inner   Store
	metrics metric.ResponseCacheMetricStore
}

// NewInstrumentedStore measures every call to inner.
func NewInstrumentedStore(inner Store, metrics metric.ResponseCacheMetricStore) Store {
	return &instrumentedStore{inner: inner, metrics: metrics}
}

func (s *instrumentedStore) GetMany(ctx context.Context, keys []string) (map[string]caching.Item, error) {
	start := time.Now()
	found, err := s.inner.GetMany(ctx, keys)
	s.metrics.MeasureOperation(ctx, metric.ResponseCacheOperationLookup, time.Since(start), errorType(err))
	if err != nil {
		return found, &measuredError{err: err}
	}

	s.metrics.MeasureKeys(ctx, metric.ResponseCacheOperationLookup, metric.ResponseCacheResultFound, int64(len(found)))
	s.metrics.MeasureKeys(ctx, metric.ResponseCacheOperationLookup, metric.ResponseCacheResultMissing, int64(len(keys)-len(found)))

	return found, nil
}

func (s *instrumentedStore) SetMany(ctx context.Context, items []caching.Item) error {
	start := time.Now()
	err := s.inner.SetMany(ctx, items)
	s.metrics.MeasureOperation(ctx, metric.ResponseCacheOperationWrite, time.Since(start), errorType(err))

	if err != nil {
		stored := 0
		var partial *caching.SetManyError
		if errors.As(err, &partial) {
			stored = min(len(partial.KnownStoredKeys), len(items))
		}
		s.metrics.MeasureKeys(ctx, metric.ResponseCacheOperationWrite, metric.ResponseCacheResultStored, int64(stored))
		s.metrics.MeasureKeys(ctx, metric.ResponseCacheOperationWrite, metric.ResponseCacheResultFailed, int64(len(items)-stored))
		return &measuredError{err: err}
	}

	var ttl time.Duration
	for i, item := range items {
		if i == 0 || item.TTL < ttl {
			ttl = item.TTL
		}
	}
	s.metrics.MeasureKeys(ctx, metric.ResponseCacheOperationWrite, metric.ResponseCacheResultStored, int64(len(items)))
	s.metrics.MeasureWriteTTL(ctx, ttl)

	return nil
}

func (s *instrumentedStore) InvalidateByTags(ctx context.Context, tags []string) (int, error) {
	start := time.Now()
	removed, err := s.inner.InvalidateByTags(ctx, tags)
	s.metrics.MeasureOperation(ctx, metric.ResponseCacheOperationInvalidate, time.Since(start), errorType(err))
	// Counted on failure as well, the entries removed before it are gone.
	s.metrics.MeasureKeys(ctx, metric.ResponseCacheOperationInvalidate, metric.ResponseCacheResultRemoved, int64(removed))
	if err != nil {
		return removed, &measuredError{err: err}
	}

	return removed, nil
}

func (s *instrumentedStore) Close() error {
	return s.inner.Close()
}

// errorType is the wg.error.type of a store failure, empty for none.
func errorType(err error) string {
	if err == nil {
		return ""
	}

	var (
		partial *caching.SetManyError
		netErr  net.Error
	)
	switch {
	case errors.Is(err, context.Canceled):
		return metric.ResponseCacheErrorCanceled
	case errors.As(err, &partial):
		return metric.ResponseCacheErrorPartialWrite
	case errors.Is(err, context.DeadlineExceeded), errors.As(err, &netErr) && netErr.Timeout():
		return metric.ResponseCacheErrorTimeout
	case errors.Is(err, caching.ErrMissingTTL), errors.Is(err, caching.ErrNoKeys), errors.Is(err, caching.ErrNoItems):
		return metric.ResponseCacheErrorInvalidArgument
	default:
		return metric.ResponseCacheErrorOther
	}
}
