package integration

import (
	"bytes"
	"io"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"

	"github.com/wundergraph/cosmo/router-tests/testenv"
)

func TestInputValidation(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		t.Run("empty list default for non-null list items", func(t *testing.T) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query MyQuery($names: [String!] = []) { rootFieldWithListArg(arg: $names) }`,
			})
			require.Equal(t, `{"data":{"rootFieldWithListArg":[]}}`, res.Body)
		})

		t.Run("provided value with empty list default", func(t *testing.T) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:     `query MyQuery($names: [String!] = []) { rootFieldWithListArg(arg: $names) }`,
				Variables: []byte(`{"names":["Acme"]}`),
			})
			require.Equal(t, `{"data":{"rootFieldWithListArg":["Acme"]}}`, res.Body)
		})

		t.Run("valid input", func(t *testing.T) {
			header := http.Header{
				"Content-Type": []string{"application/json"},
				"Accept":       []string{"application/json"},
			}
			body := []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":{"criteria":{"nationality":"GERMAN"}}}`)
			res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}}]}}`, string(data))
		})
		t.Run("invalid input", func(t *testing.T) {
			header := http.Header{
				"Content-Type": []string{"application/json"},
				"Accept":       []string{"application/json"},
			}
			body := []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":{"criteria":{"nationality":"GOLANG"}}}`)
			res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Variable \"$criteria\" got invalid value {\"nationality\":\"GOLANG\"} at \"criteria.nationality\"; Value \"GOLANG\" does not exist in \"Nationality\" enum."}]}`, string(data))
		})
	})
	testenv.Run(t, &testenv.Config{
		ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
			cfg.DisableExposingVariablesContentOnValidationError = true
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		t.Run("invalid input with unexposed error values", func(t *testing.T) {
			header := http.Header{
				"Content-Type": []string{"application/json"},
				"Accept":       []string{"application/json"},
			}
			body := []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":{"criteria":{"nationality":"GOLANG"}}}`)
			res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Variable \"$criteria\" got invalid value at \"criteria.nationality\"; Value does not exist in \"Nationality\" enum."}]}`, string(data))
		})
	})
}

func TestInt64VariableValues(t *testing.T) {
	t.Parallel()

	const query = `query Employee($id: Int!) { employee(id: $id) { id } }`
	const outOfInt32Range = `{"id":2147483648}`

	// run sends an Int variable outside the signed 32-bit range and returns the router
	// response and the body of the request the employees subgraph received, if any.
	run := func(t *testing.T, allowInt64Values bool) (string, string) {
		t.Helper()
		var subgraphRequest []byte
		var body string
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithBackwardsCompatibility(config.BackwardsCompatibilityConfiguration{
					VariablesValidation: config.VariablesValidationBackwardsCompatibility{AllowInt64Values: allowInt64Values},
				}),
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(_ http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							subgraphRequest, _ = io.ReadAll(r.Body)
							w.Header().Set("Content-Type", "application/json")
							_, _ = w.Write([]byte(`{"data":{"employee":{"id":2147483648}}}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:     query,
				Variables: []byte(outOfInt32Range),
			})
			body = res.Body
		})
		return body, string(subgraphRequest)
	}

	t.Run("rejected by default", func(t *testing.T) {
		t.Parallel()
		body, subgraphRequest := run(t, false)
		require.Equal(t, `{"errors":[{"message":"Variable \"$id\" got invalid value 2147483648; Int cannot represent non 32-bit signed integer value: 2147483648"}]}`, body)
		require.Empty(t, subgraphRequest)
	})

	t.Run("forwarded to the subgraph when allowed", func(t *testing.T) {
		t.Parallel()
		body, subgraphRequest := run(t, true)
		require.Equal(t, `{"data":{"employee":{"id":2147483648}}}`, body)
		require.Contains(t, subgraphRequest, `"variables":{"a":2147483648}`)
	})
}
