package core

import (
	"context"
	"sync"
	"testing"
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
}
