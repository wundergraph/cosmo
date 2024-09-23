package integration

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestApolloCompatibility(t *testing.T) {
	t.Parallel()

	t.Run("enable all", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithApolloCompatibilityFlagsConfig(config.ApolloCompatibilityFlags{
					EnableAll: true,
				}),
			},
			Subgraphs: testenv.SubgraphsConfig{
				GlobalMiddleware: func(handler http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						w.Header().Set("Content-Type", "application/json")
						w.WriteHeader(http.StatusOK)
						_, _ = w.Write([]byte(`{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"__typename":"wrongTypeName"},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"__typename":"wrongTypeName"},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"__typename":"wrongTypeName"},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"__typename":"wrongTypeName"}]}}`))
					})
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname} __typename}}`,
				Variables: json.RawMessage(`{"criteria":{"nationality":"GERMAN"}}`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"data":null,"extensions":{"valueCompletion":[{"message":"Invalid __typename found for object at array element of type wrongTypeName at index 0.","path":["findEmployees",0,"__typename"],"extensions":{"code":"INVALID_GRAPHQL"}}]}}`, res.Body)
		})
	})
	t.Run("enable value completion", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithApolloCompatibilityFlagsConfig(config.ApolloCompatibilityFlags{
					ValueCompletion: config.ApolloCompatibilityValueCompletion{
						Enabled: true,
					},
				}),
			},
			Subgraphs: testenv.SubgraphsConfig{
				GlobalMiddleware: func(handler http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						w.Header().Set("Content-Type", "application/json")
						w.WriteHeader(http.StatusOK)
						_, _ = w.Write([]byte(`{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"__typename":"wrongTypeName"},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"__typename":"wrongTypeName"},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"__typename":"wrongTypeName"},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"__typename":"wrongTypeName"}]}}`))
					})
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname} __typename}}`,
				Variables: json.RawMessage(`{"criteria":{"nationality":"GERMAN"}}`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"data":null,"extensions":{"valueCompletion":[{"message":"Invalid __typename found for object at array element of type wrongTypeName at index 0.","path":["findEmployees",0,"__typename"],"extensions":{"code":"INVALID_GRAPHQL"}}]}}`, res.Body)
		})
	})
}
