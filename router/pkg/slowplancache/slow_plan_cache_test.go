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

func TestCache_ConcurrentAccess(t *testing.T) {
	t.Parallel()
	c, err := New[*testPlan](100, 0)
	require.NoError(t, err)
	defer c.Close()
	var wg sync.WaitGroup

	// Concurrent writers
	for i := range 10 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range 100 {
				key := uint64(i*100 + j) // test code, no overflow risk
				c.Set(key, &testPlan{content: "q"}, time.Duration(j)*time.Millisecond)
			}
		}()
	}

	// Concurrent readers
	for i := range 10 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range 100 {
				c.Get(uint64(i*100 + j)) // test code, no overflow risk
			}
		}()
	}

	// Concurrent iterators
	for range 5 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range c.Values() {
				_ = struct{}{} // prevent loop optimization
			}
		}()
	}

	wg.Wait()
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

// 3.726 ns/op | 3.695 ns/op | 3.702 ns/op : SyncMap
// 4.962 | 3.771 ns/op | 5.269 ns/op | 3.947 ns/op | 4.049 ns/op : Normal
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

// 4.399 ns/op | 4.602 ns/op | 4.454 ns/op | 4.506 ns/op : SyncMap
// 4.683 ns/op | 5.099 ns/op | 5.055 ns/op | 4.546 ns/op : Mutexes
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

// 17.14 ns/op | 17.11 ns/op | 17.65 ns/op : SyncMap
// 14.79 ns/op | 16.58 ns/op | 15.15 ns/op : Mutexes
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

// 6.644 ns/op | 6.507 ns/op | 6.496 ns/op : SyncMap
// 15.00 ns/op | 14.83 ns/op | 14.73 ns/op : Mutexes
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

// 7.874 ns/op | 8.178 ns/op | 7.957 ns/op : SyncMap
// 4.882 ns/op | 4.816 ns/op | 5.666 ns/op : Mutexes
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
