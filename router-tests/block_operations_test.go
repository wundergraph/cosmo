package integration_test

import (
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestBlockOperations(t *testing.T) {
	t.Parallel()

	t.Run("block mutations", func(t *testing.T) {
		t.Parallel()

		t.Run("should allow all operations", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `mutation { updateEmployeeTag(id: 1, tag: "test") { id tag } }`,
				})
				require.Equal(t, http.StatusOK, res.Response.StatusCode)
				require.Equal(t, `{"data":{"updateEmployeeTag":{"id":1,"tag":"test"}}}`, res.Body)
			})
		})

		t.Run("should block all operations", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.BlockMutations = config.BlockMutationConfiguration{
						Enabled: true,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `mutation { updateEmployeeTag(id: 1, tag: "test") { id tag } }`,
				})
				require.Equal(t, http.StatusOK, res.Response.StatusCode)
				require.Equal(t, `{"errors":[{"message":"operation type 'mutation' is blocked"}]}`, res.Body)
			})
		})

		t.Run("should block operations by header match expression", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.BlockMutations = config.BlockMutationConfiguration{
						Enabled:   true,
						Condition: "Request.Header.Get('graphql-client-name') == 'my-client'",
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Header: map[string][]string{
						"graphql-client-name": {"my-client-different"},
					},
					Query: `mutation { updateEmployeeTag(id: 1, tag: "test") { id tag } }`,
				})
				require.Equal(t, http.StatusOK, res.Response.StatusCode)
				require.Equal(t, `{"data":{"updateEmployeeTag":{"id":1,"tag":"test"}}}`, res.Body)

				res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Header: map[string][]string{
						"graphql-client-name": {"my-client"},
					},
					Query: `mutation { updateEmployeeTag(id: 1, tag: "test") { id tag } }`,
				})
				require.Equal(t, http.StatusOK, res.Response.StatusCode)
				require.Equal(t, `{"errors":[{"message":"operation type 'mutation' is blocked"}]}`, res.Body)
			})
		})

		t.Run("should block operation by claim expression condition", func(t *testing.T) {
			t.Parallel()

			authenticators, authServer := configureAuth(t)
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, false)),
				},
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.BlockMutations = config.BlockMutationConfiguration{
						Enabled:   true,
						Condition: "'read:miscellaneous' in Request.Auth.Scopes",
					}
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
				require.Equal(t, `{"errors":[{"message":"operation type 'mutation' is blocked"}]}`, string(data))

				token, err = authServer.Token(map[string]any{
					"scope": "write:fact read:all",
				})
				require.NoError(t, err)
				header = http.Header{
					"Authorization": []string{"Bearer " + token},
				}
				res, err = xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(`
				{"query":"mutation { addFact(fact: { title: \"title\", description: \"description\", factType: DIRECTIVE }) { description } }"}
			`))
				require.NoError(t, err)
				defer res.Body.Close()
				require.Equal(t, http.StatusOK, res.StatusCode)
				data, err = io.ReadAll(res.Body)
				require.NoError(t, err)
				require.Equal(t, `{"data":{"addFact":{"description":"description"}}}`, string(data))
			})
		})
	})

	t.Run("block non-persisted operations", func(t *testing.T) {
		t.Parallel()

		t.Run("allow", func(t *testing.T) {
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.BlockNonPersistedOperations = config.BlockNonPersistedConfiguration{
						Enabled: true,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				header := make(http.Header)
				header.Add("graphql-client-name", "my-client")
				res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					OperationName: []byte(`"Employees"`),
					Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "dc67510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
					Header:        header,
				})
				require.NoError(t, err)
				require.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
			})
		})

		t.Run("block", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.BlockNonPersistedOperations = config.BlockNonPersistedConfiguration{
						Enabled: true,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `mutation { updateEmployeeTag(id: 1, tag: "test") { id tag } }`,
				})
				require.Equal(t, http.StatusOK, res.Response.StatusCode)
				require.Equal(t, res.Response.Header.Get("Content-Type"), "application/json")
				require.Equal(t, `{"errors":[{"message":"non-persisted operation is blocked"}]}`, res.Body)
			})
		})

		t.Run("should block operation by header match expression", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.BlockNonPersistedOperations = config.BlockNonPersistedConfiguration{
						Enabled:   true,
						Condition: "Request.Header.Get('graphql-client-name') == 'my-client'",
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Header: map[string][]string{
						"graphql-client-name": {"my-client-different"},
					},
					Query: `mutation { updateEmployeeTag(id: 1, tag: "test") { id tag } }`,
				})
				require.Equal(t, http.StatusOK, res.Response.StatusCode)
				require.Equal(t, `{"data":{"updateEmployeeTag":{"id":1,"tag":"test"}}}`, res.Body)

				res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Header: map[string][]string{
						"graphql-client-name": {"my-client"},
					},
					Query: `mutation { updateEmployeeTag(id: 1, tag: "test") { id tag } }`,
				})
				require.Equal(t, http.StatusOK, res.Response.StatusCode)
				require.Equal(t, res.Response.Header.Get("Content-Type"), "application/json")
				require.Equal(t, `{"errors":[{"message":"non-persisted operation is blocked"}]}`, res.Body)
			})
		})
	})
}
