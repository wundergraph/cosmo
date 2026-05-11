package module_test

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
	wildcardModule "github.com/wundergraph/cosmo/router-tests/modules/custom-set-wildcard-scope"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestCustomModuleSetWildcardScope(t *testing.T) {
	t.Run("authenticated request with wildcard scope bypasses requiresScopes checks", func(t *testing.T) {
		t.Parallel()

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]any{
				"setWildcardScopeModule": wildcardModule.SetWildcardScopeModule{},
			},
		}

		authenticators, authServer := configureAuth(t)
		accessController, err := core.NewAccessController(core.AccessControllerOptions{
			Authenticators:           authenticators,
			AuthenticationRequired:   false,
			SkipIntrospectionQueries: false,
			IntrospectionSkipSecret:  "",
		})
		require.NoError(t, err)

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(accessController),
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&wildcardModule.SetWildcardScopeModule{}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			token, err := authServer.Token(nil)
			require.NoError(t, err)

			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQueryRequiringClaims))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)

			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)

			require.Empty(t, gjson.GetBytes(data, "errors").Array())
			require.True(t, gjson.GetBytes(data, "data").Exists())
		})
	})

	t.Run("unauthenticated request with wildcard scope still fails", func(t *testing.T) {
		t.Parallel()

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]any{
				"setWildcardScopeModule": wildcardModule.SetWildcardScopeModule{},
			},
		}

		authenticators, _ := configureAuth(t)
		accessController, err := core.NewAccessController(core.AccessControllerOptions{
			Authenticators:           authenticators,
			AuthenticationRequired:   false,
			SkipIntrospectionQueries: false,
			IntrospectionSkipSecret:  "",
		})
		require.NoError(t, err)

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(accessController),
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&wildcardModule.SetWildcardScopeModule{}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", nil, strings.NewReader(employeesQueryRequiringClaims))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)

			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)

			errors := gjson.GetBytes(data, "errors").Array()
			require.Len(t, errors, 10)
			for _, e := range errors {
				require.Equal(t, "UNAUTHORIZED_FIELD_OR_TYPE", e.Get("extensions.code").String())
				require.Contains(t, e.Get("message").String(), "not authenticated")
			}
		})
	})

	t.Run("wildcard scope with RejectOperationIfUnauthorized grants access", func(t *testing.T) {
		t.Parallel()

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]any{
				"setWildcardScopeModule": wildcardModule.SetWildcardScopeModule{},
			},
		}

		authenticators, authServer := configureAuth(t)
		accessController, err := core.NewAccessController(core.AccessControllerOptions{
			Authenticators:           authenticators,
			AuthenticationRequired:   false,
			SkipIntrospectionQueries: false,
			IntrospectionSkipSecret:  "",
		})
		require.NoError(t, err)

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(accessController),
				core.WithAuthorizationConfig(&config.AuthorizationConfiguration{
					RejectOperationIfUnauthorized: true,
				}),
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&wildcardModule.SetWildcardScopeModule{}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			token, err := authServer.Token(nil)
			require.NoError(t, err)

			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQueryRequiringClaims))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)

			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)

			require.Empty(t, gjson.GetBytes(data, "errors").Array())
			require.True(t, gjson.GetBytes(data, "data").Exists())
		})
	})
}
