package module_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	authdeny "github.com/wundergraph/cosmo/router-tests/modules/custom-auth-deny"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestAuthDenyModule_WriteResponseError(t *testing.T) {
	t.Parallel()

	t.Run("missing header should return 401", func(t *testing.T) {
		t.Parallel()

		cfg := config.Config{
			Modules: map[string]interface{}{
				"authDenyModule": authdeny.AuthDenyModule{},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&authdeny.AuthDenyModule{}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:         `query MyQuery { employee(id: 1) { id currentMood hobbies { employees { currentMood } } } }`,
				OperationName: json.RawMessage(`"MyQuery"`),
			})
			require.NoError(t, err)

			assert.Equal(t, http.StatusUnauthorized, res.Response.StatusCode)
			assert.JSONEq(t, `{"errors":[{"message":"Missing Authorization header","extensions":{"code":"UNAUTHORIZED"}}]}`, res.Body)
		})
	})

	t.Run("header present should allow request to pass through", func(t *testing.T) {
		t.Parallel()

		cfg := config.Config{
			Modules: map[string]interface{}{
				"authDenyModule": authdeny.AuthDenyModule{},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&authdeny.AuthDenyModule{}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
				Query:         `query MyQuery { employee(id: 1) { id } }`,
				OperationName: json.RawMessage(`"MyQuery"`),
			}, map[string]string{
				"foo-header": "some-value",
			})
			require.NoError(t, err)

			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			assert.Equal(t, `{"data":{"employee":{"id":1}}}`, res.Body)
		})
	})
}
