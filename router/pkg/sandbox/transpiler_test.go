package sandbox

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTranspiler_ValidTypeScript(t *testing.T) {
	tr := NewTranspiler()

	js, err := tr.Transpile(`async () => { return 42; }`)
	require.NoError(t, err)
	assert.Contains(t, js, "return 42")
	// Verify IIFE wrapping: output should start with "(" and contain "()"
	assert.True(t, strings.HasPrefix(strings.TrimSpace(js), "("), "expected IIFE wrapping, got: %s", js)
}

func TestTranspiler_WithTypeAnnotations(t *testing.T) {
	tr := NewTranspiler()

	js, err := tr.Transpile(`async () => {
		const x: number = 42;
		const s: string = "hello";
		return { x, s };
	}`)
	require.NoError(t, err)
	// Type annotations should be stripped
	assert.NotContains(t, js, ": number")
	assert.NotContains(t, js, ": string")
	assert.Contains(t, js, "42")
	assert.Contains(t, js, `"hello"`)
}

func TestTranspiler_WithInterfaces(t *testing.T) {
	tr := NewTranspiler()

	// Interfaces should be stripped (type-only constructs)
	js, err := tr.Transpile(`async () => {
		interface Result { value: number; }
		const r: Result = { value: 1 };
		return r;
	}`)
	require.NoError(t, err)
	assert.NotContains(t, js, "interface")
	assert.Contains(t, js, "value:1")
}

func TestTranspiler_SyntaxError(t *testing.T) {
	tr := NewTranspiler()

	_, err := tr.Transpile(`async () => { const x = `)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "TypeScript compilation error")
}

func TestTranspiler_EmptyInput(t *testing.T) {
	tr := NewTranspiler()

	_, err := tr.Transpile("")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "empty code input")
}

func TestTranspiler_WhitespaceOnlyInput(t *testing.T) {
	tr := NewTranspiler()

	_, err := tr.Transpile("   \n\t  ")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "empty code input")
}

func TestTranspiler_WrappingPattern(t *testing.T) {
	tr := NewTranspiler()

	js, err := tr.Transpile(`async () => { return 1; }`)
	require.NoError(t, err)
	// The output should be an IIFE starting with "(" and containing "return 1"
	assert.True(t, strings.HasPrefix(strings.TrimSpace(js), "("), "expected IIFE wrapping, got: %s", js)
	assert.Contains(t, js, "return 1")
}

func TestTranspiler_LargeInput(t *testing.T) {
	tr := NewTranspiler()

	// Generate a large but valid TS input
	var builder strings.Builder
	builder.WriteString("async () => {\n")
	builder.WriteString("  let sum: number = 0;\n")
	for i := 0; i < 500; i++ {
		builder.WriteString("  sum += 1;\n")
	}
	builder.WriteString("  return sum;\n}")

	js, err := tr.Transpile(builder.String())
	require.NoError(t, err)
	assert.NotEmpty(t, js)
}

func TestTranspiler_ES2020Features(t *testing.T) {
	tr := NewTranspiler()

	// Optional chaining and nullish coalescing are ES2020
	js, err := tr.Transpile(`async () => {
		const obj: any = { a: { b: 1 } };
		return obj?.a?.b ?? 0;
	}`)
	require.NoError(t, err)
	assert.NotEmpty(t, js)
}

func TestTranspiler_PreservesAsyncAwait(t *testing.T) {
	tr := NewTranspiler()

	js, err := tr.Transpile(`async () => {
		const result = await Promise.resolve(42);
		return result;
	}`)
	require.NoError(t, err)
	assert.Contains(t, js, "async")
	assert.Contains(t, js, "await")
	assert.Contains(t, js, "Promise.resolve(42)")
}

func TestTranspiler_DebuggerStatementStripped(t *testing.T) {
	tr := NewTranspiler()

	js, err := tr.Transpile(`async () => { debugger; return 42; }`)
	require.NoError(t, err)
	assert.NotContains(t, js, "debugger")
	assert.Contains(t, js, "return 42")
}

func TestTranspiler_MinifiesWhitespace(t *testing.T) {
	tr := NewTranspiler()

	js, err := tr.Transpile(`async () => {
		const x = 1;
		const y = 2;
		return x + y;
	}`)
	require.NoError(t, err)
	// Minified output should not contain newlines (except trailing)
	trimmed := strings.TrimSpace(js)
	assert.NotContains(t, trimmed, "\n")
}
