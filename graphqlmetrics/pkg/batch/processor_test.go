package batch

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestReceiveBatch(t *testing.T) {
	type input struct {
		batch  []int
		config ProcessorConfig
	}

	type expected struct {
		itemSize                 int
		numberOfBatchInvocations int
	}

	tests := []struct {
		name     string
		input    input
		expected expected
	}{
		{
			name: "should put all items in buffer",
			input: input{
				batch: make([]int, 10),
				config: ProcessorConfig{
					MaxCostThreshold: 100,
				},
			},
			expected: expected{
				itemSize:                 10,
				numberOfBatchInvocations: 0,
			},
		},
		{
			name: "should invoke batch function twice",
			input: input{
				batch: make([]int, 10),
				config: ProcessorConfig{
					MaxCostThreshold: 5,
				},
			},
			expected: expected{
				itemSize:                 0,
				numberOfBatchInvocations: 2,
			},
		},
		{
			name: "should invoke batch function twice and have remaining items in buffer",
			input: input{
				batch: make([]int, 14),
				config: ProcessorConfig{
					MaxCostThreshold: 5,
				},
			},
			expected: expected{
				itemSize:                 4,
				numberOfBatchInvocations: 2,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			invocationCount := 0

			countInvocations := func([]int) error {
				invocationCount++
				return nil
			}

			processor := NewProcessor(zap.NewNop(), tt.input.config, countInvocations, mockCostFunc)

			for _, item := range tt.input.batch {
				processor.receiveElement(item)
			}

			require.Lenf(t, processor.buffer, tt.expected.itemSize, "Buffer size is not as expected")
			require.Equal(t, tt.expected.numberOfBatchInvocations, invocationCount)
		})
	}
}

func TestNewProcessor(t *testing.T) {
	config := ProcessorConfig{
		MaxCostThreshold: 20,
		MaxQueueSize:     5,
		Interval:         time.Second,
	}
	processor := NewProcessor(zap.NewNop(), config, mockProcessBatch, mockCostFunc)

	require.NotNil(t, processor)
	require.Equal(t, config, processor.config)
	require.NotNil(t, processor.queue)
	require.NotNil(t, processor.buffer)
	require.Equal(t, 0, len(processor.buffer))
}

func TestEnqueue(t *testing.T) {
	config := ProcessorConfig{
		MaxCostThreshold: 20,
		MaxQueueSize:     5,
		Interval:         time.Second,
	}
	processor := NewProcessor(zap.NewNop(), config, mockProcessBatch, mockCostFunc)

	ctx := context.Background()
	for i := 1; i < 4; i++ {
		err := processor.Enqueue(ctx, i)
		require.NoError(t, err, "Enqueue should succeed when queue is not full")
	}

	// Test context cancellation during enqueue
	cancelCtx, cancel := context.WithCancel(ctx)
	go processor.Start(cancelCtx)

	cancel()
	var err error
	select {
	case <-processor.closeChan:
		err = processor.Enqueue(cancelCtx, []int{3, 4, 5}...)
	case <-time.After(2 * time.Second):
		err = nil
	}
	require.Error(t, err, "Enqueue should fail if context is canceled")
}

func TestProcess(t *testing.T) {
	config := ProcessorConfig{
		MaxCostThreshold: 20,
		MaxQueueSize:     5,
		Interval:         time.Second,
	}
	processor := NewProcessor(zap.NewNop(), config, mockProcessBatch, mockCostFunc)

	// Test processing of a full batch
	processor.buffer = []int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}
	processor.process()

	require.Equal(t, 0, len(processor.buffer), "Buffer should be cleared after processing")
}

func TestStartAndStopProcessor(t *testing.T) {
	config := ProcessorConfig{
		MaxCostThreshold: 10,
		MaxQueueSize:     5,
		Interval:         time.Minute,
	}
	processor := NewProcessor(zap.NewNop(), config, mockProcessBatch, mockCostFunc)

	ctx := context.Background()
	go processor.Start(ctx)

	require.NoError(t, processor.Enqueue(ctx, []int{1, 2, 3}...))
	require.NoError(t, processor.Enqueue(ctx, []int{4, 5}...))

	processor.Stop()

	// Stop the processor and verify it shuts down gracefully
	require.Equal(t, 0, len(processor.buffer), "Buffer should be empty after Stop is called")

	select {
	case _, open := <-processor.closeChan:
		require.False(t, open, "Close channel should be closed after Stop is called")
	case <-time.After(2 * time.Second):
		require.Fail(t, "Close channel should be closed after Stop is called")
	}
}

func TestStartProcessorWithCanceledContext(t *testing.T) {
	config := ProcessorConfig{
		MaxCostThreshold: 10,
		MaxQueueSize:     5,
		Interval:         time.Minute,
	}
	processor := NewProcessor(zap.NewNop(), config, mockProcessBatch, mockCostFunc)

	ctx, cancel := context.WithCancel(context.Background())

	go processor.Start(ctx)

	require.NoError(t, processor.Enqueue(ctx, []int{1, 2, 3}...))
	require.NoError(t, processor.Enqueue(ctx, []int{4, 5}...))

	cancel()

	select {
	case _, open := <-processor.closeChan:
		require.Equal(t, 0, len(processor.buffer), "Buffer should be empty after Stop is called")
		require.False(t, open, "Close channel should be closed after context is canceled")
	case <-time.After(2 * time.Second):
		require.Fail(t, "Processor should stop immediately after context is canceled")
	}
}

// Mock function to simulate batch processing
func mockProcessBatch(batch []int) error {
	if len(batch) == 0 {
		return errors.New("empty batch")
	}
	return nil
}

// Mock cost function to simulate cost calculation
func mockCostFunc(int) int {
	return 1
}
