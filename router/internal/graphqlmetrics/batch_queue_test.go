package graphqlmetrics

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"
)

func printf(s string, a ...interface{}) {
	if testing.Verbose() {
		fmt.Printf(s, a...)
	}
}

func produce(q chan string, numItems, numGoroutines int, out chan []string) {
	printf("=== Producing %d items.\n", numItems*numGoroutines)
	done := make(chan bool, 1)
	msgs := make(chan string)
	var wg sync.WaitGroup
	go func() {
		for i := 0; i < numGoroutines; i++ {
			wg.Add(1)
			go func(routineIdx int) {
				for j := 0; j < numItems; j++ {
					m := fmt.Sprintf("producer#%d, item#%d", routineIdx, j)
					q <- m
					msgs <- m
				}
				wg.Done()
			}(i)
		}
		wg.Wait()
		done <- true
	}()
	var coll []string
L:
	for {
		select {
		case m := <-msgs:
			coll = append(coll, m)
		case <-done:
			break L
		}
	}
	out <- coll
}

// Test cases:
//
// - Exceeding the batch limit, should trigger an immediate dispatch.
// - No items should be dropped in the dispatch-receive process.
// - When a receiver blocks, the rest of the items should be delivered.
func TestDispatchOrder(t *testing.T) {
	b := NewBatchQueue[string](&BatchQueueOptions{
		Interval:      time.Duration(10) * time.Millisecond,
		MaxBatchItems: 500,
		MaxQueueSize:  10240,
	})
	defer b.Stop()
	go b.Start(context.Background())

	var (
		numItems      = 10
		numGoroutines = 100
	)

	produced := make(chan []string, 1)
	go produce(b.inQueue, numItems, numGoroutines, produced)

	var dispatched []string
	breakout := make(chan bool)
	time.AfterFunc(time.Duration(30)*time.Millisecond, func() {
		breakout <- true
	})
L:
	for {
		select {
		case batch := <-b.OutQueue:
			for _, b := range batch {
				dispatched = append(dispatched, b)
			}
		case <-breakout:
			break L
		}
	}
	msgs := <-produced

	t.Run("no lost items", func(t *testing.T) {
		if len(msgs) != len(dispatched) {
			t.Error("dispatched messages are missing")
		}
	})

	t.Run("confirm dispatched items", func(t *testing.T) {
		msgExists := make(map[string]bool)
		for i := 0; i < len(msgs); i++ {
			msgExists[msgs[i]] = false
		}
		for i := 0; i < len(dispatched); i++ {
			if _, ok := msgExists[dispatched[i]]; !ok {
				t.Errorf("item was not dispatched: %s", dispatched[i])
			}
		}
	})
}
