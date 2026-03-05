package integration

import (
	"archive/tar"
	"bytes"
	"fmt"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/google/go-containerregistry/pkg/crane"
	"github.com/google/go-containerregistry/pkg/name"
	"github.com/google/go-containerregistry/pkg/registry"
	v1 "github.com/google/go-containerregistry/pkg/v1"
	"github.com/google/go-containerregistry/pkg/v1/empty"
	"github.com/google/go-containerregistry/pkg/v1/mutate"
	"github.com/google/go-containerregistry/pkg/v1/partial"
	"github.com/google/go-containerregistry/pkg/v1/tarball"
	"github.com/google/go-containerregistry/pkg/v1/types"
	"github.com/stretchr/testify/require"
)

// startTestOCIRegistry starts an in-memory OCI registry on localhost and returns the host:port.
func startTestOCIRegistry(t *testing.T) string {
	t.Helper()
	reg := registry.New()
	server := httptest.NewServer(reg)
	t.Cleanup(server.Close)
	return strings.TrimPrefix(server.URL, "http://")
}

// buildAndPushPluginImage reads a plugin binary (and any adjacent files in its directory),
// wraps them in an OCI image, and pushes it to the test registry.
// The binary is placed at /plugin in the image with the entrypoint set to ["/plugin"].
// Any sibling files/directories next to the binary are included at the same relative paths.
func buildAndPushPluginImage(t *testing.T, registryHost, repo, tag, pluginBinaryPath string) {
	t.Helper()

	pluginDir := filepath.Dir(pluginBinaryPath)
	binaryName := filepath.Base(pluginBinaryPath)

	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)

	err := filepath.Walk(pluginDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		relPath, err := filepath.Rel(pluginDir, path)
		if err != nil {
			return err
		}

		// Skip the root directory itself
		if relPath == "." {
			return nil
		}

		// Rename the binary to "plugin"
		tarPath := relPath
		if relPath == binaryName {
			tarPath = "plugin"
		}

		header, err := tar.FileInfoHeader(info, "")
		if err != nil {
			return err
		}
		header.Name = tarPath

		if err := tw.WriteHeader(header); err != nil {
			return err
		}

		if !info.IsDir() {
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			if _, err := tw.Write(data); err != nil {
				return err
			}
		}

		return nil
	})
	require.NoError(t, err)
	require.NoError(t, tw.Close())

	layerBytes := buf.Bytes()
	layer, err := tarball.LayerFromOpener(func() (io.ReadCloser, error) {
		return io.NopCloser(bytes.NewReader(layerBytes)), nil
	})
	require.NoError(t, err)

	img, err := mutate.AppendLayers(empty.Image, layer)
	require.NoError(t, err)

	cfgFile, err := img.ConfigFile()
	require.NoError(t, err)
	cfgFile.Config.Entrypoint = []string{"/plugin"}
	cfgFile.OS = runtime.GOOS
	cfgFile.Architecture = runtime.GOARCH
	img, err = mutate.ConfigFile(img, cfgFile)
	require.NoError(t, err)

	img = &ociImage{img}

	ref := fmt.Sprintf("%s/%s:%s", registryHost, repo, tag)
	nameRef, err := name.ParseReference(ref)
	require.NoError(t, err)
	err = crane.Push(img, nameRef.String(), crane.Insecure)
	require.NoError(t, err, "pushing image to test registry")
}

// ociImage wraps a v1.Image to force OCI media types.
type ociImage struct {
	v1.Image
}

func (i *ociImage) MediaType() (types.MediaType, error) {
	return types.OCIManifestSchema1, nil
}

func (i *ociImage) Digest() (v1.Hash, error) {
	return partial.Digest(i)
}

func (i *ociImage) Manifest() (*v1.Manifest, error) {
	m, err := i.Image.Manifest()
	if err != nil {
		return nil, err
	}
	m.MediaType = types.OCIManifestSchema1
	return m, nil
}

func (i *ociImage) RawManifest() ([]byte, error) {
	return partial.RawManifest(i)
}
