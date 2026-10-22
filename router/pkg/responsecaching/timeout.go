package responsecaching

import (
	"context"
	"time"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/caching"
)

type timeoutStore struct {
	Store
	lookup time.Duration
	write  time.Duration
}

// NewTimeoutStore bounds request path calls so a stalled store degrades to a
// miss instead of holding the request. Zero disables a bound.
func NewTimeoutStore(inner Store, lookup, write time.Duration) Store {
	return &timeoutStore{Store: inner, lookup: lookup, write: write}
}

func (s *timeoutStore) GetMany(ctx context.Context, keys []string) (map[string]caching.Item, error) {
	ctx, cancel := bound(ctx, s.lookup)
	defer cancel()
	return s.Store.GetMany(ctx, keys)
}

func (s *timeoutStore) SetMany(ctx context.Context, items []caching.Item) error {
	ctx, cancel := bound(ctx, s.write)
	defer cancel()
	return s.Store.SetMany(ctx, items)
}

func (s *timeoutStore) Probe(ctx context.Context) error {
	ctx, cancel := bound(ctx, s.lookup)
	defer cancel()
	return s.Store.Probe(ctx)
}

// bound is ctx with timeout d, or ctx itself when d is zero.
func bound(ctx context.Context, d time.Duration) (context.Context, context.CancelFunc) {
	if d <= 0 {
		return ctx, func() {}
	}
	return context.WithTimeout(ctx, d)
}
