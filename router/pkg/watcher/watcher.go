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

func LogSimpleWatch(ctx context.Context, options SimpleWatcherOptions) {
	if err := SimpleWatch(ctx, options); err != nil {
		options.Logger.Error("Error watching file", zap.Error(err))
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

	ll.Debug("Watching file for changes", zap.Time("initial_mod_time", prevModTime))

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

			ll.Debug("Checking file for changes", zap.Time("prev_mod_time", prevModTime), zap.Time("current_mod_time", stat.ModTime()))

			if stat.ModTime().After(prevModTime) {
				prevModTime = stat.ModTime()
				options.Callback()
			}
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}
