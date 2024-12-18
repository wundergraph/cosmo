package core

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"go.uber.org/zap"
)

type CacheWarmupMockSource struct {
	items []*CacheWarmupItem
	err   error
}

func (c *CacheWarmupMockSource) LoadItems(ctx context.Context, log *zap.Logger) ([]*CacheWarmupItem, error) {
	return c.items, c.err
}

type CacheWarmupMockProcessor struct {
	err            error
	processedItems []*CacheWarmupItem
	mux            sync.Mutex
}

func (c *CacheWarmupMockProcessor) ProcessOperation(ctx context.Context, item *CacheWarmupItem) error {
	if c.err != nil {
		return c.err
	}
	c.mux.Lock()
	defer c.mux.Unlock()
	c.processedItems = append(c.processedItems, item)
	return nil
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
			items: []*CacheWarmupItem{
				{
					Request: GraphQLRequest{
						Query: "query { foo }",
					},
				},
				{
					Request: GraphQLRequest{
						Query: "query { bar }",
					},
				},
				{
					Request: GraphQLRequest{
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
			items: []*CacheWarmupItem{
				{
					Request: GraphQLRequest{
						Query: "query { foo }",
					},
				},
				{
					Request: GraphQLRequest{
						Query: "query { bar }",
					},
				},
				{
					Request: GraphQLRequest{
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
			items: []*CacheWarmupItem{
				{
					Request: GraphQLRequest{
						Query: "query { foo }",
					},
				},
				{
					Request: GraphQLRequest{
						Query: "query { bar }",
					},
				},
				{
					Request: GraphQLRequest{
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
			items: []*CacheWarmupItem{
				{
					Request: GraphQLRequest{
						Query: "query { foo }",
					},
				},
				{
					Request: GraphQLRequest{
						Query: "query { bar }",
					},
				},
				{
					Request: GraphQLRequest{
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
			items: make([]*CacheWarmupItem, 101),
		}
		for i := range source.items {
			source.items[i] = &CacheWarmupItem{
				Request: GraphQLRequest{
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
			items: []*CacheWarmupItem{
				{
					Request: GraphQLRequest{
						Query: "query { foo }",
					},
				},
				{
					Request: GraphQLRequest{
						Query: "query { bar }",
					},
				},
				{
					Request: GraphQLRequest{
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
}
