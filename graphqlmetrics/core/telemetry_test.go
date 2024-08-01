package core

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/phayes/freeport"
	"github.com/prometheus/client_golang/prometheus"
	io_prometheus_client "github.com/prometheus/client_model/go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	graphqlmetricsv1 "github.com/wundergraph/cosmo/graphqlmetrics/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"github.com/wundergraph/cosmo/graphqlmetrics/gen/proto/wg/cosmo/graphqlmetrics/v1/graphqlmetricsv1connect"
	"github.com/wundergraph/cosmo/graphqlmetrics/pkg/telemetry"
	"github.com/wundergraph/cosmo/graphqlmetrics/test"
	"go.uber.org/zap"
	brotli "go.withmatt.com/connect-brotli"
)

const (
	// this token was generated using the local secret and is therefore already corrupted
	bearerToken     = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJvcmdhbml6YXRpb25faWQiOiJvcmcxMjMiLCJmZWRlcmF0ZWRfZ3JhcGhfaWQiOiJmZWQxMjMiLCJpYXQiOjE3MjI1MDcyMTJ9.wtblSf4hTEcE8CaKwNyvHo2C8y7EAUHxEbCP6rGerXM"
	ingestJWTSecret = "fkczyomvdprgvtmvkuhvprxuggkbgwld"
)

func newServerCtx() (context.Context, context.CancelFunc) {
	return signal.NotifyContext(context.Background(), os.Interrupt,
		syscall.SIGHUP,  // process is detached from terminal
		syscall.SIGTERM, // default for kill
		syscall.SIGKILL,
		syscall.SIGQUIT, // ctrl + \
		syscall.SIGINT,  // ctrl+c
	)
}

func TestExposingPrometheusMetrics(t *testing.T) {
	if os.Getenv("INT_TESTS") != "true" {
		t.Skip("Skipping integration tests")
	}

	freePort, err := freeport.GetFreePort()
	require.Nil(t, err)
	prometheusListenAddr := fmt.Sprintf("0.0.0.0:%d", freePort)

	type tc struct {
		name       string
		prom       telemetry.PrometheusConfig
		statusCode int
	}

	tests := []tc{
		{
			name: "enabled",
			prom: telemetry.PrometheusConfig{
				Enabled:      true,
				ListenAddr:   prometheusListenAddr,
				Path:         "/metrics",
				TestRegistry: prometheus.NewRegistry(),
			},
			statusCode: 200,
		},
		{
			name: "disabled",
			prom: telemetry.PrometheusConfig{
				Enabled:      false,
				ListenAddr:   prometheusListenAddr,
				Path:         "/metrics",
				TestRegistry: prometheus.NewRegistry(),
			},
			statusCode: -1,
		},
	}

	db := test.GetTestDatabase(t)
	msvc := NewMetricsService(zap.NewNop(), db)
	ctx, stop := newServerCtx()
	defer stop()

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svr := NewServer(ctx, msvc,
				WithListenAddr("0.0.0.0:0"),
				WithMetrics(&telemetry.Config{
					Prometheus: tt.prom,
				}))

			go func() {
				if err := svr.Start(); err != nil && !errors.Is(err, http.ErrServerClosed) {
					t.Logf("failed starting main server")
					stop()
				}
			}()

			defer func() {
				err := svr.Shutdown(ctx)
				if err != nil {
					t.Fatalf("Failed to shut down server: %v", err)
				}
			}()
			time.Sleep(2 * time.Second)

			endpoint := fmt.Sprintf("http://%s%s", tt.prom.ListenAddr, tt.prom.Path)
			resp, err := http.Get(endpoint)

			if resp != nil {
				defer resp.Body.Close()
				// the case when metrics server should be enabled
				require.Nil(t, err)
				assert.Equal(t, true, tt.prom.Enabled)
				assert.Equal(t, tt.statusCode, resp.StatusCode)

			} else {
				// the case when metrics server should be disabled
				// there will be no response and therefore no status code
				assert.Equal(t, false, tt.prom.Enabled)
				assert.NotNil(t, err)
			}
		})
	}
}

func TestValidateExposedMetrics(t *testing.T) {
	if os.Getenv("INT_TESTS") != "true" {
		t.Skip("Skipping integration tests")
	}

	prometheusServerPort, err := freeport.GetFreePort()
	require.Nil(t, err)
	prometheusListenAddr := fmt.Sprintf("0.0.0.0:%d", prometheusServerPort)

	mainServerPort, err := freeport.GetFreePort()
	require.Nil(t, err)
	mainListenAddr := fmt.Sprintf("0.0.0.0:%d", mainServerPort)

	registry := prometheus.NewRegistry()
	prom := telemetry.PrometheusConfig{
		Enabled:      true,
		ListenAddr:   prometheusListenAddr,
		Path:         "/metrics",
		TestRegistry: registry,
	}

	ctx, stop := newServerCtx()
	defer stop()

	db := test.GetTestDatabase(t)
	msvc := NewMetricsService(zap.NewNop(), db)

	svr := NewServer(ctx, msvc,
		WithListenAddr(mainListenAddr),
		WithJwtSecret([]byte(ingestJWTSecret)),
		WithMetrics(&telemetry.Config{
			Prometheus: prom,
		}))

	go func() {
		if err := svr.Start(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			t.Logf("failed starting main server")
			stop()
		}
	}()
	defer func() {
		err := svr.Shutdown(context.Background())
		if err != nil {
			t.Fatalf("Failed to shut down server: %v", err)
		}
	}()

	time.Sleep(2 * time.Second)

	t.Run("get default process metrics", func(t *testing.T) {
		endpoint := fmt.Sprintf("http://%s%s", prom.ListenAddr, prom.Path)
		resp, err := http.Get(endpoint)
		require.Nil(t, err)
		require.NotNil(t, resp)
		defer resp.Body.Close()

		b, err := io.ReadAll(resp.Body)
		require.Nil(t, err)

		metrics := string(b)

		require.NotNil(t, metrics)

		expectedMetrics := []string{
			"promhttp_metric_handler_errors_total",
			"go_gc_duration_seconds",
			"go_gc_duration_seconds",
			"go_gc_duration_seconds",
			"go_gc_duration_seconds",
			"go_gc_duration_seconds",
			"go_gc_duration_seconds_sum",
			"go_gc_duration_seconds_count",
			"go_goroutines",
			"go_info",
			"go_memstats_alloc_bytes",
			"go_memstats_alloc_bytes_total",
			"go_memstats_buck_hash_sys_bytes",
			"go_memstats_frees_total",
			"go_memstats_gc_sys_bytes",
			"go_memstats_heap_alloc_bytes",
			"go_memstats_heap_idle_bytes",
			"go_memstats_heap_inuse_bytes",
			"go_memstats_heap_objects",
			"go_memstats_heap_released_bytes",
			"go_memstats_heap_sys_bytes",
			"go_memstats_last_gc_time_seconds",
			"go_memstats_lookups_total",
			"go_memstats_mallocs_total",
			"go_memstats_mcache_inuse_bytes",
			"go_memstats_mcache_sys_bytes",
			"go_memstats_mspan_inuse_bytes",
			"go_memstats_mspan_sys_bytes",
			"go_memstats_next_gc_bytes",
			"go_memstats_other_sys_bytes",
			"go_memstats_stack_inuse_bytes",
			"go_memstats_stack_sys_bytes",
			"go_memstats_sys_bytes",
			"go_threads",
			"process_cpu_seconds_total",
			"process_max_fds",
			"process_open_fds",
			"process_resident_memory_bytes",
			"process_start_time_seconds",
			"process_virtual_memory_bytes",
			"process_virtual_memory_max_bytes",
			"promhttp_metric_handler_errors_total",
			"promhttp_metric_handler_errors_total",
		}

		for _, m := range expectedMetrics {
			require.True(t, strings.Contains(metrics, m))
		}
	})

	t.Run("publishing metrics should increase the http_requests_total", func(t *testing.T) {
		client := graphqlmetricsv1connect.NewGraphQLMetricsServiceClient(
			http.DefaultClient,
			fmt.Sprintf("http://%s", mainListenAddr),
			brotli.WithCompression(),
			connect.WithSendCompression(brotli.Name),
		)

		req := &connect.Request[graphqlmetricsv1.PublishGraphQLRequestMetricsRequest]{}
		req.Header().Add("Authorization", fmt.Sprintf("Bearer %s", bearerToken))

		res, err := client.PublishGraphQLMetrics(context.Background(), req)
		require.Nil(t, err)
		require.NotNil(t, res)

		metrics, err := registry.Gather()
		require.Nil(t, err)
		require.NotNil(t, metrics)

		requestCount := findMetricFamilyByName(metrics, "http_requests_total")
		metric := requestCount.GetMetric()[0]
		count := metric.Counter.GetValue()
		assert.Equal(t, float64(1), count)

		labels := metric.Label

		expectedLabels := []*io_prometheus_client.LabelPair{
			{
				Name:  PointerOf("host_name"),
				Value: PointerOf(mainListenAddr),
			},
			{
				Name:  PointerOf("http_request_method"),
				Value: PointerOf("POST"),
			},
			{
				Name:  PointerOf("network_protocol_name"),
				Value: PointerOf("connect"),
			},
			{
				Name:  PointerOf("otel_scope_name"),
				Value: PointerOf("cosmo.graphqlmetrics.prometheus"),
			},
			{
				Name:  PointerOf("otel_scope_version"),
				Value: PointerOf("0.0.1"),
			},
			{
				Name:  PointerOf("rpc_grpc_status_code"),
				Value: PointerOf("0"),
			},
			{
				Name:  PointerOf("rpc_method"),
				Value: PointerOf("PublishGraphQLMetrics"),
			},
			{
				Name:  PointerOf("rpc_service"),
				Value: PointerOf("wg.cosmo.graphqlmetrics.v1.GraphQLMetricsService"),
			},
			{
				Name:  PointerOf("rpc_system"),
				Value: PointerOf("connect_rpc"),
			},
			{
				Name:  PointerOf("wg_federated_graph_id"),
				Value: PointerOf("fed123"),
			},
			{
				Name:  PointerOf("wg_organization_id"),
				Value: PointerOf("org123"),
			},
		}
		require.Equal(t, expectedLabels, labels)
	})
}

func TestValidateExposedAttirbutesWithoutClaims(t *testing.T) {
	if os.Getenv("INT_TESTS") != "true" {
		t.Skip("Skipping integration tests")
	}

	prometheusServerPort, err := freeport.GetFreePort()
	require.Nil(t, err)
	prometheusListenAddr := fmt.Sprintf("0.0.0.0:%d", prometheusServerPort)

	mainServerPort, err := freeport.GetFreePort()
	require.Nil(t, err)
	mainListenAddr := fmt.Sprintf("0.0.0.0:%d", mainServerPort)

	registry := prometheus.NewRegistry()
	prom := telemetry.PrometheusConfig{
		Enabled:      true,
		ListenAddr:   prometheusListenAddr,
		Path:         "/metrics",
		TestRegistry: registry,
	}

	ctx, stop := newServerCtx()
	defer stop()

	db := test.GetTestDatabase(t)
	msvc := NewMetricsService(zap.NewNop(), db)

	svr := NewServer(ctx, msvc,
		WithListenAddr(mainListenAddr),
		WithJwtSecret([]byte(ingestJWTSecret)),
		WithMetrics(&telemetry.Config{
			Prometheus: prom,
		}))

	go func() {
		if err := svr.Start(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			t.Logf("failed starting main server")
			stop()
		}
	}()
	defer func() {
		err := svr.Shutdown(context.Background())
		if err != nil {
			t.Fatalf("Failed to shut down server: %v", err)
		}
	}()

	time.Sleep(2 * time.Second)

	t.Run("publishing metrics without having proper claims should indicate this in the rpc_grpc_status_code", func(t *testing.T) {
		client := graphqlmetricsv1connect.NewGraphQLMetricsServiceClient(
			http.DefaultClient,
			fmt.Sprintf("http://%s", mainListenAddr),
			brotli.WithCompression(),
			connect.WithSendCompression(brotli.Name),
		)

		req := &connect.Request[graphqlmetricsv1.PublishGraphQLRequestMetricsRequest]{}
		req.Header().Add("Authorization", fmt.Sprintf("Bearer %s", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJvcmdhbml6YXRpb25faWQiOiIiLCJmZWRlcmF0ZWRfZ3JhcGhfaWQiOiIiLCJpYXQiOjE3MjI1MDgzNDF9.7-u_kUlRDbRRGDi7rACZyE38pQzA5n8_4iDGKLRkHIw"))

		res, err := client.PublishGraphQLMetrics(context.Background(), req)
		require.Nil(t, err)
		require.NotNil(t, res)

		metrics, err := registry.Gather()
		require.Nil(t, err)
		require.NotNil(t, metrics)

		requestCount := findMetricFamilyByName(metrics, "http_requests_total")
		metric := requestCount.GetMetric()[0]

		labels := metric.Label

		expectedLabels := []*io_prometheus_client.LabelPair{
			{
				Name:  PointerOf("host_name"),
				Value: PointerOf(mainListenAddr),
			},
			{
				Name:  PointerOf("http_request_method"),
				Value: PointerOf("POST"),
			},
			{
				Name:  PointerOf("network_protocol_name"),
				Value: PointerOf("connect"),
			},
			{
				Name:  PointerOf("otel_scope_name"),
				Value: PointerOf("cosmo.graphqlmetrics.prometheus"),
			},
			{
				Name:  PointerOf("otel_scope_version"),
				Value: PointerOf("0.0.1"),
			},
			{
				Name:  PointerOf("rpc_grpc_status_code"),
				Value: PointerOf("3"),
			},
			{
				Name:  PointerOf("rpc_method"),
				Value: PointerOf("PublishGraphQLMetrics"),
			},
			{
				Name:  PointerOf("rpc_service"),
				Value: PointerOf("wg.cosmo.graphqlmetrics.v1.GraphQLMetricsService"),
			},
			{
				Name:  PointerOf("rpc_system"),
				Value: PointerOf("connect_rpc"),
			},
			{
				Name:  PointerOf("wg_federated_graph_id"),
				Value: PointerOf(""),
			},
			{
				Name:  PointerOf("wg_organization_id"),
				Value: PointerOf(""),
			},
		}
		require.Equal(t, expectedLabels, labels)
	})
}

func findMetricFamilyByName(mf []*io_prometheus_client.MetricFamily, name string) *io_prometheus_client.MetricFamily {
	for _, m := range mf {
		if m.GetName() == name {
			return m
		}
	}
	return nil
}

func PointerOf[T any](t T) *T {
	return &t
}
