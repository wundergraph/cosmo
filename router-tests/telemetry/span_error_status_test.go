package telemetry

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/trace/tracetest"
	"go.opentelemetry.io/otel/codes"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.uber.org/zap/zapcore"
)

// rootSpan returns the last span in the list, which is the root server span.
// OTEL exports child spans before parents, so the root is always last.
func rootSpan(spans []sdktrace.ReadOnlySpan) sdktrace.ReadOnlySpan {
	if len(spans) == 0 {
		return nil
	}
	return spans[len(spans)-1]
}

func TestClientDisconnectionBehavior(t *testing.T) {
	t.Parallel()

	t.Run("span status is not error but exception event is recorded", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Delay: 2 * time.Second,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			ctx, cancel := context.WithTimeout(t.Context(), 200*time.Millisecond)
			defer cancel()

			req, err := http.NewRequestWithContext(ctx, http.MethodPost, xEnv.GraphQLRequestURL(),
				strings.NewReader(`{"query":"{ employees { id } }"}`))
			require.NoError(t, err)
			req.Header.Set("Content-Type", "application/json")

			client := &http.Client{}
			_, err = client.Do(req)
			require.Error(t, err)

			time.Sleep(500 * time.Millisecond)

			rootSpan := rootSpan(exporter.GetSpans().Snapshots())
			require.NotNil(t, rootSpan, "expected root span to be exported for client disconnections")

			require.NotEqual(t, codes.Error, rootSpan.Status().Code,
				"root span should not be marked as error for client disconnections")

			hasExceptionEvent := false
			for _, event := range rootSpan.Events() {
				if event.Name == "exception" {
					hasExceptionEvent = true
					break
				}
			}
			require.True(t, hasExceptionEvent,
				"root span should have an exception event recorded for client disconnections")
		})
	})

	t.Run("error metrics are not inflated but request count is recorded", func(t *testing.T) {
		t.Parallel()

		metricReader := sdkmetric.NewManualReader()

		testenv.Run(t, &testenv.Config{
			MetricReader: metricReader,
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Delay: 2 * time.Second,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			ctx, cancel := context.WithTimeout(t.Context(), 200*time.Millisecond)
			defer cancel()

			req, err := http.NewRequestWithContext(ctx, http.MethodPost, xEnv.GraphQLRequestURL(),
				strings.NewReader(`{"query":"{ employees { id } }"}`))
			require.NoError(t, err)
			req.Header.Set("Content-Type", "application/json")

			client := &http.Client{}
			_, _ = client.Do(req)

			time.Sleep(500 * time.Millisecond)

			var rm metricdata.ResourceMetrics
			err = metricReader.Collect(t.Context(), &rm)
			require.NoError(t, err)

			var requestCountFound bool
			for _, scopeMetric := range rm.ScopeMetrics {
				for _, m := range scopeMetric.Metrics {
					if m.Name == "router.http.requests" {
						requestCountFound = true
					}
				}
			}
			require.True(t, requestCountFound, "request count metric should be recorded even for client disconnections")
		})
	})

	t.Run("log level is info not error", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.DebugLevel,
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Delay: 2 * time.Second,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			ctx, cancel := context.WithTimeout(t.Context(), 200*time.Millisecond)
			defer cancel()

			req, err := http.NewRequestWithContext(ctx, http.MethodPost, xEnv.GraphQLRequestURL(),
				strings.NewReader(`{"query":"{ employees { id } }"}`))
			require.NoError(t, err)
			req.Header.Set("Content-Type", "application/json")

			client := &http.Client{}
			_, _ = client.Do(req)

			time.Sleep(500 * time.Millisecond)

			errorLogs := xEnv.Observer().FilterLevelExact(zapcore.ErrorLevel).All()
			for _, entry := range errorLogs {
				require.NotContains(t, entry.Message, "context canceled",
					"context canceled should not be logged at error level")
			}
		})
	})

	t.Run("other errors still mark span as error", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					CloseOnStart: true,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id } }`,
			})
			require.Contains(t, res.Body, "errors")

			rootSpan := rootSpan(exporter.GetSpans().Snapshots())
			require.NotNil(t, rootSpan, "root span should exist")
			require.Equal(t, codes.Error, rootSpan.Status().Code,
				"root span should be marked as error for real failures")
		})
	})
}
