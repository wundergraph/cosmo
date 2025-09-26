package module_test

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	setScopesModule "github.com/wundergraph/cosmo/router-tests/modules/custom-set-auth-scopes"
	verifyScopes "github.com/wundergraph/cosmo/router-tests/modules/verify-scopes"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestCustomModuleSetAuthenticationScopes(t *testing.T) {
	t.Run("it can set scopes and request passes on authenticated request without scopes", func(t *testing.T) {
		t.Parallel()

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"setAuthenticationScopesModule": setScopesModule.SetAuthenticationScopesModule{
					Value:  2,
					Scopes: []string{"read:employee", "read:private"},
				},
				"verifyScopesModule": verifyScopes.VerifyScopesModule{
					Value:  3,
					Scopes: []string{"read:employee", "read:private"},
				},
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
				core.WithCustomModules(&setScopesModule.SetAuthenticationScopesModule{}, &verifyScopes.VerifyScopesModule{}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with a token should succeed
			token, err := authServer.Token(nil)
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQueryRequiringClaims))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, jwksName, res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"data":{"employees":[{"id":1,"startDate":"January 2020"},{"id":2,"startDate":"July 2022"},{"id":3,"startDate":"June 2021"},{"id":4,"startDate":"July 2022"},{"id":5,"startDate":"July 2022"},{"id":7,"startDate":"September 2022"},{"id":8,"startDate":"September 2022"},{"id":10,"startDate":"November 2022"},{"id":11,"startDate":"November 2022"},{"id":12,"startDate":"December 2022"}]}}`, string(data))
		})
	})

	t.Run("it can set scopes and request passes on authenticated request with scopes", func(t *testing.T) {
		t.Parallel()

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"setAuthenticationScopesModule": setScopesModule.SetAuthenticationScopesModule{
					Value:  2,
					Scopes: []string{"read:employee", "read:private"},
				},
				"verifyScopesModule": verifyScopes.VerifyScopesModule{
					Value:  3,
					Scopes: []string{"read:employee", "read:private"},
				},
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
				core.WithCustomModules(&setScopesModule.SetAuthenticationScopesModule{}, &verifyScopes.VerifyScopesModule{}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with a token should succeed
			token, err := authServer.Token(map[string]any{
				"scope": "read:employee2 read:private2",
			})
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQueryRequiringClaims))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, jwksName, res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"data":{"employees":[{"id":1,"startDate":"January 2020"},{"id":2,"startDate":"July 2022"},{"id":3,"startDate":"June 2021"},{"id":4,"startDate":"July 2022"},{"id":5,"startDate":"July 2022"},{"id":7,"startDate":"September 2022"},{"id":8,"startDate":"September 2022"},{"id":10,"startDate":"November 2022"},{"id":11,"startDate":"November 2022"},{"id":12,"startDate":"December 2022"}]}}`, string(data))
		})
	})

	t.Run("should fail with authorization error because module didn't set the necessary scopes to execute the query", func(t *testing.T) {
		t.Parallel()

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"setAuthenticationScopesModule": setScopesModule.SetAuthenticationScopesModule{
					Value:  2,
					Scopes: []string{"read:employee"},
				},
				"verifyScopesModule": verifyScopes.VerifyScopesModule{
					Value:  3,
					Scopes: []string{"read:employee"},
				},
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
				core.WithCustomModules(&setScopesModule.SetAuthenticationScopesModule{}, &verifyScopes.VerifyScopesModule{}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with a token should succeed
			token, err := authServer.Token(map[string]any{
				"scope": "read:employee read:private",
			})
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQueryRequiringClaims))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, jwksName, res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",0,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",1,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",2,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",3,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",4,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",5,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",6,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",7,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",8,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",9,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}}],"data":{"employees":[null,null,null,null,null,null,null,null,null,null]},"extensions":{"authorization":{"missingScopes":[{"coordinate":{"typeName":"Employee","fieldName":"startDate"},"required":[["read:employee","read:private"],["read:all"]]}],"actualScopes":["read:employee"]}}}`, string(data))
		})
	})

	t.Run("it can set scopes and request passes on not authenticated request", func(t *testing.T) {
		t.Parallel()

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"setAuthenticationScopesModule": setScopesModule.SetAuthenticationScopesModule{
					Value:  2,
					Scopes: []string{"read:employee", "read:private"},
				},
				"verifyScopesModule": verifyScopes.VerifyScopesModule{
					Value:  3,
					Scopes: []string{"read:employee", "read:private"},
				},
			},
		}
		_, authServer := configureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&setScopesModule.SetAuthenticationScopesModule{}, &verifyScopes.VerifyScopesModule{}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with a token should succeed
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
			require.Equal(t, `{"data":{"employees":[{"id":1,"startDate":"January 2020"},{"id":2,"startDate":"July 2022"},{"id":3,"startDate":"June 2021"},{"id":4,"startDate":"July 2022"},{"id":5,"startDate":"July 2022"},{"id":7,"startDate":"September 2022"},{"id":8,"startDate":"September 2022"},{"id":10,"startDate":"November 2022"},{"id":11,"startDate":"November 2022"},{"id":12,"startDate":"December 2022"}]}}`, string(data))
		})
	})
}
