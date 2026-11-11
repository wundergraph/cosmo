package operationmanifest

import (
	"encoding/json"
	"fmt"
)

type Manifest struct {
	Version     int               `json:"version"`
	Revision    string            `json:"revision"`
	GeneratedAt string            `json:"generatedAt"`
	Operations  map[string]string `json:"operations"` // sha256 hash -> operation body
}

// Parse parses operation manifest data for a Poller.
func Parse(data []byte) (*Manifest, string, error) {
	manifest, err := ParseManifest(data)
	if err != nil {
		return nil, "", err
	}
	return manifest, manifest.Revision, nil
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
