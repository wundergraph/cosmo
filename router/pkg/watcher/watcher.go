package watcher

import (
	"context"
	"errors"
	"go.uber.org/zap"
	"golang.org/x/sync/errgroup"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/bep/debounce"
	"github.com/fsnotify/fsnotify"
)

// ErrStop informs the watcher to stop.
//
// ErrStop is not an error, it's part of the control flow.
var ErrStop = errors.New("stop watching")

// Arbitrarily picked after some manual testing. OSX is pretty fast, but Ubuntu
// requires a longer delay for writes. Duplicate checks below allow us to keep
// this snappy.
var debounceDelay = 20 * time.Millisecond

// Op is the type of file event that occurred
type Op byte

const (
	OpCreate Op = 'C'
	OpUpdate Op = 'U'
	OpDelete Op = 'D'
)

// Event is used to track file events
type Event struct {
	Op   Op
	Path string
}

func (e Event) String() string {
	return string(e.Op) + ":" + e.Path
}

func newEventSet() *eventSet {
	return &eventSet{
		events: map[string]Event{},
	}
}

// eventset is used to collect events that have changed and flush them all at once
// when the watch function is triggered.
type eventSet struct {
	mu     sync.RWMutex
	events map[string]Event
}

// Add an event to the set
func (p *eventSet) Add(event Event) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.events[event.String()] = event
}

// Flush the stored events and clear the event set.
func (p *eventSet) Flush() (events []Event) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, event := range p.events {
		events = append(events, event)
	}
	sort.Slice(events, func(i, j int) bool {
		return events[i].String() < events[j].String()
	})
	p.events = map[string]Event{}
	return events
}

type Watcher struct {
	watcher  *fsnotify.Watcher
	logger   *zap.Logger
	errGroup *errgroup.Group
}

// NewWatcher creates a new watcher
func NewWatcher(logger *zap.Logger) (*Watcher, error) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	return &Watcher{
		watcher: watcher,
		logger:  logger,
	}, nil
}

func (w *Watcher) Wait() error {
	if err := w.errGroup.Wait(); err != nil {
		if !errors.Is(err, ErrStop) {
			return err
		}
		return nil
	}
	return nil
}

// Watch watches a file for changes and triggers the provided function. The watcher stops when
// the context is canceled or an error is returned from the provided function.
func (w *Watcher) Watch(ctx context.Context, filePath string, fn func(events []Event) error) error {
	// Trigger is debounced to group events together
	errorCh := make(chan error)
	eventSet := newEventSet()
	debounceFunc := debounce.New(debounceDelay)
	trigger := func(event Event) {
		eventSet.Add(event)
		debounceFunc(func() {
			if err := fn(eventSet.Flush()); err != nil {
				errorCh <- err
				return
			}
		})
	}
	// Avoid duplicate events by checking the stamp of the file. This allows us
	// to bring down the debounce delay to trigger events faster.
	// TODO: bound this map
	duplicates := map[string]struct{}{}
	isDuplicate := func(path string, stat fs.FileInfo) bool {
		stamp, err := computeStamp(path, stat)
		if err != nil {
			return false
		}
		// Duplicate check
		if _, ok := duplicates[stamp]; ok {
			return true
		}
		duplicates[stamp] = struct{}{}
		return false
	}
	// For some reason renames are often emitted instead of
	// Remove. Check it and correct.
	rename := func(path string) error {
		_, err := os.Stat(path)
		if nil == err {
			return nil
		}
		// If it's a different error, ignore
		if !errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		// Remove the path and emit an update
		w.watcher.Remove(path)
		// Trigger an update
		trigger(Event{OpDelete, path})
		return nil
	}
	// Remove the file or directory from the watcher.
	// We intentionally ignore errors for this case.
	remove := func(path string) error {
		w.watcher.Remove(path)
		// Trigger an update
		trigger(Event{OpDelete, path})
		return nil
	}
	// Watching a file or directory as long as it's not inside .gitignore.
	// Ignore most errors since missing a file isn't the end of the world.
	// If a new directory is created, add and trigger all the files within
	// that directory.
	var create func(path string) error
	create = func(path string) error {
		// Stat the file
		stat, err := os.Stat(path)
		if err != nil {
			return nil
		}
		if isDuplicate(path, stat) {
			return nil
		}
		err = w.watcher.Add(path)
		if err != nil {
			return err
		}
		// If it's a directory, walk the dir and trigger creates
		// because those create events won't happen on their own
		if stat.IsDir() {
			trigger(Event{OpCreate, path})
			des, err := os.ReadDir(path)
			if err != nil {
				return err
			}
			for _, de := range des {
				if err := create(filepath.Join(path, de.Name())); err != nil {
					return err
				}
			}
			return nil
		}
		// Otherwise, trigger the create
		trigger(Event{OpCreate, path})
		return nil
	}
	// A file or directory has been updated. Notify our matchers.
	write := func(path string) error {
		// Stat the file
		stat, err := os.Stat(path)
		if err != nil {
			return nil
		}
		if isDuplicate(path, stat) {
			return nil
		}
		// Trigger an update
		trigger(Event{OpUpdate, path})
		return nil
	}

	// The implementation is intended to watch the directory of the file to get events
	// for create, delete, and rename.
	fileDir := filepath.Dir(filePath)

	// Walk the files, adding files that aren't ignored
	if err := filepath.WalkDir(fileDir, func(path string, de fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		// Add the path to the watcher
		if filePath == path {
			if err := w.watcher.Add(path); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return err
	}

	// Watch for file events!
	// Note: The FAQ currently says it needs to be in a separate Go routine
	// https://github.com/fsnotify/fsnotify#faq, so we'll do that.
	w.errGroup, ctx = errgroup.WithContext(ctx)
	w.errGroup.Go(func() error {
		defer w.watcher.Close()

		for {
			select {
			case <-ctx.Done():
				return nil
			case err := <-errorCh:
				w.logger.Error("watcher error", zap.Error(err))
				return err
			case err := <-w.watcher.Errors:
				w.logger.Error("internal watcher error", zap.Error(err))
				return err
			case evt := <-w.watcher.Events:
				// Sometimes the event name can be empty on Linux during deletes. Ignore
				// those events.
				if evt.Name == "" {
					continue
				}
				// Switch over the operations
				switch op := evt.Op; {

				// Handle rename events
				case op&fsnotify.Rename != 0:
					if err := rename(evt.Name); err != nil {
						w.logger.Error("watcher rename error", zap.Error(err))
						return err
					}

				// Handle remove events
				case op&fsnotify.Remove != 0:
					if err := remove(evt.Name); err != nil {
						w.logger.Error("watcher remove error", zap.Error(err))
						return err
					}

				// Handle create events
				case op&fsnotify.Create != 0:
					if err := create(evt.Name); err != nil {
						w.logger.Error("watcher create error", zap.Error(err))
						return err
					}

				// Handle write events
				case op&fsnotify.Write != 0:
					if err := write(evt.Name); err != nil {
						w.logger.Error("watcher write error", zap.Error(err))
						return err
					}
				}
			}
		}
	})

	return nil
}

// computeStamp uses path, size, mode and modtime to try and ensure this is a
// unique event.
func computeStamp(path string, stat fs.FileInfo) (stamp string, err error) {
	mtime := stat.ModTime().UnixNano()
	mode := stat.Mode()
	size := stat.Size()
	stamp = path + ":" + strconv.Itoa(int(size)) + ":" + mode.String() + ":" + strconv.Itoa(int(mtime))
	return stamp, nil
}
