package integration

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap/zapcore"
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
			RouterOptions: []core.Option{
				core.WithPersistedOperationsConfig(config.PersistedOperationsConfig{
					Safelist: config.SafelistConfiguration{Enabled: true},
				}),
			},
		}, func(t *testing.T, err error) {
			require.Contains(t, err.Error(), "automatic persisted queries and safelist cannot be enabled at the same time")
		})
	})

	t.Run("safelist should allow a persisted query to run", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithPersistedOperationsConfig(config.PersistedOperationsConfig{
					Safelist: config.SafelistConfiguration{Enabled: true},
				}),
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

	t.Run("safelist should allow a persisted query (run with ID) to run", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithPersistedOperationsConfig(config.PersistedOperationsConfig{
					Safelist: config.SafelistConfiguration{Enabled: true},
				}),
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

	t.Run("safelist should reject a query with different spacing from the persisted operation", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithPersistedOperationsConfig(config.PersistedOperationsConfig{
					Safelist: config.SafelistConfiguration{Enabled: true},
				}),
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

	t.Run("safelist should block a non persisted query", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			ApqConfig: config.AutomaticPersistedQueriesConfig{
				Enabled: false,
			},
			RouterOptions: []core.Option{
				core.WithPersistedOperationsConfig(config.PersistedOperationsConfig{
					Safelist: config.SafelistConfiguration{Enabled: true},
				}),
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
		t.Run("logs non persisted query but allows them to continue", func(t *testing.T) {
			testenv.Run(t, &testenv.Config{
				ApqConfig: config.AutomaticPersistedQueriesConfig{
					Enabled: false,
				},
				RouterOptions: []core.Option{
					core.WithPersistedOperationsConfig(config.PersistedOperationsConfig{
						Safelist:   config.SafelistConfiguration{Enabled: false},
						LogUnknown: true,
					}),
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

		t.Run("logs non persisted query and stops them if safelist set", func(t *testing.T) {
			testenv.Run(t, &testenv.Config{
				ApqConfig: config.AutomaticPersistedQueriesConfig{
					Enabled: false,
				},
				RouterOptions: []core.Option{
					core.WithPersistedOperationsConfig(config.PersistedOperationsConfig{
						Safelist:   config.SafelistConfiguration{Enabled: true},
						LogUnknown: true,
					}),
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
				require.Equal(t, persistedNotFoundResp, res.Body)

				logEntries := xEnv.Observer().FilterMessageSnippet("Unknown persisted operation found").All()
				require.Len(t, logEntries, 1)
				requestContext := logEntries[0].ContextMap()
				require.Equal(t, nonPersistedQuery, requestContext["query"])
				require.Equal(t, "5e72e7c4cf0f86f7bc7044eb0c932917f3491c5f63fb769b96e5ded98c4ac0a5", requestContext["sha256Hash"])
			})
		})

		t.Run("doesn't log persisted queries and allows them to continue", func(t *testing.T) {
			testenv.Run(t, &testenv.Config{
				ApqConfig: config.AutomaticPersistedQueriesConfig{
					Enabled: false,
				},
				RouterOptions: []core.Option{
					core.WithPersistedOperationsConfig(config.PersistedOperationsConfig{
						Safelist:   config.SafelistConfiguration{Enabled: true},
						LogUnknown: true,
					}),
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
