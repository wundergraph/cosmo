package watcher

import (
	"context"
	"os"
	"time"

	"go.uber.org/zap"
)

type SimpleWatcherOptions struct {
	Interval time.Duration
	Logger   *zap.Logger
	Path     string
	Callback func()
}

func MustSimpleWatch(ctx context.Context, options SimpleWatcherOptions) {
	if err := SimpleWatch(ctx, options); err != nil {
		options.Logger.Fatal("Error watching file", zap.Error(err))
	}
}

func SimpleWatch(ctx context.Context, options SimpleWatcherOptions) error {
	ticker := time.NewTicker(options.Interval)
	defer ticker.Stop()

	ll := options.Logger.With(zap.String("path", options.Path))

	var prevModTime time.Time

	stat, err := os.Stat(options.Path)
	if err != nil {
		ll.Debug("Target file cannot be statted", zap.Error(err))
	} else {
		prevModTime = stat.ModTime()
	}

	ll.Debug("Watching file for changes", zap.Time("initialModTime", prevModTime))

	for {
		select {
		case <-ticker.C:
			stat, err := os.Stat(options.Path)
			if err != nil {
				ll.Debug("Target file cannot be statted", zap.Error(err))

				// Reset the mod time so we catch any new file at the target path
				prevModTime = time.Time{}

				continue
			}

			ll.Debug("Checking file for changes", zap.Time("prev", prevModTime), zap.Time("mod", stat.ModTime()))

			if stat.ModTime().After(prevModTime) {
				prevModTime = stat.ModTime()
				options.Callback()
			}
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}
