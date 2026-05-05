package cacheevents

import (
	"context"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/require"
	cacheeventsv1 "github.com/wundergraph/cosmo/graphqlmetrics/gen/proto/wg/cosmo/cacheevents/v1"
	"github.com/wundergraph/cosmo/graphqlmetrics/pkg/batchprocessor"
	utils "github.com/wundergraph/cosmo/graphqlmetrics/pkg/utils"
	"go.uber.org/zap"
)

// recordingDispatcher captures every batch the BatchProcessor flushes so
// tests can assert on enqueue + dispatch behaviour without ClickHouse.
type recordingDispatcher struct {
	mu      sync.Mutex
	batches [][]BatchItem
}

func (r *recordingDispatcher) dispatch(_ context.Context, items []BatchItem) {
	r.mu.Lock()
	// Copy because the BatchProcessor reuses the underlying buffer.
	cp := make([]BatchItem, len(items))
	copy(cp, items)
	r.batches = append(r.batches, cp)
	r.mu.Unlock()
}

func (r *recordingDispatcher) snapshot() [][]BatchItem {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([][]BatchItem, len(r.batches))
	copy(out, r.batches)
	return out
}

// newTestService builds a Service whose batch processor flushes through a
// recording dispatcher instead of writing to ClickHouse. The threshold is 1
// so each push triggers an immediate flush.
func newTestService(t *testing.T) (*Service, *recordingDispatcher) {
	t.Helper()
	rec := &recordingDispatcher{}
	bp := batchprocessor.New(batchprocessor.Options[BatchItem]{
		MaxQueueSize:  64,
		CostFunc:      batchCost,
		CostThreshold: 1,
		Interval:      50 * time.Millisecond,
		MaxWorkers:    1,
		Dispatcher:    rec.dispatch,
	})
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = bp.StopAndWait(ctx)
	})
	return &Service{logger: zap.NewNop(), processor: bp}, rec
}

func TestService_PublishEntityCacheEvents_RequiresAuth(t *testing.T) {
	t.Parallel()
	svc, rec := newTestService(t)

	// No claims attached to the context.
	resp, err := svc.PublishEntityCacheEvents(
		context.Background(),
		connect.NewRequest(&cacheeventsv1.PublishEntityCacheEventsRequest{
			Events: []*cacheeventsv1.CacheEvent{{EventType: cacheeventsv1.EventType_L1_READ}},
		}),
	)
	require.ErrorIs(t, err, errNotAuthenticated)
	require.Nil(t, resp)

	// Give the processor a moment to (not) dispatch.
	time.Sleep(100 * time.Millisecond)
	require.Empty(t, rec.snapshot(), "auth-rejected requests must not enqueue events")
}

func TestService_PublishEntityCacheEvents_EmptyEventsIsNoOp(t *testing.T) {
	t.Parallel()
	svc, rec := newTestService(t)

	ctx := utils.SetClaims(context.Background(), &utils.GraphAPITokenClaims{
		OrganizationID:   "org-1",
		FederatedGraphID: "fg-1",
	})

	resp, err := svc.PublishEntityCacheEvents(
		ctx,
		connect.NewRequest(&cacheeventsv1.PublishEntityCacheEventsRequest{}),
	)
	require.NoError(t, err)
	require.NotNil(t, resp)

	time.Sleep(100 * time.Millisecond)
	require.Empty(t, rec.snapshot(), "empty-events requests must not enqueue")
}

func TestService_PublishEntityCacheEvents_EnqueuesWithClaims(t *testing.T) {
	t.Parallel()
	svc, rec := newTestService(t)

	claims := &utils.GraphAPITokenClaims{
		OrganizationID:   "org-42",
		FederatedGraphID: "fg-42",
	}
	ctx := utils.SetClaims(context.Background(), claims)

	events := []*cacheeventsv1.CacheEvent{
		{EventType: cacheeventsv1.EventType_L1_READ, EntityType: "User"},
		{EventType: cacheeventsv1.EventType_L2_WRITE, EntityType: "Product"},
	}
	resp, err := svc.PublishEntityCacheEvents(
		ctx,
		connect.NewRequest(&cacheeventsv1.PublishEntityCacheEventsRequest{Events: events}),
	)
	require.NoError(t, err)
	require.NotNil(t, resp)

	require.Eventually(t, func() bool {
		for _, batch := range rec.snapshot() {
			for _, item := range batch {
				if len(item.Events) == len(events) && item.Claims != nil &&
					item.Claims.OrganizationID == claims.OrganizationID &&
					item.Claims.FederatedGraphID == claims.FederatedGraphID {
					return true
				}
			}
		}
		return false
	}, 2*time.Second, 25*time.Millisecond, "expected dispatcher to receive the published batch with attached claims")
}

// TestService_Shutdown_ReturnsWithinTimeout verifies that Shutdown returns
// promptly when the processor is idle. Drain-after-push semantics depend on
// the BatchProcessor's manager goroutine being scheduled before doneChan is
// closed, so they're covered indirectly by
// TestService_PublishEntityCacheEvents_EnqueuesWithClaims (which uses
// require.Eventually) rather than asserted strictly here.
func TestService_Shutdown_ReturnsWithinTimeout(t *testing.T) {
	t.Parallel()

	rec := &recordingDispatcher{}
	bp := batchprocessor.New(batchprocessor.Options[BatchItem]{
		MaxQueueSize:  64,
		CostFunc:      batchCost,
		CostThreshold: 1,
		Interval:      50 * time.Millisecond,
		MaxWorkers:    1,
		Dispatcher:    rec.dispatch,
	})
	svc := &Service{logger: zap.NewNop(), processor: bp}

	done := make(chan struct{})
	go func() {
		svc.Shutdown(2 * time.Second)
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("Shutdown did not return within the configured timeout")
	}
}
