package module

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	custom_trace_propagator "github.com/wundergraph/cosmo/router-tests/modules/custom-trace-propagator"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/cmd/custom/module"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	rtrace "github.com/wundergraph/cosmo/router/pkg/trace"
	"github.com/wundergraph/cosmo/router/pkg/trace/tracetest"
)

func TestModuleCustomPropagator(t *testing.T) {
	t.Run("Should set custom trace propagator with a custom trace ID", func(t *testing.T) {
		t.Parallel()

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"myModule":     module.MyModule{Value: 1},
				"custom_trace": custom_trace_propagator.CustomTracePropagatorModule{Value: 2},
			},
		}

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				GlobalMiddleware: func(handler http.Handler) http.Handler {
					return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
						require.Equal(t, "injectCalled:1, extractCalled:1", request.Header.Get("CustomPropagator"))
						handler.ServeHTTP(writer, request)
					})
				},
			},
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithTracing(&rtrace.Config{
					Enabled: true,
				}),
			},
			TraceExporter: exporter,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:         `query MyQuery { employees { id } }`,
				OperationName: json.RawMessage(`"MyQuery"`),
				Header: map[string][]string{
					"CustomPropagator": {"injectCalled:0, extractCalled:0"},
				},
			})
			require.NoError(t, err)
			assert.Equal(t, 200, res.Response.StatusCode)
			assert.JSONEq(t, res.Body, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`)

			spans := exporter.GetSpans().Snapshots()

			// check that our fantasy trace ID is set
			for _, s := range spans {
				traceIDStr := s.SpanContext().TraceID().String()
				require.Equal(t, "acde00000000000000000000eeeeffff", traceIDStr)
			}
		})
	})
}
