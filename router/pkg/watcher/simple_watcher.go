package watcher

import (
	"context"
	"os"
	"time"

	"go.uber.org/zap"
)

func SimpleWatch(ctx context.Context, logger *zap.Logger, interval time.Duration, path string, cb func()) error {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	var prevModTime time.Time

	stat, err := os.Stat(path)
	if err != nil {
		logger.Debug("target file cannot be statted", zap.String("path", path), zap.Error(err))
	} else {
		prevModTime = stat.ModTime()
	}

	logger.Debug("watching", zap.String("filename", path), zap.Time("initialModTime", prevModTime))

	for {
		select {
		case <-ticker.C:
			stat, err := os.Stat(path)
			if err != nil {
				logger.Debug("target file cannot be statted", zap.String("path", path), zap.Error(err))

				// Reset the mod time so we catch any new file at the target path
				prevModTime = time.Time{}

				continue
			}

			logger.Debug("checking", zap.String("filename", path), zap.Time("prev", prevModTime), zap.Time("mod", stat.ModTime()))

			if stat.ModTime().After(prevModTime) {
				prevModTime = stat.ModTime()
				cb()
			}
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}
