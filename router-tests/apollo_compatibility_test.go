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
			require.Equal(t, `{"data":null,"extensions":{"valueCompletion":[{"message":"Invalid __typename found for object at array element of type Employee at index 0.","path":["findEmployees",0],"extensions":{"code":"INVALID_GRAPHQL"}}]}}`, res.Body)
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
			require.Equal(t, `{"data":null,"extensions":{"valueCompletion":[{"message":"Invalid __typename found for object at array element of type Employee at index 0.","path":["findEmployees",0],"extensions":{"code":"INVALID_GRAPHQL"}}]}}`, res.Body)
		})
	})
	t.Run("float compaction off", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				Test1: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							_, _ = w.Write([]byte(`{"data":{"floatField":1.0}}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query FloatQuery($arg: Float) { floatField(arg: $arg) }`,
				Variables: json.RawMessage(`{"arg":1.0}`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"data":{"floatField":1.0}}`, res.Body)
		})
	})
	t.Run("should not truncate - off", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				Test1: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							_, _ = w.Write([]byte(`{"data":{"floatField":1.1}}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query FloatQuery($arg: Float) { floatField(arg: $arg) }`,
				Variables: json.RawMessage(`{"arg":1.1}`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"data":{"floatField":1.1}}`, res.Body)
		})
	})
	t.Run("should not truncate - on", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithApolloCompatibilityFlagsConfig(config.ApolloCompatibilityFlags{
					TruncateFloats: config.ApolloCompatibilityTruncateFloats{
						Enabled: true,
					},
				}),
			},
			Subgraphs: testenv.SubgraphsConfig{
				Test1: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							_, _ = w.Write([]byte(`{"data":{"floatField":1.1}}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query FloatQuery($arg: Float) { floatField(arg: $arg) }`,
				Variables: json.RawMessage(`{"arg":1.1}`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"data":{"floatField":1.1}}`, res.Body)
		})
	})
	t.Run("float compaction on", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithApolloCompatibilityFlagsConfig(config.ApolloCompatibilityFlags{
					TruncateFloats: config.ApolloCompatibilityTruncateFloats{
						Enabled: true,
					},
				}),
			},
			Subgraphs: testenv.SubgraphsConfig{
				Test1: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							_, _ = w.Write([]byte(`{"data":{"floatField":1.0}}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query FloatQuery($arg: Float) { floatField(arg: $arg) }`,
				Variables: json.RawMessage(`{"arg":1}`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"data":{"floatField":1}}`, res.Body)
		})
	})
	t.Run("float compaction global", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithApolloCompatibilityFlagsConfig(config.ApolloCompatibilityFlags{
					EnableAll: true,
				}),
			},
			Subgraphs: testenv.SubgraphsConfig{
				Test1: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							_, _ = w.Write([]byte(`{"data":{"floatField":1.0}}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query FloatQuery($arg: Float) { floatField(arg: $arg) }`,
				Variables: json.RawMessage(`{"arg":1}`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"data":{"floatField":1}}`, res.Body)
		})
	})
}
