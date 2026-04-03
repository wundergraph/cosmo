package integration

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
	"google.golang.org/grpc"
)

func requireSubgraphLogContext(
	t *testing.T,
	entries []observer.LoggedEntry,
	subgraphName string,
) map[string]interface{} {
	t.Helper()

	for _, entry := range entries {
		contextMap := entry.ContextMap()
		if contextMap["log_type"] == "client/subgraph" && contextMap["subgraph_name"] == subgraphName {
			return contextMap
		}
	}

	t.Fatalf("subgraph log for %q not found", subgraphName)
	return nil
}

func TestStructuredLoggingGRPCSubgraphLatency(t *testing.T) {
	t.Parallel()

	const projectsDelay = 900 * time.Millisecond

	testenv.Run(t, &testenv.Config{
		RouterConfigJSONTemplate:  testenv.ConfigWithGRPCJSONTemplate,
		EnableGRPC:                true,
		SubgraphAccessLogsEnabled: true,
		LogObservation: testenv.LogObservationConfig{
			Enabled:  true,
			LogLevel: zapcore.InfoLevel,
		},
		Subgraphs: testenv.SubgraphsConfig{
			Projects: testenv.SubgraphConfig{
				GRPCInterceptor: func(
					ctx context.Context,
					req any,
					_ *grpc.UnaryServerInfo,
					handler grpc.UnaryHandler,
				) (any, error) {
					time.Sleep(projectsDelay)
					return handler(ctx, req)
				},
			},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `query TestStructuredLoggingGRPCSubgraphLatency {
				employees {
					id
				}
				projects {
					id
				}
			}`,
		})

		require.Equal(t, res.Response.StatusCode, 200)

		logEntries := xEnv.Observer().All()
		employeeContext := requireSubgraphLogContext(t, logEntries, "employees")
		projectContext := requireSubgraphLogContext(t, logEntries, "projects")

		employeeLatency, ok := employeeContext["latency"].(time.Duration)
		require.True(t, ok)
		require.Greater(t, employeeLatency, time.Duration(0))

		projectLatency, ok := projectContext["latency"].(time.Duration)
		require.True(t, ok)
		require.Greater(t, projectLatency, time.Duration(0))

		// They should be different
		require.NotEqual(t, projectLatency, employeeLatency)
	})
}
