package slowplancache

import (
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

func TestCache_IterValues(t *testing.T) {
	t.Parallel()
	c, err := New[*testPlan](10, 0)
	require.NoError(t, err)
	defer c.Close()

	c.Set(1, &testPlan{content: "q1"}, 10*time.Millisecond)
	c.Set(2, &testPlan{content: "q2"}, 20*time.Millisecond)
	c.Set(3, &testPlan{content: "q3"}, 30*time.Millisecond)
	c.Wait()

	var contents []string
	c.IterValues(func(v *testPlan) bool {
		contents = append(contents, v.content)
		return false
	})
	require.Len(t, contents, 3)
	require.ElementsMatch(t, []string{"q1", "q2", "q3"}, contents)
}

func TestCache_IterValues_EarlyStop(t *testing.T) {
	t.Parallel()
	c, err := New[*testPlan](10, 0)
	require.NoError(t, err)
	defer c.Close()

	c.Set(1, &testPlan{content: "q1"}, 10*time.Millisecond)
	c.Set(2, &testPlan{content: "q2"}, 20*time.Millisecond)
	c.Set(3, &testPlan{content: "q3"}, 30*time.Millisecond)
	c.Wait()

	count := 0
	c.IterValues(func(_ *testPlan) bool {
		count++
		return true // stop after first
	})
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

func TestCache_IterValuesEmpty(t *testing.T) {
	t.Parallel()
	c, err := New[*testPlan](10, 0)
	require.NoError(t, err)
	defer c.Close()

	count := 0
	c.IterValues(func(_ *testPlan) bool {
		count++
		return false
	})
	require.Equal(t, 0, count)
}

func TestCache_IterValuesAfterClose(t *testing.T) {
	t.Parallel()
	c, err := New[*testPlan](10, 0)
	require.NoError(t, err)
	c.Set(1, &testPlan{content: "q1"}, 10*time.Millisecond)
	c.Close()

	count := 0
	c.IterValues(func(_ *testPlan) bool {
		count++
		return false
	})
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
	done := make(chan struct{})

	// Concurrent writers
	for i := 0; i < 10; i++ {
		go func(id int) {
			defer func() { done <- struct{}{} }()
			for j := 0; j < 100; j++ {
				key := uint64(id*100 + j) //nolint:gosec // test code, no overflow risk
				c.Set(key, &testPlan{content: "q"}, time.Duration(j)*time.Millisecond)
			}
		}(i)
	}

	// Concurrent readers
	for i := 0; i < 10; i++ {
		go func(id int) {
			defer func() { done <- struct{}{} }()
			for j := 0; j < 100; j++ {
				c.Get(uint64(id*100 + j)) //nolint:gosec // test code, no overflow risk
			}
		}(i)
	}

	// Concurrent iterators
	for i := 0; i < 5; i++ {
		go func() {
			defer func() { done <- struct{}{} }()
			c.IterValues(func(_ *testPlan) bool {
				return false
			})
		}()
	}

	// Wait for all goroutines
	for i := 0; i < 25; i++ {
		<-done
	}
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
