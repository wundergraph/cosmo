package integration_test

import (
	"bytes"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/jwks"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

const (
	jwksName                      = "my-jwks-server"
	employeesQuery                = `{"query":"{ employees { id } }"}`
	employeesQueryRequiringClaims = `{"query":"{ employees { id startDate } }"}`
	employeesExpectedData         = `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`
	unauthorizedExpectedData      = `{"errors":[{"message":"unauthorized"}],"data":null}`
	xAuthenticatedByHeader        = "X-Authenticated-By"
)

func configureAuth(t *testing.T) ([]authentication.Authenticator, *jwks.Server) {
	authServer, err := jwks.NewServer(t)
	require.NoError(t, err)
	t.Cleanup(authServer.Close)
	authOptions := authentication.JWKSAuthenticatorOptions{
		Name: jwksName,
		URL:  authServer.JWKSURL(),
	}
	authenticator, err := authentication.NewJWKSAuthenticator(authOptions)
	require.NoError(t, err)
	return []authentication.Authenticator{authenticator}, authServer
}

func TestAuthentication(t *testing.T) {
	t.Parallel()

	t.Run("no token", func(t *testing.T) {
		t.Parallel()

		authenticators, _ := configureAuth(t)

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations without token should succeed
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", nil, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, "", res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, employeesExpectedData, string(data))
		})
	})

	t.Run("invalid token", func(t *testing.T) {
		t.Parallel()

		authenticators, _ := configureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with an invalid token should fail
			header := http.Header{
				"Authorization": []string{"Bearer invalid"},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusUnauthorized, res.StatusCode)
			require.Equal(t, "", res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, unauthorizedExpectedData, string(data))
		})
	})

	t.Run("valid token", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := configureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with a token should succeed
			token, err := authServer.Token(nil)
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, jwksName, res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, employeesExpectedData, string(data))
		})
	})

	t.Run("scopes required no token", func(t *testing.T) {
		t.Parallel()

		authenticators, _ := configureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", nil, strings.NewReader(employeesQueryRequiringClaims))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",0,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",1,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",2,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",3,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",4,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",5,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",6,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",7,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",8,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",9,"startDate"]}],"data":{"employees":[null,null,null,null,null,null,null,null,null,null]}}`, string(data))
		})
	})
	t.Run("scopes required valid token no scopes", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := configureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
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
			require.Equal(t, `{"errors":[{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",0,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",1,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",2,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",3,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",4,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",5,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",6,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",7,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",8,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",9,"startDate"]}],"data":{"employees":[null,null,null,null,null,null,null,null,null,null]},"extensions":{"authorization":{"missingScopes":[{"coordinate":{"typeName":"Employee","fieldName":"startDate"},"required":[["read:employee","read:private"],["read:all"]]}],"actualScopes":[]}}}`, string(data))
		})
	})
	t.Run("scopes required valid token AND scopes present", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := configureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
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
			require.Equal(t, `{"data":{"employees":[{"id":1,"startDate":"January 2020"},{"id":2,"startDate":"July 2022"},{"id":3,"startDate":"June 2021"},{"id":4,"startDate":"July 2022"},{"id":5,"startDate":"July 2022"},{"id":7,"startDate":"September 2022"},{"id":8,"startDate":"September 2022"},{"id":10,"startDate":"November 2022"},{"id":11,"startDate":"November 2022"},{"id":12,"startDate":"December 2022"}]}}`, string(data))
		})
	})
	t.Run("scopes required valid token AND scopes partially present", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := configureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with an token should succeed
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
			require.Equal(t, jwksName, res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",0,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",1,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",2,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",3,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",4,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",5,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",6,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",7,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",8,"startDate"]},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",9,"startDate"]}],"data":{"employees":[null,null,null,null,null,null,null,null,null,null]},"extensions":{"authorization":{"missingScopes":[{"coordinate":{"typeName":"Employee","fieldName":"startDate"},"required":[["read:employee","read:private"],["read:all"]]}],"actualScopes":["read:employee"]}}}`, string(data))
		})
	})
	t.Run("reject unauthorized missing scope", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := configureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
				core.WithAuthorizationConfig(&config.AuthorizationConfiguration{
					RejectOperationIfUnauthorized: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with a token should succeed
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
			require.Equal(t, jwksName, res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			data = bytes.TrimSpace(data)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Unauthorized"}],"data":null,"extensions":{"authorization":{"missingScopes":[{"coordinate":{"typeName":"Employee","fieldName":"startDate"},"required":[["read:employee","read:private"],["read:all"]]}],"actualScopes":["read:employee"]}}}`, string(data))
		})
	})
	t.Run("reject unauthorized no scope", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := configureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
				core.WithAuthorizationConfig(&config.AuthorizationConfiguration{
					RejectOperationIfUnauthorized: true,
				}),
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
			data = bytes.TrimSpace(data)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Unauthorized"}],"data":null,"extensions":{"authorization":{"missingScopes":[{"coordinate":{"typeName":"Employee","fieldName":"startDate"},"required":[["read:employee","read:private"],["read:all"]]}],"actualScopes":[]}}}`, string(data))
		})
	})
	t.Run("reject unauthorized invalid token", func(t *testing.T) {
		t.Parallel()

		authenticators, _ := configureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
				core.WithAuthorizationConfig(&config.AuthorizationConfiguration{
					RejectOperationIfUnauthorized: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with a token should succeed
			header := http.Header{
				"Authorization": []string{"Bearer token"},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQueryRequiringClaims))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusUnauthorized, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"unauthorized"}],"data":null}`, string(data))
		})
	})
	t.Run("reject unauthorized no token", func(t *testing.T) {
		t.Parallel()

		authenticators, _ := configureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
				core.WithAuthorizationConfig(&config.AuthorizationConfiguration{
					RejectOperationIfUnauthorized: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with a token should succeed
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", nil, strings.NewReader(employeesQueryRequiringClaims))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			data = bytes.TrimSpace(data)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Unauthorized"}],"data":null}`, string(data))
		})
	})
	t.Run("scopes required valid token OR scopes present", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := configureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with a token should succeed
			token, err := authServer.Token(map[string]any{
				"scope": "read:all",
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
	t.Run("scopes required valid token AND and OR scopes present", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := configureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with a token should succeed
			token, err := authServer.Token(map[string]any{
				"scope": "read:employee read:private read:all",
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
	t.Run("non-nullable, unauthorized data returns no data even if some is authorized", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := configureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with a token should succeed
			token, err := authServer.Token(map[string]any{
				"scope": "read:fact read:miscellaneous",
			})
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(`
				{"query":"{ topSecretFederationFacts { ... on EntityFact { description } ... on MiscellaneousFact { title description } } }"}
			`))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, jwksName, res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Unauthorized to load field 'Query.topSecretFederationFacts.description', Reason: missing required scopes.","path":["topSecretFederationFacts",2,"description"]}],"data":null,"extensions":{"authorization":{"missingScopes":[{"coordinate":{"typeName":"EntityFact","fieldName":"description"},"required":[["read:entity","read:scalar"],["read:entity","read:all"]]}],"actualScopes":["read:fact","read:miscellaneous"]}}}`, string(data))
		})
	})
	t.Run("return unauthenticated error if a field requiring authentication is queried", func(t *testing.T) {
		t.Parallel()

		authenticators, _ := configureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", nil, strings.NewReader(`
				{"query":"{ factTypes }"}
			`))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Unauthorized to load field 'Query.factTypes', Reason: not authenticated.","path":["factTypes"]}],"data":{"factTypes":null}}`, string(data))
		})
	})
	t.Run("nullable, unauthenticated data returns an error but partial data that does not require authentication is returned", func(t *testing.T) {
		t.Parallel()

		authenticators, _ := configureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", nil, strings.NewReader(`
				{"query":"{ factTypes productTypes { ... on Cosmo { upc } } }"}
			`))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Unauthorized to load field 'Query.factTypes', Reason: not authenticated.","path":["factTypes"]}],"data":{"factTypes":null,"productTypes":[{"upc":"cosmo"},{},{}]}}`, string(data))
		})
	})
	t.Run("nullable, unauthenticated data returns an error but partial data that does not require authentication is returned (reordered fields)", func(t *testing.T) {
		t.Parallel()

		authenticators, _ := configureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", nil, strings.NewReader(`
				{"query":"{ productTypes { ... on Cosmo { upc } } factTypes }"}
			`))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Unauthorized to load field 'Query.factTypes', Reason: not authenticated.","path":["factTypes"]}],"data":{"productTypes":[{"upc":"cosmo"},{},{}],"factTypes":null}}`, string(data))
		})
	})
	t.Run("data requiring authentication is returned when authenticated", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := configureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			token, err := authServer.Token(nil)
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(`
				{"query":"{ factTypes productTypes { ... on Cosmo { upc } } }"}
			`))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"data":{"factTypes":["DIRECTIVE","ENTITY","MISCELLANEOUS"],"productTypes":[{"upc":"cosmo"},{},{}]}}`, string(data))
		})
	})
	t.Run("mutation with valid scopes", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := configureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			token, err := authServer.Token(map[string]any{
				"scope": "write:fact read:miscellaneous read:all",
			})
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(`
				{"query":"mutation { addFact(fact: { title: \"title\", description: \"description\", factType: MISCELLANEOUS }) { ... on MiscellaneousFact { title description } } }"}
			`))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"data":{"addFact":{"title":"title","description":"description"}}}`, string(data))
		})
	})
	t.Run("mutation with scope missing for response field", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := configureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			token, err := authServer.Token(map[string]any{
				"scope": "write:fact read:miscellaneous",
			})
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(`
				{"query":"mutation { addFact(fact: { title: \"title\", description: \"description\", factType: MISCELLANEOUS }) { ... on MiscellaneousFact { title description } } }"}
			`))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Unauthorized to load field 'Mutation.addFact.description', Reason: missing required scopes.","path":["addFact","description"]}],"data":null,"extensions":{"authorization":{"missingScopes":[{"coordinate":{"typeName":"MiscellaneousFact","fieldName":"description"},"required":[["read:miscellaneous","read:scalar"],["read:miscellaneous","read:all"]]}],"actualScopes":["write:fact","read:miscellaneous"]}}}`, string(data))
		})
	})
	t.Run("mutation with scope missing for mutation root field", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := configureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			token, err := authServer.Token(map[string]any{
				"scope": "read:miscellaneous read:all",
			})
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(`
				{"query":"mutation { addFact(fact: { title: \"title\", description: \"description\", factType: MISCELLANEOUS }) { ... on MiscellaneousFact { title description } } }"}
			`))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Unauthorized request to Subgraph '3', Reason: missing required scopes."},{"message":"Unauthorized to load field 'Mutation.addFact', Reason: missing required scopes.","path":["addFact"]}],"data":null,"extensions":{"authorization":{"missingScopes":[{"coordinate":{"typeName":"Mutation","fieldName":"addFact"},"required":[["write:fact"],["write:all"]]}],"actualScopes":["read:miscellaneous","read:all"]}}}`, string(data))
		})
	})
	t.Run("mutation with scope missing for mutation root field (with reject)", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := configureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
				core.WithAuthorizationConfig(&config.AuthorizationConfiguration{
					RejectOperationIfUnauthorized: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			token, err := authServer.Token(map[string]any{
				"scope": "read:miscellaneous read:all",
			})
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(`
				{"query":"mutation { addFact(fact: { title: \"title\", description: \"description\", factType: MISCELLANEOUS }) { ... on MiscellaneousFact { title description } } }"}
			`))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			data = bytes.TrimSpace(data)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Unauthorized"}],"data":null,"extensions":{"authorization":{"missingScopes":[{"coordinate":{"typeName":"Mutation","fieldName":"addFact"},"required":[["write:fact"],["write:all"]]}],"actualScopes":["read:miscellaneous","read:all"]}}}`, string(data))
		})
	})
}

func TestAuthenticationWithCustomHeaders(t *testing.T) {
	t.Parallel()

	const (
		headerName        = "X-My-Header"
		headerValuePrefix = "Token"
	)

	authServer, err := jwks.NewServer(t)
	require.NoError(t, err)
	t.Cleanup(authServer.Close)
	authOptions := authentication.JWKSAuthenticatorOptions{
		Name:                jwksName,
		URL:                 authServer.JWKSURL(),
		HeaderNames:         []string{headerName},
		HeaderValuePrefixes: []string{headerValuePrefix},
	}
	authenticator, err := authentication.NewJWKSAuthenticator(authOptions)
	require.NoError(t, err)
	authenticators := []authentication.Authenticator{authenticator}

	token, err := authServer.Token(nil)
	require.NoError(t, err)

	runTest := func(t *testing.T, headerValue string) {
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {

			header := http.Header{
				headerName: []string{headerValue},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, jwksName, res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, employeesExpectedData, string(data))
		})
	}

	t.Run("with space", func(t *testing.T) {
		t.Parallel()

		runTest(t, headerValuePrefix+" "+token)
	})

	t.Run("without space", func(t *testing.T) {
		t.Parallel()

		runTest(t, headerValuePrefix+token)
	})
}

func TestAuthorization(t *testing.T) {
	t.Parallel()

	t.Run("no token", func(t *testing.T) {
		t.Parallel()

		authenticators, _ := configureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, true)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations without token should fail
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", nil, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusUnauthorized, res.StatusCode)
			require.Equal(t, "", res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.JSONEq(t, unauthorizedExpectedData, string(data))
		})
	})

	t.Run("invalid token", func(t *testing.T) {
		t.Parallel()

		authenticators, _ := configureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, true)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with an invalid token should fail
			header := http.Header{
				"Authorization": []string{"Bearer invalid"},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusUnauthorized, res.StatusCode)
			require.Equal(t, "", res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.JSONEq(t, unauthorizedExpectedData, string(data))
		})
	})

	t.Run("valid token", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := configureAuth(t)
		token, err := authServer.Token(nil)
		require.NoError(t, err)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, true)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with a token should succeed
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, jwksName, res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, employeesExpectedData, string(data))
		})
	})
}

func TestAuthenticationMultipleProviders(t *testing.T) {
	t.Parallel()

	authServer1, err := jwks.NewServer(t)
	require.NoError(t, err)
	t.Cleanup(authServer1.Close)

	authServer2, err := jwks.NewServer(t)
	require.NoError(t, err)
	t.Cleanup(authServer2.Close)

	authenticator1HeaderValuePrefixes := []string{"Bearer"}
	authenticator1, err := authentication.NewJWKSAuthenticator(authentication.JWKSAuthenticatorOptions{
		Name:                "1",
		HeaderValuePrefixes: authenticator1HeaderValuePrefixes,
		URL:                 authServer1.JWKSURL(),
	})
	require.NoError(t, err)

	authenticator2HeaderValuePrefixes := []string{"", "Bearer", "Token"}
	authenticator2, err := authentication.NewJWKSAuthenticator(authentication.JWKSAuthenticatorOptions{
		Name:                "2",
		HeaderValuePrefixes: authenticator2HeaderValuePrefixes,
		URL:                 authServer2.JWKSURL(),
	})
	require.NoError(t, err)
	authenticators := []authentication.Authenticator{authenticator1, authenticator2}
	accessController := core.NewAccessController(authenticators, false)

	t.Run("authenticate with first provider", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(accessController),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			for _, prefix := range authenticator1HeaderValuePrefixes {
				prefix := prefix
				t.Run("prefix "+prefix, func(t *testing.T) {
					token, err := authServer1.Token(nil)
					require.NoError(t, err)
					header := http.Header{
						"Authorization": []string{prefix + token},
					}
					res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
					require.NoError(t, err)
					defer res.Body.Close()
					require.Equal(t, http.StatusOK, res.StatusCode)
					require.Equal(t, "1", res.Header.Get(xAuthenticatedByHeader))
					data, err := io.ReadAll(res.Body)
					require.NoError(t, err)
					require.Equal(t, employeesExpectedData, string(data))
				})
			}
		})
	})

	t.Run("authenticate with second provider", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(accessController),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			for _, prefix := range authenticator2HeaderValuePrefixes {
				prefix := prefix
				t.Run("prefix "+prefix, func(t *testing.T) {
					token, err := authServer2.Token(nil)
					require.NoError(t, err)
					header := http.Header{
						"Authorization": []string{prefix + token},
					}
					res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
					require.NoError(t, err)
					defer res.Body.Close()
					require.Equal(t, http.StatusOK, res.StatusCode)
					require.Equal(t, "2", res.Header.Get(xAuthenticatedByHeader))
					data, err := io.ReadAll(res.Body)
					require.NoError(t, err)
					require.Equal(t, employeesExpectedData, string(data))
				})
			}
		})
	})

	t.Run("invalid token", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(accessController),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := http.Header{
				"Authorization": []string{"Bearer invalid"},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusUnauthorized, res.StatusCode)
			require.Equal(t, "", res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.JSONEq(t, unauthorizedExpectedData, string(data))
		})
	})
}

func TestAuthenticationOverWebsocket(t *testing.T) {
	t.Parallel()

	authServer, err := jwks.NewServer(t)
	require.NoError(t, err)
	defer authServer.Close()

	jwksOpts := authentication.JWKSAuthenticatorOptions{
		Name: jwksName,
		URL:  authServer.JWKSURL(),
	}

	authenticator, err := authentication.NewJWKSAuthenticator(jwksOpts)
	require.NoError(t, err)
	authenticators := []authentication.Authenticator{authenticator}

	testenv.Run(t, &testenv.Config{
		RouterOptions: []core.Option{
			core.WithAccessController(core.NewAccessController(authenticators, true)),
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {

		conn, res, err := xEnv.GraphQLWebsocketDialWithRetry(nil, nil)
		require.Nil(t, conn)
		require.Error(t, err)
		require.Equal(t, http.StatusUnauthorized, res.StatusCode)

		token, err := authServer.Token(nil)
		require.NoError(t, err)

		headers := http.Header{
			"Authorization": []string{"Bearer " + token},
		}
		conn, res, err = xEnv.GraphQLWebsocketDialWithRetry(headers, nil)
		defer func() {
			require.NoError(t, conn.Close())
		}()

		require.NoError(t, err)
		require.Equal(t, http.StatusSwitchingProtocols, res.StatusCode)
	})
}
