package mcpserver

import (
	"context"
	"errors"
	"io/fs"
	"path/filepath"
	"strings"
	"time"

	"go.uber.org/zap"
)

// WatchOperationsDir starts a ticker that scans dir on every interval, detects
// when the set of .graphql / .gql files (or their modification times) has
// changed, and invokes onChange using a leading-edge debounce: the first tick
// that observes a change fires onChange immediately, and further fires are
// suppressed for one interval. If additional changes arrive during the
// cooldown, a single trailing fire runs once the cooldown expires so the final
// state always reaches the callback. This gives sub-interval first-notification
// latency for the common case (single save) while still coalescing bursts
// produced by editors that touch a file multiple times during save (atomic
// rename, formatter rewrite, save-on-blur + autosave).
//
// The watcher runs until ctx is cancelled. It is non-blocking — start it in a
// goroutine.
//
// onChange is invoked synchronously on the watcher goroutine. While it runs,
// ticker fires are dropped (Go tickers do not queue), so a slow callback
// throttles detection — keep it fast or run heavy work asynchronously inside
// the callback itself. The next snapshot after onChange returns picks up any
// changes that occurred during the call via the trailing-fire path.
//
// Errors from individual scans are logged at debug level; the watcher does not
// exit on transient I/O errors so that flaky filesystems (network mounts,
// container volumes) don't take down hot-reload.
func WatchOperationsDir(ctx context.Context, dir string, interval time.Duration, onChange func(), logger *zap.Logger) error {
	if dir == "" {
		return errors.New("dir is required")
	}
	if interval <= 0 {
		return errors.New("interval must be greater than zero")
	}
	if onChange == nil {
		return errors.New("onChange callback is required")
	}
	if logger == nil {
		logger = zap.NewNop()
	}

	logger = logger.With(zap.String("component", "mcp_operations_watcher"), zap.String("dir", dir))

	prev, err := snapshotOperationFiles(dir)
	if err != nil {
		// Don't fail startup on transient errors — start with an empty snapshot
		// and the next successful scan will pick everything up.
		logger.Debug("initial directory snapshot failed; starting with empty baseline", zap.Error(err))
		prev = map[string]fileFingerprint{}
	}

	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		// Cooldown is counted in ticks, not wall-clock time, because ticker
		// fires straddle a wall-clock cooldown boundary with jitter — a
		// time-based cooldown of one interval lets every tick fire and
		// defeats coalescing.
		cooldownTicks := 0
		pendingTrailing := false

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				curr, scanErr := snapshotOperationFiles(dir)
				if scanErr != nil {
					logger.Debug("scan failed", zap.Error(scanErr))
					continue
				}

				changed := !fingerprintsEqual(prev, curr)
				if changed {
					prev = curr
				}

				if cooldownTicks > 0 {
					cooldownTicks--
					if changed {
						pendingTrailing = true
					}
					continue
				}

				fire := false
				switch {
				case changed:
					fire = true
					pendingTrailing = false
				case pendingTrailing:
					fire = true
					pendingTrailing = false
				}

				if fire {
					// Two-tick cooldown: one tick to drain in-flight changes
					// (pendingTrailing accumulates), one quiet tick where the
					// trailing fire can land. A one-tick cooldown lets sustained
					// change streams fire on every other tick, which defeats
					// coalescing.
					cooldownTicks = 2
					logger.Info("operations directory changed; reloading tools and notifying connected clients")
					onChange()
				}
			}
		}
	}()

	return nil
}

// fileFingerprint identifies a file's relevant state (modification time + size).
type fileFingerprint struct {
	modTime time.Time
	size    int64
}

// snapshotOperationFiles returns a map of path → fingerprint for every .graphql / .gql
// file under dir. Used by the watcher to detect added, removed, or modified operations.
func snapshotOperationFiles(dir string) (map[string]fileFingerprint, error) {
	out := map[string]fileFingerprint{}
	walkErr := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		if ext != ".graphql" && ext != ".gql" {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil // skip unreadable entries; treat as if absent
		}
		out[path] = fileFingerprint{modTime: info.ModTime(), size: info.Size()}
		return nil
	})
	if walkErr != nil {
		return nil, walkErr
	}
	return out, nil
}

func fingerprintsEqual(a, b map[string]fileFingerprint) bool {
	if len(a) != len(b) {
		return false
	}
	for k, va := range a {
		vb, ok := b[k]
		if !ok || !va.modTime.Equal(vb.modTime) || va.size != vb.size {
			return false
		}
	}
	return true
}
