package sandbox

import (
	"context"
	"encoding/json"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPool_BasicExecution(t *testing.T) {
	pool := NewPool(4, defaultConfig())
	defer pool.Close()

	result, err := pool.Execute(context.Background(), `(function() { return 42; })()`, nil, nil, nil)
	require.NoError(t, err)
	assert.Equal(t, json.RawMessage("42"), result.Value)
}

func TestPool_ConcurrentExecution(t *testing.T) {
	pool := NewPool(4, defaultConfig())
	defer pool.Close()

	var wg sync.WaitGroup
	var maxConcurrent atomic.Int32
	var current atomic.Int32
	errors := make([]error, 10)

	for i := range 10 {
		wg.Go(func() {
			cur := current.Add(1)
			defer current.Add(-1)

			// Track max concurrency
			for {
				old := maxConcurrent.Load()
				if cur <= old || maxConcurrent.CompareAndSwap(old, cur) {
					break
				}
			}

			result, err := pool.Execute(context.Background(), `(function() { return 1; })()`, nil, nil, nil)
			errors[i] = err
			if err == nil {
				assert.Equal(t, json.RawMessage("1"), result.Value)
			}
		})
	}

	wg.Wait()

	for i, err := range errors {
		assert.NoError(t, err, "execution %d failed", i)
	}
}

func TestPool_ConcurrencyLimit(t *testing.T) {
	// Pool size 2, submit 4 tasks that take 100ms each
	pool := NewPool(2, ExecutionConfig{
		Timeout:        5 * time.Second,
		MaxMemoryMB:    16,
		MaxOutputBytes: 1024 * 1024,
	})
	defer pool.Close()

	var concurrent atomic.Int32
	var maxSeen atomic.Int32
	var wg sync.WaitGroup

	for range 4 {
		wg.Go(func() {
			_, _ = pool.Execute(context.Background(), `(function() {
				trackConcurrency();
				var s = 0;
				for (var i = 0; i < 100000; i++) s += i;
				return s;
			})()`, []SyncFunc{
				{
					Name: "trackConcurrency",
					Fn: func(args []any) (any, error) {
						cur := concurrent.Add(1)
						defer concurrent.Add(-1)
						for {
							old := maxSeen.Load()
							if cur <= old || maxSeen.CompareAndSwap(old, cur) {
								break
							}
						}
						return nil, nil
					},
				},
			}, nil, nil)
		})
	}

	wg.Wait()
	// Pool size is 2, so max concurrent should be <= 2
	require.True(t, maxSeen.Load() <= int32(2), "max concurrent %d exceeds pool size 2", maxSeen.Load())
}

func TestPool_ContextCancellation(t *testing.T) {
	pool := NewPool(1, ExecutionConfig{
		Timeout:        5 * time.Second,
		MaxMemoryMB:    16,
		MaxOutputBytes: 1024 * 1024,
	})
	defer pool.Close()

	// Fill the pool with a blocking execution
	var started sync.WaitGroup
	started.Add(1)
	go func() {
		started.Done()
		_, _ = pool.Execute(context.Background(), `(function() {
			var s = 0;
			for (var i = 0; i < 100000000; i++) s += i;
			return s;
		})()`, nil, nil, nil)
	}()
	started.Wait()
	time.Sleep(10 * time.Millisecond) // Let the goroutine acquire the slot

	// Try to execute with a cancelled context — should fail
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	_, err := pool.Execute(ctx, `(function() { return 1; })()`, nil, nil, nil)
	assert.Error(t, err)
}

func TestPool_CloseRejectsNewExecutions(t *testing.T) {
	pool := NewPool(4, defaultConfig())
	pool.Close()

	_, err := pool.Execute(context.Background(), `(function() { return 1; })()`, nil, nil, nil)
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrPoolClosed)
}

func TestPool_DefaultSize(t *testing.T) {
	pool := NewPool(0, defaultConfig())
	defer pool.Close()

	result, err := pool.Execute(context.Background(), `(function() { return "ok"; })()`, nil, nil, nil)
	require.NoError(t, err)
	assert.Equal(t, json.RawMessage(`"ok"`), result.Value)
}

func TestPool_Config(t *testing.T) {
	cfg := defaultConfig()
	pool := NewPool(4, cfg)
	assert.Equal(t, cfg, pool.Config())
}
