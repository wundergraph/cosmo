package core

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestExpensivePlanCache_GetSet(t *testing.T) {
	c := newExpensivePlanCache(10)

	plan1 := &planWithMetaData{content: "query { a }"}
	plan2 := &planWithMetaData{content: "query { b }"}

	// Miss
	_, ok := c.Get(1)
	require.False(t, ok)

	// Set and get
	c.Set(1, plan1, 10*time.Millisecond)
	got, ok := c.Get(1)
	require.True(t, ok)
	require.Equal(t, plan1, got)

	// Different key
	c.Set(2, plan2, 20*time.Millisecond)
	got, ok = c.Get(2)
	require.True(t, ok)
	require.Equal(t, plan2, got)

	// Original still there
	got, ok = c.Get(1)
	require.True(t, ok)
	require.Equal(t, plan1, got)
}

func TestExpensivePlanCache_BoundedSize(t *testing.T) {
	c := newExpensivePlanCache(3)

	c.Set(1, &planWithMetaData{content: "q1"}, 10*time.Millisecond)
	c.Set(2, &planWithMetaData{content: "q2"}, 20*time.Millisecond)
	c.Set(3, &planWithMetaData{content: "q3"}, 30*time.Millisecond)

	// Cache is full (3/3). Adding a 4th with higher duration should evict the shortest (key=1, 10ms)
	c.Set(4, &planWithMetaData{content: "q4"}, 25*time.Millisecond)

	// Key 1 should be evicted (it had the shortest duration: 10ms)
	_, ok := c.Get(1)
	require.False(t, ok, "key 1 should have been evicted")

	// Keys 2, 3, 4 should remain
	_, ok = c.Get(2)
	require.True(t, ok)
	_, ok = c.Get(3)
	require.True(t, ok)
	_, ok = c.Get(4)
	require.True(t, ok)
}

func TestExpensivePlanCache_BoundedSize_SkipsCheaper(t *testing.T) {
	c := newExpensivePlanCache(3)

	c.Set(1, &planWithMetaData{content: "q1"}, 10*time.Second)
	c.Set(2, &planWithMetaData{content: "q2"}, 20*time.Second)
	c.Set(3, &planWithMetaData{content: "q3"}, 30*time.Second)

	// Try to add a cheaper entry (5s < 10s minimum) — should be rejected
	c.Set(4, &planWithMetaData{content: "q4"}, 5*time.Second)

	_, ok := c.Get(4)
	require.False(t, ok, "cheaper entry should not be added when cache is full")

	// All original entries should remain
	_, ok = c.Get(1)
	require.True(t, ok)
	_, ok = c.Get(2)
	require.True(t, ok)
	_, ok = c.Get(3)
	require.True(t, ok)
}

func TestExpensivePlanCache_UpdateExisting(t *testing.T) {
	c := newExpensivePlanCache(2)

	plan1 := &planWithMetaData{content: "q1"}
	plan1Updated := &planWithMetaData{content: "q1-updated"}

	c.Set(1, plan1, 10*time.Millisecond)
	c.Set(1, plan1Updated, 50*time.Millisecond)

	got, ok := c.Get(1)
	require.True(t, ok)
	require.Equal(t, "q1-updated", got.content)

	// Updating an existing key should not increase the count
	c.Set(2, &planWithMetaData{content: "q2"}, 20*time.Millisecond)
	_, ok = c.Get(1)
	require.True(t, ok, "key 1 should still exist after adding key 2 (capacity is 2)")
	_, ok = c.Get(2)
	require.True(t, ok)
}

func TestExpensivePlanCache_IterValues(t *testing.T) {
	c := newExpensivePlanCache(10)

	c.Set(1, &planWithMetaData{content: "q1"}, 10*time.Millisecond)
	c.Set(2, &planWithMetaData{content: "q2"}, 20*time.Millisecond)
	c.Set(3, &planWithMetaData{content: "q3"}, 30*time.Millisecond)

	var contents []string
	c.IterValues(func(v *planWithMetaData) bool {
		contents = append(contents, v.content)
		return false
	})
	require.Len(t, contents, 3)
	require.ElementsMatch(t, []string{"q1", "q2", "q3"}, contents)
}

func TestExpensivePlanCache_IterValues_EarlyStop(t *testing.T) {
	c := newExpensivePlanCache(10)

	c.Set(1, &planWithMetaData{content: "q1"}, 10*time.Millisecond)
	c.Set(2, &planWithMetaData{content: "q2"}, 20*time.Millisecond)
	c.Set(3, &planWithMetaData{content: "q3"}, 30*time.Millisecond)

	count := 0
	c.IterValues(func(v *planWithMetaData) bool {
		count++
		return true // stop after first
	})
	require.Equal(t, 1, count)
}

func TestExpensivePlanCache_Close(t *testing.T) {
	c := newExpensivePlanCache(10)
	c.Set(1, &planWithMetaData{content: "q1"}, 10*time.Millisecond)

	c.Close()

	// After close, entries map should be nil
	_, ok := c.Get(1)
	require.False(t, ok)
}

func TestExpensivePlanCache_SetAfterClose(t *testing.T) {
	c := newExpensivePlanCache(10)
	c.Close()

	// Set after Close should not panic
	c.Set(1, &planWithMetaData{content: "q1"}, 10*time.Millisecond)

	_, ok := c.Get(1)
	require.False(t, ok)
}

func TestExpensivePlanCache_IterValuesEmpty(t *testing.T) {
	c := newExpensivePlanCache(10)

	count := 0
	c.IterValues(func(v *planWithMetaData) bool {
		count++
		return false
	})
	require.Equal(t, 0, count)
}

func TestExpensivePlanCache_IterValuesAfterClose(t *testing.T) {
	c := newExpensivePlanCache(10)
	c.Set(1, &planWithMetaData{content: "q1"}, 10*time.Millisecond)
	c.Close()

	count := 0
	c.IterValues(func(v *planWithMetaData) bool {
		count++
		return false
	})
	require.Equal(t, 0, count)
}

func TestExpensivePlanCache_EqualDurationNotEvicted(t *testing.T) {
	c := newExpensivePlanCache(2)

	c.Set(1, &planWithMetaData{content: "q1"}, 10*time.Millisecond)
	c.Set(2, &planWithMetaData{content: "q2"}, 20*time.Millisecond)

	// Same duration as minimum (10ms) — should NOT evict (requires strictly greater)
	c.Set(3, &planWithMetaData{content: "q3"}, 10*time.Millisecond)

	_, ok := c.Get(3)
	require.False(t, ok, "entry with equal duration should not replace minimum")
	_, ok = c.Get(1)
	require.True(t, ok)
	_, ok = c.Get(2)
	require.True(t, ok)
}

func TestExpensivePlanCache_MaxSizeOne(t *testing.T) {
	c := newExpensivePlanCache(1)

	c.Set(1, &planWithMetaData{content: "q1"}, 10*time.Millisecond)
	got, ok := c.Get(1)
	require.True(t, ok)
	require.Equal(t, "q1", got.content)

	// Adding a more expensive entry should evict the only entry
	c.Set(2, &planWithMetaData{content: "q2"}, 20*time.Millisecond)
	_, ok = c.Get(1)
	require.False(t, ok)
	got, ok = c.Get(2)
	require.True(t, ok)
	require.Equal(t, "q2", got.content)

	// Adding a cheaper entry should be rejected
	c.Set(3, &planWithMetaData{content: "q3"}, 5*time.Millisecond)
	_, ok = c.Get(3)
	require.False(t, ok)
	_, ok = c.Get(2)
	require.True(t, ok)
}

func TestExpensivePlanCache_ConcurrentAccess(t *testing.T) {
	c := newExpensivePlanCache(100)
	done := make(chan struct{})

	// Concurrent writers — each goroutine writes to its own key range
	for i := 0; i < 10; i++ {
		go func(id int) {
			defer func() { done <- struct{}{} }()
			for j := 0; j < 100; j++ {
				key := uint64(id*100 + j)
				c.Set(key, &planWithMetaData{content: "q"}, time.Duration(j)*time.Millisecond)
			}
		}(i)
	}

	// Concurrent readers
	for i := 0; i < 10; i++ {
		go func(id int) {
			defer func() { done <- struct{}{} }()
			for j := 0; j < 100; j++ {
				c.Get(uint64(id*100 + j))
			}
		}(i)
	}

	// Concurrent iterators
	for i := 0; i < 5; i++ {
		go func() {
			defer func() { done <- struct{}{} }()
			c.IterValues(func(v *planWithMetaData) bool {
				return false
			})
		}()
	}

	// Wait for all goroutines
	for i := 0; i < 25; i++ {
		<-done
	}

	// Cache should be at capacity and all entries should be retrievable
	count := 0
	c.IterValues(func(v *planWithMetaData) bool {
		count++
		return false
	})
	require.Equal(t, 100, count, "cache should be at max capacity")

	// Every entry in the cache should be gettable
	c.IterValues(func(v *planWithMetaData) bool {
		require.Equal(t, "q", v.content)
		return false
	})
}
