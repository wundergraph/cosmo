package harness

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTranspileStripsTypeScriptAnnotations(t *testing.T) {
	got, err := Transpile(`async () => { const x: string = "hi"; return x; }`)
	require.NoError(t, err)

	assert.NotContains(t, got.JS, `: string`)
	assert.Contains(t, got.JS, `"hi"`)
	assert.False(t, strings.HasSuffix(strings.TrimSpace(got.JS), ";"))
	assert.NotEmpty(t, got.SourceMap)
	assert.Empty(t, got.Diagnostics)

	var sourceMap map[string]any
	require.NoError(t, json.Unmarshal(got.SourceMap, &sourceMap))
	assert.Equal(t, float64(3), sourceMap["version"])
}

func TestTranspileTreatsTypesAsNotation(t *testing.T) {
	got, err := Transpile(`async (value: { id: string }): Promise<string> => value.id`)
	require.NoError(t, err)

	assert.NotContains(t, got.JS, `Promise<string>`)
	assert.NotContains(t, got.JS, `id: string`)
	assert.Contains(t, got.JS, `value.id`)
}

func TestTranspileReportsDiagnosticsForSyntaxErrors(t *testing.T) {
	got, err := Transpile(`async () => { let x = ; }`)
	require.Error(t, err)

	require.NotEmpty(t, got.Diagnostics)
	assert.NotEmpty(t, got.Diagnostics[0].Text)
	assert.NotEqual(t, 0, got.Diagnostics[0].Line)
	assert.NotEqual(t, 0, got.Diagnostics[0].Column)
	assert.True(t, strings.Contains(err.Error(), got.Diagnostics[0].Text))
}

func TestTranspileDropsDebuggerStatement(t *testing.T) {
	got, err := Transpile(`async () => { debugger; return 1; }`)
	require.NoError(t, err)

	assert.NotContains(t, got.JS, "debugger", "Drop:DropDebugger should remove debugger statements")
}

func TestTranspileEscapesNonASCII(t *testing.T) {
	got, err := Transpile(`async () => "héllo"`)
	require.NoError(t, err)

	// CharsetASCII tells esbuild to escape non-ASCII codepoints in string
	// literals. The raw `é` byte sequence must not appear in the output.
	assert.NotContains(t, got.JS, "é", "Charset:ASCII should escape non-ASCII codepoints")
}
