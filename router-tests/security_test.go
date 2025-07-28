package integration

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
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
