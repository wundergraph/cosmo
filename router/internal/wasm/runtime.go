// Package wasm is the router host runtime for WASM custom modules. It wraps
// Extism (on top of wazero) to compile and instantiate guest modules and to
// invoke their hooks over the JSON ABI defined in
// github.com/wundergraph/cosmo/router-wasm-module/wire.
//
// This package deliberately has no dependency on the router core package; it
// only deals with bytes and the Extism runtime, so core can import it without
// creating an import cycle. The mapping between the router RequestContext and
// the wire messages lives in the core package (wasm_module.go).
package wasm

import (
	"context"
	"fmt"
	"time"

	extism "github.com/extism/go-sdk"
	"github.com/tetratelabs/wazero"
	"go.uber.org/zap"
)

// Runtime is a shared environment for loading WASM modules. It holds a wazero
// compilation cache so identical guests are compiled only once across modules.
type Runtime struct {
	logger *zap.Logger
	cache  wazero.CompilationCache
}

// NewRuntime creates a Runtime. The logger is used for guest log output and
// module diagnostics.
func NewRuntime(logger *zap.Logger) *Runtime {
	if logger == nil {
		logger = zap.NewNop()
	}
	// Set the process-wide Extism log threshold to Info. This keeps guest
	// pdk.Log(Info/Warn/Error) messages flowing (they are bridged to the module
	// logger in Module.configureInstance) while suppressing Extism's internal
	// Trace/Debug output, which is emitted during instantiation before a
	// per-instance logger is attached and would otherwise print to stderr.
	extism.SetLogLevel(extism.LogLevelInfo)
	return &Runtime{
		logger: logger,
		cache:  wazero.NewCompilationCache(),
	}
}

// ModuleConfig configures a single WASM module load.
type ModuleConfig struct {
	// ID is the module identifier, used for logging and error messages.
	ID string
	// Path is the filesystem path to the compiled .wasm file.
	Path string
	// Wasm is an optional inline wasm binary. When set it takes precedence over
	// Path (used by tests).
	Wasm []byte
	// AllowedHosts is an optional egress allowlist passed to the Extism manifest.
	AllowedHosts []string
	// MaxInstances is the size of the instance pool. Zero means GOMAXPROCS.
	MaxInstances int
	// Timeout is the per-hook-call timeout. Zero means no timeout.
	Timeout time.Duration
	// ProvisionConfig is the raw JSON module config passed to the guest's
	// provision hook when each instance is created.
	ProvisionConfig []byte
}

// LoadModule compiles a WASM module, probes its capabilities and provisions its
// first instance. It returns an error if compilation or provisioning fails.
func (r *Runtime) LoadModule(ctx context.Context, cfg ModuleConfig) (*Module, error) {
	var source extism.Wasm
	switch {
	case len(cfg.Wasm) > 0:
		source = extism.WasmData{Data: cfg.Wasm}
	case cfg.Path != "":
		source = extism.WasmFile{Path: cfg.Path}
	default:
		return nil, fmt.Errorf("wasm module %q: no path or inline wasm provided", cfg.ID)
	}

	manifest := extism.Manifest{
		Wasm:         []extism.Wasm{source},
		AllowedHosts: cfg.AllowedHosts,
	}

	// WithCloseOnContextDone lets per-call context deadlines interrupt guest
	// execution; the shared cache avoids recompiling identical guests.
	runtimeConfig := wazero.NewRuntimeConfig().
		WithCompilationCache(r.cache).
		WithCloseOnContextDone(true)

	compiled, err := extism.NewCompiledPlugin(ctx, manifest, extism.PluginConfig{
		EnableWasi:    true,
		RuntimeConfig: runtimeConfig,
	}, nil)
	if err != nil {
		return nil, fmt.Errorf("compile wasm module %q: %w", cfg.ID, err)
	}

	mod, err := newModule(ctx, r.logger, compiled, cfg)
	if err != nil {
		_ = compiled.Close(ctx)
		return nil, err
	}
	return mod, nil
}

// Close releases the shared compilation cache. Individual modules must be
// closed via Module.Close.
func (r *Runtime) Close(ctx context.Context) error {
	return r.cache.Close(ctx)
}
