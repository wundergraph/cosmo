package integration

import (
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap/zapcore"
	"net/http"
	"testing"
)

func TestSafelist(t *testing.T) {
	t.Parallel()

	var (
		persistedQuery        = "query Employees {\n employees {\n id\n }\n}"
		nonPersistedQuery     = "query Employees {\n\n\n employees {\n id\n }\n}"
		queryWithDetails      = "query Employees {\n employees {\n id\n details {\n forename\n} \n}\n}"
		persistedNotFoundResp = `{"errors":[{"message":"PersistedQueryNotFound","extensions":{"code":"PERSISTED_QUERY_NOT_FOUND"}}]}`
	)

	t.Run("router fails if APQ and Safelist are both enabled", func(t *testing.T) {
		testenv.FailsOnStartup(t, &testenv.Config{
			ApqConfig: config.AutomaticPersistedQueriesConfig{Enabled: true},
			ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
				securityConfiguration.Safelist = config.EnableOperationConfiguration{Enabled: true}
			},
		}, func(t *testing.T, err error) {
			require.Contains(t, err.Error(), "automatic persisted queries and safelist cannot be enabled at the same time")
		})
	})

	t.Run("safelist works with persisted query", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
				securityConfiguration.Safelist = config.EnableOperationConfiguration{
					Enabled: true,
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"Employees"`),
				Header:        header,
				Query:         persistedQuery,
			})
			require.NoError(t, err)
			require.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
		})
	})

	t.Run("safelist rejects persisted query with different spacing", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
				securityConfiguration.Safelist = config.EnableOperationConfiguration{
					Enabled: true,
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"Employees"`),
				Header:        header,
				Query:         nonPersistedQuery,
			})
			require.NoError(t, err)
			require.Equal(t, persistedNotFoundResp, res.Body)
		})
	})

	t.Run("safelist blocks non persisted query", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			ApqConfig: config.AutomaticPersistedQueriesConfig{
				Enabled: false,
			},
			ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
				securityConfiguration.Safelist = config.EnableOperationConfiguration{
					Enabled: true,
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"Employees"`),
				Header:        header,
				Query:         queryWithDetails,
			})
			require.NoError(t, err)
			require.Equal(t, persistedNotFoundResp, res.Body)
		})
	})

	t.Run("log unknown operations", func(t *testing.T) {
		t.Run("logs non persisted query but doesn't block", func(t *testing.T) {
			testenv.Run(t, &testenv.Config{
				ApqConfig: config.AutomaticPersistedQueriesConfig{
					Enabled: false,
				},
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.Safelist = config.EnableOperationConfiguration{
						Enabled: false,
					}
					securityConfiguration.LogUnknownOperations = config.EnableOperationConfiguration{
						Enabled: true,
					}
				},
				LogObservation: testenv.LogObservationConfig{
					Enabled:  true,
					LogLevel: zapcore.InfoLevel,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				header := make(http.Header)
				header.Add("graphql-client-name", "my-client")
				res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					OperationName: []byte(`"Employees"`),
					Header:        header,
					Query:         nonPersistedQuery,
				})
				require.NoError(t, err)
				require.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)

				logEntries := xEnv.Observer().FilterMessageSnippet("Unknown persisted operation found").All()
				require.Len(t, logEntries, 1)
				requestContext := logEntries[0].ContextMap()
				require.Equal(t, nonPersistedQuery, requestContext["query"])
				require.Equal(t, "5e72e7c4cf0f86f7bc7044eb0c932917f3491c5f63fb769b96e5ded98c4ac0a5", requestContext["sha256Hash"])
			})
		})

		t.Run("doesn't log persisted queries", func(t *testing.T) {
			testenv.Run(t, &testenv.Config{
				ApqConfig: config.AutomaticPersistedQueriesConfig{
					Enabled: false,
				},
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.Safelist = config.EnableOperationConfiguration{
						Enabled: false,
					}
					securityConfiguration.LogUnknownOperations = config.EnableOperationConfiguration{
						Enabled: true,
					}
				},
				LogObservation: testenv.LogObservationConfig{
					Enabled:  true,
					LogLevel: zapcore.InfoLevel,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				header := make(http.Header)
				header.Add("graphql-client-name", "my-client")
				res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					OperationName: []byte(`"Employees"`),
					Header:        header,
					Query:         persistedQuery,
				})
				require.NoError(t, err)
				require.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)

				logEntries := xEnv.Observer().FilterMessageSnippet("Unknown persisted operation found").All()
				require.Len(t, logEntries, 0)
			})
		})
	})
}
