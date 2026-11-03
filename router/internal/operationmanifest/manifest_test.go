package operationmanifest

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestParseManifest(t *testing.T) {
	t.Parallel()

	t.Run("returns the manifest for valid JSON", func(t *testing.T) {
		t.Parallel()
		data := []byte(`{"version":1,"revision":"rev-1","generatedAt":"2024-01-01","operations":{"h1":"query { a }"}}`)
		m, err := ParseManifest(data)
		require.NoError(t, err)
		require.Equal(t, &Manifest{
			Version:     1,
			Revision:    "rev-1",
			GeneratedAt: "2024-01-01",
			Operations:  map[string]string{"h1": "query { a }"},
		}, m)
	})

	t.Run("returns an error for invalid JSON", func(t *testing.T) {
		t.Parallel()
		_, err := ParseManifest([]byte(`{bad`))
		require.ErrorContains(t, err, "failed to parse manifest")
	})

	t.Run("returns an error for an unsupported version", func(t *testing.T) {
		t.Parallel()
		_, err := ParseManifest([]byte(`{"version":2,"revision":"r","operations":{}}`))
		require.ErrorContains(t, err, "unsupported manifest version 2")
	})

	t.Run("returns an error when the revision is missing", func(t *testing.T) {
		t.Parallel()
		_, err := ParseManifest([]byte(`{"version":1,"revision":"","operations":{}}`))
		require.ErrorContains(t, err, "revision is required")
	})

	t.Run("returns an error when operations are missing", func(t *testing.T) {
		t.Parallel()
		_, err := ParseManifest([]byte(`{"version":1,"revision":"r"}`))
		require.ErrorContains(t, err, "operations field is required")
	})
}
