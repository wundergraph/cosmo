package debug

import (
	"context"
	"github.com/dustin/go-humanize"
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
	logger.Info("Memory usage",
		zap.String("alloc_mb", humanize.Bytes(m.Alloc)),
		zap.String("total_alloc_mb", humanize.Bytes(m.TotalAlloc)),
		zap.String("sys_mb", humanize.Bytes(m.Sys)),
		zap.Uint32("num_gc", m.NumGC),
	)
}
