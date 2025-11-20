package exporter

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	graphqlmetrics "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"go.uber.org/zap"
)

// mockSink is a simple sink that does nothing, for benchmarking
type mockSink struct {
	exportCount atomic.Int64
}

func (m *mockSink) Export(ctx context.Context, batch []*graphqlmetrics.SchemaUsageInfo) error {
	m.exportCount.Add(1)
	return nil
}

func (m *mockSink) Close(ctx context.Context) error {
	return nil
}

// BenchmarkExporterBatchBufferAllocation measures allocations when creating and recycling batch buffers
func BenchmarkExporterBatchBufferAllocation(b *testing.B) {
	logger := zap.NewNop()
	sink := &mockSink{}

	settings := &ExporterSettings{
		BatchSize:     100,
		QueueSize:     1000,
		Interval:      time.Second,
		ExportTimeout: time.Second,
		RetryOptions: RetryOptions{
			Enabled:     false,
			MaxRetry:    1,
			MaxDuration: time.Second,
			Interval:    time.Second,
		},
	}

	exporter, err := NewExporter(logger, sink, nil, settings)
	if err != nil {
		b.Fatal(err)
	}
	defer exporter.Shutdown(context.Background())

	b.ReportAllocs()

	for b.Loop() {
		// Get a buffer from the pool
		buffer := exporter.getBatchBuffer()

		// Simulate filling the buffer
		for j := 0; j < 10; j++ {
			buffer = append(buffer, &graphqlmetrics.SchemaUsageInfo{})
		}

		// Return buffer to pool
		exporter.putBatchBuffer(buffer)
	}
}

// BenchmarkExporterHighThroughput simulates high-throughput usage
func BenchmarkExporterHighThroughput(b *testing.B) {
	logger := zap.NewNop()
	sink := &mockSink{}

	settings := &ExporterSettings{
		BatchSize:     100,
		QueueSize:     10000,
		Interval:      100 * time.Millisecond,
		ExportTimeout: time.Second,
		RetryOptions: RetryOptions{
			Enabled:     false,
			MaxRetry:    1,
			MaxDuration: time.Second,
			Interval:    time.Second,
		},
	}

	exporter, err := NewExporter(logger, sink, nil, settings)
	if err != nil {
		b.Fatal(err)
	}

	item := &graphqlmetrics.SchemaUsageInfo{
		OperationInfo: &graphqlmetrics.OperationInfo{
			Hash: "test-hash",
			Name: "TestOperation",
			Type: graphqlmetrics.OperationType_QUERY,
		},
	}

	b.ReportAllocs()

	for b.Loop() {
		exporter.Record(item, false)
	}

	// Shutdown to flush remaining items
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	exporter.Shutdown(ctx)
}

// BenchmarkExporterBatchCycle measures a complete batch collection and flush cycle
func BenchmarkExporterBatchCycle(b *testing.B) {
	logger := zap.NewNop()
	sink := &mockSink{}

	settings := &ExporterSettings{
		BatchSize:     50, // Smaller batch for faster cycling
		QueueSize:     1000,
		Interval:      time.Hour, // Don't flush by time
		ExportTimeout: time.Second,
		RetryOptions: RetryOptions{
			Enabled:     false,
			MaxRetry:    1,
			MaxDuration: time.Second,
			Interval:    time.Second,
		},
	}

	exporter, err := NewExporter(logger, sink, nil, settings)
	if err != nil {
		b.Fatal(err)
	}
	defer exporter.Shutdown(context.Background())

	item := &graphqlmetrics.SchemaUsageInfo{
		OperationInfo: &graphqlmetrics.OperationInfo{
			Hash: "test-hash",
			Name: "TestOperation",
			Type: graphqlmetrics.OperationType_QUERY,
		},
	}

	b.ReportAllocs()

	for b.Loop() {
		// Fill exactly one batch
		for j := 0; j < settings.BatchSize; j++ {
			exporter.Record(item, false)
		}
		// Give time for batch to be processed
		time.Sleep(time.Millisecond)
	}
}

// BenchmarkExporterBufferGrowth measures allocations when buffers grow beyond initial capacity
func BenchmarkExporterBufferGrowth(b *testing.B) {
	logger := zap.NewNop()
	sink := &mockSink{}

	settings := &ExporterSettings{
		BatchSize:     100,
		QueueSize:     1000,
		Interval:      time.Second,
		ExportTimeout: time.Second,
		RetryOptions: RetryOptions{
			Enabled:     false,
			MaxRetry:    1,
			MaxDuration: time.Second,
			Interval:    time.Second,
		},
	}

	exporter, err := NewExporter(logger, sink, nil, settings)
	if err != nil {
		b.Fatal(err)
	}
	defer exporter.Shutdown(context.Background())

	b.ReportAllocs()

	for b.Loop() {
		// Get a buffer from the pool
		buffer := exporter.getBatchBuffer()

		// Fill to capacity (should not allocate)
		for j := 0; j < settings.BatchSize; j++ {
			buffer = append(buffer, &graphqlmetrics.SchemaUsageInfo{})
		}

		// Return buffer to pool
		exporter.putBatchBuffer(buffer)
	}
}

// BenchmarkExporterParallelRecords measures concurrent record operations
func BenchmarkExporterParallelRecords(b *testing.B) {
	logger := zap.NewNop()
	sink := &mockSink{}

	settings := &ExporterSettings{
		BatchSize:     100,
		QueueSize:     10000,
		Interval:      100 * time.Millisecond,
		ExportTimeout: time.Second,
		RetryOptions: RetryOptions{
			Enabled:     false,
			MaxRetry:    1,
			MaxDuration: time.Second,
			Interval:    time.Second,
		},
	}

	exporter, err := NewExporter(logger, sink, nil, settings)
	if err != nil {
		b.Fatal(err)
	}

	item := &graphqlmetrics.SchemaUsageInfo{
		OperationInfo: &graphqlmetrics.OperationInfo{
			Hash: "test-hash",
			Name: "TestOperation",
			Type: graphqlmetrics.OperationType_QUERY,
		},
	}

	b.ResetTimer()
	b.ReportAllocs()

	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			exporter.Record(item, false)
		}
	})

	// Shutdown to flush remaining items
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	exporter.Shutdown(ctx)
}
