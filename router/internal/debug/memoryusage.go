package debug

import (
	"context"
	"fmt"
	"runtime"
	"time"

	"go.uber.org/zap"
)

func ReportMemoryUsage(ctx context.Context, logger *zap.Logger) {
	go printLoop(ctx, logger)
}

func printLoop(ctx context.Context, logger *zap.Logger) {
	ticker := time.NewTicker(5 * time.Second)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			printMemoryUsage(logger)
		}
	}
}

func printMemoryUsage(logger *zap.Logger) {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	logger.Info("memory usage",
		zap.Uint64("alloc_mb", bToMb(m.Alloc)),
		zap.Uint64("total_alloc_mb", bToMb(m.TotalAlloc)),
		zap.Uint64("sys_mb", bToMb(m.Sys)),
		zap.Uint32("num_gc", m.NumGC),
	)
	if logger.Level() != zap.InfoLevel {
		fmt.Printf("memory usage: alloc_mb=%d total_alloc_mb=%d sys_mb=%d num_gc=%d\n", bToMb(m.Alloc), bToMb(m.TotalAlloc), bToMb(m.Sys), m.NumGC)
	}
}

func bToMb(b uint64) uint64 {
	return b / 1024 / 1024
}
