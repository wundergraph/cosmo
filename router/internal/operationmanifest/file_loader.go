package operationmanifest

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
)

// FileLoader loads a manifest from a file below a root directory. If the file name
// ends with .gz or .zst, the content is decompressed.
// It skips unchanged mtimes; writes preserving timestamps may be missed.
// The Poller remains responsible for comparing manifest revisions.
type FileLoader struct {
	path     string
	lastInfo os.FileInfo
}

func NewFileLoader(root, objectPath string) *FileLoader {
	return &FileLoader{path: filepath.Join(root, objectPath)}
}

func (l *FileLoader) Fetch(_ context.Context, _ string) (*Manifest, bool, error) {
	info, err := os.Stat(l.path)
	if err != nil {
		return nil, false, fmt.Errorf("failed to read manifest file: %w", err)
	}

	if l.lastInfo != nil && info.ModTime().Equal(l.lastInfo.ModTime()) {
		return nil, false, nil
	}

	f, err := os.Open(l.path)
	if err != nil {
		return nil, false, fmt.Errorf("failed to read manifest file: %w", err)
	}

	defer func() {
		_ = f.Close()
	}()

	data, err := decompressAndRead(f, l.path)
	if err != nil {
		return nil, false, fmt.Errorf("failed to read manifest file: %w", err)
	}

	manifest, err := ParseManifest(data)
	if err != nil {
		return nil, false, err
	}

	l.lastInfo = info

	return manifest, true, nil
}
