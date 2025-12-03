package grpcpluginoci

import (
	"archive/tar"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	v1 "github.com/google/go-containerregistry/pkg/v1"
	"github.com/google/go-containerregistry/pkg/v1/mutate"
)

// sanitizePathWithinDestDir returns a sanitized path that is guaranteed to be within destDir
func sanitizePathWithinDestDir(destDir, path string) (string, error) {
	// Resolve symlinks for both destDir and target
	resolvedDestDir, err := filepath.EvalSymlinks(destDir)
	if err != nil {
		resolvedDestDir = destDir
	}

	// Create the target path by joining destDir with the path
	target := filepath.Join(resolvedDestDir, path)

	resolvedTarget, err := filepath.EvalSymlinks(target)
	if err != nil {
		// If EvalSymlinks fails, the target doesn't exist yet, use the target as-is
		resolvedTarget = target
	}

	rel, err := filepath.Rel(resolvedDestDir, resolvedTarget)
	if err != nil {
		return "", fmt.Errorf("failed to get relative path: %w", err)
	}

	// We don't want to allow paths that attempt to escape the destination directory
	// This is both a security measure against theoretical malicious input and a simple
	// check to ensure relevant files are within the plugin working directory.
	if strings.HasPrefix(rel, "..") || strings.Contains(rel, string(filepath.Separator)+"..") {
		return "", fmt.Errorf("path escapes destination directory")
	}

	return target, nil
}

// UnpackImageToDir unpacks a v1.Image to destDir.
func UnpackImageToDir(img v1.Image, destDir string) error {
	_ = os.MkdirAll(destDir, 0700)

	reader := mutate.Extract(img)
	defer func() {
		_ = reader.Close()
	}()

	tr := tar.NewReader(reader)
	for {
		hdr, err := tr.Next()
		if err != nil {
			if err == io.EOF {
				break
			}
			return fmt.Errorf("error reading tar: %w", err)
		}

		target, err := sanitizePathWithinDestDir(destDir, hdr.Name)
		if err != nil {
			return fmt.Errorf("unsafe path in archive: %w", err)
		}

		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, os.FileMode(hdr.Mode)); err != nil {
				return fmt.Errorf("mkdir %s: %w", target, err)
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return fmt.Errorf("mkdir for file %s: %w", target, err)
			}

			f, err := os.OpenFile(target, os.O_CREATE|os.O_RDWR|os.O_TRUNC, os.FileMode(hdr.Mode))
			if err != nil {
				return fmt.Errorf("create file %s: %w", target, err)
			}

			if _, err := io.Copy(f, tr); err != nil {
				_ = f.Close()
				return fmt.Errorf("write file %s: %w", target, err)
			}

			_ = f.Close()
		case tar.TypeSymlink:
			// Validate symlink target
			symlinkTarget, err := sanitizePathWithinDestDir(destDir, hdr.Linkname)
			if err != nil {
				return fmt.Errorf("unsafe symlink target: %w", err)
			}

			// Use relative path for symlink to maintain portability
			relPath, err := filepath.Rel(filepath.Dir(target), symlinkTarget)
			if err != nil {
				return fmt.Errorf("failed to create relative symlink path: %w", err)
			}
			if err := os.Symlink(relPath, target); err != nil {
				return fmt.Errorf("symlink %s: %w", target, err)
			}
		case tar.TypeLink:
			linkTarget, err := sanitizePathWithinDestDir(destDir, hdr.Linkname)
			if err != nil {
				return fmt.Errorf("unsafe hardlink target: %w", err)
			}

			if err := os.Link(linkTarget, target); err != nil {
				return fmt.Errorf("hardlink %s: %w", target, err)
			}
		}
	}
	return nil
}
