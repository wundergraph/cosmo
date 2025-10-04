package integration

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestParserHardLimits(t *testing.T) {
	t.Parallel()

	t.Run("parser approximate depth limit", func(t *testing.T) {
		t.Parallel()
		t.Run("blocks queries over the limit", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.ParserLimits = config.ParserLimitsConfiguration{
						ApproximateDepthLimit: 2,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res, _ := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: `{ employee(id:1) { id details { forename surname } } }`,
				})
				require.Equal(t, 400, res.Response.StatusCode)
				require.Equal(t, `{"errors":[{"message":"allowed parsing depth per GraphQL document of '2' exceeded"}]}`, res.Body)
			})
		})

		t.Run("blocks persisted queries over the limit", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.ParserLimits = config.ParserLimitsConfiguration{
						ApproximateDepthLimit: 2,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				header := make(http.Header)
				header.Add("graphql-client-name", "my-client")
				res, _ := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
					OperationName: []byte(`Find`),
					Variables:     []byte(`{"criteria":  {"nationality":  "GERMAN"   }}`),
					Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "e33580cf6276de9a75fb3b1c4b7580fec2a1c8facd13f3487bf6c7c3f854f7e3"}}`),
					Header:        header,
				})
				require.Equal(t, 400, res.Response.StatusCode)
				require.Equal(t, `{"errors":[{"message":"allowed parsing depth per GraphQL document of '2' exceeded"}]}`, res.Body)
			})
		})

		t.Run("default limit allows persisted queries", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
				header := make(http.Header)
				header.Add("graphql-client-name", "my-client")
				res, _ := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
					OperationName: []byte(`Find`),
					Variables:     []byte(`{"criteria":  {"nationality":  "GERMAN"   }}`),
					Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "e33580cf6276de9a75fb3b1c4b7580fec2a1c8facd13f3487bf6c7c3f854f7e3"}}`),
					Header:        header,
				})
				require.Equal(t, 200, res.Response.StatusCode)
				require.Equal(t, `{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}}]}}`, res.Body)
			})
		})
	})

	t.Run("parser total fields limit", func(t *testing.T) {
		t.Parallel()

		t.Run("blocks queries over the limit", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.ParserLimits = config.ParserLimitsConfiguration{
						TotalFieldsLimit: 2,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res, _ := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: `{ employee(id:1) { id details { forename surname } } }`,
				})
				require.Equal(t, 400, res.Response.StatusCode)
				require.Equal(t, `{"errors":[{"message":"allowed number of fields per GraphQL document of '2' exceeded"}]}`, res.Body)
			})
		})

		t.Run("allows queries under the limit", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.ParserLimits = config.ParserLimitsConfiguration{
						TotalFieldsLimit: 6, // fail if count > limit
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res, _ := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: `{ employee(id:1) { id details { forename surname } } }`, // has 5 fields
				})
				require.Equal(t, 200, res.Response.StatusCode)
				require.Equal(t, `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)
			})
		})
	})
}

func TestQueryNamingLimits(t *testing.T) {
	t.Parallel()

	t.Run("verify operation query naming limits", func(t *testing.T) {
		t.Parallel()

		t.Run("with large query name and no operation name", func(t *testing.T) {
			t.Parallel()
			maxLength := 2
			queryName := "longstring"

			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.OperationNameLengthLimit = maxLength
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				expectedErrorMessage := fmt.Sprintf(`{"errors":[{"message":"operation name of length %d exceeds max length of %d"}]}`, len(queryName), maxLength)

				resPost, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: "query " + queryName + " { employees { id } }",
				})
				require.NoError(t, err)
				require.JSONEq(t, expectedErrorMessage, resPost.Body)
				require.Equal(t, http.StatusBadRequest, resPost.Response.StatusCode)

				resGet, err := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
					Query: "query " + queryName + " { employees { id } }",
				})
				require.NoError(t, err)
				require.JSONEq(t, expectedErrorMessage, resGet.Body)
				require.Equal(t, http.StatusBadRequest, resGet.Response.StatusCode)
			})
		})

		t.Run("with large query name and small operation name", func(t *testing.T) {
			t.Parallel()
			maxLength := 6
			queryName := "longstring"
			operationNameGet := `short`
			operationNamePost := `"short"`

			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.OperationNameLengthLimit = maxLength
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				expectedErrorMessage := fmt.Sprintf(`{"errors":[{"message":"operation name of length %d exceeds max length of %d"}]}`, len(queryName), maxLength)

				resPost, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query:         "query " + queryName + " { employees { id } }",
					OperationName: []byte(operationNamePost),
				})
				require.NoError(t, err)
				require.JSONEq(t, expectedErrorMessage, resPost.Body)
				require.Equal(t, http.StatusBadRequest, resPost.Response.StatusCode)

				resGet, err := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
					Query:         "query " + queryName + " { employees { id } }",
					OperationName: []byte(operationNameGet),
				})
				require.NoError(t, err)
				require.JSONEq(t, expectedErrorMessage, resGet.Body)
				require.Equal(t, http.StatusBadRequest, resGet.Response.StatusCode)
			})
		})

		t.Run("with small query name and large operation name", func(t *testing.T) {
			t.Parallel()

			maxLength := 6
			queryName := "short"
			operationNameGet := `longname`
			operationNamePost := `"longname"`

			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.OperationNameLengthLimit = maxLength
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				expectedErrorMessage := fmt.Sprintf(`{"errors":[{"message":"operation name of length %d exceeds max length of %d"}]}`, len(operationNameGet), maxLength)

				resPost, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query:         "query " + queryName + " { employees { id } }",
					OperationName: []byte(operationNamePost),
				})
				require.NoError(t, err)
				require.JSONEq(t, expectedErrorMessage, resPost.Body)
				require.Equal(t, http.StatusBadRequest, resPost.Response.StatusCode)

				resGet, err := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
					Query:         "query " + queryName + " { employees { id } }",
					OperationName: []byte(operationNameGet),
				})
				require.NoError(t, err)
				require.JSONEq(t, expectedErrorMessage, resGet.Body)
				require.Equal(t, http.StatusBadRequest, resGet.Response.StatusCode)
			})
		})

		t.Run("with small query name and small operation name", func(t *testing.T) {
			t.Parallel()

			liitSize := 7
			queryName := "short"
			operationNameGet := `short`
			operationNamePost := `"short"`

			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.OperationNameLengthLimit = liitSize
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				resPost, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query:         "query " + queryName + " { employees { id } }",
					OperationName: []byte(operationNamePost),
				})
				require.NoError(t, err)
				require.JSONEq(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, resPost.Body)
				require.Equal(t, http.StatusOK, resPost.Response.StatusCode)

				resGet, err := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
					Query:         "query " + queryName + " { employees { id } }",
					OperationName: []byte(operationNameGet),
				})
				require.NoError(t, err)
				require.JSONEq(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, resGet.Body)
				require.Equal(t, http.StatusOK, resGet.Response.StatusCode)
			})
		})

		t.Run("with multiple queries of which one is large", func(t *testing.T) {
			t.Parallel()

			maxLength := 6
			query1Name := "short"
			query2Name := "longstring"

			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.OperationNameLengthLimit = maxLength
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				expectedErrorMessage := fmt.Sprintf(`{"errors":[{"message":"operation name of length %d exceeds max length of %d"}]}`, len(query2Name), maxLength)

				resPost, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: "query " + query1Name + " { employees { id } } query " + query2Name + " { employees { id } }",
				})
				require.NoError(t, err)
				require.JSONEq(t, expectedErrorMessage, resPost.Body)
				require.Equal(t, http.StatusBadRequest, resPost.Response.StatusCode)

				resGet, err := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
					Query: "query " + query1Name + " { employees { id } } query " + query2Name + " { employees { id } }",
				})
				require.NoError(t, err)
				require.JSONEq(t, expectedErrorMessage, resGet.Body)
				require.Equal(t, http.StatusBadRequest, resGet.Response.StatusCode)
			})
		})

		t.Run("with multiple queries of which both are small", func(t *testing.T) {
			t.Parallel()

			maxLength := 6
			query1Name := "short1"
			query2Name := "short2"

			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.OperationNameLengthLimit = maxLength
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				resPost, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: "query " + query1Name + " { employees { id } } query " + query2Name + " { employees { id } }",
				})
				require.NoError(t, err)
				require.JSONEq(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, resPost.Body)
				require.Equal(t, http.StatusOK, resPost.Response.StatusCode)

				resGet, err := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
					Query: "query " + query1Name + " { employees { id } } query " + query2Name + " { employees { id } }",
				})
				require.NoError(t, err)
				require.JSONEq(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, resGet.Body)
				require.Equal(t, http.StatusOK, resGet.Response.StatusCode)
			})
		})

		t.Run("with large queries with max length of 0 where the validation is not enabled", func(t *testing.T) {
			t.Parallel()

			maxLength := 0
			query1Name := "longlonglonglonglonglonglonglonglonglong1"
			query2Name := "short2"

			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.OperationNameLengthLimit = maxLength
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				resPost, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: "query " + query1Name + " { employees { id } } query " + query2Name + " { employees { id } }",
				})
				require.NoError(t, err)
				require.JSONEq(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, resPost.Body)
				require.Equal(t, http.StatusOK, resPost.Response.StatusCode)

				resGet, err := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
					Query: "query " + query1Name + " { employees { id } } query " + query2Name + " { employees { id } }",
				})
				require.NoError(t, err)
				require.JSONEq(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, resGet.Body)
				require.Equal(t, http.StatusOK, resGet.Response.StatusCode)
			})
		})

		// In case of introspection checks, we could potentially early return
		t.Run("with multiple queries with introspection disabled", func(t *testing.T) {
			t.Parallel()

			maxLength := 6
			query1Name := "longquery"
			query2Name := "short2"

			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.OperationNameLengthLimit = maxLength
				},
				RouterOptions: []core.Option{
					core.WithIntrospection(false, config.IntrospectionConfiguration{
						Enabled: false,
					}),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				expectedErrorMessage := fmt.Sprintf(`{"errors":[{"message":"operation name of length %d exceeds max length of %d"}]}`, len(query1Name), maxLength)

				resPost, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: "query " + query1Name + " { __schema { __typename } } query " + query2Name + " { employees { id } }",
				})
				require.NoError(t, err)
				require.JSONEq(t, expectedErrorMessage, resPost.Body)
				require.Equal(t, http.StatusBadRequest, resPost.Response.StatusCode)

				resGet, err := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
					Query: "query " + query1Name + " { __schema { __typename } } query " + query2Name + " { employees { id } }",
				})
				require.NoError(t, err)
				require.JSONEq(t, expectedErrorMessage, resGet.Body)
				require.Equal(t, http.StatusBadRequest, resGet.Response.StatusCode)
			})
		})
	})
}
