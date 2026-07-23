package module_test

import (
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap/zapcore"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// buildWasmFixture compiles the example WASM guest module to a temporary .wasm
// reactor. It skips the test if the wasip1 toolchain is unavailable.
func buildWasmFixture(t *testing.T) string {
	t.Helper()
	src, err := filepath.Abs("../../router-wasm-module/example")
	require.NoError(t, err)
	if _, err := os.Stat(filepath.Join(src, "main.go")); err != nil {
		t.Skipf("example wasm module not found at %s: %v", src, err)
	}

	out := filepath.Join(t.TempDir(), "module.wasm")
	cmd := exec.Command("go", "build", "-buildmode=c-shared", "-o", out, ".")
	cmd.Dir = src
	cmd.Env = append(os.Environ(), "GOOS=wasip1", "GOARCH=wasm")
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Skipf("could not build wasm fixture (needs Go wasip1 support): %v\n%s", err, output)
	}
	return out
}

func TestWasmModule(t *testing.T) {
	t.Parallel()

	wasmPath := buildWasmFixture(t)

	wasmModules := []config.WasmModuleConfiguration{
		{
			ID:   "exampleWasm",
			Path: wasmPath,
			Config: map[string]any{
				"value": "pong-value",
			},
		},
	}

	t.Run("router_on_request short-circuits with a canned response", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithWasmModules(wasmModules),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// The module loaded during startup.
			assert.Len(t, xEnv.Observer().FilterMessage("WASM module loaded").All(), 1)

			resp, err := xEnv.MakeRequest(http.MethodPost, "/graphql", http.Header{
				"Content-Type": {"application/json"},
				"X-Wasm-Ping":  {"1"},
			}, strings.NewReader(`{"query":"{ employees { id } }"}`))
			require.NoError(t, err)
			defer resp.Body.Close()

			body, err := io.ReadAll(resp.Body)
			require.NoError(t, err)

			assert.Equal(t, 418, resp.StatusCode)
			assert.JSONEq(t, `{"pong":"pong-value"}`, string(body))
		})
	})

	t.Run("normal requests pass through the module", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithWasmModules(wasmModules),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `{ employees { id } }`,
			})
			require.NoError(t, err)
			assert.Equal(t, 200, res.Response.StatusCode)
			assert.JSONEq(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
		})
	})

	t.Run("provisioning failure aborts startup", func(t *testing.T) {
		t.Parallel()

		err := testenv.RunWithError(t, &testenv.Config{
			RouterOptions: []core.Option{
				// No config.value provided; the module's Provision must fail.
				core.WithWasmModules([]config.WasmModuleConfiguration{
					{ID: "badWasm", Path: wasmPath},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "value must be set")
	})
}
