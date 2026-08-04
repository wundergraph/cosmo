package cache

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	enginecache "github.com/wundergraph/graphql-go-tools/v2/pkg/entitycaching"
)

func TestInMemoryCacheGetManySetMany(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	c := NewInMemoryCache()

	results, err := c.GetMany(ctx, []string{"one", "two"})
	require.NoError(t, err)
	require.Len(t, results, 2)
	require.Nil(t, results[0].Value)
	require.Nil(t, results[1].Value)

	require.NoError(t, c.SetMany(ctx, []enginecache.Item{
		{Key: "one", Value: []byte("1")},
		{Key: "three", Value: []byte("3")},
	}))

	// Results are positional, so the miss on "two" keeps the hits aligned
	results, err = c.GetMany(ctx, []string{"one", "two", "three"})
	require.NoError(t, err)
	require.Len(t, results, 3)
	require.NotNil(t, results[0].Value)
	require.Equal(t, []byte("1"), results[0].Value)
	require.Nil(t, results[1].Value)
	require.NotNil(t, results[2].Value)
	require.Equal(t, []byte("3"), results[2].Value)
}

func TestInMemoryCacheSetManyLastWriteWins(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	c := NewInMemoryCache()

	require.NoError(t, c.SetMany(ctx, []enginecache.Item{
		{Key: "one", Value: []byte("first")},
		{Key: "one", Value: []byte("second")},
	}))

	results, err := c.GetMany(ctx, []string{"one"})
	require.NoError(t, err)
	require.NotNil(t, results[0].Value)
	require.Equal(t, []byte("second"), results[0].Value)
}

func TestInMemoryCacheTTL(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	now := time.Now()

	c := NewInMemoryCache()
	c.now = func() time.Time { return now }

	require.NoError(t, c.SetMany(ctx, []enginecache.Item{
		{Key: "expiring", Value: []byte("1"), TTL: time.Second},
		// A zero TTL means the entry never expires
		{Key: "permanent", Value: []byte("2")},
	}))

	now = now.Add(2 * time.Second)

	results, err := c.GetMany(ctx, []string{"expiring", "permanent"})
	require.NoError(t, err)
	require.Nil(t, results[0].Value)
	require.NotNil(t, results[1].Value)
	require.Equal(t, []byte("2"), results[1].Value)
}

func TestInMemoryCacheCopiesValues(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	c := NewInMemoryCache()

	value := []byte("original")
	require.NoError(t, c.SetMany(ctx, []enginecache.Item{{Key: "one", Value: value}}))

	// Mutating the slice we handed over must not reach the cache
	value[0] = 'X'

	results, err := c.GetMany(ctx, []string{"one"})
	require.NoError(t, err)
	require.Equal(t, []byte("original"), results[0].Value)

	// Mutating what we got back must not reach the cache either
	results[0].Value[0] = 'X'

	results, err = c.GetMany(ctx, []string{"one"})
	require.NoError(t, err)
	require.Equal(t, []byte("original"), results[0].Value)
}

func TestInMemoryCacheEmptyValueIsNotAMiss(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	c := NewInMemoryCache()

	require.NoError(t, c.SetMany(ctx, []enginecache.Item{
		{Key: "empty", Value: []byte{}},
		// A nil value is stored as an empty one so it still reads back as a hit
		{Key: "nil", Value: nil},
	}))

	results, err := c.GetMany(ctx, []string{"empty", "nil", "absent"})
	require.NoError(t, err)

	require.NotNil(t, results[0].Value)
	require.Empty(t, results[0].Value)

	require.NotNil(t, results[1].Value)
	require.Empty(t, results[1].Value)

	require.Nil(t, results[2].Value)
}

func TestInMemoryCacheEmptyBatches(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	c := NewInMemoryCache()

	require.NoError(t, c.SetMany(ctx, nil))

	results, err := c.GetMany(ctx, nil)
	require.NoError(t, err)
	require.Empty(t, results)
}

func TestInMemoryCacheCancelledContext(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	c := NewInMemoryCache()

	require.ErrorIs(t, c.SetMany(ctx, []enginecache.Item{{Key: "one", Value: []byte("1")}}), context.Canceled)

	_, err := c.GetMany(ctx, []string{"one"})
	require.ErrorIs(t, err, context.Canceled)
}
