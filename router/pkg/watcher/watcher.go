package watcher

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"time"

	"go.uber.org/zap"
)

type DirOptions struct {
	DirPath string
	Filter  func(string) bool
}

type Options struct {
	Interval   time.Duration
	Logger     *zap.Logger
	Paths      []string
	Directory  DirOptions
	Callback   func()
	TickSource <-chan time.Time
}

func ListDirFilePaths(diropts DirOptions) ([]string, error) {
	var files []string
	if diropts.DirPath != "" {
		err := filepath.WalkDir(diropts.DirPath, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			// Skip directories
			if d.IsDir() {
				return nil
			}
			//  Accept if filter passes the file
			if diropts.Filter != nil && !diropts.Filter(path) {
				return nil
			}
			files = append(files, path)
			return nil
		})
		if err != nil {
			return files, fmt.Errorf("error walking directory %s: %w", diropts.DirPath, err)
		}
	}
	return files, nil
}

func New(options Options) (func(ctx context.Context) error, error) {
	if options.Interval <= 0 {
		return nil, errors.New("interval must be greater than zero")
	}

	if options.Logger == nil {
		return nil, errors.New("logger must be provided")
	}

	if len(options.Paths) == 0 && options.Directory.DirPath == "" {
		return nil, errors.New("either paths or directory must be provided")
	}

	if len(options.Paths) != 0 && options.Directory.DirPath != "" {
		return nil, errors.New("can't watch both paths and directory")
	}

	if options.Callback == nil {
		return nil, errors.New("callback must be provided")
	}

	ll := options.Logger.With(zap.String("component", "file_watcher"), zap.Strings("path", options.Paths))

	return func(ctx context.Context) error {
		// If a ticker source is provided, use that instead of the default ticker
		// The ticker source is right now used for testing
		ticker := options.TickSource
		if ticker == nil {
			ticker = time.Tick(options.Interval)
		}

		prevModTimes := make(map[string]time.Time)

		var err error
		if options.Directory.DirPath != "" {
			options.Paths, err = ListDirFilePaths(options.Directory)
			if err != nil {
				ll.Error("failed to list directory files", zap.Error(err))
			}
		}

		for _, path := range options.Paths {
			stat, err := os.Stat(path)
			if err != nil {
				ll.Debug("Target file cannot be statted", zap.Error(err))
			} else {
				prevModTimes[path] = stat.ModTime()
				ll.Debug("Watching file for changes", zap.String("path", path), zap.Time("initial_mod_time", prevModTimes[path]))
			}
		}

		pendingCallback := false

		for {
			select {
			case <-ticker:
				changesDetected := false

				if options.Directory.DirPath != "" {
					options.Paths, err = ListDirFilePaths(options.Directory)
					if err != nil {
						ll.Error("failed to list directory files", zap.Error(err))
					}
				}

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
					_, seen := prevModTimes[path]

					// Detects new files & existing file updates
					if !seen || stat.ModTime().After(prevModTimes[path]) {
						prevModTimes[path] = stat.ModTime()
						changesDetected = true
					}
				}

				for path := range prevModTimes {
					_, err := os.Stat(path)
					if os.IsNotExist(err) {
						delete(prevModTimes, path)
						changesDetected = true
					}
				}

				if changesDetected {
					// If there are changes detected this tick
					// We want to wait for the next tick (without changes)
					// to run the callback
					pendingCallback = true
				} else if pendingCallback {
					// When there are no changes detected for this tick
					// but the previous tick had changes detected
					pendingCallback = false
					options.Callback()
					ll.Info("Running callback!")
				}
			case <-ctx.Done():
				return ctx.Err()
			}
		}
	}, nil
}
