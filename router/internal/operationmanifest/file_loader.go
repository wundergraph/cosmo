package operationmanifest

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
)

// FileLoader loads a manifest from a file below a root directory. If the file name
// ends with .gz or .zst, the content is decompressed.
// It reads the file on every Fetch and only decompresses and parses it when its
// bytes changed since the last Fetch. It does not check modification times
// because rsync -a, cp -p and mv keep old ones.
type FileLoader struct {
	path    string
	lastSum [sha256.Size]byte
	last    *Manifest
}

func NewFileLoader(root, objectPath string) *FileLoader {
	return &FileLoader{path: filepath.Join(root, objectPath)}
}

func (l *FileLoader) Fetch(_ context.Context, currentRevision string) (*Manifest, bool, error) {
	raw, err := os.ReadFile(l.path)
	if err != nil {
		return nil, false, fmt.Errorf("failed to read manifest file: %w", err)
	}

	if sum := sha256.Sum256(raw); sum != l.lastSum {
		data, err := decompressAndRead(bytes.NewReader(raw), l.path)
		if err != nil {
			return nil, false, fmt.Errorf("failed to read manifest file: %w", err)
		}

		manifest, err := ParseManifest(data)
		if err != nil {
			return nil, false, err
		}

		l.lastSum, l.last = sum, manifest
	}

	if l.last.Revision == currentRevision {
		return nil, false, nil
	}

	return l.last, true, nil
}
