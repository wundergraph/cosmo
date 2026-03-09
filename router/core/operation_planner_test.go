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

