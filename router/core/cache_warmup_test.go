package core

import (
	"context"
	"sync"
	"testing"
	"testing/synctest"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
)

type CacheWarmupMockSource struct {
	items []*nodev1.Operation
	err   error
}

func (c *CacheWarmupMockSource) LoadItems(ctx context.Context, log *zap.Logger) ([]*nodev1.Operation, error) {
	return c.items, c.err
}

type CacheWarmupMockProcessor struct {
	err            error
	processedItems []*nodev1.Operation
	mux            sync.Mutex
}

func (c *CacheWarmupMockProcessor) ProcessOperation(ctx context.Context, item *nodev1.Operation) (*CacheWarmupOperationPlanResult, error) {
	if c.err != nil {
		return nil, c.err
	}
	c.mux.Lock()
	defer c.mux.Unlock()
	c.processedItems = append(c.processedItems, item)
	return &CacheWarmupOperationPlanResult{
		OperationHash: "",
		OperationName: "",
		OperationType: "",
		ClientName:    item.GetClient().Name,
		ClientVersion: item.GetClient().Version,
		PlanningTime:  0,
	}, nil
}

type CacheWarmupProcessorError struct{}

func (c CacheWarmupProcessorError) Error() string {
	return "processor error"
}

func (c CacheWarmupProcessorError) Timeout() bool {
	//TODO implement me
	panic("implement me")
}

func (c CacheWarmupProcessorError) Temporary() bool {
	//TODO implement me
	panic("implement me")
}

func TestCacheWarmup(t *testing.T) {
	t.Parallel()
	t.Run("success", func(t *testing.T) {
		t.Parallel()
		source := &CacheWarmupMockSource{
			items: []*nodev1.Operation{
				{
					Request: &nodev1.OperationRequest{
						Query: "query { foo }",
					},
				},
				{
					Request: &nodev1.OperationRequest{
						Query: "query { bar }",
					},
				},
				{
					Request: &nodev1.OperationRequest{
						Query: "query { baz }",
					},
				},
			},
		}
		processor := &CacheWarmupMockProcessor{
			mux: sync.Mutex{},
		}
		cfg := &CacheWarmupConfig{
			Log:            zap.NewNop(),
			Source:         source,
			Processor:      processor,
			ItemsPerSecond: 0, // unlimited
			Workers:        2,
			Timeout:        time.Second,
		}
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		err := WarmupCaches(ctx, cfg)
		assert.NoError(t, err)
		processor.mux.Lock()
		assert.Len(t, processor.processedItems, 3)
		processor.mux.Unlock()
	})
	t.Run("timeout", func(t *testing.T) {
		t.Parallel()
		source := &CacheWarmupMockSource{
			items: []*nodev1.Operation{
				{
					Request: &nodev1.OperationRequest{
						Query: "query { foo }",
					},
				},
				{
					Request: &nodev1.OperationRequest{
						Query: "query { bar }",
					},
				},
				{
					Request: &nodev1.OperationRequest{
						Query: "query { baz }",
					},
				},
			},
		}
		processor := &CacheWarmupMockProcessor{
			mux: sync.Mutex{},
		}
		cfg := &CacheWarmupConfig{
			Log:            zap.NewNop(),
			Source:         source,
			Processor:      processor,
			ItemsPerSecond: 1,
			Workers:        2,
			Timeout:        time.Millisecond,
		}
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		err := WarmupCaches(ctx, cfg)
		assert.ErrorIs(t, err, context.DeadlineExceeded)
	})
	t.Run("more workers than items", func(t *testing.T) {
		t.Parallel()
		source := &CacheWarmupMockSource{
			items: []*nodev1.Operation{
				{
					Request: &nodev1.OperationRequest{
						Query: "query { foo }",
					},
				},
				{
					Request: &nodev1.OperationRequest{
						Query: "query { bar }",
					},
				},
				{
					Request: &nodev1.OperationRequest{
						Query: "query { baz }",
					},
				},
			},
		}
		processor := &CacheWarmupMockProcessor{
			mux: sync.Mutex{},
		}
		cfg := &CacheWarmupConfig{
			Log:            zap.NewNop(),
			Source:         source,
			Processor:      processor,
			ItemsPerSecond: 10,
			Workers:        6,
			Timeout:        time.Second,
		}
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		err := WarmupCaches(ctx, cfg)
		assert.NoError(t, err)
		processor.mux.Lock()
		assert.Len(t, processor.processedItems, 3)
		processor.mux.Unlock()
	})
	t.Run("processor error", func(t *testing.T) {
		t.Parallel()
		source := &CacheWarmupMockSource{
			items: []*nodev1.Operation{
				{
					Request: &nodev1.OperationRequest{
						Query: "query { foo }",
					},
				},
				{
					Request: &nodev1.OperationRequest{
						Query: "query { bar }",
					},
				},
				{
					Request: &nodev1.OperationRequest{
						Query: "query { baz }",
					},
				},
			},
		}
		processor := &CacheWarmupMockProcessor{
			mux: sync.Mutex{},
			err: &CacheWarmupProcessorError{},
		}
		cfg := &CacheWarmupConfig{
			Log:            zap.NewNop(),
			Source:         source,
			Processor:      processor,
			ItemsPerSecond: 0, // unlimited
			Workers:        2,
			Timeout:        time.Second,
		}
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		err := WarmupCaches(ctx, cfg)
		assert.NoError(t, err)
		processor.mux.Lock()
		assert.Len(t, processor.processedItems, 0)
		processor.mux.Unlock()
	})
	t.Run("101 items", func(t *testing.T) {
		t.Parallel()
		source := &CacheWarmupMockSource{
			items: make([]*nodev1.Operation, 101),
		}
		for i := range source.items {
			source.items[i] = &nodev1.Operation{
				Request: &nodev1.OperationRequest{
					Query: "query { foo }",
				},
			}
		}
		processor := &CacheWarmupMockProcessor{
			mux: sync.Mutex{},
		}
		cfg := &CacheWarmupConfig{
			Log:            zap.NewNop(),
			Source:         source,
			Processor:      processor,
			ItemsPerSecond: 1000, // unlimited
			Workers:        10,
			Timeout:        time.Second * 5,
		}
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		err := WarmupCaches(ctx, cfg)
		assert.NoError(t, err)
		processor.mux.Lock()
		assert.Len(t, processor.processedItems, 101)
		processor.mux.Unlock()
	})
	t.Run("ctx done", func(t *testing.T) {
		t.Parallel()
		source := &CacheWarmupMockSource{
			items: []*nodev1.Operation{
				{
					Request: &nodev1.OperationRequest{
						Query: "query { foo }",
					},
				},
				{
					Request: &nodev1.OperationRequest{
						Query: "query { bar }",
					},
				},
				{
					Request: &nodev1.OperationRequest{
						Query: "query { baz }",
					},
				},
			},
		}
		processor := &CacheWarmupMockProcessor{
			mux: sync.Mutex{},
		}
		cfg := &CacheWarmupConfig{
			Log:            zap.NewNop(),
			Source:         source,
			Processor:      processor,
			ItemsPerSecond: 0, // unlimited
			Workers:        2,
			Timeout:        time.Second,
		}
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		err := WarmupCaches(ctx, cfg)
		assert.ErrorIs(t, err, context.Canceled)
	})
	t.Run("load items error", func(t *testing.T) {
		t.Parallel()
		source := &CacheWarmupMockSource{
			err: &CacheWarmupProcessorError{},
		}
		processor := &CacheWarmupMockProcessor{
			mux: sync.Mutex{},
		}
		cfg := &CacheWarmupConfig{
			Log:            zap.NewNop(),
			Source:         source,
			Processor:      processor,
			ItemsPerSecond: 0, // unlimited
			Workers:        2,
			Timeout:        time.Second,
		}
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		err := WarmupCaches(ctx, cfg)
		assert.ErrorIs(t, err, &CacheWarmupProcessorError{})
	})
	t.Run("load items returns empty list", func(t *testing.T) {
		t.Parallel()
		source := &CacheWarmupMockSource{}
		processor := &CacheWarmupMockProcessor{
			mux: sync.Mutex{},
		}
		cfg := &CacheWarmupConfig{
			Log:            zap.NewNop(),
			Source:         source,
			Processor:      processor,
			ItemsPerSecond: 0, // unlimited
			Workers:        2,
			Timeout:        time.Second,
		}
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		err := WarmupCaches(ctx, cfg)
		assert.NoError(t, err)
		processor.mux.Lock()
		assert.Len(t, processor.processedItems, 0)
		processor.mux.Unlock()
	})
	t.Run("logs warmup started and completed at info level", func(t *testing.T) {
		t.Parallel()
		core, logs := observer.New(zapcore.InfoLevel)
		logger := zap.New(core)
		source := &CacheWarmupMockSource{
			items: []*nodev1.Operation{
				{
					Request: &nodev1.OperationRequest{
						Query: "query { foo }",
					},
				},
			},
		}
		processor := &CacheWarmupMockProcessor{
			mux: sync.Mutex{},
		}
		cfg := &CacheWarmupConfig{
			Log:            logger,
			Source:         source,
			Processor:      processor,
			ItemsPerSecond: 0,
			Workers:        2,
			Timeout:        time.Second,
		}
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		err := WarmupCaches(ctx, cfg)
		require.NoError(t, err)

		infoLogs := logs.FilterLevelExact(zapcore.InfoLevel)
		messages := make([]string, infoLogs.Len())
		for i, entry := range infoLogs.All() {
			messages[i] = entry.Message
		}
		require.Contains(t, messages, "Warmup started")
		require.Contains(t, messages, "Warmup completed")
	})
	t.Run("logs no items to process at info level", func(t *testing.T) {
		t.Parallel()
		core, logs := observer.New(zapcore.InfoLevel)
		logger := zap.New(core)
		source := &CacheWarmupMockSource{}
		processor := &CacheWarmupMockProcessor{
			mux: sync.Mutex{},
		}
		cfg := &CacheWarmupConfig{
			Log:            logger,
			Source:         source,
			Processor:      processor,
			ItemsPerSecond: 0,
			Workers:        2,
			Timeout:        time.Second,
		}
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		err := WarmupCaches(ctx, cfg)
		require.NoError(t, err)

		infoLogs := logs.FilterLevelExact(zapcore.InfoLevel)
		messages := make([]string, infoLogs.Len())
		for i, entry := range infoLogs.All() {
			messages[i] = entry.Message
		}
		require.Contains(t, messages, "No items to process")
	})
	t.Run("warmup started and completed not logged at debug level", func(t *testing.T) {
		t.Parallel()
		// With a DebugLevel observer, Info messages are captured too,
		// but the key assertion is that the entries themselves are at InfoLevel, not DebugLevel.
		core, logs := observer.New(zapcore.DebugLevel)
		logger := zap.New(core)
		source := &CacheWarmupMockSource{
			items: []*nodev1.Operation{
				{
					Request: &nodev1.OperationRequest{
						Query: "query { foo }",
					},
				},
			},
		}
		processor := &CacheWarmupMockProcessor{
			mux: sync.Mutex{},
		}
		cfg := &CacheWarmupConfig{
			Log:            logger,
			Source:         source,
			Processor:      processor,
			ItemsPerSecond: 0,
			Workers:        2,
			Timeout:        time.Second,
		}
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		err := WarmupCaches(ctx, cfg)
		require.NoError(t, err)

		// Verify that "Warmup started" and "Warmup completed" are logged at Info, not Debug
		for _, entry := range logs.All() {
			if entry.Message == "Warmup started" || entry.Message == "Warmup completed" || entry.Message == "No items to process" {
				require.Equal(t, zapcore.InfoLevel, entry.Level, "expected %q to be logged at Info level", entry.Message)
			}
		}
	})
	t.Run("item delay combined with items per second", func(t *testing.T) {
		t.Parallel()

		newItems := func(n int) []*nodev1.Operation {
			items := make([]*nodev1.Operation, n)
			for i := range items {
				items[i] = &nodev1.Operation{
					Request: &nodev1.OperationRequest{Query: "query { foo }"},
				}
			}
			return items
		}

		// runWarmup warms up itemCount items with a single worker so that the
		// rate limiter and the item delay apply sequentially. It runs inside a
		// testing/synctest bubble: the bubble's fake clock advances instantly
		// and deterministically, so time.After (ItemDelay) and the rate
		// limiter's sleeps produce an exact, flake-free elapsed duration.
		runWarmup := func(t *testing.T, itemCount, itemsPerSecond int, itemDelay time.Duration) time.Duration {
			t.Helper()
			var elapsed time.Duration
			synctest.Test(t, func(t *testing.T) {
				source := &CacheWarmupMockSource{items: newItems(itemCount)}
				processor := &CacheWarmupMockProcessor{mux: sync.Mutex{}}
				cfg := &CacheWarmupConfig{
					Log:            zap.NewNop(),
					Source:         source,
					Processor:      processor,
					ItemsPerSecond: itemsPerSecond,
					ItemDelay:      itemDelay,
					Workers:        1, // single worker => spacing is sequential
					Timeout:        30 * time.Second,
				}
				start := time.Now()
				require.NoError(t, WarmupCaches(context.Background(), cfg))
				elapsed = time.Since(start)

				// WarmupCaches returns once all items are counted, but its
				// worker goroutine still has to observe the closed index
				// channel and exit. Wait for it so the bubble can settle.
				synctest.Wait()

				processor.mux.Lock()
				require.Len(t, processor.processedItems, itemCount)
				processor.mux.Unlock()
			})
			return elapsed
		}

		// The rate limiter spaces the *start* of each item by 1/itemsPerSecond,
		// while ItemDelay pauses *after* each item is processed. With a single
		// worker the two overlap: effective per-item spacing is
		// max(1/itemsPerSecond, ItemDelay), not the sum of the two.

		t.Run("no item delay and no rate limit runs without throttling", func(t *testing.T) {
			t.Parallel()
			// With ItemDelay=0 the post-processing pause is skipped entirely and
			// the unlimited rate limiter never sleeps: nothing advances the fake clock.
			elapsed := runWarmup(t, 6, 0 /* unlimited */, 0 /* no delay */)
			require.Equal(t, time.Duration(0), elapsed)
		})

		t.Run("item delay caps throughput below the configured items per second", func(t *testing.T) {
			t.Parallel()
			const itemCount = 6
			const itemsPerSecond = 2                  // 500ms rate gap
			const itemDelay = 1100 * time.Millisecond // slower than the 500ms rate gap
			elapsed := runWarmup(t, itemCount, itemsPerSecond, itemDelay)

			// Because itemDelay > rate gap, the delay — not the rate limiter —
			// paces the run. 1 worker: elapsed is exactly itemCount*itemDelay,
			// i.e. throughput 1/itemDelay (~0.91/s), capped below the configured
			// itemsPerSecond (2/s).
			require.Equal(t, itemCount*itemDelay, elapsed)
		})

		t.Run("rate limit dominates when slower than the item delay", func(t *testing.T) {
			t.Parallel()
			const itemCount = 6
			const itemsPerSecond = 25 // => 40ms between item starts
			const rateGap = time.Second / itemsPerSecond
			const itemDelay = 5 * time.Millisecond // far smaller than the 40ms rate gap
			elapsed := runWarmup(t, itemCount, itemsPerSecond, itemDelay)
			// The rate limiter spaces the (itemCount-1) gaps between item
			// starts; the final item still incurs one trailing ItemDelay.
			require.Equal(t, (itemCount-1)*rateGap+itemDelay, elapsed)
		})
	})
}

func TestCacheWarmupConfigValidate(t *testing.T) {
	t.Parallel()

	t.Run("negative item_delay is rejected", func(t *testing.T) {
		t.Parallel()
		cfg := &CacheWarmupConfig{ItemDelay: -1 * time.Second}
		err := cfg.Validate()
		require.Error(t, err)
		require.ErrorContains(t, err, "the warmup config value for item_delay must not be negative")
	})

	t.Run("zero item_delay is accepted", func(t *testing.T) {
		t.Parallel()
		cfg := &CacheWarmupConfig{ItemDelay: 0}
		require.NoError(t, cfg.Validate())
	})

	t.Run("positive item_delay is accepted", func(t *testing.T) {
		t.Parallel()
		cfg := &CacheWarmupConfig{ItemDelay: 250 * time.Millisecond}
		require.NoError(t, cfg.Validate())
	})
}
