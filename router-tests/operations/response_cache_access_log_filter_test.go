package integration

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// TestResponseCacheAccessLogFilter verifies that the access log filter allows to log requests with a partial cache hit
func TestResponseCacheAccessLogFilter(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{
		RouterOptions:             memoryCacheOptions(t, nil),
		SubgraphAccessLogsEnabled: true,
		AccessLogFilter:           `response.cache.status == 'partial_hit'`,
		SubgraphAccessLogFilter:   `subgraph.name == 'mood' && subgraph.response.cache.status == 'hit' && request.operation.name == 'Moods' && (log.request_id ?? '') != '' && log.url == nil`,
		LogObservation:            testenv.LogObservationConfig{Enabled: true, LogLevel: zapcore.InfoLevel},
		Subgraphs:                 testenv.SubgraphsConfig{Mood: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("max-age=60")}},
	}, func(t *testing.T, env *testenv.Environment) {
		const query = `query Moods { employees { id currentMood } }`
		first := env.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query})
		second := env.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query})
		require.Equal(t, first.Body, second.Body)
		require.EqualValues(t, 1, env.SubgraphRequestCount.Mood.Load())
		require.Len(t, env.Observer().FilterField(zap.String("log_type", "request")).All(), 1)
		require.Len(t, env.Observer().FilterField(zap.String("log_type", "client/subgraph")).All(), 1)
	})
}
