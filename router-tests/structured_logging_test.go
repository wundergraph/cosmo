package integration_test

import (
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
)

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
			require.True(t, exists)
			require.Equal(t, mapVal, val)
		}
		for _, key := range additionalExpectedKeys {
			_, exists := requestContext[key]
			require.True(t, exists)
		}
	})
}
