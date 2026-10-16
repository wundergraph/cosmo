package wasm

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
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

// mapStore is a ContextStore backed by a map.
type mapStore map[string]any

func (s mapStore) Get(key string) (any, bool) { v, ok := s[key]; return v, ok }
func (s mapStore) Set(key string, value any)  { s[key] = value }

func newOriginRequest(t *testing.T, body string) *http.Request {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, "http://subgraph/graphql", strings.NewReader(body))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	return req
}

func decodeHTTPOutput(t *testing.T, out []byte) wire.HTTPHookOutput {
	t.Helper()
	var res wire.HTTPHookOutput
	require.NoError(t, json.Unmarshal(out, &res))
	return res
}

func TestOnOriginRequestHook(t *testing.T) {
	_, mod := loadExample(t, ModuleConfig{ProvisionConfig: []byte(`{"value":"hello"}`)})

	const body = `{"query":"{ me }"}`
	req := newOriginRequest(t, body)
	store := mapStore{}

	out, err := mod.Call(context.Background(), wire.HookOnOriginRequest, nil, &CallState{
		Request:             req,
		RequestBodyReadable: true,
		Info: func() wire.ContextInfo {
			return wire.ContextInfo{Operation: &wire.Operation{Name: "Me"}}
		},
		Store: store,
	})
	require.NoError(t, err)
	require.Nil(t, decodeHTTPOutput(t, out).Response)

	// The guest mutated the live request headers.
	require.Equal(t, "hello", req.Header.Get("X-Wasm-Module"))
	require.Equal(t, "Me", req.Header.Get("X-Wasm-Operation"))
	require.Equal(t, strconv.Itoa(len(body)), req.Header.Get("X-Wasm-Body-Size"))
	require.Equal(t, "application/json", req.Header.Get("Content-Type"), "untouched headers are kept")

	// Reading the body in the guest leaves it readable for the transport.
	got, err := io.ReadAll(req.Body)
	require.NoError(t, err)
	require.Equal(t, body, string(got))

	// The module stored a JSON-decoded value on the context.
	require.Equal(t, "hello", store["wasmValue"])
}

func TestOnOriginResponseHook(t *testing.T) {
	_, mod := loadExample(t, ModuleConfig{ProvisionConfig: []byte(`{"value":"hello"}`)})

	resp := &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{},
		Body:       io.NopCloser(strings.NewReader(`{"data":{}}`)),
	}
	input, err := json.Marshal(wire.OnOriginResponseInput{HasResponse: true})
	require.NoError(t, err)

	out, err := mod.Call(context.Background(), wire.HookOnOriginResponse, input, &CallState{
		Request:         newOriginRequest(t, ""),
		RequestReadOnly: true,
		Response:        resp,
		Store:           mapStore{"wasmValue": "from-request"},
	})
	require.NoError(t, err)
	// The response was mutated in place, not replaced.
	require.Nil(t, decodeHTTPOutput(t, out).Response)
	require.Equal(t, "from-request", resp.Header.Get("X-Wasm-Origin-Value"))
}

func TestRouterOnRequestShortCircuit(t *testing.T) {
	_, mod := loadExample(t, ModuleConfig{ProvisionConfig: []byte(`{"value":"hello"}`)})

	req := newOriginRequest(t, "")
	req.Header.Set("X-Wasm-Ping", "1")
	out, err := mod.Call(context.Background(), wire.HookRouterOnRequest, nil, &CallState{Request: req})
	require.NoError(t, err)

	res := decodeHTTPOutput(t, out)
	require.NotNil(t, res.Response)
	require.Equal(t, 418, res.Response.StatusCode)
	require.JSONEq(t, `{"pong":"hello"}`, string(res.Response.Body))
}

func TestHostFunctionPermissionTrapsGuest(t *testing.T) {
	_, mod := loadExample(t, ModuleConfig{ProvisionConfig: []byte(`{"value":"hello"}`)})

	// The example reads the request body in on_origin_request; with the body
	// not readable the host function traps and the call fails.
	_, err := mod.Call(context.Background(), wire.HookOnOriginRequest, nil, &CallState{
		Request: newOriginRequest(t, "body"),
		Store:   mapStore{},
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "request body is not available")

	// Without call state no host function is available.
	_, err = mod.Call(context.Background(), wire.HookOnOriginRequest, nil, nil)
	require.Error(t, err)

	// The failed instances were discarded; the module keeps serving.
	_, err = mod.Call(context.Background(), wire.HookOnOriginRequest, nil, &CallState{
		Request:             newOriginRequest(t, "body"),
		RequestBodyReadable: true,
		Store:               mapStore{},
	})
	require.NoError(t, err)
}

func TestDecodeContextValuePreservesIntegerPrecision(t *testing.T) {
	// 2^53 + 1 cannot be represented exactly as a float64.
	v := DecodeContextValue([]byte(`9007199254740993`))
	num, ok := v.(json.Number)
	require.True(t, ok, "integers must be decoded as json.Number, got %T", v)
	require.Equal(t, "9007199254740993", num.String())

	raw, ok := EncodeContextValue(num)
	require.True(t, ok)
	require.Equal(t, `9007199254740993`, string(raw))

	require.Equal(t, "not json", DecodeContextValue([]byte(`not json`)))
}

func TestCallUnimplementedHook(t *testing.T) {
	_, mod := loadExample(t, ModuleConfig{ProvisionConfig: []byte(`{"value":"hello"}`)})
	_, err := mod.Call(context.Background(), wire.HookSubscriptionOnStart, []byte(`{}`), nil)
	require.ErrorIs(t, err, ErrHookNotImplemented)
}

func TestConcurrentCalls(t *testing.T) {
	_, mod := loadExample(t, ModuleConfig{
		ProvisionConfig: []byte(`{"value":"hello"}`),
		MaxInstances:    4,
	})

	const n = 50
	errs := make(chan error, n)
	for i := range n {
		go func() {
			req, err := http.NewRequest(http.MethodPost, "http://s/graphql", strings.NewReader(strconv.Itoa(i)))
			if err != nil {
				errs <- err
				return
			}
			_, callErr := mod.Call(context.Background(), wire.HookOnOriginRequest, nil, &CallState{
				Request:             req,
				RequestBodyReadable: true,
				Store:               mapStore{},
			})
			if callErr == nil && req.Header.Get("X-Wasm-Body-Size") != strconv.Itoa(len(strconv.Itoa(i))) {
				callErr = fmt.Errorf("call %d saw another call's request", i)
			}
			errs <- callErr
		}()
	}
	for range n {
		require.NoError(t, <-errs)
	}
}
