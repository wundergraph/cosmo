package integration

import (
	"bytes"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"github.com/golang-jwt/jwt/v5"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/MicahParks/jwkset"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/jwks"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
)

const (
	employeesQuery                = `{"query":"{ employees { id } }"}`
	employeesQueryRequiringClaims = `{"query":"{ employees { id startDate } }"}`
	employeesExpectedData         = `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`
	unauthorizedExpectedData      = `{"errors":[{"message":"unauthorized"}]}`
	xAuthenticatedByHeader        = "X-Authenticated-By"
)

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
			require.Equal(t, `{"errors":[{"message":"unauthorized"}]}`, string(data))
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
			require.Equal(t, `{"errors":[{"message":"Unauthorized request to Subgraph 'products', Reason: missing required scopes."},{"message":"Unauthorized to load field 'Mutation.addFact', Reason: missing required scopes.","path":["addFact"]}],"data":null,"extensions":{"authorization":{"missingScopes":[{"coordinate":{"typeName":"Mutation","fieldName":"addFact"},"required":[["write:fact"],["write:all"]]}],"actualScopes":["read:miscellaneous","read:all"]}}}`, string(data))
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

	tokenDecoder, _ := authentication.NewJwksTokenDecoder(NewContextWithCancel(t), zap.NewNop(), []authentication.JWKSConfig{toJWKSConfig(authServer.JWKSURL(), time.Second*5)})
	authOptions := authentication.HttpHeaderAuthenticatorOptions{
		Name:                jwksName,
		HeaderNames:         []string{headerName},
		HeaderValuePrefixes: []string{headerValuePrefix},
		TokenDecoder:        tokenDecoder,
	}
	authenticator, err := authentication.NewHttpHeaderAuthenticator(authOptions)
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

	tokenDecoder1, _ := authentication.NewJwksTokenDecoder(NewContextWithCancel(t), zap.NewNop(), []authentication.JWKSConfig{toJWKSConfig(authServer1.JWKSURL(), time.Second*5)})
	authenticator1HeaderValuePrefixes := []string{"Provider1"}
	authenticator1, err := authentication.NewHttpHeaderAuthenticator(authentication.HttpHeaderAuthenticatorOptions{
		Name:                "1",
		HeaderValuePrefixes: authenticator1HeaderValuePrefixes,
		TokenDecoder:        tokenDecoder1,
	})
	require.NoError(t, err)

	tokenDecoder2, _ := authentication.NewJwksTokenDecoder(NewContextWithCancel(t), zap.NewNop(), []authentication.JWKSConfig{toJWKSConfig(authServer2.JWKSURL(), time.Second*5)})
	authenticator2HeaderValuePrefixes := []string{"", "Provider2"}
	authenticator2, err := authentication.NewHttpHeaderAuthenticator(authentication.HttpHeaderAuthenticatorOptions{
		Name:                "2",
		HeaderValuePrefixes: authenticator2HeaderValuePrefixes,
		TokenDecoder:        tokenDecoder2,
	})
	require.NoError(t, err)
	authenticators := []authentication.Authenticator{authenticator1, authenticator2}
	accessController := core.NewAccessController(authenticators, false)

	t.Run("authenticate with first provider due to matching prefix", func(t *testing.T) {
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

	t.Run("authenticate with second provider due to matching prefix", func(t *testing.T) {
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

	t.Run("should fail to create TokenDecoder with RSA algorithm when only HS256 is allowed", func(t *testing.T) {
		t.Parallel()

		authServer, err := jwks.NewServer(t)
		require.NoError(t, err)
		t.Cleanup(authServer.Close)

		_, err = authentication.NewJwksTokenDecoder(NewContextWithCancel(t), zap.NewNop(),
			[]authentication.JWKSConfig{
				toJWKSConfig(authServer.JWKSURL(), time.Second*5, "HS256"), // Allow only HS256. RSA should be denied
			},
		)

		require.Error(t, err)
	})
}

func TestAlgorithmMismatch(t *testing.T) {
	t.Parallel()

	testSetup := func(t *testing.T, crypto jwks.Crypto) (string, []authentication.Authenticator) {
		t.Helper()

		authServer, err := jwks.NewServerWithCrypto(t, crypto)
		require.NoError(t, err)
		t.Cleanup(authServer.Close)

		tokenDecoder, err := authentication.NewJwksTokenDecoder(NewContextWithCancel(t), zap.NewNop(), []authentication.JWKSConfig{toJWKSConfig(authServer.JWKSURL(), time.Second*5)})
		require.NoError(t, err)

		authOptions := authentication.HttpHeaderAuthenticatorOptions{
			Name:         jwksName,
			TokenDecoder: tokenDecoder,
		}
		authenticator, err := authentication.NewHttpHeaderAuthenticator(authOptions)
		require.NoError(t, err)

		authenticators := []authentication.Authenticator{authenticator}

		token, err := authServer.TokenForKID(crypto.KID(), nil)
		require.NoError(t, err)

		return token, authenticators
	}

	t.Run("should prevent access with invalid algorithm", func(t *testing.T) {
		// create a crypto for RSA
		rsaCrypto, err := jwks.NewRSACrypto("", jwkset.AlgRS256, 2048)
		require.NoError(t, err)

		// We are not using the provided token here as we want to test the algorithm mismatch
		_, authenticators := testSetup(t, rsaCrypto)

		// sign a token with an HMAC algorithm using the RSA key in PEM format
		// Unlike RSA, HMAC is a symmetric algorithm and the key is the same for signing and verifying
		// Therefore we can try to use the public key as the HMAC key to sign a token.
		signer := jwt.New(jwt.SigningMethodHS256)

		signer.Header[jwkset.HeaderKID] = rsaCrypto.KID()

		publicKey := rsaCrypto.PrivateKey().(*rsa.PrivateKey).PublicKey
		publicKeyPEM := &pem.Block{
			Type:  "RSA PUBLIC KEY",
			Bytes: x509.MarshalPKCS1PublicKey(&publicKey),
		}

		token, err := signer.SignedString(pem.EncodeToMemory(publicKeyPEM))
		require.NoError(t, err)

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, true)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operation with forged token should fail
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}

			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			require.Equal(t, http.StatusUnauthorized, res.StatusCode)
		})
	})

	t.Run("Should not allow none algorithm", func(t *testing.T) {
		t.Parallel()

		rsaCrypto, err := jwks.NewRSACrypto("", jwkset.AlgRS256, 2048)
		require.NoError(t, err)

		// We will create a token with none algorithm
		_, authenticators := testSetup(t, rsaCrypto)

		token, err := jwt.New(jwt.SigningMethodNone).SignedString(jwt.UnsafeAllowNoneSignatureType)
		require.NoError(t, err)

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, true)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}

			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusUnauthorized, res.StatusCode)
		})
	})
}

func TestMultipleKeys(t *testing.T) {
	t.Parallel()

	testAuthentication := func(t *testing.T, xEnv *testenv.Environment, token string) {
		t.Helper()

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

		// Operation without a token should fail
		res, err = xEnv.MakeRequest(http.MethodPost, "/graphql", nil, strings.NewReader(employeesQuery))
		require.NoError(t, err)
		require.Equal(t, http.StatusUnauthorized, res.StatusCode)
	}

	testSetup := func(t *testing.T, crypto ...jwks.Crypto) (map[string]string, []authentication.Authenticator) {
		t.Helper()

		authServer, err := jwks.NewServerWithCrypto(t, crypto...)
		require.NoError(t, err)

		t.Cleanup(authServer.Close)

		tokenDecoder, err := authentication.NewJwksTokenDecoder(NewContextWithCancel(t), zap.NewNop(), []authentication.JWKSConfig{toJWKSConfig(authServer.JWKSURL(), time.Second*5)})
		require.NoError(t, err)

		authOptions := authentication.HttpHeaderAuthenticatorOptions{
			Name:         jwksName,
			TokenDecoder: tokenDecoder,
		}
		authenticator, err := authentication.NewHttpHeaderAuthenticator(authOptions)
		require.NoError(t, err)

		authenticators := []authentication.Authenticator{authenticator}

		tokens := make(map[string]string)

		for _, c := range crypto {
			token, err := authServer.TokenForKID(c.KID(), nil)
			require.NoError(t, err)

			tokens[c.KID()] = token
		}

		return tokens, authenticators
	}

	t.Run("Test with multiple asymmetric keys", func(t *testing.T) {
		t.Parallel()

		t.Run("Should succeed with multiple RSA keys", func(t *testing.T) {
			t.Parallel()

			rsa1, err := jwks.NewRSACrypto("", jwkset.AlgRS256, 2048)
			require.NoError(t, err)

			rsa2, err := jwks.NewRSACrypto("", jwkset.AlgRS512, 2048)
			require.NoError(t, err)

			tokens, authenticators := testSetup(t, rsa1, rsa2)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				for _, token := range tokens {
					testAuthentication(t, xEnv, token)
				}
			})
		})

		t.Run("Should succeed with multiple ECDSA keys", func(t *testing.T) {
			t.Parallel()

			ec1, err := jwks.NewES256Crypto("")
			require.NoError(t, err)

			ec2, err := jwks.NewES384Crypto("")
			require.NoError(t, err)

			tokens, authenticators := testSetup(t, ec1, ec2)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				for _, token := range tokens {
					testAuthentication(t, xEnv, token)
				}
			})
		})

		t.Run("Should succeed with RSA and ECDSA keys", func(t *testing.T) {
			t.Parallel()

			rsa, err := jwks.NewRSACrypto("", jwkset.AlgRS256, 2048)
			require.NoError(t, err)

			ec, err := jwks.NewES256Crypto("")
			require.NoError(t, err)

			tokens, authenticators := testSetup(t, rsa, ec)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				for _, token := range tokens {
					testAuthentication(t, xEnv, token)
				}
			})
		})
	})

	t.Run("Test with multiple symmetric keys", func(t *testing.T) {
		t.Parallel()

		t.Run("Should succeed with multiple HS256 keys", func(t *testing.T) {
			t.Parallel()

			hs1, err := jwks.NewHMACCrypto("", jwkset.AlgHS256)
			require.NoError(t, err)

			hs2, err := jwks.NewHMACCrypto("", jwkset.AlgHS256)
			require.NoError(t, err)

			tokens, authenticators := testSetup(t, hs1, hs2)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				for _, token := range tokens {
					testAuthentication(t, xEnv, token)
				}
			})
		})
	})

	t.Run("Test with symmetric and asymmetric keys", func(t *testing.T) {
		t.Parallel()

		t.Run("Should succeed with RSA and HS256 keys", func(t *testing.T) {
			t.Parallel()

			rsa, err := jwks.NewRSACrypto("", jwkset.AlgRS256, 2048)
			require.NoError(t, err)

			hs, err := jwks.NewHMACCrypto("", jwkset.AlgHS256)
			require.NoError(t, err)

			tokens, authenticators := testSetup(t, rsa, hs)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				for _, token := range tokens {
					testAuthentication(t, xEnv, token)
				}
			})
		})
	})
}

func TestSupportedAlgorithms(t *testing.T) {
	t.Parallel()

	testAuthentication := func(t *testing.T, xEnv *testenv.Environment, token string) {
		t.Helper()

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

		// Operation without a token should fail
		res, err = xEnv.MakeRequest(http.MethodPost, "/graphql", nil, strings.NewReader(employeesQuery))
		require.NoError(t, err)
		require.Equal(t, http.StatusUnauthorized, res.StatusCode)
	}

	testSetup := func(t *testing.T, crypto jwks.Crypto) (string, []authentication.Authenticator) {
		t.Helper()

		authServer, err := jwks.NewServerWithCrypto(t, crypto)
		require.NoError(t, err)
		t.Cleanup(authServer.Close)

		tokenDecoder, err := authentication.NewJwksTokenDecoder(NewContextWithCancel(t), zap.NewNop(), []authentication.JWKSConfig{toJWKSConfig(authServer.JWKSURL(), time.Second*5)})
		require.NoError(t, err)

		authOptions := authentication.HttpHeaderAuthenticatorOptions{
			Name:         jwksName,
			TokenDecoder: tokenDecoder,
		}
		authenticator, err := authentication.NewHttpHeaderAuthenticator(authOptions)
		require.NoError(t, err)

		authenticators := []authentication.Authenticator{authenticator}

		token, err := authServer.TokenForKID(crypto.KID(), nil)
		require.NoError(t, err)

		return token, authenticators
	}

	t.Run("RSA Tests", func(t *testing.T) {
		t.Parallel()

		t.Run("Test authentication with RSA 256", func(t *testing.T) {
			t.Parallel()

			rsaCrypto, err := jwks.NewRSACrypto("", jwkset.AlgRS256, 2048)
			require.NoError(t, err)

			token, authenticators := testSetup(t, rsaCrypto)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				testAuthentication(t, xEnv, token)
			})
		})

		t.Run("Test authentication with RSA 384", func(t *testing.T) {
			t.Parallel()

			rsaCrypto, err := jwks.NewRSACrypto("", jwkset.AlgRS384, 2048)
			require.NoError(t, err)

			token, authenticators := testSetup(t, rsaCrypto)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				testAuthentication(t, xEnv, token)
			})
		})

		t.Run("Test authentication with RSA 512", func(t *testing.T) {
			t.Parallel()

			rsaCrypto, err := jwks.NewRSACrypto("", jwkset.AlgRS512, 2048)
			require.NoError(t, err)

			token, authenticators := testSetup(t, rsaCrypto)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				testAuthentication(t, xEnv, token)
			})
		})

		t.Run("Test authentication with RSA 256 PSS", func(t *testing.T) {
			t.Parallel()

			rsaCrypto, err := jwks.NewRSACrypto("", jwkset.AlgPS256, 2048)
			require.NoError(t, err)

			token, authenticators := testSetup(t, rsaCrypto)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				testAuthentication(t, xEnv, token)
			})
		})

		t.Run("Test authentication with RSA 384 PSS", func(t *testing.T) {
			t.Parallel()

			rsaCrypto, err := jwks.NewRSACrypto("", jwkset.AlgPS384, 2048)
			require.NoError(t, err)

			token, authenticators := testSetup(t, rsaCrypto)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				testAuthentication(t, xEnv, token)
			})
		})

		t.Run("Test authentication with RSA 512 PSS", func(t *testing.T) {
			t.Parallel()

			rsaCrypto, err := jwks.NewRSACrypto("", jwkset.AlgPS512, 2048)
			require.NoError(t, err)

			token, authenticators := testSetup(t, rsaCrypto)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				testAuthentication(t, xEnv, token)
			})
		})
	})

	t.Run("HMAC Tests", func(t *testing.T) {
		t.Parallel()

		t.Run("Test authentication with HMAC 256", func(t *testing.T) {
			t.Parallel()

			hmac, err := jwks.NewHMACCrypto("", jwkset.AlgHS256)
			require.NoError(t, err)

			token, authenticators := testSetup(t, hmac)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				testAuthentication(t, xEnv, token)
			})
		})

		t.Run("Test authentication with HMAC 384", func(t *testing.T) {
			t.Parallel()

			hmac, err := jwks.NewHMACCrypto("", jwkset.AlgHS384)
			require.NoError(t, err)

			token, authenticators := testSetup(t, hmac)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				testAuthentication(t, xEnv, token)
			})
		})

		t.Run("Test authentication with HMAC 512", func(t *testing.T) {
			t.Parallel()

			hmac, err := jwks.NewHMACCrypto("", jwkset.AlgHS512)
			require.NoError(t, err)

			token, authenticators := testSetup(t, hmac)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				testAuthentication(t, xEnv, token)
			})
		})
	})

	t.Run("ED25519 Tests", func(t *testing.T) {
		t.Parallel()

		t.Run("Test authentication with ED25519", func(t *testing.T) {
			t.Parallel()

			ed25519Crypto, err := jwks.NewED25519Crypto("")
			require.NoError(t, err)

			token, authenticators := testSetup(t, ed25519Crypto)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				testAuthentication(t, xEnv, token)
			})
		})
	})

	t.Run("ECDSA Tests", func(t *testing.T) {
		t.Parallel()

		t.Run("Test authentication with ES256", func(t *testing.T) {
			t.Parallel()

			es256Crypto, err := jwks.NewES256Crypto("")
			require.NoError(t, err)

			token, authenticators := testSetup(t, es256Crypto)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				testAuthentication(t, xEnv, token)
			})
		})

		t.Run("Test authentication with ES384", func(t *testing.T) {
			t.Parallel()

			es384Crypto, err := jwks.NewES384Crypto("")
			require.NoError(t, err)

			token, authenticators := testSetup(t, es384Crypto)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				testAuthentication(t, xEnv, token)
			})
		})

		t.Run("Test authentication with ES512", func(t *testing.T) {
			t.Parallel()

			es512Crypto, err := jwks.NewES512Crypto("")
			require.NoError(t, err)

			token, authenticators := testSetup(t, es512Crypto)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				testAuthentication(t, xEnv, token)
			})
		})
	})

}

func TestAuthenticationOverWebsocket(t *testing.T) {
	t.Parallel()

	authServer, err := jwks.NewServer(t)
	require.NoError(t, err)
	defer authServer.Close()

	tokenDecoder, _ := authentication.NewJwksTokenDecoder(NewContextWithCancel(t), zap.NewNop(), []authentication.JWKSConfig{toJWKSConfig(authServer.JWKSURL(), time.Second*5)})
	jwksOpts := authentication.HttpHeaderAuthenticatorOptions{
		Name:         jwksName,
		TokenDecoder: tokenDecoder,
	}

	authenticator, err := authentication.NewHttpHeaderAuthenticator(jwksOpts)
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

func toJWKSConfig(url string, refresh time.Duration, allowedAlgorithms ...string) authentication.JWKSConfig {
	return authentication.JWKSConfig{
		URL:               url,
		RefreshInterval:   refresh,
		AllowedAlgorithms: allowedAlgorithms,
	}
}
