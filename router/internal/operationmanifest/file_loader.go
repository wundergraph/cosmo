package operationmanifest

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
)

// FileLoader loads a manifest from a file below a root directory.
// It reads the file on every Fetch and compares revisions. It does not check
// modification times because rsync -a, cp -p and mv keep old ones.
type FileLoader struct {
	path string
}

func NewFileLoader(root, objectPath string) *FileLoader {
	return &FileLoader{path: filepath.Join(root, objectPath)}
}

func (l *FileLoader) Fetch(_ context.Context, currentRevision string) (*Manifest, bool, error) {
	data, err := os.ReadFile(l.path)
	if err != nil {
		return nil, false, fmt.Errorf("failed to read manifest file: %w", err)
	}

	manifest, err := ParseManifest(data)
	if err != nil {
		return nil, false, err
	}

	if manifest.Revision == currentRevision {
		return nil, false, nil
	}

	return manifest, true, nil
}
