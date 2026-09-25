package fs

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestMaximumLengthCustomOperationID(t *testing.T) {
	// 250 ASCII bytes plus ".json" fit a 255-byte filename component on macOS.
	// Reject overlong IDs in parser tests, before attempting filesystem access.
	id := strings.Repeat("x", 250)
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, id+".json"), []byte(`{"version":1,"body":"query GetTypeName { __typename }"}`), 0600))
	storage, err := NewClient(dir, &Options{})
	require.NoError(t, err)
	defer storage.Close()
	body, err := storage.PersistedOperation(t.Context(), "web", id)
	require.NoError(t, err)
	require.Equal(t, "query GetTypeName { __typename }", string(body))
}
