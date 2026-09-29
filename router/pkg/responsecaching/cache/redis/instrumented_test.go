package redis

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	enginecache "github.com/wundergraph/graphql-go-tools/v2/pkg/caching"

	"github.com/wundergraph/cosmo/router/pkg/metric"
	"github.com/wundergraph/cosmo/router/pkg/responsecaching"
)

// measurements keeps what an instrumented store measured.
type measurements struct {
	metric.NoopResponseCacheMetricStore
	errorTypes map[string]string
	keys       map[string]int64
}

func (m *measurements) MeasureOperation(_ context.Context, operation string, _ time.Duration, errorType string) {
	m.errorTypes[operation] = errorType
}

func (m *measurements) MeasureKeys(_ context.Context, operation, result string, count int64) {
	if count > 0 {
		m.keys[operation+"/"+result] += count
	}
}

func TestInstrumentedRedisCache(t *testing.T) {
	t.Parallel()

	ctx := t.Context()

	items := []enginecache.Item{
		{Key: "a", Value: []byte("1"), TTL: time.Minute},
		{Key: "b", Value: []byte("2"), TTL: time.Minute},
		{Key: "c", Value: []byte("3"), TTL: time.Minute},
	}

	t.Run("a batch cut short is measured as a partial write", func(t *testing.T) {
		t.Parallel()

		c, _ := newTestRedisCacheWithHook(t, cutRepliesAfter{n: 2})
		m := &measurements{errorTypes: map[string]string{}, keys: map[string]int64{}}
		store := responsecaching.NewInstrumentedStore(c, m)

		err := store.SetMany(ctx, items)

		var partial *enginecache.SetManyError
		require.ErrorAs(t, err, &partial)
		require.True(t, responsecaching.IsMeasured(err))

		require.Equal(t, metric.ResponseCacheErrorPartialWrite, m.errorTypes[metric.ResponseCacheOperationWrite])
		require.Equal(t, map[string]int64{"write/stored": 2, "write/failed": 1}, m.keys)
	})

	t.Run("a write and a lookup are measured", func(t *testing.T) {
		t.Parallel()

		c, _ := newTestRedisCache(t)
		m := &measurements{errorTypes: map[string]string{}, keys: map[string]int64{}}
		store := responsecaching.NewInstrumentedStore(c, m)

		require.NoError(t, store.SetMany(ctx, items))

		found, err := store.GetMany(ctx, []string{"a", "b", "missing"})
		require.NoError(t, err)
		require.Len(t, found, 2)

		require.Equal(t, map[string]string{
			metric.ResponseCacheOperationWrite:  "",
			metric.ResponseCacheOperationLookup: "",
		}, m.errorTypes)
		require.Equal(t, map[string]int64{"write/stored": 3, "lookup/found": 2, "lookup/missing": 1}, m.keys)
	})

	t.Run("an unreachable redis is measured as a failed lookup", func(t *testing.T) {
		t.Parallel()

		c, mr := newTestRedisCache(t)
		mr.Close()
		m := &measurements{errorTypes: map[string]string{}, keys: map[string]int64{}}
		store := responsecaching.NewInstrumentedStore(c, m)

		_, err := store.GetMany(ctx, []string{"a"})
		require.Error(t, err)

		require.Equal(t, metric.ResponseCacheErrorOther, m.errorTypes[metric.ResponseCacheOperationLookup])
		require.Empty(t, m.keys)
	})
}
