package telemetry

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/trace/tracetest"
	"go.opentelemetry.io/otel/codes"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	otelsdktracetest "go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.uber.org/zap"
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

// waitForStableSpans polls exporter.GetSpans() until the snapshot count stops
// changing for at least 200ms, guaranteeing the trace tree has finished exporting
// before assertions run across all spans.
func waitForStableSpans(t *testing.T, exporter *otelsdktracetest.InMemoryExporter) []sdktrace.ReadOnlySpan {
	t.Helper()
	var (
		spans       []sdktrace.ReadOnlySpan
		lastCount   = -1
		stableSince time.Time
	)
	require.Eventually(t, func() bool {
		spans = exporter.GetSpans().Snapshots()
		if len(spans) != lastCount {
			lastCount = len(spans)
			stableSince = time.Now()
			return false
		}
		return len(spans) > 0 && time.Since(stableSince) >= 200*time.Millisecond
	}, 5*time.Second, 50*time.Millisecond, "expected span snapshot to stabilize")
	return spans
}

func TestClientDisconnectionBehavior(t *testing.T) {
	t.Parallel()

	t.Run("root span is not marked as error but records exception event on client disconnect", func(t *testing.T) {
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

	t.Run("error metrics are not inflated but request count is recorded on client disconnect", func(t *testing.T) {
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

	t.Run("context canceled is not logged at error level on client disconnect", func(t *testing.T) {
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

	t.Run("subgraph fetch span is not marked as error on client disconnect", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
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
			// Since the subgraph takes 2 seconds, and this takes 200 milliseconds which is less than the subgraph
			// this will ensure that the request is cancelled due to a timeout
			ctx, cancel := context.WithTimeout(t.Context(), 200*time.Millisecond)
			defer cancel()

			req, err := http.NewRequestWithContext(ctx, http.MethodPost, xEnv.GraphQLRequestURL(),
				strings.NewReader(`{"query":"{ employees { id } }"}`))
			require.NoError(t, err)
			req.Header.Set("Content-Type", "application/json")

			client := &http.Client{}
			resp, err := client.Do(req)
			require.Error(t, err)
			require.Nil(t, resp, "client should not receive any response when it disconnects")

			spans := waitForStableSpans(t, exporter)

			// No span in the entire trace should be marked as ERROR for client disconnections
			for _, s := range spans {
				require.NotEqual(t, codes.Error, s.Status().Code,
					"span %q should not be marked as error when client disconnects", s.Name())
			}

			// Find the "Engine - Fetch" span and verify the cancellation is still recorded as an event
			var fetchSpan sdktrace.ReadOnlySpan
			for _, s := range spans {
				if s.Name() == "Engine - Fetch" {
					fetchSpan = s
					break
				}
			}
			require.NotNil(t, fetchSpan, "expected Engine - Fetch span to be exported")

			hasExceptionEvent := false
			for _, event := range fetchSpan.Events() {
				if event.Name == "exception" {
					hasExceptionEvent = true
					break
				}
			}
			require.True(t, hasExceptionEvent,
				"subgraph fetch span should have an exception event recorded for client disconnections")

			// The wg.request.error attribute should not be set on the fetch span
			for _, attr := range fetchSpan.Attributes() {
				if attr.Key == "wg.request.error" {
					require.False(t, attr.Value.AsBool(),
						"wg.request.error should not be true on fetch span for client disconnects")
				}
			}

			// Verify no 500 status code was written — the server should not produce
			// an error response when the client has disconnected
			requestLogs := xEnv.Observer().FilterField(zap.Int("status", 500)).All()
			require.Empty(t, requestLogs,
				"server should not write a 500 response for client disconnections")
		})
	})

	t.Run("persisted operation fetch span is not marked as error on client disconnect", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		// Create a slow CDN server that delays persisted operation responses long enough
		// for the client's request context to be canceled mid-fetch.
		cdnServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/" {
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`[]`))
				return
			}
			time.Sleep(2 * time.Second)
			w.WriteHeader(http.StatusNotFound)
		}))
		defer cdnServer.Close()

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.DebugLevel,
			},
			CdnSever: cdnServer,
			ModifyCDNConfig: func(cfg *config.CDNConfiguration) {
				cfg.CacheSize = 0 // Disable cache so every request hits the CDN
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			ctx, cancel := context.WithTimeout(t.Context(), 200*time.Millisecond)
			defer cancel()

			req, err := http.NewRequestWithContext(ctx, http.MethodPost, xEnv.GraphQLRequestURL(),
				strings.NewReader(`{"operationName":"Employees","extensions":{"persistedQuery":{"version":1,"sha256Hash":"dc67510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}}`))
			require.NoError(t, err)
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("graphql-client-name", "my-client")

			client := &http.Client{}
			resp, err := client.Do(req)
			require.Error(t, err)
			require.Nil(t, resp, "client should not receive any response when it disconnects")

			spans := waitForStableSpans(t, exporter)

			// No span should be marked as ERROR for client disconnections
			for _, s := range spans {
				require.NotEqual(t, codes.Error, s.Status().Code,
					"span %q should not be marked as error when client disconnects during persisted op fetch", s.Name())
			}

			// Verify the "Load Persisted Operation" span exists and has the exception event
			var poSpan sdktrace.ReadOnlySpan
			for _, s := range spans {
				if s.Name() == "Load Persisted Operation" {
					poSpan = s
					break
				}
			}
			require.NotNil(t, poSpan, "expected Load Persisted Operation span to be exported")

			hasExceptionEvent := false
			for _, event := range poSpan.Events() {
				if event.Name == "exception" {
					hasExceptionEvent = true
					break
				}
			}
			require.True(t, hasExceptionEvent,
				"Load Persisted Operation span should have an exception event for client disconnections")

			// Verify no 500 status code was written
			requestLogs := xEnv.Observer().FilterField(zap.Int("status", 500)).All()
			require.Empty(t, requestLogs,
				"server should not write a 500 response for client disconnections during persisted op fetch")
		})
	})

	t.Run("batched request spans are not marked as error on client disconnect", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.DebugLevel,
			},
			BatchingConfig: config.BatchingConfig{
				Enabled:            true,
				MaxConcurrency:     10,
				MaxEntriesPerBatch: 100,
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Delay: 2 * time.Second,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			ctx, cancel := context.WithTimeout(t.Context(), 200*time.Millisecond)
			defer cancel()

			res, err := xEnv.MakeGraphQLBatchedRequestRequestWithContext(ctx, []testenv.GraphQLRequest{
				{Query: `query employees { employees { id } }`},
				{Query: `query employee { employees { isAvailable } }`},
			}, nil)
			require.Error(t, err)
			require.Nil(t, res, "client should not receive any response when it disconnects")

			spans := waitForStableSpans(t, exporter)

			// No span should be marked as ERROR for client disconnections
			for _, s := range spans {
				require.NotEqual(t, codes.Error, s.Status().Code,
					"span %q should not be marked as error when client disconnects during batch request", s.Name())
			}

			// Verify no 500 status code was written
			requestLogs := xEnv.Observer().FilterField(zap.Int("status", 500)).All()
			require.Empty(t, requestLogs,
				"server should not write a 500 response for client disconnections during batch request")
		})
	})

	t.Run("root span is marked as error on subgraph failure", func(t *testing.T) {
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
