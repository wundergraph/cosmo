package harness

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// ShapeCheck runs on post-esbuild JavaScript. Inputs in this file are written
// as the JS that Transpile would produce — never raw TypeScript. End-to-end
// TS handling is covered by pipeline_test.go and transpile_test.go.

func TestShapeCheckAcceptsAsyncArrowRoots(t *testing.T) {
	tests := []string{
		`async () => 1`,
		`async()=>1`,
		`async () => { return 1; }`,
		`async (x) => x`,
		`async (x, y) => x + y`,
		`async (x) => ({ x })`,
		`(async () => 1)`,
		`((async () => 1))`,
		" \n\tasync () => true",
		"// leading\nasync () => true",
		"/* leading */ async () => true",
		`async ({ id }) => id`,
		`async () => await tools.getUser({ id: "1" })`,
		`async () => { const rows = await Promise.all([]); return rows; }`,
	}
	for _, source := range tests {
		t.Run(source, func(t *testing.T) {
			assert.NoError(t, ShapeCheck(source))
		})
	}
}

func TestShapeCheckRejectsNonAsyncArrowRoots(t *testing.T) {
	tests := []struct {
		name   string
		source string
		want   string
	}{
		// Top-level await: ShapeCheck handles this defensively for the case where the
		// pipeline's esbuild target is later raised to ES2022. Under today's ES2020 target,
		// `await x` is rejected at Transpile and never reaches ShapeCheck — but the AST
		// path still works as a unit, so we keep the test.
		{name: "top-level await", source: `await tools.getUser({})`, want: `code mode: source must be a single async-arrow root (got: top-level await)`},
		// Import/export must be detected before the multi-statement check, otherwise
		// `import x from "x"; async () => x` reports "multiple statements" instead.
		{name: "import then arrow", source: `import x from "x"; async () => x`, want: `code mode: source must be a single async-arrow root (got: leading import/export)`},
		{name: "import alone", source: `import x from "x"`, want: `code mode: source must be a single async-arrow root (got: leading import/export)`},
		{name: "export", source: `export default async () => 1`, want: `code mode: source must be a single async-arrow root (got: leading import/export)`},
		{name: "block", source: `{ async () => 1 }`, want: `code mode: source must be a single async-arrow root (got: non-arrow root)`},
		{name: "function declaration", source: `async function main() {}`, want: `code mode: source must be a single async-arrow root (got: non-arrow root)`},
		{name: "non async arrow", source: `() => 1`, want: `code mode: source must be a single async-arrow root (got: missing async modifier)`},
		{name: "paren non async arrow", source: `(() => 1)`, want: `code mode: source must be a single async-arrow root (got: missing async modifier)`},
		{name: "identifier", source: `foo`, want: `code mode: source must be a single async-arrow root (got: non-arrow root)`},
		{name: "empty", source: `  `, want: `code mode: source must be a single async-arrow root (got: empty source)`},
		{name: "comment-only", source: `// only trivia`, want: `code mode: source must be a single async-arrow root (got: empty source)`},
		{name: "async call", source: `async()`, want: `code mode: source must be a single async-arrow root (got: non-arrow root)`},
		{name: "multiple arrows", source: `async () => 1; async () => 2`, want: `code mode: source must be a single async-arrow root (got: multiple statements)`},
		{name: "var then arrow", source: `const x = 1; async () => x`, want: `code mode: source must be a single async-arrow root (got: multiple statements)`},
		{name: "class", source: `class X {}`, want: `code mode: source must be a single async-arrow root (got: non-arrow root)`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ShapeCheck(tt.source)
			if assert.Error(t, err) {
				assert.Equal(t, tt.want, err.Error())
			}
		})
	}
}
