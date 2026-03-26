package pqlmanifest

import (
	"encoding/json"
	"fmt"
	"os"
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
	manifest atomic.Pointer[Manifest]
	logger   *zap.Logger
}

func NewStore(logger *zap.Logger) *Store {
	return &Store{
		logger: logger,
	}
}

// Load swaps the manifest atomically.
func (s *Store) Load(manifest *Manifest) {
	s.manifest.Store(manifest)
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
