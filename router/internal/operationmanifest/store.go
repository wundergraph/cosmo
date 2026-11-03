package operationmanifest

import (
	"sync/atomic"

	"go.uber.org/zap"
)

type Store struct {
	manifest   atomic.Pointer[Manifest]
	subscriber atomic.Pointer[chan struct{}]
	logger     *zap.Logger
}

func NewStore(logger *zap.Logger) *Store {
	return &Store{logger: logger}
}

// Subscribe returns a channel that signals after each later Load. The channel
// holds one signal, so loads that arrive while a signal is pending coalesce into
// it and the receiver always sees the latest manifest. A new call replaces the
// previous subscriber, which receives no further signals.
func (s *Store) Subscribe() <-chan struct{} {
	ch := make(chan struct{}, 1)
	s.subscriber.Store(&ch)
	return ch
}

// Load swaps the manifest atomically and signals the subscriber, if any.
func (s *Store) Load(manifest *Manifest) {
	s.manifest.Store(manifest)

	ch := s.subscriber.Load()
	if ch == nil {
		return
	}

	select {
	case *ch <- struct{}{}:
	default:
		s.logger.Debug("Skipping manifest update signal, previous signal still pending")
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
