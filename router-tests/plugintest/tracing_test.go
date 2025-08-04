package plugintest

import (
	"context"
	"fmt"
	"github.com/wundergraph/cosmo/router-plugin/config"
	"github.com/wundergraph/cosmo/router-plugin/httpclient"
	"github.com/wundergraph/cosmo/router-plugin/tracing"
	plugin "github.com/wundergraph/cosmo/router-tests/plugintest/hello/generated"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.17.0"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/trace/tracetest"
)

func TestTracing(t *testing.T) {
	t.Run("verify tracing not enabled", func(t *testing.T) {

		t.Run("with tracing enabled parameter as false", func(t *testing.T) {
			exporter := tracetest.NewInMemoryExporter(t)

			startup := getTracingBaseConfig()
			startup.Telemetry.Tracing.Exporters = []config.Exporter{
				{},
			}

			tracingEnabled := false

			opts := config.RouterPluginConfig{
				TracingEnabled: tracingEnabled,
				MemoryExporter: exporter,
			}

			svc := setupTracingTest(t, startup, opts, nil)
			defer svc.Cleanup()

			resp, err := svc.Client.QueryRun(context.Background(), &plugin.QueryRunRequest{})
			require.NoError(t, err)
			require.NotNil(t, resp.Run)

			sn := exporter.GetSpans().Snapshots()
			require.Len(t, sn, 0)
		})

		t.Run("with tracing enabled parameter as true but no exporters", func(t *testing.T) {
			exporter := tracetest.NewInMemoryExporter(t)

			startup := getTracingBaseConfig()
			startup.Telemetry.Tracing.Exporters = []config.Exporter{}

			tracingEnabled := true

			opts := config.RouterPluginConfig{
				TracingEnabled: tracingEnabled,
				MemoryExporter: exporter,
			}

			svc := setupTracingTest(t, startup, opts, nil)
			defer svc.Cleanup()

			resp, err := svc.Client.QueryRun(context.Background(), &plugin.QueryRunRequest{})
			require.NoError(t, err)
			require.NotNil(t, resp.Run)

			sn := exporter.GetSpans().Snapshots()
			require.Len(t, sn, 0)
		})

		t.Run("with tracing enabled parameter as true but nil telemetry config", func(t *testing.T) {
			exporter := tracetest.NewInMemoryExporter(t)

			startup := getTracingBaseConfig()
			startup.Telemetry = nil

			tracingEnabled := true

			opts := config.RouterPluginConfig{
				TracingEnabled: tracingEnabled,
				MemoryExporter: exporter,
			}

			svc := setupTracingTest(t, startup, opts, nil)
			defer svc.Cleanup()

			resp, err := svc.Client.QueryRun(context.Background(), &plugin.QueryRunRequest{})
			require.NoError(t, err)
			require.NotNil(t, resp.Run)

			sn := exporter.GetSpans().Snapshots()
			require.Len(t, sn, 0)
		})

		t.Run("with tracing enabled parameter as true but nil tracing config", func(t *testing.T) {
			exporter := tracetest.NewInMemoryExporter(t)

			startup := getTracingBaseConfig()
			startup.Telemetry.Tracing = nil

			tracingEnabled := true

			opts := config.RouterPluginConfig{
				TracingEnabled: tracingEnabled,
				MemoryExporter: exporter,
			}

			svc := setupTracingTest(t, startup, opts, nil)
			defer svc.Cleanup()

			resp, err := svc.Client.QueryRun(context.Background(), &plugin.QueryRunRequest{})
			require.NoError(t, err)
			require.NotNil(t, resp.Run)

			sn := exporter.GetSpans().Snapshots()
			require.Len(t, sn, 0)
		})
	})

	t.Run("verify span", func(t *testing.T) {
		t.Parallel()

		t.Run("with base values", func(t *testing.T) {
			exporter := tracetest.NewInMemoryExporter(t)

			startup := getTracingBaseConfig()

			opts := config.RouterPluginConfig{
				TracingEnabled: true,
				MemoryExporter: exporter,
			}

			svc := setupTracingTest(t, startup, opts, nil)
			defer svc.Cleanup()

			resp, err := svc.Client.QueryRun(context.Background(), &plugin.QueryRunRequest{})
			require.NoError(t, err)
			require.NotNil(t, resp.Run)

			sn := exporter.GetSpans().Snapshots()
			require.Len(t, sn, 1)

			baseSpan := sn[0]

			expectedSpanName := "Router Plugin - /service.HelloService/QueryRun"
			require.Equal(t, expectedSpanName, baseSpan.Name())

			rootSpanAttributes := baseSpan.Resource().Attributes()
			require.Len(t, rootSpanAttributes, 9)

			expectedDefaultName := "cosmo-router-plugin"
			expectedDefaultVersion := "1.0.0"
			require.Contains(t, rootSpanAttributes, semconv.ServiceNameKey.String(expectedDefaultName))
			require.Contains(t, rootSpanAttributes, semconv.ServiceVersionKey.String(expectedDefaultVersion))
			require.Contains(t, rootSpanAttributes, tracing.WgIsPlugin.Bool(true))

			keys := make(map[attribute.Key]struct{})
			for _, attr := range rootSpanAttributes {
				require.True(t, attr.Valid())
				keys[attr.Key] = struct{}{}
				fmt.Println("Attribute:", attr.Key, "Value:", attr.Value.AsString())
			}

			require.Contains(t, keys, semconv.HostNameKey.String("").Key)
			require.Contains(t, keys, semconv.OSTypeKey.String("").Key)
			require.Contains(t, keys, semconv.ProcessPIDKey.String("").Key)
			require.Contains(t, keys, semconv.TelemetrySDKLanguageKey.String("").Key)
			require.Contains(t, keys, semconv.TelemetrySDKNameKey.String("").Key)
			require.Contains(t, keys, semconv.TelemetrySDKVersionKey.String("").Key)
		})

		t.Run("with custom service name and version", func(t *testing.T) {
			exporter := tracetest.NewInMemoryExporter(t)

			customName := "test-service"
			customVersion := "2.0.0"

			opts := config.RouterPluginConfig{
				ServiceName:    customName,
				ServiceVersion: customVersion,
				TracingEnabled: true,
				MemoryExporter: exporter,
			}

			svc := setupTracingTest(t, getTracingBaseConfig(), opts, nil)
			defer svc.Cleanup()

			resp, err := svc.Client.QueryRun(context.Background(), &plugin.QueryRunRequest{})
			require.NoError(t, err)
			require.NotNil(t, resp.Run)

			sn := exporter.GetSpans().Snapshots()
			require.Len(t, sn, 1)

			rootSpanAttributes := sn[0].Resource().Attributes()

			require.Contains(t, rootSpanAttributes, semconv.ServiceNameKey.String(customName))
			require.Contains(t, rootSpanAttributes, semconv.ServiceVersionKey.String(customVersion))
		})

		t.Run("verify custom values set by the plugin", func(t *testing.T) {
			exporter := tracetest.NewInMemoryExporter(t)

			opts := config.RouterPluginConfig{
				TracingEnabled: true,
				MemoryExporter: exporter,
			}

			customKey := attribute.Key("custom.key").String("keythere")
			customValue := attribute.Key("custom.count").String("valuethere")
			customSpanName := "Custom Span Name"

			runner := func(ctx context.Context, req *plugin.QueryRunRequest) (*plugin.QueryRunResponse, error) {
				span := trace.SpanFromContext(ctx)
				require.NotNil(t, span)
				span.SetName(customSpanName)
				span.SetAttributes(
					customKey,
					customValue,
				)

				response := &plugin.QueryRunResponse{
					Run: &plugin.Result{
						ResponseString: "response string",
					},
				}
				return response, nil
			}

			svc := setupTracingTest(t, getTracingBaseConfig(), opts, runner)
			defer svc.Cleanup()

			resp, err := svc.Client.QueryRun(context.Background(), &plugin.QueryRunRequest{})
			require.NoError(t, err)
			require.NotNil(t, resp.Run)

			sn := exporter.GetSpans().Snapshots()
			require.Len(t, sn, 1)

			baseSpan := sn[0]

			require.Equal(t, customSpanName, baseSpan.Name())

			attributes := baseSpan.Attributes()
			require.Len(t, attributes, 2)

			require.Contains(t, attributes, customKey)
			require.Contains(t, attributes, customValue)
		})

		t.Run("verify custom spans created by the plugin", func(t *testing.T) {
			exporter := tracetest.NewInMemoryExporter(t)

			opts := config.RouterPluginConfig{
				TracingEnabled: true,
				MemoryExporter: exporter,
			}

			customKey := attribute.Key("custom.key").String("keythere")
			customValue := attribute.Key("custom.count").String("valuethere")
			customSpanName := "Custom Span Name"

			runner := func(ctx context.Context, req *plugin.QueryRunRequest) (*plugin.QueryRunResponse, error) {
				tracer := otel.Tracer("inner-tracer")

				_, span := tracer.Start(ctx, customSpanName)
				span.SetAttributes(
					customKey,
					customValue,
				)
				defer span.End()

				response := &plugin.QueryRunResponse{
					Run: &plugin.Result{
						ResponseString: "response string",
					},
				}
				return response, nil
			}

			svc := setupTracingTest(t, getTracingBaseConfig(), opts, runner)
			defer svc.Cleanup()

			resp, err := svc.Client.QueryRun(context.Background(), &plugin.QueryRunRequest{})
			require.NoError(t, err)
			require.NotNil(t, resp.Run)

			sn := exporter.GetSpans().Snapshots()
			require.Len(t, sn, 2)

			baseSpan := sn[1]
			baseSpanName := "Router Plugin - /service.HelloService/QueryRun"
			require.Equal(t, baseSpanName, baseSpan.Name())
			require.Len(t, baseSpan.Attributes(), 0)

			customSpan := sn[0]
			require.Equal(t, customSpanName, customSpan.Name())
			require.Contains(t, customSpan.Attributes(), customKey)
			require.Contains(t, customSpan.Attributes(), customValue)
		})
	})

	t.Run("verify ip anonymization", func(t *testing.T) {
		t.Run("when not enabled", func(t *testing.T) {
			exporter := tracetest.NewInMemoryExporter(t)

			startup := getTracingBaseConfig()
			startup.IPAnonymization = &config.IPAnonymization{
				Enabled: false,
				Method:  config.Redact,
			}

			opts := config.RouterPluginConfig{
				TracingEnabled: true,
				MemoryExporter: exporter,
			}

			httpClientIPKey := "127.2.2.5"
			netSockPeerAddrKey := "127.3.2.6"

			runner := func(ctx context.Context, req *plugin.QueryRunRequest) (*plugin.QueryRunResponse, error) {
				span := trace.SpanFromContext(ctx)
				require.NotNil(t, span)
				span.SetAttributes(
					semconv.HTTPClientIPKey.String(httpClientIPKey),
					semconv.NetSockPeerAddrKey.String(netSockPeerAddrKey),
				)

				response := &plugin.QueryRunResponse{
					Run: &plugin.Result{
						ResponseString: "response string",
					},
				}
				return response, nil
			}

			svc := setupTracingTest(t, startup, opts, runner)
			defer svc.Cleanup()

			resp, err := svc.Client.QueryRun(context.Background(), &plugin.QueryRunRequest{})
			require.NoError(t, err)
			require.NotNil(t, resp.Run)

			sn := exporter.GetSpans().Snapshots()
			require.Len(t, sn, 1)

			baseSpan := sn[0]
			require.Len(t, baseSpan.Attributes(), 2)
			require.Contains(t, baseSpan.Attributes(), semconv.HTTPClientIPKey.String(httpClientIPKey))
			require.Contains(t, baseSpan.Attributes(), semconv.NetSockPeerAddrKey.String(netSockPeerAddrKey))
		})

		t.Run("when nil", func(t *testing.T) {
			exporter := tracetest.NewInMemoryExporter(t)

			startup := getTracingBaseConfig()
			startup.IPAnonymization = nil

			opts := config.RouterPluginConfig{
				TracingEnabled: true,
				MemoryExporter: exporter,
			}

			httpClientIPKey := "127.2.2.5"
			netSockPeerAddrKey := "127.3.2.6"

			runner := func(ctx context.Context, req *plugin.QueryRunRequest) (*plugin.QueryRunResponse, error) {
				span := trace.SpanFromContext(ctx)
				require.NotNil(t, span)
				span.SetAttributes(
					semconv.HTTPClientIPKey.String(httpClientIPKey),
					semconv.NetSockPeerAddrKey.String(netSockPeerAddrKey),
				)

				response := &plugin.QueryRunResponse{
					Run: &plugin.Result{
						ResponseString: "response string",
					},
				}
				return response, nil
			}

			svc := setupTracingTest(t, startup, opts, runner)
			defer svc.Cleanup()

			resp, err := svc.Client.QueryRun(context.Background(), &plugin.QueryRunRequest{})
			require.NoError(t, err)
			require.NotNil(t, resp.Run)

			sn := exporter.GetSpans().Snapshots()
			require.Len(t, sn, 1)

			baseSpan := sn[0]
			require.Len(t, baseSpan.Attributes(), 2)
			require.Contains(t, baseSpan.Attributes(), semconv.HTTPClientIPKey.String(httpClientIPKey))
			require.Contains(t, baseSpan.Attributes(), semconv.NetSockPeerAddrKey.String(netSockPeerAddrKey))
		})

		t.Run("with redact", func(t *testing.T) {
			exporter := tracetest.NewInMemoryExporter(t)

			startup := getTracingBaseConfig()
			startup.IPAnonymization = &config.IPAnonymization{
				Enabled: true,
				Method:  config.Redact,
			}

			opts := config.RouterPluginConfig{
				TracingEnabled: true,
				MemoryExporter: exporter,
			}

			runner := func(ctx context.Context, req *plugin.QueryRunRequest) (*plugin.QueryRunResponse, error) {
				span := trace.SpanFromContext(ctx)
				require.NotNil(t, span)
				span.SetAttributes(
					semconv.HTTPClientIPKey.String("127.2.2.5"),
					semconv.NetSockPeerAddrKey.String("127.3.2.5"),
				)

				response := &plugin.QueryRunResponse{
					Run: &plugin.Result{
						ResponseString: "response string",
					},
				}
				return response, nil
			}

			svc := setupTracingTest(t, startup, opts, runner)
			defer svc.Cleanup()

			resp, err := svc.Client.QueryRun(context.Background(), &plugin.QueryRunRequest{})
			require.NoError(t, err)
			require.NotNil(t, resp.Run)

			sn := exporter.GetSpans().Snapshots()
			require.Len(t, sn, 1)

			baseSpan := sn[0]
			require.Len(t, baseSpan.Attributes(), 2)
			require.Contains(t, baseSpan.Attributes(), semconv.HTTPClientIPKey.String("[REDACTED]"))
			require.Contains(t, baseSpan.Attributes(), semconv.NetSockPeerAddrKey.String("[REDACTED]"))
		})

		t.Run("with hash", func(t *testing.T) {
			exporter := tracetest.NewInMemoryExporter(t)

			startup := getTracingBaseConfig()
			startup.IPAnonymization = &config.IPAnonymization{
				Enabled: true,
				Method:  config.Hash,
			}

			opts := config.RouterPluginConfig{
				TracingEnabled: true,
				MemoryExporter: exporter,
			}

			runner := func(ctx context.Context, req *plugin.QueryRunRequest) (*plugin.QueryRunResponse, error) {
				span := trace.SpanFromContext(ctx)
				require.NotNil(t, span)
				span.SetAttributes(
					semconv.HTTPClientIPKey.String("127.2.2.5"),
					semconv.NetSockPeerAddrKey.String("127.3.2.5"),
				)

				response := &plugin.QueryRunResponse{
					Run: &plugin.Result{
						ResponseString: "response string",
					},
				}
				return response, nil
			}

			svc := setupTracingTest(t, startup, opts, runner)
			defer svc.Cleanup()

			resp, err := svc.Client.QueryRun(context.Background(), &plugin.QueryRunRequest{})
			require.NoError(t, err)
			require.NotNil(t, resp.Run)

			sn := exporter.GetSpans().Snapshots()
			require.Len(t, sn, 1)

			baseSpan := sn[0]
			require.Len(t, baseSpan.Attributes(), 2)
			require.Contains(t, baseSpan.Attributes(), semconv.HTTPClientIPKey.String("70c76e7df1c5f51c716f98e4ec3372566a242d429de2cc87c683034df9a440f5"))
			require.Contains(t, baseSpan.Attributes(), semconv.NetSockPeerAddrKey.String("a5ec9311d0d04e08d359e8135fda0e8426a797199eefe98f07ab95b7a1acdf59"))
		})
	})

	t.Run("http client tracing", func(t *testing.T) {
		t.Run("when tracing is disabled", func(t *testing.T) {
			expectedResponse := `{"message":"success"}`
			mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, err := w.Write([]byte(expectedResponse))
				require.NoError(t, err)
			}))
			defer mockServer.Close()

			exporter := tracetest.NewInMemoryExporter(t)

			opts := config.RouterPluginConfig{
				TracingEnabled: true,
				MemoryExporter: exporter,
			}

			runner := func(ctx context.Context, req *plugin.QueryRunRequest) (*plugin.QueryRunResponse, error) {
				for range 5 {
					client := httpclient.New(httpclient.WithBaseURL(mockServer.URL))
					resp, err := client.Get(ctx, "/test")
					require.NoError(t, err)
					require.Equal(t, expectedResponse, string(resp.Body))
				}

				response := &plugin.QueryRunResponse{
					Run: &plugin.Result{
						ResponseString: "response string",
					},
				}
				return response, nil
			}

			svc := setupTracingTest(t, getTracingBaseConfig(), opts, runner)
			defer svc.Cleanup()

			resp, err := svc.Client.QueryRun(context.Background(), &plugin.QueryRunRequest{})
			require.NoError(t, err)
			require.NotNil(t, resp.Run)

			snapshots := exporter.GetSpans().Snapshots()
			require.Len(t, snapshots, 1)

			baseSpan := snapshots[0]
			baseSpanName := "Router Plugin - /service.HelloService/QueryRun"
			require.Equal(t, baseSpanName, baseSpan.Name())
			require.Len(t, baseSpan.Attributes(), 0)
		})

		t.Run("when tracing enabled", func(t *testing.T) {
			expectedResponse := `{"message":"success"}`
			mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, err := w.Write([]byte(expectedResponse))
				require.NoError(t, err)
			}))
			defer mockServer.Close()

			exporter := tracetest.NewInMemoryExporter(t)

			opts := config.RouterPluginConfig{
				TracingEnabled: true,
				MemoryExporter: exporter,
			}

			numberOfHttpRequests := 5
			path := "/test"

			runner := func(ctx context.Context, req *plugin.QueryRunRequest) (*plugin.QueryRunResponse, error) {
				for range numberOfHttpRequests {
					client := httpclient.New(httpclient.WithTracing(), httpclient.WithBaseURL(mockServer.URL))
					resp, err := client.Get(ctx, path)
					require.NoError(t, err)
					require.Equal(t, expectedResponse, string(resp.Body))
				}

				response := &plugin.QueryRunResponse{
					Run: &plugin.Result{
						ResponseString: "response string",
					},
				}
				return response, nil
			}

			svc := setupTracingTest(t, getTracingBaseConfig(), opts, runner)
			defer svc.Cleanup()

			resp, err := svc.Client.QueryRun(context.Background(), &plugin.QueryRunRequest{})
			require.NoError(t, err)
			require.NotNil(t, resp.Run)

			snapshots := exporter.GetSpans().Snapshots()
			require.Len(t, snapshots, 1+numberOfHttpRequests)

			httpCallSpan1 := snapshots[0]
			require.Len(t, httpCallSpan1.Attributes(), 2)

			expectedMethod := "GET"
			expectedUrl := mockServer.URL + path
			expectedSpanName := fmt.Sprintf("http.request - %s %s", expectedMethod, expectedUrl)

			require.Equal(t, expectedSpanName, httpCallSpan1.Name())
			require.Contains(t, httpCallSpan1.Attributes(), semconv.HTTPURLKey.String(expectedUrl))
			require.Contains(t, httpCallSpan1.Attributes(), semconv.HTTPMethodKey.String(expectedMethod))

			// Verify that the HTTP client spans are the actual occurences
			httpCallInstances := 0
			for _, snapshot := range snapshots {
				if expectedSpanName == snapshot.Name() {
					httpCallInstances++
				}
			}
			require.Equal(t, numberOfHttpRequests, httpCallInstances)
		})

		t.Run("verify external service gets headers propagated", func(t *testing.T) {
			traceId := "4bf92f3577b34da6a3ce929d0e0e4736"
			traceParentHeader := "00-" + traceId + "-00f067aa0ba902b7-01"
			baggageValue := "key1=value1,key2=value2"

			mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				//Jaeger
				require.Contains(t, r.Header.Get("Uber-Trace-Id"), "4bf92f3577b34da6a3ce929d0e0e4736")

				// B3
				require.Contains(t, r.Header.Get("B3"), traceId)
				require.Equal(t, traceId, r.Header.Get("X-B3-Traceid"))
				require.NotEmpty(t, r.Header.Get("X-B3-Spanid"))
				require.Equal(t, "1", r.Header.Get("X-B3-Sampled"))

				// Datadog
				require.NotEmpty(t, r.Header.Get("X-Datadog-Parent-Id"))
				require.Equal(t, "11803532876627986230", r.Header.Get("X-Datadog-Trace-Id"))
				require.Equal(t, "1", r.Header.Get("X-Datadog-Sampling-Priority"))

				// Traceparent
				require.Contains(t, r.Header.Get("Traceparent"), traceId)

				// Baggage
				require.Contains(t, r.Header.Get("Baggage"), baggageValue)

				w.Header().Set("Content-Type", "application/json")
				_, err := w.Write([]byte(`{"message":"success"}`))
				require.NoError(t, err)
			}))
			defer mockServer.Close()

			exporter := tracetest.NewInMemoryExporter(t)

			baseConfig := getTracingBaseConfig()
			baseConfig.Telemetry.Tracing.Propagators = []config.Propagator{
				config.PropagatorTraceContext,
				config.PropagatorB3,
				config.PropagatorJaeger,
				config.PropagatorBaggage,
				config.PropagatorDatadog,
			}

			opts := config.RouterPluginConfig{
				TracingEnabled: true,
				MemoryExporter: exporter,
			}

			runner := func(ctx context.Context, req *plugin.QueryRunRequest) (*plugin.QueryRunResponse, error) {
				client := httpclient.New(httpclient.WithTracing(), httpclient.WithBaseURL(mockServer.URL))
				_, err := client.Get(ctx, "/test")
				require.NoError(t, err)

				response := &plugin.QueryRunResponse{
					Run: &plugin.Result{
						ResponseString: "response string",
					},
				}
				return response, nil
			}

			svc := setupTracingTest(t, baseConfig, opts, runner)
			defer svc.Cleanup()

			ctx := context.Background()

			ctx = metadata.NewOutgoingContext(ctx, metadata.New(map[string]string{
				"traceparent": traceParentHeader,
				"Baggage":     baggageValue,
			}))

			resp, err := svc.Client.QueryRun(ctx, &plugin.QueryRunRequest{})
			require.NoError(t, err)
			require.NotNil(t, resp.Run)
			require.Len(t, exporter.GetSpans().Snapshots(), 2)
		})
	})

}

func getTracingBaseConfig() config.StartupConfig {
	return config.StartupConfig{
		Telemetry: &config.Telemetry{
			Tracing: &config.Tracing{
				Sampler: 1.0,
				Exporters: []config.Exporter{
					{},
				},
			},
		},
	}
}

type runFunc func(_ context.Context, req *plugin.QueryRunRequest) (*plugin.QueryRunResponse, error)

func setupTracingTest(t *testing.T, startup config.StartupConfig, opts config.RouterPluginConfig, runner runFunc) *PluginGrpcServerSetupResponse[plugin.HelloServiceClient] {
	// Use base runner if nothing is passed
	if runner == nil {
		runner = func(_ context.Context, req *plugin.QueryRunRequest) (*plugin.QueryRunResponse, error) {
			response := &plugin.QueryRunResponse{
				Run: &plugin.Result{
					ResponseString: "response string",
				},
			}
			return response, nil
		}
	}

	svc := SetupPluginGrpcServerForTest[plugin.HelloServiceClient](t, PluginGrpcTestConfig[plugin.HelloServiceClient]{
		StartupConfig:      startup,
		RouterPluginConfig: opts,
		RegisterServiceFunc: func(reg grpc.ServiceRegistrar) {
			plugin.RegisterHelloServiceServer(reg, &HelloService{runFunc: runner})
		},
		CreateClientFunc: func(conn *grpc.ClientConn) plugin.HelloServiceClient {
			return plugin.NewHelloServiceClient(conn)
		},
	})
	return svc
}
