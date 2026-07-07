package integration

import (
	"bytes"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/jwks"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router-tests/testutils"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// TestPreFetchFieldAuthorization exercises the router with pre-fetch field authorization enabled.
// Protected fields are authorized in a single batch before any subgraph fetch runs; the observable
// authorization outcomes must match the default post-fetch behavior.
func TestPreFetchFieldAuthorization(t *testing.T) {
	t.Parallel()

	newAccessController := func(t *testing.T) (*core.AccessController, *jwks.Server) {
		t.Helper()
		authenticators, authServer := testutils.ConfigureAuth(t)
		accessController, err := core.NewAccessController(core.AccessControllerOptions{
			Authenticators: authenticators,
		})
		require.NoError(t, err)
		return accessController, authServer
	}

	t.Run("authorized request returns full data", func(t *testing.T) {
		t.Parallel()

		accessController, authServer := newAccessController(t)

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(accessController),
				core.WithAuthorizationConfig(&config.AuthorizationConfiguration{
					EnablePreFetchFieldAuthorization: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			token, err := authServer.Token(map[string]any{
				"scope": "read:employee read:private",
			})
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQueryBodyRequiringClaims))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, testutils.JwksName, res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"data":{"employees":[{"id":1,"startDate":"January 2020"},{"id":2,"startDate":"July 2022"},{"id":3,"startDate":"June 2021"},{"id":4,"startDate":"July 2022"},{"id":5,"startDate":"July 2022"},{"id":7,"startDate":"September 2022"},{"id":8,"startDate":"September 2022"},{"id":10,"startDate":"November 2022"},{"id":11,"startDate":"November 2022"},{"id":12,"startDate":"December 2022"}]}}`, string(data))
		})
	})

	t.Run("authorized when any OR scope group is satisfied", func(t *testing.T) {
		t.Parallel()

		accessController, authServer := newAccessController(t)

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(accessController),
				core.WithAuthorizationConfig(&config.AuthorizationConfiguration{
					EnablePreFetchFieldAuthorization: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			token, err := authServer.Token(map[string]any{
				"scope": "read:all",
			})
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQueryBodyRequiringClaims))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"data":{"employees":[{"id":1,"startDate":"January 2020"},{"id":2,"startDate":"July 2022"},{"id":3,"startDate":"June 2021"},{"id":4,"startDate":"July 2022"},{"id":5,"startDate":"July 2022"},{"id":7,"startDate":"September 2022"},{"id":8,"startDate":"September 2022"},{"id":10,"startDate":"November 2022"},{"id":11,"startDate":"November 2022"},{"id":12,"startDate":"December 2022"}]}}`, string(data))
		})
	})

	t.Run("partial scopes null the unauthorized field and report missing scopes", func(t *testing.T) {
		t.Parallel()

		accessController, authServer := newAccessController(t)

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(accessController),
				core.WithAuthorizationConfig(&config.AuthorizationConfiguration{
					EnablePreFetchFieldAuthorization: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Employee.startDate is non-null (String!) and protected by @requiresScopes; the token lacks
			// the required scopes, so startDate is nulled. Because a non-null field cannot hold null, the
			// null propagates up to the nearest nullable parent, collapsing each Employee list element to
			// null (rather than returning {id, startDate: null}).
			token, err := authServer.Token(map[string]any{
				"scope": "read:employee",
			})
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQueryBodyRequiringClaims))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",0,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",1,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",2,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",3,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",4,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",5,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",6,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",7,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",8,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",9,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}}],"data":{"employees":[null,null,null,null,null,null,null,null,null,null]},"extensions":{"authorization":{"missingScopes":[{"coordinate":{"typeName":"Employee","fieldName":"startDate"},"required":[["read:employee","read:private"],["read:all"]]}],"actualScopes":["read:employee"]}}}`, string(data))
		})
	})

	t.Run("reject unauthorized fails the whole operation", func(t *testing.T) {
		t.Parallel()

		accessController, authServer := newAccessController(t)

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(accessController),
				core.WithAuthorizationConfig(&config.AuthorizationConfiguration{
					EnablePreFetchFieldAuthorization: true,
					RejectOperationIfUnauthorized:    true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			token, err := authServer.Token(map[string]any{
				"scope": "read:employee",
			})
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQueryBodyRequiringClaims))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			data = bytes.TrimSpace(data)
			require.Equal(t, `{"errors":[{"message":"Unauthorized"}],"data":null,"extensions":{"authorization":{"missingScopes":[{"coordinate":{"typeName":"Employee","fieldName":"startDate"},"required":[["read:employee","read:private"],["read:all"]]}],"actualScopes":["read:employee"]}}}`, string(data))
		})
	})

	t.Run("nullable field is nulled while the rest of the data is returned", func(t *testing.T) {
		t.Parallel()

		accessController, authServer := newAccessController(t)

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(accessController),
				core.WithAuthorizationConfig(&config.AuthorizationConfiguration{
					EnablePreFetchFieldAuthorization: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Query.secret is nullable and protected by @requiresScopes(read:secret); the token lacks
			// that scope, so only secret is nulled while the sibling root field is still resolved.
			token, err := authServer.Token(map[string]any{
				"scope": "read:employee",
			})
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(`{"query":"{ secret { value } floatField(arg: 1.5) }"}`))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Unauthorized to load field 'Query.secret', Reason: missing required scopes.","path":["secret"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}}],"data":{"secret":null,"floatField":1.5},"extensions":{"authorization":{"missingScopes":[{"coordinate":{"typeName":"Query","fieldName":"secret"},"required":[["read:secret"]]}],"actualScopes":["read:employee"]}}}`, string(data))
		})
	})
}
