package sandbox

import (
	"context"
	"encoding/json"
	"time"
)

// RuntimeType identifies which JavaScript runtime implementation to use.
type RuntimeType string

const (
	// RuntimeTypeQJS uses QuickJS compiled to WASM via wazero.
	// Provides native Promise support, WASM memory isolation, and resource limits.
	RuntimeTypeQJS RuntimeType = "qjs"

	// RuntimeTypeGoja uses goja, a pure-Go JS runtime.
	// Fallback option — no native Promise support, no WASM isolation.
	RuntimeTypeGoja RuntimeType = "goja"
)

// SyncFunc represents a synchronous function to inject into the sandbox.
type SyncFunc struct {
	Name string
	Fn   func(args []any) (any, error)
}

// AsyncFunc represents an asynchronous function to inject into the sandbox.
// With qjs: registered via SetAsyncFunc, returns native JS Promise.
// With goja: called synchronously (blocking), async/await stripped from code.
type AsyncFunc struct {
	Name string
	Fn   func(args []any) (any, error)
}

// ObjectDef represents a namespaced object with methods to inject.
type ObjectDef struct {
	Name    string
	Methods map[string]func(args []any) (any, error)
}

// ExecutionConfig controls sandbox resource limits.
type ExecutionConfig struct {
	Timeout        time.Duration
	MaxMemoryMB    int
	MaxFuel        uint64 // reserved for future use
	MaxInputBytes  int
	MaxOutputBytes int
}

// Result holds the output of a sandbox execution.
type Result struct {
	Value json.RawMessage
}

// Ensure Result implements json.Marshaler for convenience
var _ json.Marshaler = (*Result)(nil)

func (r *Result) MarshalJSON() ([]byte, error) {
	return r.Value, nil
}

// Runtime executes JavaScript code in an isolated environment.
type Runtime interface {
	Execute(ctx context.Context, jsCode string, syncFuncs []SyncFunc, asyncFuncs []AsyncFunc, objects []ObjectDef) (*Result, error)
}

// NewRuntime creates a new sandbox runtime of the specified type.
func NewRuntime(runtimeType RuntimeType, config ExecutionConfig) Runtime {
	switch runtimeType {
	case RuntimeTypeQJS:
		return newQJSRuntime(config)
	case RuntimeTypeGoja:
		return newGojaRuntime(config)
	default:
		// Default to qjs for unknown runtime types to avoid silently
		// downgrading to a less-isolated runtime.
		return newQJSRuntime(config)
	}
}
