package grpcpluginoci

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSanitizePathWithinDestDir(t *testing.T) {
	tempDir := t.TempDir()

	tempDir, err := filepath.EvalSymlinks(tempDir)
	require.NoError(t, err)

	tests := []struct {
		name           string
		destDir        string
		path           string
		shouldError    bool
		expectedResult string
	}{
		{
			name:           "valid file in destDir",
			destDir:        tempDir,
			path:           "file.txt",
			shouldError:    false,
			expectedResult: filepath.Join(tempDir, "file.txt"),
		},
		{
			name:           "valid nested file in destDir",
			destDir:        tempDir,
			path:           filepath.Join("subdir", "file.txt"),
			shouldError:    false,
			expectedResult: filepath.Join(tempDir, "subdir", "file.txt"),
		},
		{
			name:        "path traversal with ../",
			destDir:     tempDir,
			path:        "../evil.txt",
			shouldError: true,
		},
		{
			name:        "path traversal with ../../",
			destDir:     tempDir,
			path:        "../../evil.txt",
			shouldError: true,
		},
		{
			name:        "path traversal in middle",
			destDir:     tempDir,
			path:        filepath.Join("subdir", "..", "..", "evil.txt"),
			shouldError: true,
		},
		{
			name:           "absolute path",
			destDir:        tempDir,
			path:           "/etc/passwd",
			shouldError:    false,
			expectedResult: filepath.Join(tempDir, "/etc/passwd"),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := sanitizePathWithinDestDir(tt.destDir, tt.path)
			if tt.shouldError {
				assert.Error(t, err, "Expected error for path %s, got result %v instead", tt.path, result)
				assert.Empty(t, result, "Result should be empty on error")
			} else {
				assert.NoError(t, err, "Unexpected error for path %s", tt.path)
				assert.Equal(t, tt.expectedResult, result, "Unexpected sanitized path")
			}
		})
	}
}

func TestSanitizePathWithinDestDirWithSymlinks(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "test-symlink")
	require.NoError(t, err)
	defer func() {
		_ = os.RemoveAll(tempDir)
	}()

	// Create a directory outside tempDir
	outsideDir, err := os.MkdirTemp("", "test-outside")
	require.NoError(t, err)
	defer func() {
		_ = os.RemoveAll(outsideDir)
	}()

	// Create a file inside tempDir
	insideFile := filepath.Join(tempDir, "inside.txt")
	require.NoError(t, os.WriteFile(insideFile, []byte("safe"), 0644))

	// Create a file outside tempDir
	outsideFile := filepath.Join(outsideDir, "outside.txt")
	require.NoError(t, os.WriteFile(outsideFile, []byte("dangerous"), 0644))

	// Create symlinks within tempDir
	safeSymlink := filepath.Join(tempDir, "safe-symlink")
	require.NoError(t, os.Symlink(insideFile, safeSymlink))

	evilSymlink := filepath.Join(tempDir, "evil-symlink")
	require.NoError(t, os.Symlink(outsideFile, evilSymlink))

	tests := []struct {
		name        string
		path        string
		shouldError bool
	}{
		{
			name:        "symlink pointing to file inside destDir",
			path:        "safe-symlink",
			shouldError: false,
		},
		{
			name:        "symlink pointing to file outside destDir",
			path:        "evil-symlink",
			shouldError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := sanitizePathWithinDestDir(tempDir, tt.path)
			if tt.shouldError {
				assert.Error(t, err, "Expected error for symlink %s", tt.path)
				assert.Empty(t, result, "Result should be empty on error")
			} else {
				assert.NoError(t, err, "Unexpected error for symlink %s", tt.path)
				assert.NotEmpty(t, result, "Result should not be empty on success")
			}
		})
	}
}
