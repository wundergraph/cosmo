package modules_v1

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/modules_v1/custom_modules"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
)

func TestModuleV1ProvisionAndCleanupLifecycle(t *testing.T) {
	t.Parallel()

	t.Run("no regression with the module system introduced", func(t *testing.T) {
		t.Parallel()

		dbModule := &custom_modules.DatabaseModule{}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithCustomModulesV1(dbModule),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:         `query MyQuery { employees { id } }`,
				OperationName: json.RawMessage(`"MyQuery"`),
			})
			require.NoError(t, err)
			assert.Equal(t, 200, res.Response.StatusCode)
			assert.JSONEq(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
		})
	})
}
