package module_test

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/trace/tracetest"
	"go.uber.org/zap/zapcore"

	"github.com/wundergraph/cosmo/router-tests/modules/custom-module/module"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestModuleSetCustomHeader(t *testing.T) {
	cfg := config.Config{
		Graph: config.Graph{},
		Modules: map[string]interface{}{
			"myModule": module.MyModule{
				Value: 1,
			},
		},
	}

	testenv.Run(t, &testenv.Config{
		RouterOptions: []core.Option{
			core.WithModulesConfig(cfg.Modules),
			core.WithCustomModules(&module.MyModule{}),
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			Query:         `query MyQuery { employees { id } }`,
			OperationName: json.RawMessage(`"MyQuery"`),
		})
		require.NoError(t, err)

		assert.Equal(t, 200, res.Response.StatusCode)

		assert.JSONEq(t, res.Body, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`)
	})
}

func TestCustomModuleLogs(t *testing.T) {
	cfg := config.Config{
		Graph: config.Graph{},
		Modules: map[string]interface{}{
			"myModule": module.MyModule{
				Value: 1,
			},
		},
	}

	exporter := tracetest.NewInMemoryExporter(t)

	testenv.Run(t, &testenv.Config{
		RouterOptions: []core.Option{
			core.WithModulesConfig(cfg.Modules),
			core.WithCustomModules(&module.MyModule{}),
		},
		LogObservation: testenv.LogObservationConfig{
			Enabled:  true,
			LogLevel: zapcore.InfoLevel,
		},
		TraceExporter: exporter,
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			Query:         `query MyQuery { employees { id } }`,
			OperationName: json.RawMessage(`"MyQuery"`),
		})
		require.NoError(t, err)

		assert.Equal(t, 200, res.Response.StatusCode)
		assert.JSONEq(t, res.Body, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`)

		requestLog := xEnv.Observer().FilterMessage("Test custom module logs")
		assert.Equal(t, requestLog.Len(), 1)
		requestContext := requestLog.All()[0].ContextMap()

		expectedKeys := []string{
			"trace_id", "request_id", "hostname", "pid",
		}

		for _, key := range expectedKeys {
			assert.NotEmpty(t, requestContext[key])
		}
	})
}
