package module_test

import (
	"encoding/json"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"testing"

	"github.com/wundergraph/cosmo/router/cmd/custom/module"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestModuleSetCustomHeader(t *testing.T) {
	cfg := config.Config{
		Graph: config.Graph{
			Name: "production",
		},
		Modules: map[string]interface{}{
			"myModule": module.MyModule{
				Value: 1,
			},
		},
	}

	testenv.Run(t, &testenv.Config{
		RouterOptions: []core.Option{
			core.WithModulesConfig(cfg.Modules),
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			Query:         `query MyQuery { employees { id } }`,
			OperationName: json.RawMessage(`"MyQuery"`),
		})
		require.NoError(t, err)

		assert.Equal(t, 200, res.Response.StatusCode)

		// This header was set by the module
		assert.Equal(t, res.Response.Header.Get("myHeader"), "myValue")
		assert.JSONEq(t, res.Body, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":9},{"id":10},{"id":11},{"id":12}]}}`)
	})
}
