package wasm

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router-wasm-module/wire"
)

var (
	buildOnce sync.Once
	builtPath string
	builtDir  string
	buildErr  error
)

// buildExampleModule compiles the example guest module in router-wasm-module to
// a temporary .wasm reactor using the standard Go toolchain. Building at test
// time keeps the fixture in sync with the SDK/ABI.
func buildExampleModule() {
	src, err := filepath.Abs("../../../router-wasm-module/example")
	if err != nil {
		buildErr = err
		return
	}
	if _, err := os.Stat(filepath.Join(src, "main.go")); err != nil {
		buildErr = fmt.Errorf("example module not found at %s: %w", src, err)
		return
	}
	dir, err := os.MkdirTemp("", "wasm-fixture-*")
	if err != nil {
		buildErr = err
		return
	}
	builtDir = dir

	out := filepath.Join(dir, "module.wasm")
	cmd := exec.Command("go", "build", "-buildmode=c-shared", "-o", out, ".")
	cmd.Dir = src
	cmd.Env = append(os.Environ(), "GOOS=wasip1", "GOARCH=wasm")
	if output, err := cmd.CombinedOutput(); err != nil {
		buildErr = fmt.Errorf("failed to build wasm fixture: %w\n%s", err, output)
		return
	}
	builtPath = out
}

func requireExampleModule(t *testing.T) string {
	t.Helper()
	buildOnce.Do(buildExampleModule)
	if buildErr != nil {
		t.Skipf("skipping: could not build wasm fixture (needs Go wasip1 support): %v", buildErr)
	}
	return builtPath
}

func TestMain(m *testing.M) {
	code := m.Run()
	if builtDir != "" {
		_ = os.RemoveAll(builtDir)
	}
	os.Exit(code)
}

func loadExample(t *testing.T, cfg ModuleConfig) (*Runtime, *Module) {
	t.Helper()
	path := requireExampleModule(t)
	if cfg.ID == "" {
		cfg.ID = "example"
	}
	cfg.Path = path

	rt := NewRuntime(zap.NewNop())
	mod, err := rt.LoadModule(context.Background(), cfg)
	require.NoError(t, err)
	t.Cleanup(func() {
		_ = mod.Close(context.Background())
		_ = rt.Close(context.Background())
	})
	return rt, mod
}

func TestLoadAndCapabilities(t *testing.T) {
	_, mod := loadExample(t, ModuleConfig{ProvisionConfig: []byte(`{"value":"hello"}`)})

	caps := mod.Capabilities()
	require.True(t, caps[wire.HookProvision])
	require.True(t, caps[wire.HookOnOriginRequest])
	require.True(t, caps[wire.HookOnOriginResponse])
	require.True(t, caps[wire.HookRouterOnRequest])
	require.True(t, caps[wire.HookOnPublishEvents])
	// The example does not implement these hooks.
	require.False(t, caps[wire.HookSubscriptionOnStart])
	require.False(t, caps[wire.HookOnReceiveEvents])
	require.False(t, caps[wire.HookSubscriptionOnCreate])
}

func TestProvisionFailureAbortsLoad(t *testing.T) {
	path := requireExampleModule(t)
	rt := NewRuntime(zap.NewNop())
	t.Cleanup(func() { _ = rt.Close(context.Background()) })

	// The example requires config.value to be set; empty config must fail.
	_, err := rt.LoadModule(context.Background(), ModuleConfig{
		ID:   "example-bad",
		Path: path,
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "value must be set")
}

func TestOnOriginRequestHook(t *testing.T) {
	_, mod := loadExample(t, ModuleConfig{ProvisionConfig: []byte(`{"value":"hello"}`)})

	input, err := json.Marshal(wire.OnOriginRequestInput{
		Request: wire.HTTPRequest{
			Method: "POST",
			URL:    "http://subgraph/graphql",
			Header: wire.Header{"Content-Type": {"application/json"}},
			Body:   []byte(`{"query":"{ me }"}`),
		},
		Context: wire.ContextSnapshot{},
	})
	require.NoError(t, err)

	out, err := mod.Call(context.Background(), wire.HookOnOriginRequest, input)
	require.NoError(t, err)

	var res wire.OnOriginRequestOutput
	require.NoError(t, json.Unmarshal(out, &res))
	require.Empty(t, res.Error)
	require.Nil(t, res.Response)
	require.NotNil(t, res.Request)
	require.Equal(t, "hello", res.Request.Header.Get("X-Wasm-Module"))
	// The body was not modified, so no body mutation should be returned.
	require.Nil(t, res.Request.Body)
	// The module stored a value on the context.
	require.JSONEq(t, `"hello"`, string(res.ContextSets["wasmValue"]))
}

func TestCallUnimplementedHook(t *testing.T) {
	_, mod := loadExample(t, ModuleConfig{ProvisionConfig: []byte(`{"value":"hello"}`)})
	_, err := mod.Call(context.Background(), wire.HookSubscriptionOnStart, []byte(`{}`))
	require.ErrorIs(t, err, ErrHookNotImplemented)
}

func TestConcurrentCalls(t *testing.T) {
	_, mod := loadExample(t, ModuleConfig{
		ProvisionConfig: []byte(`{"value":"hello"}`),
		MaxInstances:    4,
	})

	input, err := json.Marshal(wire.OnOriginRequestInput{
		Request: wire.HTTPRequest{Method: "POST", URL: "http://s/graphql", Header: wire.Header{}},
	})
	require.NoError(t, err)

	const n = 50
	errs := make(chan error, n)
	for range n {
		go func() {
			_, callErr := mod.Call(context.Background(), wire.HookOnOriginRequest, input)
			errs <- callErr
		}()
	}
	for range n {
		require.NoError(t, <-errs)
	}
}
