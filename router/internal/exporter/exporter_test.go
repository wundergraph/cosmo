package exporter

import (
	"context"
	"runtime"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	graphqlmetrics "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"go.uber.org/zap"
)

// newIdleExporter creates an exporter that won't flush on its own (long interval,
// no records), so tests can exercise the buffer pool deterministically.
func newIdleExporter(t *testing.T, batchSize int) *Exporter[*graphqlmetrics.SchemaUsageInfo] {
	t.Helper()
	e, err := NewExporter(zap.NewNop(), &mockSink{}, nil, &ExporterSettings{
		BatchSize:            batchSize,
		QueueSize:            16,
		Interval:             time.Hour,
		ExportTimeout:        time.Second,
		MaxConcurrentExports: 2,
		RetryOptions: RetryOptions{
			Enabled:     false,
			MaxRetry:    1,
			MaxDuration: time.Second,
			Interval:    time.Second,
		},
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = e.Shutdown(context.Background()) })
	return e
}

// TestPutBatchBufferClearsElements verifies a buffer returned to the pool comes
// back with no lingering element references (the clear-on-return fix). A dirty
// slot here would mean an already-exported item is still pinned by the pool.
func TestPutBatchBufferClearsElements(t *testing.T) {
	e := newIdleExporter(t, 4)

	buf := e.getBatchBuffer()
	buf = append(buf, &graphqlmetrics.SchemaUsageInfo{}, &graphqlmetrics.SchemaUsageInfo{}, &graphqlmetrics.SchemaUsageInfo{})
	e.putBatchBuffer(buf)

	full := buf[:cap(buf)]
	for i := range full {
		require.Nilf(t, full[i], "pooled buffer not cleared at slot %d", i)
	}
}

// TestPutBatchBufferDropsOversized verifies buffers that grew past BatchSize are
// discarded instead of pooled, so the pool can't retain oversized backing arrays.
func TestPutBatchBufferDropsOversized(t *testing.T) {
	e := newIdleExporter(t, 4)

	oversized := make([]*graphqlmetrics.SchemaUsageInfo, 0, e.settings.BatchSize*4)
	oversized = append(oversized, &graphqlmetrics.SchemaUsageInfo{})
	e.putBatchBuffer(oversized)

	got := e.getBatchBuffer()
	require.LessOrEqualf(t, cap(got), e.settings.BatchSize, "oversized buffer was pooled: cap=%d, want <= %d", cap(got), e.settings.BatchSize)
}

// blockingSink blocks every Export until release is closed, tracking how many
// exports run concurrently so a test can assert the inflight cap is respected.
type blockingSink struct {
	active  atomic.Int64
	maxSeen atomic.Int64
	release chan struct{}
}

func (s *blockingSink) Export(_ context.Context, _ []*graphqlmetrics.SchemaUsageInfo) error {
	cur := s.active.Add(1)
	for {
		m := s.maxSeen.Load()
		if cur <= m || s.maxSeen.CompareAndSwap(m, cur) {
			break
		}
	}
	<-s.release
	s.active.Add(-1)
	return nil
}

func (s *blockingSink) Close(_ context.Context) error { return nil }

// TestConcurrentExportsRespectCap verifies that no more than MaxConcurrentExports
// export goroutines run at once, and that the cap is actually reached (parallelism
// isn't accidentally serialized).
func TestConcurrentExportsRespectCap(t *testing.T) {
	const cap = 3
	sink := &blockingSink{release: make(chan struct{})}

	e, err := NewExporter(zap.NewNop(), sink, nil, &ExporterSettings{
		BatchSize:            1, // one item per batch, so each record can spawn an export
		QueueSize:            100,
		Interval:             time.Hour,
		ExportTimeout:        time.Minute,
		MaxConcurrentExports: cap,
		RetryOptions: RetryOptions{
			Enabled:     false,
			MaxRetry:    1,
			MaxDuration: time.Second,
			Interval:    time.Second,
		},
	})
	require.NoError(t, err)
	// Always free blocked export goroutines and shut down, even if an assertion
	// below fails. Release first to unblock the goroutines Shutdown waits on.
	t.Cleanup(func() {
		close(sink.release)
		_ = e.Shutdown(context.Background())
	})

	for range 10 {
		e.Record(&graphqlmetrics.SchemaUsageInfo{}, false)
	}

	require.Eventuallyf(t, func() bool { return sink.active.Load() >= cap }, 3*time.Second, 10*time.Millisecond,
		"cap not saturated: only %d concurrent exports", sink.active.Load())
	// Give the drain loop a chance to (wrongly) start a 4th export if the cap
	// weren't enforced; backpressure should keep it blocked on Acquire.
	time.Sleep(100 * time.Millisecond)
	require.Equal(t, int64(cap), sink.active.Load(), "active exports")
	require.Equal(t, int64(cap), sink.maxSeen.Load(), "max observed concurrency")
}

// TestExporterDoesNotRetainExportedItems is the end-to-end guarantee behind the
// clear fix: once a batch is exported and its goroutine finishes, the items must
// be collectable. If the pooled buffer (or the drain loop's reused buffer) still
// pinned them, the finalizers would never run and this would time out.
func TestExporterDoesNotRetainExportedItems(t *testing.T) {
	const n = 8
	sink := &mockSink{}

	e, err := NewExporter(zap.NewNop(), sink, nil, &ExporterSettings{
		BatchSize:            n, // fill exactly one batch so it flushes immediately
		QueueSize:            1024,
		Interval:             time.Hour,
		ExportTimeout:        time.Second,
		MaxConcurrentExports: 4,
		RetryOptions: RetryOptions{
			Enabled:     false,
			MaxRetry:    1,
			MaxDuration: time.Second,
			Interval:    time.Second,
		},
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = e.Shutdown(context.Background()) })

	var finalized atomic.Int64
	items := make([]*graphqlmetrics.SchemaUsageInfo, n)
	for i := range items {
		it := &graphqlmetrics.SchemaUsageInfo{}
		runtime.SetFinalizer(it, func(*graphqlmetrics.SchemaUsageInfo) { finalized.Add(1) })
		items[i] = it
		require.Truef(t, e.Record(it, false), "record %d unexpectedly dropped", i)
	}

	// Wait until the batch is exported and the export goroutine has finished, so
	// the buffer has been returned to the pool (and cleared, if the fix is in).
	require.Eventually(t, func() bool {
		return sink.exportCount.Load() >= 1 && e.inflightBatches.Load() == 0
	}, 5*time.Second, 10*time.Millisecond, "batch was not exported in time")

	// Drop our references; nothing in the exporter should keep the items alive.
	for i := range items {
		items[i] = nil
	}
	items = nil

	require.Eventuallyf(t, func() bool {
		runtime.GC()
		return finalized.Load() == int64(n)
	}, 5*time.Second, 10*time.Millisecond, "exported items were retained: want %d finalized", n)
}

// TestNewExporterDefaultsMaxConcurrentExports verifies that leaving the cap unset
// (<= 0) falls back to the default rather than producing a zero-capacity semaphore
// that would deadlock every export.
func TestNewExporterDefaultsMaxConcurrentExports(t *testing.T) {
	sink := &mockSink{}
	e, err := NewExporter(zap.NewNop(), sink, nil, &ExporterSettings{
		BatchSize:     4,
		QueueSize:     64,
		Interval:      time.Hour,
		ExportTimeout: time.Second,
		// MaxConcurrentExports intentionally left 0.
		RetryOptions: RetryOptions{
			Enabled:     false,
			MaxRetry:    1,
			MaxDuration: time.Second,
			Interval:    time.Second,
		},
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = e.Shutdown(context.Background()) })

	for range 12 {
		e.Record(&graphqlmetrics.SchemaUsageInfo{}, false)
	}
	require.Eventually(t, func() bool { return sink.exportCount.Load() >= 1 }, 3*time.Second, 10*time.Millisecond,
		"exporter with defaulted cap did not export (possible deadlock)")
}
