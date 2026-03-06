package module_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	wildcardModule "github.com/wundergraph/cosmo/router-tests/modules/custom-set-wildcard-scope"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

type graphQLResponse struct {
	Data   json.RawMessage `json:"data"`
	Errors []struct {
		Message    string `json:"message"`
		Extensions struct {
			Code string `json:"code"`
		} `json:"extensions"`
	} `json:"errors"`
	Extensions struct {
		Authorization struct {
			MissingScopes []struct {
				Coordinate struct {
					TypeName  string `json:"typeName"`
					FieldName string `json:"fieldName"`
				} `json:"coordinate"`
				Required [][]string `json:"required"`
			} `json:"missingScopes"`
			ActualScopes []string `json:"actualScopes"`
		} `json:"authorization"`
	} `json:"extensions"`
}

func TestCustomModuleSetWildcardScope(t *testing.T) {
	t.Run("authenticated request with wildcard scope bypasses requiresScopes checks", func(t *testing.T) {
		t.Parallel()

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]any{
				"setWildcardScopeModule": wildcardModule.SetWildcardScopeModule{
					Enabled: true,
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
				core.WithCustomModules(&wildcardModule.SetWildcardScopeModule{}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Token has no scopes at all, but wildcard should grant access
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
			var resp graphQLResponse
			require.NoError(t, json.Unmarshal(data, &resp))
			require.Empty(t, resp.Errors)
			require.NotEmpty(t, resp.Data)
		})
	})

	t.Run("unauthenticated request with wildcard scope still fails", func(t *testing.T) {
		t.Parallel()

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]any{
				"setWildcardScopeModule": wildcardModule.SetWildcardScopeModule{
					Enabled: true,
				},
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
			// No token — should still get "not authenticated" errors
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", nil, strings.NewReader(employeesQueryRequiringClaims))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			var resp graphQLResponse
			require.NoError(t, json.Unmarshal(data, &resp))
			require.Len(t, resp.Errors, 10)
			for _, e := range resp.Errors {
				require.Equal(t, "UNAUTHORIZED_FIELD_OR_TYPE", e.Extensions.Code)
				require.Contains(t, e.Message, "not authenticated")
			}
		})
	})

	t.Run("wildcard scope disabled still requires correct scopes", func(t *testing.T) {
		t.Parallel()

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]any{
				"setWildcardScopeModule": wildcardModule.SetWildcardScopeModule{
					Enabled: false,
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
				core.WithCustomModules(&wildcardModule.SetWildcardScopeModule{}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Token with insufficient scopes — wildcard is disabled so should fail
			token, err := authServer.Token(map[string]any{
				"scope": "read:employee",
			})
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
			var resp graphQLResponse
			require.NoError(t, json.Unmarshal(data, &resp))
			require.Len(t, resp.Errors, 10)
			for _, e := range resp.Errors {
				require.Equal(t, "UNAUTHORIZED_FIELD_OR_TYPE", e.Extensions.Code)
				require.Contains(t, e.Message, "missing required scopes")
			}
			require.Len(t, resp.Extensions.Authorization.MissingScopes, 1)
			require.Equal(t, "Employee", resp.Extensions.Authorization.MissingScopes[0].Coordinate.TypeName)
			require.Equal(t, "startDate", resp.Extensions.Authorization.MissingScopes[0].Coordinate.FieldName)
			require.Equal(t, []string{"read:employee"}, resp.Extensions.Authorization.ActualScopes)
		})
	})

	t.Run("wildcard scope with RejectOperationIfUnauthorized grants access", func(t *testing.T) {
		t.Parallel()

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]any{
				"setWildcardScopeModule": wildcardModule.SetWildcardScopeModule{
					Enabled: true,
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
				core.WithAuthorizationConfig(&config.AuthorizationConfiguration{
					RejectOperationIfUnauthorized: true,
				}),
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&wildcardModule.SetWildcardScopeModule{}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Token has no scopes, but wildcard should grant access even with reject mode
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
			data = bytes.TrimSpace(data)
			require.NoError(t, err)
			var resp graphQLResponse
			require.NoError(t, json.Unmarshal(data, &resp))
			require.Empty(t, resp.Errors)
			require.NotEmpty(t, resp.Data)
		})
	})
}
