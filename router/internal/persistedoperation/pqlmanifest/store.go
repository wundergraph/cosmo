package pqlmanifest

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"strings"
	"sync"
	"sync/atomic"

	"go.uber.org/zap"
)

type Manifest struct {
	Version     int               `json:"version"`
	Revision    string            `json:"revision"`
	GeneratedAt string            `json:"generatedAt"`
	Operations  map[string]string `json:"operations"` // sha256 hash -> operation body
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
	s.manifest.Store(manifest)

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
	var mismatchedIDs []string
	for id, body := range m.Operations {
		if !OperationIDMatchesBody(id, body) {
			mismatchedIDs = append(mismatchedIDs, id)
		}
	}
	if len(mismatchedIDs) > 0 {
		slices.Sort(mismatchedIDs)
		return fmt.Errorf("operation IDs that look like SHA256 hashes must be the SHA256 of their body: %s",
			strings.Join(mismatchedIDs, ", "))
	}
	return nil
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

// OperationIDMatchesBody reports whether a persisted operation ID is consistent
// with its body. The router looks up query-only requests by the SHA256 of their
// query, so an ID that looks like a SHA256 hash (64 lowercase hex characters)
// must be the hash of its body. Other IDs are custom IDs and always match.
func OperationIDMatchesBody(id, body string) bool {
	if !IsSHA256ID(id) {
		return true
	}
	sum := sha256.Sum256([]byte(body))
	return hex.EncodeToString(sum[:]) == id
}

// IsSHA256ID reports whether id looks like a SHA256 hash: 64 lowercase hex characters.
func IsSHA256ID(id string) bool {
	if len(id) != sha256.Size*2 {
		return false
	}
	for i := 0; i < len(id); i++ {
		if !isLowerHex(id[i]) {
			return false
		}
	}
	return true
}

func isLowerHex(c byte) bool {
	return c >= '0' && c <= '9' || c >= 'a' && c <= 'f'
}
