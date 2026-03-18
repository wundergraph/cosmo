package slowplancache

import (
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type testPlan struct {
	content string
}

func TestCache_GetSet(t *testing.T) {
	t.Parallel()
	c, err := New[*testPlan](10, 0)
	require.NoError(t, err)
	defer c.Close()

	plan1 := &testPlan{content: "query { a }"}
	plan2 := &testPlan{content: "query { b }"}

	// Miss
	_, ok := c.Get(1)
	require.False(t, ok)

	// Set and get
	c.Set(1, plan1, 10*time.Millisecond)
	c.Wait()
	got, ok := c.Get(1)
	require.True(t, ok)
	require.Equal(t, plan1, got)

	// Different key
	c.Set(2, plan2, 20*time.Millisecond)
	c.Wait()
	got, ok = c.Get(2)
	require.True(t, ok)
	require.Equal(t, plan2, got)

	// Original still there
	got, ok = c.Get(1)
	require.True(t, ok)
	require.Equal(t, plan1, got)
}

func TestCache_BoundedSize(t *testing.T) {
	t.Parallel()
	c, err := New[*testPlan](3, 0)
	require.NoError(t, err)
	defer c.Close()

	c.Set(1, &testPlan{content: "q1"}, 10*time.Millisecond)
	c.Set(2, &testPlan{content: "q2"}, 20*time.Millisecond)
	c.Set(3, &testPlan{content: "q3"}, 30*time.Millisecond)

	// Cache is full (3/3). Adding a 4th with higher duration should evict the shortest (key=1, 10ms)
	c.Set(4, &testPlan{content: "q4"}, 25*time.Millisecond)
	c.Wait()

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

func TestCache_BoundedSize_SkipsCheaper(t *testing.T) {
	t.Parallel()
	c, err := New[*testPlan](3, 0)
	require.NoError(t, err)
	defer c.Close()

	c.Set(1, &testPlan{content: "q1"}, 10*time.Second)
	c.Set(2, &testPlan{content: "q2"}, 20*time.Second)
	c.Set(3, &testPlan{content: "q3"}, 30*time.Second)

	// Try to add a cheaper entry (5s < 10s minimum) — should be rejected
	c.Set(4, &testPlan{content: "q4"}, 5*time.Second)
	c.Wait()

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

func TestCache_UpdateExisting(t *testing.T) {
	t.Parallel()
	c, err := New[*testPlan](2, 0)
	require.NoError(t, err)
	defer c.Close()

	plan1 := &testPlan{content: "q1"}
	plan1Updated := &testPlan{content: "q1-updated"}

	c.Set(1, plan1, 10*time.Millisecond)
	c.Set(1, plan1Updated, 50*time.Millisecond)
	c.Wait()

	got, ok := c.Get(1)
	require.True(t, ok)
	require.Equal(t, "q1-updated", got.content)

	// Updating an existing key should not increase the count
	c.Set(2, &testPlan{content: "q2"}, 20*time.Millisecond)
	c.Wait()
	_, ok = c.Get(1)
	require.True(t, ok, "key 1 should still exist after adding key 2 (capacity is 2)")
	_, ok = c.Get(2)
	require.True(t, ok)
}

func TestCache_Values(t *testing.T) {
	t.Parallel()
	c, err := New[*testPlan](10, 0)
	require.NoError(t, err)
	defer c.Close()

	c.Set(1, &testPlan{content: "q1"}, 10*time.Millisecond)
	c.Set(2, &testPlan{content: "q2"}, 20*time.Millisecond)
	c.Set(3, &testPlan{content: "q3"}, 30*time.Millisecond)
	c.Wait()

	var contents []string
	for v := range c.Values() {
		contents = append(contents, v.content)
	}
	require.Len(t, contents, 3)
	require.ElementsMatch(t, []string{"q1", "q2", "q3"}, contents)
}

func TestCache_Values_EarlyStop(t *testing.T) {
	t.Parallel()
	c, err := New[*testPlan](10, 0)
	require.NoError(t, err)
	defer c.Close()

	c.Set(1, &testPlan{content: "q1"}, 10*time.Millisecond)
	c.Set(2, &testPlan{content: "q2"}, 20*time.Millisecond)
	c.Set(3, &testPlan{content: "q3"}, 30*time.Millisecond)
	c.Wait()

	count := 0
	for range c.Values() {
		count++
		break // stop after first
	}
	require.Equal(t, 1, count)
}

func TestCache_Close(t *testing.T) {
	t.Parallel()
	c, err := New[*testPlan](10, 0)
	require.NoError(t, err)
	c.Set(1, &testPlan{content: "q1"}, 10*time.Millisecond)

	c.Close()

	// After close, entries map should be nil
	_, ok := c.Get(1)
	require.False(t, ok)
}

func TestCache_SetAfterClose(t *testing.T) {
	t.Parallel()
	c, err := New[*testPlan](10, 0)
	require.NoError(t, err)
	c.Close()

	// Set after Close should not panic — buffer drops silently
	require.NotPanics(t, func() {
		c.Set(1, &testPlan{content: "q1"}, 10*time.Millisecond)
	})

	_, ok := c.Get(1)
	require.False(t, ok)
}

func TestCache_ValuesEmpty(t *testing.T) {
	t.Parallel()
	c, err := New[*testPlan](10, 0)
	require.NoError(t, err)
	defer c.Close()

	count := 0
	for range c.Values() {
		count++
	}
	require.Equal(t, 0, count)
}

func TestCache_ValuesAfterClose(t *testing.T) {
	t.Parallel()
	c, err := New[*testPlan](10, 0)
	require.NoError(t, err)
	c.Set(1, &testPlan{content: "q1"}, 10*time.Millisecond)
	c.Close()

	count := 0
	for range c.Values() {
		count++
	}
	require.Equal(t, 0, count)
}

func TestCache_EqualDurationNotEvicted(t *testing.T) {
	t.Parallel()
	c, err := New[*testPlan](2, 0)
	require.NoError(t, err)
	defer c.Close()

	c.Set(1, &testPlan{content: "q1"}, 10*time.Millisecond)
	c.Set(2, &testPlan{content: "q2"}, 20*time.Millisecond)

	// Same duration as minimum (10ms) — should NOT evict (requires strictly greater)
	c.Set(3, &testPlan{content: "q3"}, 10*time.Millisecond)
	c.Wait()

	_, ok := c.Get(3)
	require.False(t, ok, "entry with equal duration should not replace minimum")
	_, ok = c.Get(1)
	require.True(t, ok)
	_, ok = c.Get(2)
	require.True(t, ok)
}

func TestCache_MaxSizeOne(t *testing.T) {
	t.Parallel()
	c, err := New[*testPlan](1, 0)
	require.NoError(t, err)
	defer c.Close()

	c.Set(1, &testPlan{content: "q1"}, 10*time.Millisecond)
	c.Wait()
	got, ok := c.Get(1)
	require.True(t, ok)
	require.Equal(t, "q1", got.content)

	// Adding a more expensive entry should evict the only entry
	c.Set(2, &testPlan{content: "q2"}, 20*time.Millisecond)
	c.Wait()
	_, ok = c.Get(1)
	require.False(t, ok)
	got, ok = c.Get(2)
	require.True(t, ok)
	require.Equal(t, "q2", got.content)

	// Adding a cheaper entry should be rejected
	c.Set(3, &testPlan{content: "q3"}, 5*time.Millisecond)
	c.Wait()
	_, ok = c.Get(3)
	require.False(t, ok)
	_, ok = c.Get(2)
	require.True(t, ok)
}

// runMixedOps exercises all cache operations deterministically based on the counter i.
// Operation distribution: ~29% writes, ~14% same-key writes, ~29% read hits,
// ~14% read misses, ~14% iteration (80% full, 20% early stop) + occasional Wait.
func runMixedOps(c *Cache[*testPlan], i int) {
	plan := &testPlan{content: "q"}
	op := i % 7
	key := uint64(i % 2000)

	switch {
	case op < 2:
		// ~29% writes with varying keys (triggers eviction when cache is full)
		c.Set(key, plan, time.Duration(i%500+1)*time.Millisecond)
	case op < 3:
		// ~14% writes to same key (triggers update path and possible refreshMin)
		c.Set(42, plan, time.Duration(i%500+1)*time.Millisecond)
	case op < 5:
		// ~29% reads that may hit
		c.Get(uint64(i % 500))
	case op < 6:
		// ~14% reads that will mostly miss (keys beyond cache capacity)
		c.Get(key + 1000)
	default:
		// ~14% iteration + Wait
		if i%5 == 0 {
			for range c.Values() {
				break
			}
		} else {
			for range c.Values() {
			}
		}
		if i%13 == 0 {
			c.Wait()
		}
	}
}

func TestCache_ConcurrentAccess(t *testing.T) {
	t.Parallel()
	c, err := New[*testPlan](100, 0)
	require.NoError(t, err)
	defer c.Close()
	var wg sync.WaitGroup

	const (
		numGoroutines = 2000
		opsPerRoutine = 5000
	)

	for g := range numGoroutines {
		wg.Go(func() {
			for j := range opsPerRoutine {
				runMixedOps(c, g*opsPerRoutine+j)
			}
		})
	}

	wg.Wait()
}

func BenchmarkCache_ConcurrentMixed(b *testing.B) {
	c, err := New[*testPlan](1000, 0)
	require.NoError(b, err)
	defer c.Close()

	// Pre-populate half the key space so we get a mix of hits and misses
	for i := range 500 {
		c.Set(uint64(i), &testPlan{content: "q"}, time.Duration(i+1)*time.Millisecond)
	}
	c.Wait()

	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			runMixedOps(c, i)
			i++
		}
	})
	c.Wait()
}

func TestCache_InvalidSize(t *testing.T) {
	t.Parallel()
	_, err := New[*testPlan](0, 0)
	require.Error(t, err)

	_, err = New[*testPlan](-1, 0)
	require.Error(t, err)
}

func TestCache_ThresholdRejectsBelow(t *testing.T) {
	t.Parallel()
	c, err := New[*testPlan](10, 100*time.Millisecond)
	require.NoError(t, err)
	defer c.Close()

	// Below threshold — should be rejected
	c.Set(1, &testPlan{content: "q1"}, 50*time.Millisecond)
	c.Wait()
	_, ok := c.Get(1)
	require.False(t, ok, "entry below threshold should be rejected")

	// At threshold — should be accepted
	c.Set(2, &testPlan{content: "q2"}, 100*time.Millisecond)
	c.Wait()
	_, ok = c.Get(2)
	require.True(t, ok, "entry at threshold should be accepted")

	// Above threshold — should be accepted
	c.Set(3, &testPlan{content: "q3"}, 200*time.Millisecond)
	c.Wait()
	_, ok = c.Get(3)
	require.True(t, ok, "entry above threshold should be accepted")
}

func TestCache_WaitAfterClose(t *testing.T) {
	t.Parallel()
	c, err := New[*testPlan](10, 0)
	require.NoError(t, err)

	c.Set(1, &testPlan{content: "q1"}, 10*time.Millisecond)
	c.Close()

	// Wait after Close should not deadlock or panic
	require.NotPanics(t, func() {
		c.Wait()
	})
}

func TestCache_DoubleClose(t *testing.T) {
	t.Parallel()
	c, err := New[*testPlan](10, 0)
	require.NoError(t, err)

	c.Set(1, &testPlan{content: "q1"}, 10*time.Millisecond)

	// Double Close should not panic
	require.NotPanics(t, func() {
		c.Close()
		c.Close()
	})
}

func BenchmarkCache_Set(b *testing.B) {
	c, err := New[*testPlan](1000, 0)
	require.NoError(b, err)
	defer c.Close()

	plan := &testPlan{content: "query { benchmarkField }"}

	i := 0
	for b.Loop() {
		c.Set(uint64(i), plan, time.Duration(i)*time.Millisecond)
		i++
	}
	c.Wait()
}

func BenchmarkCache_Set_Eviction(b *testing.B) {
	c, err := New[*testPlan](100, 0)
	require.NoError(b, err)
	defer c.Close()

	plan := &testPlan{content: "query { benchmarkField }"}

	i := 0
	for b.Loop() {
		c.Set(uint64(i), plan, time.Duration(i)*time.Millisecond)
		i++
	}
	c.Wait()
}

func BenchmarkCache_Get_Hit(b *testing.B) {
	c, err := New[*testPlan](1000, 0)
	require.NoError(b, err)
	defer c.Close()

	for i := range 1000 {
		c.Set(uint64(i), &testPlan{content: "q"}, time.Duration(i+1)*time.Millisecond)
	}
	c.Wait()

	i := 0
	for b.Loop() {
		c.Get(uint64(i % 1000))
		i++
	}
}

func BenchmarkCache_Get_Miss(b *testing.B) {
	c, err := New[*testPlan](1000, 0)
	require.NoError(b, err)
	defer c.Close()

	i := 0
	for b.Loop() {
		c.Get(uint64(i))
		i++
	}
}

func BenchmarkCache_Set_SameKey(b *testing.B) {
	c, err := New[*testPlan](1000, 0)
	require.NoError(b, err)
	defer c.Close()

	plan := &testPlan{content: "query { benchmarkField }"}

	// Pre-populate so the key exists
	c.Set(42, plan, 10*time.Millisecond)
	c.Wait()

	i := 0
	for b.Loop() {
		c.Set(42, plan, time.Duration(i)*time.Millisecond)
		i++
	}
	c.Wait()
}

// 19.22 ns/op | 21.75 ns/op | 18.95 ns/op : SyncMap
// 43.91 ns/op | 41.16 ns/op | 39.43 ns/op : Mutexes
func BenchmarkCache_Mixed(b *testing.B) {
	c, err := New[*testPlan](1000, 0)
	require.NoError(b, err)
	defer c.Close()

	plan := &testPlan{content: "query { benchmarkField }"}

	i := 0
	for b.Loop() {
		key := uint64(i % 2000)
		if i%3 == 0 {
			c.Set(key, plan, time.Duration(i)*time.Millisecond)
		} else {
			c.Get(key)
		}
		i++
	}
	c.Wait()
}
