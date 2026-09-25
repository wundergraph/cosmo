package pqlmanifest

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"sync"
	"sync/atomic"

	"go.uber.org/zap"
)

type Manifest struct {
	Version     int               `json:"version"`
	Revision    string            `json:"revision"`
	GeneratedAt string            `json:"generatedAt"`
	Operations  map[string]string `json:"operations"` // operation ID -> body

	bodyHashes map[string]string
}

// BodyHash returns the body SHA256 computed when this snapshot was loaded.
func (m *Manifest) BodyHash(id string) string {
	return m.bodyHashes[id]
}

type Store struct {
	manifest  atomic.Pointer[Manifest]
	updateCh  chan struct{}
	onUpdate  atomic.Value // stores func()
	startOnce sync.Once
	logger    *zap.Logger
}

func NewStore(logger *zap.Logger) *Store {
	return &Store{
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
			for range s.updateCh {
				if f, ok := s.onUpdate.Load().(func()); ok && f != nil {
					f()
				}
			}
		}()
	})
}

// Load swaps the manifest atomically and signals the update worker if a callback is registered.
// If the worker is busy processing a previous update, the signal is dropped (coalesced)
// so back-to-back manifest updates don't queue unbounded work.
func (s *Store) Load(manifest *Manifest) {
	// Prepare a new immutable snapshot before publishing it. Cache identities can
	// then use body hashes without hashing on each request or depending on revision.
	snapshot := *manifest
	snapshot.Operations = maps.Clone(manifest.Operations)
	snapshot.bodyHashes = make(map[string]string, len(snapshot.Operations))
	for id, body := range snapshot.Operations {
		sum := sha256.Sum256([]byte(body))
		snapshot.bodyHashes[id] = hex.EncodeToString(sum[:])
	}
	s.manifest.Store(&snapshot)

	if s.onUpdate.Load() == nil {
		return
	}

	select {
	case s.updateCh <- struct{}{}:
	default:
		s.logger.Debug("Skipping PQL manifest update signal, worker is busy")
	}
}

// Close stops the update worker goroutine.
func (s *Store) Close() {
	close(s.updateCh)
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

// LoadFromFile reads a manifest JSON file from disk and loads it into the store.
func (s *Store) LoadFromFile(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("failed to read manifest file: %w", err)
	}

	return s.LoadFromData(data)
}

// ParseManifest parses and validates manifest JSON data.
func ParseManifest(data []byte) (*Manifest, error) {
	var manifest Manifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return nil, fmt.Errorf("failed to parse manifest: %w", err)
	}
	if err := validateManifest(&manifest); err != nil {
		return nil, fmt.Errorf("invalid manifest: %w", err)
	}
	return &manifest, nil
}

// LoadFromData parses and validates manifest JSON data and loads it into the store.
func (s *Store) LoadFromData(data []byte) error {
	manifest, err := ParseManifest(data)
	if err != nil {
		return err
	}
	s.Load(manifest)
	return nil
}

func validateManifest(m *Manifest) error {
	if m.Version != 1 {
		return fmt.Errorf("unsupported manifest version %d, expected 1", m.Version)
	}
	if m.Revision == "" {
		return fmt.Errorf("manifest revision is required")
	}
	if m.Operations == nil {
		return fmt.Errorf("manifest operations field is required")
	}
	return nil
}

// IsLoaded returns whether a manifest has been loaded.
func (s *Store) IsLoaded() bool {
	return s.manifest.Load() != nil
}

// Snapshot returns the current immutable manifest. Keep this snapshot for the entire
// operation so lookup and cache identity cannot observe different revisions.
func (s *Store) Snapshot() *Manifest {
	return s.manifest.Load()
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
