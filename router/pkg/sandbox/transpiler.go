package sandbox

import (
	"fmt"
	"strings"

	"github.com/evanw/esbuild/pkg/api"
)

// Transpiler wraps esbuild for TypeScript to JavaScript transpilation.
type Transpiler struct{}

// NewTranspiler creates a new transpiler.
func NewTranspiler() *Transpiler {
	return &Transpiler{}
}

// Transpile converts TypeScript code to JavaScript.
// The agent code is expected to be an async arrow function: async () => { ... }
// It is wrapped as an IIFE: (async () => { ... })()
func (t *Transpiler) Transpile(tsCode string) (string, error) {
	if strings.TrimSpace(tsCode) == "" {
		return "", fmt.Errorf("empty code input")
	}

	// Wrap the agent code into an IIFE.
	// The agent writes: async () => { ... }
	// We wrap it as: (async () => { ... })()
	wrapped := fmt.Sprintf("(%s)()", tsCode)

	result := api.Transform(wrapped, api.TransformOptions{
		Loader:           api.LoaderTS,
		Target:           api.ES2020,
		Platform:         api.PlatformNeutral,
		Drop:             api.DropDebugger,
		Charset:          api.CharsetASCII,
		MinifyWhitespace: true,
	})

	if len(result.Errors) > 0 {
		var msgs []string
		for _, e := range result.Errors {
			msg := e.Text
			if e.Location != nil {
				msg = fmt.Sprintf("line %d, col %d: %s", e.Location.Line, e.Location.Column, e.Text)
			}
			msgs = append(msgs, msg)
		}
		return "", fmt.Errorf("TypeScript compilation error: %s", strings.Join(msgs, "; "))
	}

	return string(result.Code), nil
}
