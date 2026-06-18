package integration

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap/zapcore"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// TestRequestTracingSecurity verifies the production authorization gate around
// Advanced Request Tracing (ART).
func TestRequestTracingSecurity(t *testing.T) {
	t.Parallel()

	const query = `{ employees { id } }`
	headers := http.Header{
		"X-WG-Trace":              []string{"true"},
		"X-WG-Include-Query-Plan": []string{"true"},
	}
	wantLogMsg := "Advanced Request Tracing (ART) is enabled for unauthenticated requests."

	t.Run("anonymous ART is denied in production by default", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.WarnLevel,
			},
			RouterOptions: []core.Option{
				core.WithDevelopmentMode(false),
			},
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.EnableRequestTracing = true
				cfg.ForceUnauthenticatedRequestTracing = false
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Header: headers,
				Query:  query,
			})

			var resp struct {
				Extensions map[string]json.RawMessage `json:"extensions"`
			}
			require.NoError(t, json.Unmarshal([]byte(res.Body), &resp))
			require.NotContains(t, resp.Extensions, "trace")
			require.NotContains(t, resp.Extensions, "queryPlan")

			warns := xEnv.Observer().FilterMessageSnippet(wantLogMsg).All()
			require.Len(t, warns, 0)
		})
	})

	t.Run("anonymous ART is allowed when force_unauthenticated_request_tracing is enabled", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.WarnLevel,
			},
			RouterOptions: []core.Option{
				core.WithDevelopmentMode(false),
			},
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.EnableRequestTracing = true
				cfg.ForceUnauthenticatedRequestTracing = true
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Header: headers,
				Query:  query,
			})

			var resp struct {
				Extensions map[string]json.RawMessage `json:"extensions"`
			}
			require.NoError(t, json.Unmarshal([]byte(res.Body), &resp))
			require.Contains(t, resp.Extensions, "trace")

			var trace struct {
				Version string          `json:"version"`
				Info    json.RawMessage `json:"info"`
				Fetches json.RawMessage `json:"fetches"`
				Request json.RawMessage `json:"request"`
			}
			require.NoError(t, json.Unmarshal(resp.Extensions["trace"], &trace))
			require.NotEmpty(t, trace.Version)
			require.NotEmpty(t, trace.Info)
			require.NotEmpty(t, trace.Fetches)
			require.NotEmpty(t, trace.Request)

			warns := xEnv.Observer().FilterMessageSnippet(wantLogMsg).All()
			require.Len(t, warns, 1)
			require.Equal(t, zapcore.WarnLevel, warns[0].Level)
		})
	})
}
