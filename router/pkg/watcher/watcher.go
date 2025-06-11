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
	Paths    []string
	Callback func()
}

func New(options Options) (func(ctx context.Context) error, error) {
	if options.Interval <= 0 {
		return nil, errors.New("interval must be greater than zero")
	}

	if options.Logger == nil {
		return nil, errors.New("logger must be provided")
	}

	if len(options.Paths) == 0 {
		return nil, errors.New("path must be provided")
	}

	if options.Callback == nil {
		return nil, errors.New("callback must be provided")
	}

	ll := options.Logger.With(zap.String("component", "file_watcher"), zap.Strings("path", options.Paths))

	return func(ctx context.Context) error {
		ticker := time.NewTicker(options.Interval)
		defer ticker.Stop()

		prevModTimes := make(map[string]time.Time)

		for _, path := range options.Paths {
			stat, err := os.Stat(path)
			if err != nil {
				ll.Debug("Target file cannot be statted", zap.Error(err))
			} else {
				prevModTimes[path] = stat.ModTime()
				ll.Debug("Watching file for changes", zap.String("path", path), zap.Time("initial_mod_time", prevModTimes[path]))
			}
		}

		for {
			select {
			case <-ticker.C:
				for _, path := range options.Paths {
					stat, err := os.Stat(path)
					if err != nil {
						ll.Debug("Target file cannot be statted", zap.String("path", path), zap.Error(err))

						// Reset the mod time so we catch any new file at the target path
						prevModTimes[path] = time.Time{}

						continue
					}

					ll.Debug("Checking file for changes",
						zap.String("path", path),
						zap.Time("prev_mod_time", prevModTimes[path]),
						zap.Time("current_mod_time", stat.ModTime()),
					)

					if stat.ModTime().After(prevModTimes[path]) {
						prevModTimes[path] = stat.ModTime()
						options.Callback()
					}
				}
			case <-ctx.Done():
				return ctx.Err()
			}
		}
	}, nil
}
