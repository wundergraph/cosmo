package integration

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestApolloRouterCompatibility(t *testing.T) {
	t.Parallel()

	t.Run("enable replace invalid variable error", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithApolloRouterCompatibilityFlags(config.ApolloRouterCompatibilityFlags{
					ReplaceInvalidVarErrors: config.ApolloCompatibilityFlag{
						Enabled: true,
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query FloatQuery($arg: Float) { floatField(arg: $arg) }`,
				Variables: json.RawMessage(`{"arg":"INVALID"}`),
			})
			require.NoError(t, err)
			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			assert.JSONEq(t, `{
				"errors": [
					{
						"message": "invalid type for variable: 'arg'",
						"extensions": {
							"code": "VALIDATION_INVALID_TYPE_VARIABLE"
						}
					}
				]
			}`, res.Body)
		})
	})

	t.Run("enable replace invalid variable error AND replace validation error status", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithApolloCompatibilityFlagsConfig(config.ApolloCompatibilityFlags{
					ReplaceValidationErrorStatus: config.ApolloCompatibilityFlag{
						Enabled: true,
					},
				}),
				core.WithApolloRouterCompatibilityFlags(config.ApolloRouterCompatibilityFlags{
					ReplaceInvalidVarErrors: config.ApolloCompatibilityFlag{
						Enabled: true,
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query FloatQuery($arg: Float) { floatField(arg: $arg) }`,
				Variables: json.RawMessage(`{"arg":"INVALID"}`),
			})
			require.NoError(t, err)
			assert.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
			assert.JSONEq(t, `{
				"errors": [
					{
						"message": "invalid type for variable: 'arg'",
						"extensions": {
							"code": "VALIDATION_INVALID_TYPE_VARIABLE"
						}
					}
				]
			}`, res.Body)
		})
	})

	errorWithStatus := func(statusCode int) func(http.Handler) http.Handler {
		return func(_ http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(statusCode)
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]interface{}{
					"errors": []map[string]interface{}{
						{
							"message": "Unknown access token",
							"extensions": map[string]interface{}{
								"code": "UNAUTHENTICATED",
							},
						},
					},
				})
			})
		}
	}

	t.Run("enable subrequest http error compatibility with error propagation disabled", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithApolloRouterCompatibilityFlags(config.ApolloRouterCompatibilityFlags{
					SubrequestHTTPError: config.ApolloCompatibilityFlag{
						Enabled: true,
					},
				}),
				core.WithSubgraphErrorPropagation(config.SubgraphErrorPropagationConfiguration{
					Enabled: false,
				}),
			},
			Subgraphs: testenv.SubgraphsConfig{
				Test1: testenv.SubgraphConfig{
					Middleware: errorWithStatus(http.StatusForbidden),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query FloatQuery($arg: Float) { floatField(arg: $arg) }`,
				Variables: json.RawMessage(`{"arg": 2.5}`),
			})
			require.NoError(t, err)
			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			assert.JSONEq(t, `{
				"errors": [
					{
						"message": "HTTP fetch failed from 'test1': 403: Forbidden",
						"path": [],
						"extensions": {
							"code": "SUBREQUEST_HTTP_ERROR",
							"service": "test1",
							"reason": "403: Forbidden",
							"http": {
								"status": 403
							}
						}
					},
					{
						"message": "Failed to fetch from Subgraph 'test1'."
					}
				],
				"data": {
					"floatField": null
				}
			}`, res.Body)
		})
	})

	t.Run("enable subrequest http error compatibility with subgraph error propagation enabled", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithApolloRouterCompatibilityFlags(config.ApolloRouterCompatibilityFlags{
					SubrequestHTTPError: config.ApolloCompatibilityFlag{
						Enabled: true,
					},
				}),
				core.WithSubgraphErrorPropagation(config.SubgraphErrorPropagationConfiguration{
					Enabled:                true,
					Mode:                   "pass-through",
					AllowedExtensionFields: []string{"code"},
				}),
			},
			Subgraphs: testenv.SubgraphsConfig{
				Test1: testenv.SubgraphConfig{
					Middleware: errorWithStatus(http.StatusForbidden),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query FloatQuery($arg: Float) { floatField(arg: $arg) }`,
				Variables: json.RawMessage(`{"arg": 2.5}`),
			})
			require.NoError(t, err)
			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			assert.JSONEq(t, `{
				"errors": [
					{
						"message": "HTTP fetch failed from 'test1': 403: Forbidden",
						"path": [],
						"extensions": {
							"code": "SUBREQUEST_HTTP_ERROR",
							"service": "test1",
							"reason": "403: Forbidden",
							"http": {
								"status": 403
							}
						}
					},
					{
						"message": "Unknown access token",
						"extensions": {
							"code": "UNAUTHENTICATED"
						}
					}
				],
				"data": {
					"floatField": null
				}
			}`, res.Body)
		})
	})

	t.Run("disable subrequest http error compatibility", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithApolloRouterCompatibilityFlags(config.ApolloRouterCompatibilityFlags{
					SubrequestHTTPError: config.ApolloCompatibilityFlag{
						Enabled: false,
					},
				}),
			},
			Subgraphs: testenv.SubgraphsConfig{
				Test1: testenv.SubgraphConfig{
					Middleware: errorWithStatus(http.StatusForbidden),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query FloatQuery($arg: Float) { floatField(arg: $arg) }`,
				Variables: json.RawMessage(`{"arg": 2.5}`),
			})
			require.NoError(t, err)
			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			assert.JSONEq(t, `{
				"errors": [
					{
						"message": "Failed to fetch from Subgraph 'test1'.",
						"extensions": {
							"errors": [
								{
									"message": "Unknown access token",
									"extensions": {
										"code": "UNAUTHENTICATED"
									}
								}
							],
							"statusCode": 403
						}
					}
				],
				"data": {
					"floatField": null
				}
			}`, res.Body)
		})
	})

	t.Run("enable subrequest http error compatibility and return non-error code", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithApolloRouterCompatibilityFlags(config.ApolloRouterCompatibilityFlags{
					SubrequestHTTPError: config.ApolloCompatibilityFlag{
						Enabled: true,
					},
				}),
			},
			Subgraphs: testenv.SubgraphsConfig{
				Test1: testenv.SubgraphConfig{
					Middleware: errorWithStatus(http.StatusOK),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query FloatQuery($arg: Float) { floatField(arg: $arg) }`,
				Variables: json.RawMessage(`{"arg": 2.5}`),
			})
			require.NoError(t, err)
			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			assert.JSONEq(t, `{
				"errors": [
					{
						"message": "Failed to fetch from Subgraph 'test1'.",
						"extensions": {
							"errors": [
								{
									"message": "Unknown access token",
									"extensions": {
										"code": "UNAUTHENTICATED"
									}
								}
							],
							"statusCode": 200
						}
					}
				],
				"data": {
					"floatField": null
				}
			}`, res.Body)
		})
	})
}

func TestApolloGatewayCompatibility(t *testing.T) {
	t.Parallel()

	t.Run("enable all", func(t *testing.T) {
		t.Parallel()
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
			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			assert.Equal(t, `{"data":null,"extensions":{"valueCompletion":[{"message":"Invalid __typename found for object at array element of type Employee at index 0.","path":["findEmployees",0],"extensions":{"code":"INVALID_GRAPHQL"}}]}}`, res.Body)
		})
	})
	t.Run("enable value completion", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithApolloCompatibilityFlagsConfig(config.ApolloCompatibilityFlags{
					ValueCompletion: config.ApolloCompatibilityFlag{
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
			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			assert.Equal(t, `{"data":null,"extensions":{"valueCompletion":[{"message":"Invalid __typename found for object at array element of type Employee at index 0.","path":["findEmployees",0],"extensions":{"code":"INVALID_GRAPHQL"}}]}}`, res.Body)
		})
	})
	t.Run("enable value completion — invalid enum value", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithApolloCompatibilityFlagsConfig(config.ApolloCompatibilityFlags{
					ValueCompletion: config.ApolloCompatibilityFlag{
						Enabled: true,
					},
				}),
			},
			Subgraphs: testenv.SubgraphsConfig{
				GlobalMiddleware: func(handler http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						w.Header().Set("Content-Type", "application/json")
						w.WriteHeader(http.StatusOK)
						_, _ = w.Write([]byte(`{"data":{"employee":{"currentMood":"INVALID"}}}`))
					})
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query ($id: Int!) { employee(id: $id) { currentMood } }`,
				Variables: json.RawMessage(`{"id":12}`),
			})
			require.NoError(t, err)
			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			assert.Equal(t, `{"data":{"employee":null},"extensions":{"valueCompletion":[{"message":"Invalid value found for field Employee.currentMood.","path":["employee","currentMood"],"extensions":{"code":"INVALID_GRAPHQL"}}]}}`, res.Body)
		})
	})
	t.Run("enable value completion — inaccessible enum value", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithApolloCompatibilityFlagsConfig(config.ApolloCompatibilityFlags{
					ValueCompletion: config.ApolloCompatibilityFlag{
						Enabled: true,
					},
				}),
			},
			Subgraphs: testenv.SubgraphsConfig{
				GlobalMiddleware: func(handler http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						w.Header().Set("Content-Type", "application/json")
						w.WriteHeader(http.StatusOK)
						_, _ = w.Write([]byte(`{"data":{"employee":{"currentMood":"APATHETIC"}}}`))
					})
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query ($id: Int!) { employee(id: $id) { currentMood } }`,
				Variables: json.RawMessage(`{"id":12}`),
			})
			require.NoError(t, err)
			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			assert.Equal(t, `{"data":{"employee":null},"extensions":{"valueCompletion":[{"message":"Invalid value found for field Employee.currentMood.","path":["employee","currentMood"],"extensions":{"code":"INVALID_GRAPHQL"}}]}}`, res.Body)
		})
	})
	t.Run("float compaction off", func(t *testing.T) {
		t.Parallel()
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
			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			assert.Equal(t, `{"data":{"floatField":1.0}}`, res.Body)
		})
	})
	t.Run("should not truncate - off", func(t *testing.T) {
		t.Parallel()
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
			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			assert.Equal(t, `{"data":{"floatField":1.1}}`, res.Body)
		})
	})
	t.Run("should not truncate - on", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithApolloCompatibilityFlagsConfig(config.ApolloCompatibilityFlags{
					TruncateFloats: config.ApolloCompatibilityFlag{
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
			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			assert.Equal(t, `{"data":{"floatField":1.1}}`, res.Body)
		})
	})
	t.Run("float compaction on", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithApolloCompatibilityFlagsConfig(config.ApolloCompatibilityFlags{
					TruncateFloats: config.ApolloCompatibilityFlag{
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
			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			assert.Equal(t, `{"data":{"floatField":1}}`, res.Body)
		})
	})
	t.Run("float compaction global", func(t *testing.T) {
		t.Parallel()
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
			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			assert.Equal(t, `{"data":{"floatField":1}}`, res.Body)
		})
	})
	t.Run("nullable array item with non-nullable array item field", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithApolloCompatibilityFlagsConfig(config.ApolloCompatibilityFlags{
					ValueCompletion: config.ApolloCompatibilityFlag{
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
			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			assert.Equal(t, `{"data":{"employees":[null]},"extensions":{"valueCompletion":[{"message":"Cannot return null for non-nullable field Employee.id.","path":["employees",0,"id"],"extensions":{"code":"INVALID_GRAPHQL"}}]}}`, res.Body)
		})
	})
	t.Run("non-nullable array item", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithApolloCompatibilityFlagsConfig(config.ApolloCompatibilityFlags{
					ValueCompletion: config.ApolloCompatibilityFlag{
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
			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			assert.Equal(t, `{"data":null,"extensions":{"valueCompletion":[{"message":"Cannot return null for non-nullable array element of type Products at index 0.","path":["products",0],"extensions":{"code":"INVALID_GRAPHQL"}}]}}`, res.Body)
		})
	})
	t.Run("non-nullable array item with non-nullable array item field", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithApolloCompatibilityFlagsConfig(config.ApolloCompatibilityFlags{
					ValueCompletion: config.ApolloCompatibilityFlag{
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
			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			assert.Equal(t, `{"data":null,"extensions":{"valueCompletion":[{"message":"Cannot return null for non-nullable field Products.upc.","path":["products",0,"upc"],"extensions":{"code":"INVALID_GRAPHQL"}}]}}`, res.Body)
		})
	})
	t.Run("simple fetch with suppress fetch errors enabled", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithApolloCompatibilityFlagsConfig(config.ApolloCompatibilityFlags{
					ValueCompletion: config.ApolloCompatibilityFlag{
						Enabled: true,
					},
					SuppressFetchErrors: config.ApolloCompatibilityFlag{
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
			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			assert.Equal(t, `{"data":null,"extensions":{"valueCompletion":[{"message":"Cannot return null for non-nullable field Query.products.","path":["products"],"extensions":{"code":"INVALID_GRAPHQL"}}]}}`, res.Body)
		})
	})
	t.Run("simple fetch with suppress fetch errors disabled", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithApolloCompatibilityFlagsConfig(config.ApolloCompatibilityFlags{
					ValueCompletion: config.ApolloCompatibilityFlag{
						Enabled: true,
					},
					SuppressFetchErrors: config.ApolloCompatibilityFlag{
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
			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			assert.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees', Reason: no data or errors in response.","extensions":{"statusCode":200}}],"data":null}`, res.Body)
		})
	})
	t.Run("should suppress errors when enable all is true", func(t *testing.T) {
		t.Parallel()
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
			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			assert.Equal(t, `{"data":null,"extensions":{"valueCompletion":[{"message":"Cannot return null for non-nullable field Query.products.","path":["products"],"extensions":{"code":"INVALID_GRAPHQL"}}]}}`, res.Body)
		})
	})
	t.Run("enable replace undefined operation field error", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithApolloCompatibilityFlagsConfig(config.ApolloCompatibilityFlags{
					UseGraphQLValidationFailedStatus: config.ApolloCompatibilityFlag{
						Enabled: true,
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query {employees{nonExistentField {id}}}`,
			})
			require.NoError(t, err)
			assert.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
			assert.Equal(t, `{"errors":[{"message":"Cannot query field \"nonExistentField\" on type \"Employee\".","extensions":{"code":"GRAPHQL_VALIDATION_FAILED"}}]}`, res.Body)
		})
	})
	t.Run("enable all: replace undefined operation field error", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithApolloCompatibilityFlagsConfig(config.ApolloCompatibilityFlags{
					EnableAll: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query {employees{nonExistentField}}`,
			})
			require.NoError(t, err)
			assert.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
			assert.Equal(t, `{"errors":[{"message":"Cannot query field \"nonExistentField\" on type \"Employee\".","extensions":{"code":"GRAPHQL_VALIDATION_FAILED"}}]}`, res.Body)
		})
	})
	t.Run("enable replace invalid variable error", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithApolloCompatibilityFlagsConfig(config.ApolloCompatibilityFlags{
					ReplaceInvalidVarErrors: config.ApolloCompatibilityFlag{
						Enabled: true,
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query FloatQuery($arg: Float) { floatField(arg: $arg) }`,
				Variables: json.RawMessage(`{"arg":"INVALID"}`),
			})
			require.NoError(t, err)
			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			assert.Equal(t, `{"errors":[{"message":"Variable \"$arg\" got invalid value \"INVALID\"; Float cannot represent non numeric value: \"INVALID\"","extensions":{"code":"BAD_USER_INPUT"}}]}`, res.Body)
		})
	})
	t.Run("enable replace validation error status", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithApolloCompatibilityFlagsConfig(config.ApolloCompatibilityFlags{
					ReplaceValidationErrorStatus: config.ApolloCompatibilityFlag{
						Enabled: true,
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query FloatQuery($arg: Float) { floatField(arg: $arg) }`,
				Variables: json.RawMessage(`{"arg":"INVALID"}`),
			})
			require.NoError(t, err)
			assert.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
			assert.Equal(t, `{"errors":[{"message":"Variable \"$arg\" got invalid value \"INVALID\"; Float cannot represent non numeric value: \"INVALID\""}]}`, res.Body)
		})
	})
	t.Run("enable replace invalid variable error and error status", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithApolloCompatibilityFlagsConfig(config.ApolloCompatibilityFlags{
					ReplaceInvalidVarErrors: config.ApolloCompatibilityFlag{
						Enabled: true,
					},
					ReplaceValidationErrorStatus: config.ApolloCompatibilityFlag{
						Enabled: true,
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query FloatQuery($arg: Float) { floatField(arg: $arg) }`,
				Variables: json.RawMessage(`{"arg":"INVALID"}`),
			})
			require.NoError(t, err)
			assert.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
			assert.Equal(t, `{"errors":[{"message":"Variable \"$arg\" got invalid value \"INVALID\"; Float cannot represent non numeric value: \"INVALID\"","extensions":{"code":"BAD_USER_INPUT"}}]}`, res.Body)
		})
	})
	t.Run("enable all: replace invalid variable error", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithApolloCompatibilityFlagsConfig(config.ApolloCompatibilityFlags{
					EnableAll: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query FloatQuery($arg: Float) { floatField(arg: $arg) }`,
				Variables: json.RawMessage(`{"arg":"INVALID"}`),
			})
			require.NoError(t, err)
			assert.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
			assert.Equal(t, `{"errors":[{"message":"Variable \"$arg\" got invalid value \"INVALID\"; Float cannot represent non numeric value: \"INVALID\"","extensions":{"code":"BAD_USER_INPUT"}}]}`, res.Body)
		})
	})
}
