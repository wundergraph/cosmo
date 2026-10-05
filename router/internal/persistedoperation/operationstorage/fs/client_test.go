package fs

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPersistedOperationIDRoundTrip(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("Printable ASCII IDs follow POSIX filename rules")
	}
	dir := t.TempDir()
	client, err := NewClient(dir, &Options{})
	require.NoError(t, err)
	for _, id := range []string{"get_employee-1.2.3", " !\"#$%&'()*+,-.:;<=>?@[]^_{}|~ ", "%2F", "%252F", ".", "..", strings.Repeat(".", 250)} {
		t.Run(id, func(t *testing.T) {
			require.NoError(t, os.WriteFile(filepath.Join(dir, id+".json"), []byte(`{"version":1,"body":"query { a }"}`), 0600))
			body, err := client.PersistedOperation(t.Context(), "web", id)
			require.NoError(t, err)
			assert.Equal(t, "query { a }", string(body))
		})
	}
}
