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

func New(options Options) (func(ctx context.Context) error, error) {
	if options.Interval <= 0 {
		return nil, errors.New("interval must be greater than zero")
	}

	if options.Logger == nil {
		return nil, errors.New("logger must be provided")
	}

	if len(options.Paths) == 0 && options.Directory.DirPath == "" {
		return nil, errors.New("paths or directory must be provided")
	}

	if options.Callback == nil {
		return nil, errors.New("callback must be provided")
	}

	ll := options.Logger.With(zap.String("component", "file_watcher"), zap.Strings("path", options.Paths))

	listDirFilePaths := func() ([]string, error) {
		var files []string
		if options.Directory.DirPath != "" {
			err := filepath.WalkDir(options.Directory.DirPath, func(path string, d fs.DirEntry, err error) error {
				if err != nil {
					return err
				}
				// Skip directories
				if d.IsDir() {
					return nil
				}
				// Skip if filter rejects the file
				if options.Directory.Filter != nil && options.Directory.Filter(path) {
					return nil
				}
				files = append(files, path)
				return nil
			})
			if err != nil {
				return []string{}, fmt.Errorf("error walking directory %s: %w", options.Directory.DirPath, err)
			}
		}
		return files, nil
	}

	return func(ctx context.Context) error {
		// If a ticker source is provided, use that instead of the default ticker
		// The ticker source is right now used for testing
		ticker := options.TickSource
		if ticker == nil {
			ticker = time.Tick(options.Interval)
		}

		prevModTimes := make(map[string]time.Time)
		seenDirFilePaths := make(map[string]struct{})

		dirFilePaths, err := listDirFilePaths()
		if err != nil {
			ll.Error("failed to list directory files", zap.Error(err))
		}

		for _, path := range dirFilePaths {
			stat, err := os.Stat(path)
			if err != nil {
				ll.Debug("Target file cannot be statted", zap.Error(err))
			} else {
				prevModTimes[path] = stat.ModTime()
				ll.Debug("Watching file for changes", zap.String("path", path), zap.Time("initial_mod_time", prevModTimes[path]))
			}
			seenDirFilePaths[path] = struct{}{}
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

				dirFilePaths, err := listDirFilePaths()
				if err != nil {
					ll.Error("failed to list directory files", zap.Error(err))
				}

				visitedDirFilePaths := make(map[string]struct{})

				for _, path := range dirFilePaths {
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
					_, seen := seenDirFilePaths[path]
					// Detects new files & existing file updates in `options.Directory.DirPath`
					if !seen || stat.ModTime().After(prevModTimes[path]) {
						seenDirFilePaths[path] = struct{}{}
						prevModTimes[path] = stat.ModTime()
						changesDetected = true
					}
					visitedDirFilePaths[path] = struct{}{}
				}

				// Detects deleted files
				if len(seenDirFilePaths) > len(dirFilePaths) {
					changesDetected = true
				}

				for path := range seenDirFilePaths {
					if _, ok := visitedDirFilePaths[path]; !ok {
						delete(seenDirFilePaths, path)
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
					if stat.ModTime().After(prevModTimes[path]) {
						prevModTimes[path] = stat.ModTime()
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
				}
			case <-ctx.Done():
				return ctx.Err()
			}
		}
	}, nil
}
