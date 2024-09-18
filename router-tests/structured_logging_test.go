package integration_test

import (
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"math"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
)

// Interface guard
var (
	_ core.EnginePreOriginHandler = (*MyPanicModule)(nil)
	_ core.Module                 = (*MyPanicModule)(nil)
)

type MyPanicModule struct{}

func (m MyPanicModule) OnOriginRequest(req *http.Request, ctx core.RequestContext) (*http.Request, *http.Response) {
	panic("implement me")
}

func (m MyPanicModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       "myPanicModule",
		Priority: math.MaxInt32,
		New: func() core.Module {
			return &MyPanicModule{}
		},
	}
}

func TestRouterStartLogs(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{LogObservation: testenv.LogObservationConfig{
		Enabled:  true,
		LogLevel: zapcore.InfoLevel,
	}}, func(t *testing.T, xEnv *testenv.Environment) {
		logEntries := xEnv.Observer().All()
		require.Len(t, logEntries, 11)
		natsLogs := xEnv.Observer().FilterMessageSnippet("Nats Event source enabled").All()
		require.Len(t, natsLogs, 4)
		providerIDFields := xEnv.Observer().FilterField(zap.String("provider_id", "default")).All()
		require.Len(t, providerIDFields, 1)
		kafkaLogs := xEnv.Observer().FilterMessageSnippet("Kafka Event source enabled").All()
		require.Len(t, kafkaLogs, 2)
		playgroundLog := xEnv.Observer().FilterMessage("Serving GraphQL playground")
		require.Equal(t, playgroundLog.Len(), 1)
		featureFlagLog := xEnv.Observer().FilterMessage("Feature flags enabled")
		require.Equal(t, featureFlagLog.Len(), 1)
		serverListeningLog := xEnv.Observer().FilterMessage("Server listening and serving")
		require.Equal(t, serverListeningLog.Len(), 1)
	})
}

func TestQueryWithLogging(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{LogObservation: testenv.LogObservationConfig{
		Enabled:  true,
		LogLevel: zapcore.InfoLevel,
	}}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `{ employees { id } }`,
		})
		require.JSONEq(t, employeesIDData, res.Body)
		logEntries := xEnv.Observer().All()
		require.Len(t, logEntries, 12)
		requestLog := xEnv.Observer().FilterMessage("/graphql")
		require.Equal(t, requestLog.Len(), 1)
		requestContext := requestLog.All()[0].ContextMap()
		expectedValues := map[string]interface{}{
			"status": int64(200),
			"method": "POST",
			"path":   "/graphql",
			"query":  "", // http query is empty
			"ip":     "[REDACTED]",
		}
		additionalExpectedKeys := []string{
			"user_agent", "latency", "config_version", "request_id",
		}
		require.Len(t, requestContext, len(expectedValues)+len(additionalExpectedKeys))
		for key, val := range expectedValues {
			mapVal, exists := requestContext[key]
			require.Truef(t, exists, "key '%s' not found", key)
			require.Equalf(t, mapVal, val, "expected '%v', got '%v'", val, mapVal)
		}
		for _, key := range additionalExpectedKeys {
			_, exists := requestContext[key]
			require.Truef(t, exists, "key '%s' not found", key)
		}
	})
}

func TestQueryWithLoggingError(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{
		NoRetryClient: true,
		Subgraphs: testenv.SubgraphsConfig{
			Employees: testenv.SubgraphConfig{
				CloseOnStart: true,
			},
		},
		RouterOptions: []core.Option{
			core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
				EnableSingleFlight:     true,
				MaxConcurrentResolvers: 1,
			}),
			core.WithSubgraphRetryOptions(false, 0, 0, 0),
		},
		LogObservation: testenv.LogObservationConfig{
			Enabled:  true,
			LogLevel: zapcore.InfoLevel,
		}}, func(t *testing.T, xEnv *testenv.Environment) {
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			Query: `{ employees { id } }`,
		})
		require.NoError(t, err)
		require.JSONEq(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees'."}],"data":{"employees":null}}`, res.Body)
		logEntries := xEnv.Observer().All()
		require.Len(t, logEntries, 13)
		requestLog := xEnv.Observer().FilterMessage("/graphql")
		require.Equal(t, requestLog.Len(), 1)
		requestContext := requestLog.All()[0].ContextMap()
		expectedValues := map[string]interface{}{
			"status":     int64(200),
			"method":     "POST",
			"path":       "/graphql",
			"query":      "", // http query is empty
			"ip":         "[REDACTED]",
			"user_agent": "Go-http-client/1.1",
		}
		additionalExpectedKeys := []string{
			"latency", "config_version", "request_id",
		}
		require.Len(t, requestContext, len(expectedValues)+len(additionalExpectedKeys))
		for key, val := range expectedValues {
			mapVal, exists := requestContext[key]
			require.Truef(t, exists, "key '%s' not found", key)
			require.Equalf(t, mapVal, val, "expected '%v', got '%v'", val, mapVal)
		}
		for _, key := range additionalExpectedKeys {
			_, exists := requestContext[key]
			require.Truef(t, exists, "key '%s' not found", key)
		}
	})
}

func TestQueryWithLoggingPanic(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{
		NoRetryClient: true,
		RouterOptions: []core.Option{
			core.WithCustomModules(&MyPanicModule{}),
			core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
				EnableSingleFlight:     true,
				MaxConcurrentResolvers: 1,
			}),
			core.WithSubgraphRetryOptions(false, 0, 0, 0),
		},
		LogObservation: testenv.LogObservationConfig{
			Enabled:  true,
			LogLevel: zapcore.InfoLevel,
		}}, func(t *testing.T, xEnv *testenv.Environment) {
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			Query: `{ employees { id } }`,
		})
		require.NoError(t, err)
		require.Equal(t, "", res.Body)
		logEntries := xEnv.Observer().All()
		require.Len(t, logEntries, 13)
		requestLog := xEnv.Observer().FilterMessage("[Recovery from panic]")
		require.Equal(t, requestLog.Len(), 1)
		requestContext := requestLog.All()[0].ContextMap()
		expectedValues := map[string]interface{}{
			"status":     int64(500),
			"method":     "POST",
			"path":       "/graphql",
			"query":      "", // http query is empty
			"ip":         "[REDACTED]",
			"user_agent": "Go-http-client/1.1",
			"error":      "implement me",
		}
		additionalExpectedKeys := []string{
			"latency", "config_version", "request_id", "stack",
		}
		require.Len(t, requestContext, len(expectedValues)+len(additionalExpectedKeys))
		for key, val := range expectedValues {
			mapVal, exists := requestContext[key]
			require.Truef(t, exists, "key '%s' not found", key)
			require.Equalf(t, mapVal, val, "expected '%v', got '%v'", val, mapVal)
		}
		for _, key := range additionalExpectedKeys {
			_, exists := requestContext[key]
			require.Truef(t, exists, "key '%s' not found", key)
		}
	})
}
