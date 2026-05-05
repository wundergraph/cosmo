package harness

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/codemode/sandbox"
)

func TestBuildEnvelopePassesThroughSmallResult(t *testing.T) {
	got, err := BuildEnvelope(sandbox.ExecuteResult{OK: true, Result: raw(`{"ok":true}`)}, 32<<10)
	require.NoError(t, err)

	assert.Equal(t, ResultEnvelope{Result: raw(`{"ok":true}`), Truncated: false, Error: nil}, got)
}

func TestBuildEnvelopeTruncatesTopLevelArray(t *testing.T) {
	got, err := BuildEnvelope(sandbox.ExecuteResult{OK: true, Result: raw(`[{"id":1},{"id":2},{"id":3}]`)}, len(`[{"id":1},{"id":2}]`))
	require.NoError(t, err)

	assert.Equal(t, ResultEnvelope{Result: raw(`[{"id":1},{"id":2}]`), Truncated: true, Error: nil}, got)
}

func TestBuildEnvelopeTruncatesTopLevelObject(t *testing.T) {
	got, err := BuildEnvelope(sandbox.ExecuteResult{OK: true, Result: raw(`{"a":1,"b":2,"c":3}`)}, len(`{"a":1,"b":2}`))
	require.NoError(t, err)

	assert.Equal(t, ResultEnvelope{Result: raw(`{"a":1,"b":2}`), Truncated: true, Error: nil}, got)
}

func TestBuildEnvelopeFallsBackToPreviewForHugeScalar(t *testing.T) {
	value := strings.Repeat("a", 2048)
	body, err := json.Marshal(value)
	require.NoError(t, err)

	got, err := BuildEnvelope(sandbox.ExecuteResult{OK: true, Result: body}, 128)
	require.NoError(t, err)

	var preview struct {
		Truncated    bool   `json:"__truncated"`
		OriginalSize int    `json:"originalSize"`
		Preview      string `json:"preview"`
	}
	require.NoError(t, json.Unmarshal(got.Result, &preview))
	assert.Equal(t, true, got.Truncated)
	assert.Equal(t, true, preview.Truncated)
	assert.Equal(t, len(body), preview.OriginalSize)
	assert.Equal(t, strings.Repeat("a", 1024), preview.Preview)
}

func TestBuildEnvelopeCopiesSandboxError(t *testing.T) {
	sandboxErr := &sandbox.ErrorEnvelope{Name: "Error", Message: "boom", Stack: "stack"}

	got, err := BuildEnvelope(sandbox.ExecuteResult{OK: false, Error: sandboxErr}, 32<<10)
	require.NoError(t, err)

	assert.Equal(t, ResultEnvelope{Result: raw(`null`), Truncated: false, Error: sandboxErr}, got)
}
