package operationmanifest

import (
	"context"
	"sync"
	"sync/atomic"

	"go.uber.org/zap"
)

type Store struct {
	manifest  atomic.Pointer[Manifest]
	updateCh  chan struct{}
	ctx       context.Context
	onUpdate  atomic.Value // stores func()
	startOnce sync.Once
	logger    *zap.Logger
}

// NewStore returns a store whose update worker stops when ctx is canceled.
// Load still swaps the manifest after that but does not signal the worker.
func NewStore(ctx context.Context, logger *zap.Logger) *Store {
	return &Store{
		ctx:      ctx,
		logger:   logger,
		updateCh: make(chan struct{}, 1),
	}
}

// SetOnUpdate registers a callback that is invoked after the manifest is updated via Load.
// The callback runs on a dedicated worker goroutine that processes signals sequentially.
// If an update arrives while the callback is still running, it is coalesced into a single
// pending signal — at most one signal is buffered, so rapid updates don't queue up.
// Safe to call multiple times (e.g. on config reload): the callback is swapped atomically.
func (s *Store) SetOnUpdate(fn func()) {
	s.onUpdate.Store(fn)
	s.startOnce.Do(func() {
		go func() {
			for {
				select {
				case <-s.ctx.Done():
					return
				case <-s.updateCh:
					if f, ok := s.onUpdate.Load().(func()); ok && f != nil {
						f()
					}
				}
			}
		}()
	})
}

// Load swaps the manifest atomically and signals the update worker if a callback is registered.
// If the worker is busy processing a previous update, the signal is dropped (coalesced)
// so back-to-back manifest updates don't queue unbounded work.
func (s *Store) Load(manifest *Manifest) {
	s.manifest.Store(manifest)

	if s.onUpdate.Load() == nil || s.ctx.Err() != nil {
		return
	}

	select {
	case s.updateCh <- struct{}{}:
	default:
		s.logger.Debug("Skipping manifest update signal, worker is busy")
	}
}

// Snapshot returns the current manifest. Published manifests must not be modified.
func (s *Store) Snapshot() *Manifest {
	return s.manifest.Load()
}

// LookupByHash performs an O(1) map lookup by sha256 hash.
func (s *Store) LookupByHash(sha256Hash string) (body []byte, found bool) {
	m := s.manifest.Load()
	if m == nil {
		return nil, false
	}

	op, ok := m.Operations[sha256Hash]
	if !ok {
		return nil, false
	}

	return []byte(op), true
}

// IsLoaded returns whether a manifest has been loaded.
func (s *Store) IsLoaded() bool {
	return s.manifest.Load() != nil
}

// Revision returns the current manifest revision for polling.
func (s *Store) Revision() string {
	m := s.manifest.Load()
	if m == nil {
		return ""
	}
	return m.Revision
}

// OperationCount returns the number of operations in the manifest.
func (s *Store) OperationCount() int {
	m := s.manifest.Load()
	if m == nil {
		return 0
	}
	return len(m.Operations)
}

// AllOperations returns all operations from the manifest for iteration (e.g., warmup).
// Returns nil if no manifest is loaded.
func (s *Store) AllOperations() map[string]string {
	m := s.manifest.Load()
	if m == nil {
		return nil
	}
	return m.Operations
}
