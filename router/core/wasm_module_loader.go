package core

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/internal/wasm"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// defaultWasmCallTimeout is the per-hook-call timeout applied when a module does
// not configure one. It mirrors the documented default in config.schema.json.
// Schema defaults are not injected into the parsed config, so it must be applied
// here.
const defaultWasmCallTimeout = 10 * time.Second

// buildWasmModules compiles and loads the enabled WASM modules. It returns the
// module adapters together with the shared runtime that owns the compilation
// cache; the runtime must be closed on shutdown. When no modules are enabled it
// returns (nil, nil, nil).
//
// If any module fails to load, all modules loaded so far and the runtime are
// closed before returning the error.
func buildWasmModules(ctx context.Context, cfgs []config.WasmModuleConfiguration, logger *zap.Logger) ([]*wasmModule, *wasm.Runtime, error) {
	if logger == nil {
		logger = zap.NewNop()
	}

	enabled := make([]config.WasmModuleConfiguration, 0, len(cfgs))
	seen := make(map[string]struct{}, len(cfgs))
	for _, c := range cfgs {
		if c.Enabled != nil && !*c.Enabled {
			logger.Debug("WASM module disabled, skipping", zap.String("id", c.ID))
			continue
		}
		if c.ID == "" {
			return nil, nil, fmt.Errorf("wasm module id must not be empty")
		}
		if _, dup := seen[c.ID]; dup {
			return nil, nil, fmt.Errorf("duplicate wasm module id %q", c.ID)
		}
		seen[c.ID] = struct{}{}
		enabled = append(enabled, c)
	}
	if len(enabled) == 0 {
		return nil, nil, nil
	}

	runtime := wasm.NewRuntime(logger)
	loaded := make([]*wasmModule, 0, len(enabled))

	for _, c := range enabled {
		var provisionConfig []byte
		if len(c.Config) > 0 {
			raw, err := json.Marshal(c.Config)
			if err != nil {
				closeWasm(ctx, loaded, runtime)
				return nil, nil, fmt.Errorf("wasm module %q: encode config: %w", c.ID, err)
			}
			provisionConfig = raw
		}

		timeout := c.Timeout
		if timeout <= 0 {
			timeout = defaultWasmCallTimeout
		}

		mod, err := runtime.LoadModule(ctx, wasm.ModuleConfig{
			ID:              c.ID,
			Path:            c.Path,
			AllowedHosts:    c.AllowedHosts,
			MaxInstances:    c.MaxInstances,
			Timeout:         timeout,
			ProvisionConfig: provisionConfig,
		})
		if err != nil {
			closeWasm(ctx, loaded, runtime)
			return nil, nil, err
		}

		loaded = append(loaded, newWasmModule(c.ID, c.Priority, mod, logger.With(zap.String("wasm_module", c.ID))))
		logger.Info("WASM module loaded",
			zap.String("id", c.ID),
			zap.Int("priority", c.Priority),
			zap.Any("hooks", capabilityHooks(mod)),
		)
	}

	return loaded, runtime, nil
}

func closeWasm(ctx context.Context, loaded []*wasmModule, runtime *wasm.Runtime) {
	for _, m := range loaded {
		_ = m.module.Close(ctx)
	}
	_ = runtime.Close(ctx)
}

func capabilityHooks(mod *wasm.Module) []string {
	caps := mod.Capabilities()
	hooks := make([]string, 0, len(caps))
	for h := range caps {
		hooks = append(hooks, h)
	}
	return hooks
}
