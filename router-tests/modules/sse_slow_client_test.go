package module_test

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	sse_slow_client "github.com/wundergraph/cosmo/router-tests/modules/sse-slow-client"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/trace/tracetest"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	oteltracetest "go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.uber.org/zap/zapcore"
)

func TestSSESlowClientModule(t *testing.T) {
	t.Parallel()

	const (
		sseWriteTimeout = time.Second
		waitTimeout     = 60 * time.Second
		// The subgraph emits without pause, so a client that does not read fills
		// the transport buffers within a few seconds.
		subscription = `{"query":"subscription { countEmp(max: 100000000, intervalMilliseconds: 0) }"}`
	)

	protocols := []struct {
		name string
		tls  bool
	}{
		{name: "HTTP/1.1", tls: false},
		{name: "HTTP/2", tls: true},
	}

	type fixture struct {
		reader   *sdkmetric.ManualReader
		exporter *oteltracetest.InMemoryExporter
		config   *testenv.Config
	}

	newFixture := func(t *testing.T, tls bool) fixture {
		reader := sdkmetric.NewManualReader()
		exporter := tracetest.NewInMemoryExporter(t)

		cfg := &testenv.Config{
			TraceExporter: exporter,
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.WarnLevel,
			},
			RouterOptions: []core.Option{
				core.WithCustomModules(&sse_slow_client.SSESlowClientModule{
					MeterProvider: sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader)),
				}),
				core.WithSubscriptionHeartbeatInterval(time.Minute),
			},
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.SSEServerWriteTimeout = sseWriteTimeout
			},
		}
		if tls {
			// TLS enables HTTP/2.
			cfg.TLSConfig = config.TLSConfiguration{
				Server: config.TLSServerConfiguration{
					Enabled:  true,
					CertFile: "../testdata/tls/cert.pem",
					KeyFile:  "../testdata/tls/key.pem",
				},
			}
		}

		return fixture{reader: reader, exporter: exporter, config: cfg}
	}

	subscribe := func(t *testing.T, xEnv *testenv.Environment, tls bool) *http.Response {
		t.Helper()

		request, err := http.NewRequestWithContext(t.Context(), http.MethodPost, xEnv.GraphQLRequestURL(), strings.NewReader(subscription))
		require.NoError(t, err)
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Accept", "text/event-stream")

		client := xEnv.RouterClient
		if !tls {
			client = &http.Client{}
		}

		response, err := client.Do(request)
		require.NoError(t, err)
		require.Equal(t, http.StatusOK, response.StatusCode)
		if tls {
			require.Equal(t, 2, response.ProtoMajor)
		} else {
			require.Equal(t, 1, response.ProtoMajor)
		}
		return response
	}

	for _, protocol := range protocols {
		t.Run("reports a client that stops reading over "+protocol.name, func(t *testing.T) {
			if !protocol.tls {
				// Over HTTP/1.1 the only backpressure is the kernel's socket buffers,
				// and on loopback they can absorb tens of megabytes of unread events,
				// so the client cannot be stalled reliably. HTTP/2 stalls on its
				// flow-control window instead, which does not depend on the kernel.
				t.Skip("Skipping: an HTTP/1.1 client cannot be stalled reliably on loopback")
			}
			t.Parallel()

			f := newFixture(t, protocol.tls)

			testenv.Run(t, f.config, func(t *testing.T, xEnv *testenv.Environment) {
				// The body is never read, so the router's writes eventually block.
				response := subscribe(t, xEnv, protocol.tls)
				defer func() { _ = response.Body.Close() }()

				require.Eventually(t, func() bool {
					return xEnv.Observer().FilterMessage(sse_slow_client.DropLogMessage).Len() == 1
				}, waitTimeout, 100*time.Millisecond)
				xEnv.WaitForSubscriptionCount(0, waitTimeout)

				logs := xEnv.Observer().FilterMessage(sse_slow_client.DropLogMessage).All()
				require.Len(t, logs, 1)
				require.Equal(t, zapcore.WarnLevel, logs[0].Level)
				waited, ok := logs[0].ContextMap()["write_wait"].(time.Duration)
				require.True(t, ok)
				require.GreaterOrEqual(t, waited, sseWriteTimeout)

				require.Equal(t, int64(1), dropCount(t, f.reader))

				require.Eventually(t, func() bool {
					return dropSpanEvents(f.exporter) == 1
				}, waitTimeout, 100*time.Millisecond)
			})
		})

		t.Run("ignores a client that disconnects over "+protocol.name, func(t *testing.T) {
			t.Parallel()

			f := newFixture(t, protocol.tls)

			testenv.Run(t, f.config, func(t *testing.T, xEnv *testenv.Environment) {
				response := subscribe(t, xEnv, protocol.tls)
				xEnv.WaitForSubscriptionCount(1, waitTimeout)

				// A healthy client keeps reading until it closes the stream.
				drained := make(chan struct{})
				go func() {
					defer close(drained)
					_, _ = io.Copy(io.Discard, response.Body)
				}()
				time.Sleep(500 * time.Millisecond)
				require.NoError(t, response.Body.Close())
				<-drained

				xEnv.WaitForSubscriptionCount(0, waitTimeout)

				// The root span ends once the request is done, after any report.
				require.Eventually(t, func() bool {
					return rootSpanEnded(f.exporter)
				}, waitTimeout, 100*time.Millisecond)

				require.Zero(t, xEnv.Observer().FilterMessage(sse_slow_client.DropLogMessage).Len())
				require.Zero(t, dropCount(t, f.reader))
				require.Zero(t, dropSpanEvents(f.exporter))
			})
		})
	}
}

func dropCount(t *testing.T, reader *sdkmetric.ManualReader) int64 {
	t.Helper()

	var collected metricdata.ResourceMetrics
	require.NoError(t, reader.Collect(context.Background(), &collected))

	var total int64
	for _, scope := range collected.ScopeMetrics {
		for _, m := range scope.Metrics {
			if m.Name != sse_slow_client.DropCounterName {
				continue
			}
			sum, ok := m.Data.(metricdata.Sum[int64])
			require.True(t, ok)
			for _, point := range sum.DataPoints {
				total += point.Value
			}
		}
	}
	return total
}

func dropSpanEvents(exporter *oteltracetest.InMemoryExporter) int {
	count := 0
	for _, span := range exporter.GetSpans().Snapshots() {
		for _, event := range span.Events() {
			if event.Name == sse_slow_client.DropSpanEventName {
				count++
			}
		}
	}
	return count
}

func rootSpanEnded(exporter *oteltracetest.InMemoryExporter) bool {
	for _, span := range exporter.GetSpans().Snapshots() {
		if !span.Parent().IsValid() {
			return true
		}
	}
	return false
}
