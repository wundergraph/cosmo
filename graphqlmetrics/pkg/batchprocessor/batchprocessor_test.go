package batchprocessor

import (
	"context"
	"github.com/stretchr/testify/require"
	"sync"
	"testing"
	"time"
)

func TestBatchProcessor_PushAndDispatchByCost(t *testing.T) {
	var dispatchedBatches [][]int
	var mutex sync.Mutex

	// Define the cost function
	costFunc := func(batch []int) int {
		return len(batch)
	}

	// Define the dispatcher function
	dispatcher := func(ctx context.Context, batch []int) {
		mutex.Lock()
		dispatchedBatches = append(dispatchedBatches, batch)
		mutex.Unlock()
	}

	// Create a new BatchProcessor using the Options struct
	bp := New(Options[int]{
		MaxQueueSize:  5,
		CostFunc:      costFunc,
		MaxWorkers:    2,
		CostThreshold: 3,
		Dispatcher:    dispatcher,
		Interval:      1 * time.Second,
	})

	// Push items onto the queue
	bp.Push(1)
	bp.Push(2)
	bp.Push(3) // Should trigger dispatch based on cost threshold

	// Wait a moment to allow dispatch
	time.Sleep(100 * time.Millisecond)

	// Check that the batch was dispatched
	mutex.Lock()
	if len(dispatchedBatches) != 1 {
		t.Fatalf("Expected 1 dispatched batch, got %d", len(dispatchedBatches))
	}
	if len(dispatchedBatches[0]) != 3 {
		t.Fatalf("Expected batch size 3, got %d", len(dispatchedBatches[0]))
	}
	mutex.Unlock()

	// Clean up
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	err := bp.StopAndWait(ctx)
	if err != nil {
		t.Fatalf("StopAndWait error: %v", err)
	}
}

func TestBatchProcessor_CorrectBatches(t *testing.T) {
	var dispatchedBatches [][]int
	var mutex sync.Mutex

	// Define the cost function
	costFunc := func(batch []int) int {
		return len(batch)
	}

	// Define the dispatcher function
	dispatcher := func(ctx context.Context, batch []int) {
		mutex.Lock()
		dispatchedBatches = append(dispatchedBatches, batch)
		mutex.Unlock()
	}

	batchSize := 10
	dispatchItems := 100

	// Create a new BatchProcessor using the Options struct
	bp := New(Options[int]{
		MaxQueueSize:  100,
		CostFunc:      costFunc,
		MaxWorkers:    2,
		CostThreshold: batchSize,
		Dispatcher:    dispatcher,
		Interval:      1 * time.Second,
	})

	// Push items onto the queue
	for i := 0; i < dispatchItems; i++ {
		_ = bp.Push(i)
	}

	// Wait a moment to allow dispatch
	time.Sleep(100 * time.Millisecond)

	// Clean up
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	err := bp.StopAndWait(ctx)
	if err != nil {
		t.Fatalf("StopAndWait error: %v", err)
	}

	// Check that the correct number of batches were dispatched
	if len(dispatchedBatches) != batchSize {
		t.Fatalf("Expected 10 dispatched batches, got %d", len(dispatchedBatches))
	}

	for i := 0; i < dispatchItems; i++ {
		if i%batchSize == 0 {
			if len(dispatchedBatches[i/batchSize]) != batchSize {
				t.Fatalf("Expected batch size 10, got %d", len(dispatchedBatches[i/batchSize]))
			}
		}
	}
}

func TestBatchProcessor_DispatchByInterval(t *testing.T) {
	var dispatchedBatches [][]int
	var mutex sync.Mutex

	// Define the cost function
	costFunc := func(batch []int) int {
		return 1 // Low cost to prevent dispatch by cost
	}

	// Define the dispatcher function
	dispatcher := func(ctx context.Context, batch []int) {
		mutex.Lock()
		dispatchedBatches = append(dispatchedBatches, batch)
		mutex.Unlock()
	}

	// Create a new BatchProcessor using the Options struct
	bp := New(Options[int]{
		MaxQueueSize:  5,
		CostFunc:      costFunc,
		MaxWorkers:    2,
		CostThreshold: 10, // High threshold to prevent cost-based dispatch
		Dispatcher:    dispatcher,
		Interval:      500 * time.Millisecond,
	})

	// Push items onto the queue
	bp.Push(1)
	bp.Push(2)

	// Wait for interval dispatch
	time.Sleep(600 * time.Millisecond)

	// Check that the batch was dispatched
	mutex.Lock()
	if len(dispatchedBatches) != 1 {
		t.Fatalf("Expected 1 dispatched batch, got %d", len(dispatchedBatches))
	}
	if len(dispatchedBatches[0]) != 2 {
		t.Fatalf("Expected batch size 2, got %d", len(dispatchedBatches[0]))
	}
	mutex.Unlock()

	// Clean up
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()
	err := bp.StopAndWait(ctx)
	if err != nil {
		t.Fatalf("StopAndWait error: %v", err)
	}
}

func TestBatchProcessor_StopAndWait_ContextCancellation(t *testing.T) {
	var dispatchedBatches [][]int
	var mutex sync.Mutex

	// Define the cost function
	costFunc := func(batch []int) int {
		return len(batch)
	}

	// Define the dispatcher function
	dispatcher := func(ctx context.Context, batch []int) {
		select {
		case <-ctx.Done():
			// Context canceled
			return
		default:
			// Simulate processing time
			time.Sleep(1 * time.Second)
			mutex.Lock()
			dispatchedBatches = append(dispatchedBatches, batch)
			mutex.Unlock()
		}
	}

	// Create a new BatchProcessor using the Options struct
	bp := New(Options[int]{
		MaxQueueSize:  10,
		CostFunc:      costFunc,
		CostThreshold: 15, // Higher than total items
		Dispatcher:    dispatcher,
		Interval:      2 * time.Second, // Longer than context timeout
	})

	// Push items onto the queue
	for i := 1; i <= 10; i++ {
		bp.Push(i)
	}

	// Create a context with a timeout shorter than dispatch interval
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	// Stop the processor and wait
	err := bp.StopAndWait(ctx)
	require.Nil(t, err)

	// Wait a bit to ensure dispatcher had time to process if it were to be called
	time.Sleep(100 * time.Millisecond)

	// Check that the dispatcher did not process any batches after context cancellation
	mutex.Lock()
	if len(dispatchedBatches) != 0 {
		t.Fatalf("Expected 0 dispatched batches, got %d", len(dispatchedBatches))
	}
	mutex.Unlock()
}

func TestBatchProcessor_BlockingPush(t *testing.T) {
	// Define the cost function
	costFunc := func(batch []int) int {
		return len(batch)
	}

	// Define the dispatcher function
	dispatcher := func(ctx context.Context, batch []int) {
		// Simulate slow processing
		time.Sleep(500 * time.Millisecond)
	}

	// Create a new BatchProcessor using the Options struct
	bp := New(Options[int]{
		MaxQueueSize:  2,
		CostFunc:      costFunc,
		MaxWorkers:    1,
		CostThreshold: 10,
		Dispatcher:    dispatcher,
		Interval:      1 * time.Second,
	})

	// Record the time before pushing items
	startTime := time.Now()

	// Use a wait group to wait for the goroutine to finish
	var wg sync.WaitGroup
	wg.Add(1)

	// Push items onto the queue
	go func() {
		defer wg.Done()
		bp.Push(1)
		bp.Push(2)
		// This push should block until there is space in the queue
		bp.Push(3)
	}()

	// Wait a moment to ensure the goroutine has started
	time.Sleep(100 * time.Millisecond)

	// Stop the processor and wait
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	err := bp.StopAndWait(ctx)
	if err != nil {
		t.Fatalf("StopAndWait error: %v", err)
	}

	// Wait for the goroutine to finish
	wg.Wait()

	// Calculate the elapsed time
	elapsedTime := time.Since(startTime)

	// Since the queue size is 2, the third push should block until the dispatcher processes items
	if elapsedTime < 500*time.Millisecond {
		t.Fatalf("Expected Push to block, but it returned too quickly")
	}
}
