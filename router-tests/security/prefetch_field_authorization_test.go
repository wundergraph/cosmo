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

	costControlMeasure := func(securityConfiguration *config.SecurityConfiguration) {
		securityConfiguration.CostControl = &config.CostControl{
			Enabled:       true,
			Mode:          config.CostControlModeMeasure,
			ExposeHeaders: true,
		}
	}

	t.Run("authorized request returns full data and is charged full actual cost", func(t *testing.T) {
		t.Parallel()

		accessController, authServer := newAccessController(t)

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(accessController),
				core.WithAuthorizationConfig(&config.AuthorizationConfiguration{
					EnablePreFetchFieldAuthorization: true,
				}),
			},
			ModifySecurityConfiguration: costControlMeasure,
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

			// employees has @listSize(assumedSize: 50): estimated = 50 * employees(1).
			// Actual charges the 10 delivered elements: 10 * employees(1).
			require.Equal(t, "50", res.Header.Get(core.CostEstimatedHeader))
			require.Equal(t, "10", res.Header.Get(core.CostActualHeader))
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

	t.Run("partial scopes null the unauthorized field and denied fields are not charged", func(t *testing.T) {
		t.Parallel()

		accessController, authServer := newAccessController(t)

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(accessController),
				core.WithAuthorizationConfig(&config.AuthorizationConfiguration{
					EnablePreFetchFieldAuthorization: true,
				}),
			},
			ModifySecurityConfiguration: costControlMeasure,
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

			// Same query as the fully-authorized test above (estimated = 50), but the denied
			// startDate nulls every list element, so no element is delivered and nothing is
			// charged in the actual cost.
			require.Equal(t, "50", res.Header.Get(core.CostEstimatedHeader))
			require.Equal(t, "0", res.Header.Get(core.CostActualHeader))
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

	// The pair of tests below is what distinguishes pre-fetch from the default post-fetch mode:
	// the query is planned as a single fetch whose only root field is denied,
	// so the fetch must be skipped entirely.
	// Without them, the pre-fetch wiring could silently fall back to post-fetch filtering and
	// every response-shape test would still pass.
	t.Run("denied query fetch is skipped before reaching the subgraph", func(t *testing.T) {
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
				"scope": "read:employee",
			})
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(`{"query":"{ secret { value } }"}`))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Unauthorized to load field 'Query.secret', Reason: missing required scopes.","path":["secret"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}}],"data":{"secret":null},"extensions":{"authorization":{"missingScopes":[{"coordinate":{"typeName":"Query","fieldName":"secret"},"required":[["read:secret"]]}],"actualScopes":["read:employee"]}}}`, string(data))
			require.Equal(t, int64(0), xEnv.SubgraphRequestCount.Test1.Load(), "the fetch serves only denied fields and must not reach the subgraph")
		})
	})
	t.Run("control: default post-fetch mode sends the denied query fetch and filters the response", func(t *testing.T) {
		t.Parallel()
		accessController, authServer := newAccessController(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(accessController),
				core.WithAuthorizationConfig(&config.AuthorizationConfiguration{
					EnablePreFetchFieldAuthorization: false,
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
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(`{"query":"{ secret { value } }"}`))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Unauthorized to load field 'Query.secret', Reason: missing required scopes.","path":["secret"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}}],"data":{"secret":null},"extensions":{"authorization":{"missingScopes":[{"coordinate":{"typeName":"Query","fieldName":"secret"},"required":[["read:secret"]]}],"actualScopes":["read:employee"]}}}`, string(data))
			require.Equal(t, int64(1), xEnv.SubgraphRequestCount.Test1.Load(), "default mode fetches the data and filters it out of the response afterwards")
		})
	})

	// The two tests below cover mutations: Mutation.addFact requires write:fact or write:all.
	t.Run("denied mutation is never sent to the subgraph", func(t *testing.T) {
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
				"scope": "read:miscellaneous read:all",
			})
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(`{"query":"mutation { addFact(fact: { title: \"title\", description: \"description\", factType: MISCELLANEOUS }) { ... on MiscellaneousFact { title description } } }"}`))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Unauthorized to load field 'Mutation.addFact', Reason: missing required scopes.","path":["addFact"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}}],"data":null,"extensions":{"authorization":{"missingScopes":[{"coordinate":{"typeName":"Mutation","fieldName":"addFact"},"required":[["write:fact"],["write:all"]]}],"actualScopes":["read:miscellaneous","read:all"]}}}`, string(data))
			require.Equal(t, int64(0), xEnv.SubgraphRequestCount.Products.Load(), "a denied mutation must not be sent to the subgraph")
		})
	})
	t.Run("authorized mutation still executes with pre-fetch enabled", func(t *testing.T) {
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
				"scope": "write:fact read:miscellaneous read:all",
			})
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(`{"query":"mutation { addFact(fact: { title: \"title\", description: \"description\", factType: MISCELLANEOUS }) { ... on MiscellaneousFact { title description } } }"}`))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"data":{"addFact":{"title":"title","description":"description"}}}`, string(data))
			require.Equal(t, int64(1), xEnv.SubgraphRequestCount.Products.Load(), "an authorized mutation must reach the subgraph exactly once")
		})
	})
}
