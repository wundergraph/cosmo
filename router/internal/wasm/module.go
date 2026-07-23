package wasm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"runtime"
	"sync/atomic"
	"time"

	extism "github.com/extism/go-sdk"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router-wasm-module/wire"
)

// ErrHookNotImplemented is returned by Call when the guest does not implement
// the requested hook. Callers should check HasCapability first.
var ErrHookNotImplemented = errors.New("wasm: hook not implemented by module")

// Module is a loaded WASM module. It owns a compiled Extism plugin and a
// bounded pool of instances. Extism instances are single-memory and not safe
// for concurrent calls, so each in-flight call uses its own instance. Every
// instance is provisioned when created.
//
// The pool is a create-permit + idle-instance design: at most maxInstances
// instances exist at once (bounded by the permits in the sem channel), idle
// instances are reused from the idle channel, and a discarded (errored)
// instance returns its permit so a waiter can create a fresh one.
type Module struct {
	id       string
	logger   *zap.Logger
	compiled *extism.CompiledPlugin
	timeout  time.Duration
	// provisionConfig is the raw JSON module config passed to the provision hook.
	provisionConfig []byte

	// caps is the set of hooks the guest implements (immutable after load).
	caps map[string]bool

	sem    chan struct{}       // create permits; cap == maxInstances
	idle   chan *extism.Plugin // ready-to-use instances; cap == maxInstances
	closed atomic.Bool
}

func newModule(ctx context.Context, logger *zap.Logger, compiled *extism.CompiledPlugin, cfg ModuleConfig) (*Module, error) {
	max := cfg.MaxInstances
	if max <= 0 {
		max = runtime.GOMAXPROCS(0)
	}
	if max < 1 {
		max = 1
	}

	m := &Module{
		id:              cfg.ID,
		logger:          logger.With(zap.String("wasm_module", cfg.ID)),
		compiled:        compiled,
		timeout:         cfg.Timeout,
		provisionConfig: cfg.ProvisionConfig,
		sem:             make(chan struct{}, max),
		idle:            make(chan *extism.Plugin, max),
	}
	for range max {
		m.sem <- struct{}{}
	}

	// Probe capabilities and validate provisioning with the first instance.
	// Consume a permit for it to keep the invariant liveInstances+permits==max.
	<-m.sem
	probe, err := compiled.Instance(ctx, extism.PluginInstanceConfig{})
	if err != nil {
		m.sem <- struct{}{}
		return nil, fmt.Errorf("wasm module %q: create instance: %w", cfg.ID, err)
	}
	m.configureInstance(probe)

	caps, err := probeCapabilities(ctx, probe)
	if err != nil {
		_ = probe.Close(ctx)
		m.sem <- struct{}{}
		return nil, fmt.Errorf("wasm module %q: %w", cfg.ID, err)
	}
	m.caps = caps

	if caps[wire.HookProvision] {
		if err := provisionInstance(ctx, probe, m.provisionConfig, m.timeout); err != nil {
			_ = probe.Close(ctx)
			m.sem <- struct{}{}
			return nil, fmt.Errorf("wasm module %q: %w", cfg.ID, err)
		}
	}

	m.idle <- probe
	return m, nil
}

// Capabilities returns the set of hooks the guest implements.
func (m *Module) Capabilities() map[string]bool {
	return m.caps
}

// HasCapability reports whether the guest implements the given hook.
func (m *Module) HasCapability(hook string) bool {
	return m.caps[hook]
}

// Call invokes a guest hook with the given JSON input and returns the JSON
// output. It transparently acquires a free instance from the pool (creating one
// up to MaxInstances) and returns it afterwards.
func (m *Module) Call(ctx context.Context, hook string, input []byte) ([]byte, error) {
	if !m.caps[hook] {
		return nil, ErrHookNotImplemented
	}

	p, err := m.acquire(ctx)
	if err != nil {
		return nil, err
	}

	callCtx := ctx
	if m.timeout > 0 {
		var cancel context.CancelFunc
		callCtx, cancel = context.WithTimeout(ctx, m.timeout)
		defer cancel()
	}

	code, out, err := p.CallWithContext(callCtx, hook, input)
	if err != nil {
		// The instance may be left in an inconsistent state after an error or
		// an interrupt, so discard it rather than returning it to the pool.
		m.discard(ctx, p)
		return nil, fmt.Errorf("wasm module %q hook %q: %w", m.id, hook, err)
	}
	if code != 0 {
		m.discard(ctx, p)
		return nil, fmt.Errorf("wasm module %q hook %q exited with code %d", m.id, hook, code)
	}
	m.release(p)
	return out, nil
}

// Close closes all pooled instances and the compiled plugin. It must only be
// called after all in-flight calls have drained (router shutdown).
func (m *Module) Close(ctx context.Context) error {
	if m.closed.Swap(true) {
		return nil
	}

	var errs []error
	for {
		select {
		case p := <-m.idle:
			if err := p.Close(ctx); err != nil {
				errs = append(errs, err)
			}
		default:
			if err := m.compiled.Close(ctx); err != nil {
				errs = append(errs, err)
			}
			return errors.Join(errs...)
		}
	}
}

// configureInstance bridges guest log output to the module logger.
func (m *Module) configureInstance(p *extism.Plugin) {
	p.SetLogger(func(level extism.LogLevel, msg string) {
		switch level {
		case extism.LogLevelError:
			m.logger.Error(msg)
		case extism.LogLevelWarn:
			m.logger.Warn(msg)
		case extism.LogLevelInfo:
			m.logger.Info(msg)
		default:
			m.logger.Debug(msg)
		}
	})
}

// createInstance creates and provisions a new pool instance. The caller must
// already hold a permit (a receive from m.sem).
func (m *Module) createInstance(ctx context.Context) (*extism.Plugin, error) {
	p, err := m.compiled.Instance(ctx, extism.PluginInstanceConfig{})
	if err != nil {
		return nil, fmt.Errorf("wasm module %q: create instance: %w", m.id, err)
	}
	m.configureInstance(p)
	if m.caps[wire.HookProvision] {
		if err := provisionInstance(ctx, p, m.provisionConfig, m.timeout); err != nil {
			_ = p.Close(ctx)
			return nil, fmt.Errorf("wasm module %q: %w", m.id, err)
		}
	}
	return p, nil
}

// acquire returns an instance to use, reusing an idle one or creating a new one
// (bounded by the create permits). It blocks until one is available or ctx is
// done.
func (m *Module) acquire(ctx context.Context) (*extism.Plugin, error) {
	if m.closed.Load() {
		return nil, fmt.Errorf("wasm module %q is closed", m.id)
	}

	// Fast path: reuse an idle instance.
	select {
	case p := <-m.idle:
		return p, nil
	default:
	}

	// Create a new instance if a permit is available.
	select {
	case <-m.sem:
		return m.createOrReturnPermit(ctx)
	default:
	}

	// At capacity: wait for an idle instance, a freed permit, or cancellation.
	select {
	case p := <-m.idle:
		return p, nil
	case <-m.sem:
		return m.createOrReturnPermit(ctx)
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// createOrReturnPermit creates an instance, returning the held permit to the
// pool if creation fails.
func (m *Module) createOrReturnPermit(ctx context.Context) (*extism.Plugin, error) {
	p, err := m.createInstance(ctx)
	if err != nil {
		m.sem <- struct{}{}
		return nil, err
	}
	return p, nil
}

// release returns a healthy instance to the idle pool.
func (m *Module) release(p *extism.Plugin) {
	select {
	case m.idle <- p:
	default:
		// The idle pool is full (should not happen); close it and free a permit.
		_ = p.Close(context.Background())
		m.sem <- struct{}{}
	}
}

// discard destroys an instance and returns its permit so another instance can
// be created in its place.
func (m *Module) discard(ctx context.Context, p *extism.Plugin) {
	_ = p.Close(ctx)
	m.sem <- struct{}{}
}

func probeCapabilities(ctx context.Context, p *extism.Plugin) (map[string]bool, error) {
	if !p.FunctionExists(wire.HookCapabilities) {
		return nil, fmt.Errorf("module does not export %q; was it built with the router-wasm-module sdk?", wire.HookCapabilities)
	}
	code, out, err := p.CallWithContext(ctx, wire.HookCapabilities, nil)
	if err != nil {
		return nil, fmt.Errorf("probe capabilities: %w", err)
	}
	if code != 0 {
		return nil, fmt.Errorf("capabilities exited with code %d", code)
	}
	var res wire.CapabilitiesOutput
	if err := json.Unmarshal(out, &res); err != nil {
		return nil, fmt.Errorf("decode capabilities: %w", err)
	}
	caps := make(map[string]bool, len(res.Hooks))
	for _, h := range res.Hooks {
		caps[h] = true
	}
	return caps, nil
}

func provisionInstance(ctx context.Context, p *extism.Plugin, provisionConfig []byte, timeout time.Duration) error {
	input, err := json.Marshal(wire.ProvisionInput{Config: provisionConfig})
	if err != nil {
		return fmt.Errorf("encode provision input: %w", err)
	}

	callCtx := ctx
	if timeout > 0 {
		var cancel context.CancelFunc
		callCtx, cancel = context.WithTimeout(ctx, timeout)
		defer cancel()
	}

	code, out, err := p.CallWithContext(callCtx, wire.HookProvision, input)
	if err != nil {
		return fmt.Errorf("provision: %w", err)
	}
	if code != 0 {
		return fmt.Errorf("provision exited with code %d", code)
	}
	var res wire.ProvisionOutput
	if err := json.Unmarshal(out, &res); err != nil {
		return fmt.Errorf("decode provision output: %w", err)
	}
	if res.Error != "" {
		return fmt.Errorf("provision failed: %s", res.Error)
	}
	return nil
}
