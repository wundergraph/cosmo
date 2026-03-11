package pqlmanifest

import (
	"sync"

	"go.uber.org/zap"
)

type Manifest struct {
	Version     int               `json:"version"`
	Revision    string            `json:"revision"`
	GeneratedAt string            `json:"generatedAt"`
	Operations  map[string]string `json:"operations"` // sha256 hash -> operation body
}

type Store struct {
	mu       sync.RWMutex
	manifest *Manifest
	logger   *zap.Logger
}

func NewStore(logger *zap.Logger) *Store {
	return &Store{
		logger: logger,
	}
}

// Load write-locks and swaps the manifest atomically.
func (s *Store) Load(manifest *Manifest) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.manifest = manifest
}

// LookupByHash read-locks and performs an O(1) map lookup by sha256 hash.
func (s *Store) LookupByHash(sha256Hash string) (body []byte, found bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.manifest == nil {
		return nil, false
	}

	op, ok := s.manifest.Operations[sha256Hash]
	if !ok {
		return nil, false
	}

	return []byte(op), true
}

// IsLoaded returns whether a manifest has been loaded.
func (s *Store) IsLoaded() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.manifest != nil
}

// Revision returns the current manifest revision for polling.
func (s *Store) Revision() string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.manifest == nil {
		return ""
	}

	return s.manifest.Revision
}

// OperationCount returns the number of operations in the manifest.
func (s *Store) OperationCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.manifest == nil {
		return 0
	}

	return len(s.manifest.Operations)
}
