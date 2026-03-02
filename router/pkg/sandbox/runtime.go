package sandbox

import (
	"context"
	"encoding/json"
	"time"
)

// SyncFunc represents a synchronous function to inject into the sandbox.
type SyncFunc struct {
	Name string
	Fn   func(args []any) (any, error)
}

// AsyncFunc represents an asynchronous function to inject into the sandbox.
// Registered via SetAsyncFunc, returns a native JS Promise.
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

// NewRuntime creates a new QuickJS sandbox runtime with the given config.
func NewRuntime(config ExecutionConfig) Runtime {
	return newQJSRuntime(config)
}
