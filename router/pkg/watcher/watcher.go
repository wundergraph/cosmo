package watcher

import (
	"context"
	"errors"
	"os"
	"time"

	"go.uber.org/zap"
)

type Options struct {
	Interval time.Duration
	Logger   *zap.Logger
	Path     string
	Callback func()
}

func New(options Options) (func(ctx context.Context) error, error) {
	if options.Interval <= 0 {
		return nil, errors.New("interval must be greater than zero")
	}

	if options.Logger == nil {
		return nil, errors.New("logger must be provided")
	}

	if options.Path == "" {
		return nil, errors.New("path must be provided")
	}

	if options.Callback == nil {
		return nil, errors.New("callback must be provided")
	}

	ll := options.Logger.With(zap.String("component", "file_watcher"), zap.String("path", options.Path))

	return func(ctx context.Context) error {
		ticker := time.NewTicker(options.Interval)
		defer ticker.Stop()

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
	}, nil
}
