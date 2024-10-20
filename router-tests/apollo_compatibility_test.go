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
	t.Run("nullable array item with non-nullable array item field", func(t *testing.T) {
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
						_, _ = w.Write([]byte(`{"data":{"employees":[{"id":null}]}}`))
					})
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query {employees{id}}`,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"data":{"employees":[null]},"extensions":{"valueCompletion":[{"message":"Cannot return null for non-nullable field Employee.id.","path":["employees",0,"id"],"extensions":{"code":"INVALID_GRAPHQL"}}]}}`, res.Body)
		})
	})
	t.Run("non-nullable array item", func(t *testing.T) {
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
						_, _ = w.Write([]byte(`{"data":{"products":[null]}}`))
					})
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query {products{... on Consultancy{upc}}}`,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"data":null,"extensions":{"valueCompletion":[{"message":"Cannot return null for non-nullable array element of type Products at index 0.","path":["products",0],"extensions":{"code":"INVALID_GRAPHQL"}}]}}`, res.Body)
		})
	})
	t.Run("non-nullable array item with non-nullable array item field", func(t *testing.T) {
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
						_, _ = w.Write([]byte(`{"data":{"products":[{"__typename":"Consultancy","upc":null}]}}`))
					})
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query {products{... on Consultancy{upc}}}`,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"data":null,"extensions":{"valueCompletion":[{"message":"Cannot return null for non-nullable field Products.upc.","path":["products",0,"upc"],"extensions":{"code":"INVALID_GRAPHQL"}}]}}`, res.Body)
		})
	})
	t.Run("simple fetch with suppress fetch errors enabled", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithApolloCompatibilityFlagsConfig(config.ApolloCompatibilityFlags{
					ValueCompletion: config.ApolloCompatibilityValueCompletion{
						Enabled: true,
					},
					SuppressFetchErrors: config.ApolloCompatibilitySuppressFetchErrors{
						Enabled: true,
					},
				}),
			},
			Subgraphs: testenv.SubgraphsConfig{
				GlobalMiddleware: func(handler http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						w.Header().Set("Content-Type", "application/json")
						w.WriteHeader(http.StatusOK)
						_, _ = w.Write([]byte(`{}`))
					})
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query {products{... on Consultancy{upc}}}`,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"data":null,"extensions":{"valueCompletion":[{"message":"Cannot return null for non-nullable field Query.products.","path":["products"],"extensions":{"code":"INVALID_GRAPHQL"}}]}}`, res.Body)
		})
	})
	t.Run("simple fetch with suppress fetch errors disabled", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithApolloCompatibilityFlagsConfig(config.ApolloCompatibilityFlags{
					ValueCompletion: config.ApolloCompatibilityValueCompletion{
						Enabled: true,
					},
					SuppressFetchErrors: config.ApolloCompatibilitySuppressFetchErrors{
						Enabled: false,
					},
				}),
			},
			Subgraphs: testenv.SubgraphsConfig{
				GlobalMiddleware: func(handler http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						w.Header().Set("Content-Type", "application/json")
						w.WriteHeader(http.StatusOK)
						_, _ = w.Write([]byte(`{}`))
					})
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query {products{... on Consultancy{upc}}}`,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees', Reason: no data or errors in response.","extensions":{"statusCode":200}}],"data":null}`, res.Body)
		})
	})
	t.Run("should suppress errors when enable all is true", func(t *testing.T) {
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
						_, _ = w.Write([]byte(`{}`))
					})
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query {products{... on Consultancy{upc}}}`,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"data":null,"extensions":{"valueCompletion":[{"message":"Cannot return null for non-nullable field Query.products.","path":["products"],"extensions":{"code":"INVALID_GRAPHQL"}}]}}`, res.Body)
		})
	})
}
