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
	graphqlmetricsv1 "github.com/wundergraph/cosmo/graphqlmetrics/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"github.com/wundergraph/cosmo/graphqlmetrics/gen/proto/wg/cosmo/graphqlmetrics/v1/graphqlmetricsv1connect"
	"github.com/wundergraph/cosmo/graphqlmetrics/pkg/telemetry"
	"github.com/wundergraph/cosmo/graphqlmetrics/test"
	"go.uber.org/zap"
	brotli "go.withmatt.com/connect-brotli"
)

const (
	// this token was generated using the local secret and is therefore already corrupted
	bearerToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJmZWRlcmF0ZWRHcmFwaElEIjoiZmVkMTIzIiwib3JnYW5pemF0aW9uSUQiOiJvcmcxMjMiLCJpYXQiOjE3MjIyNTU5NTR9.8mxFEDqmzmmhPVfKedzTuUUM4VxvPnsPP5N3_8fnecY"
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
	assert.Nil(t, err)
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
				if err := svr.Start(stop); err != nil && !errors.Is(err, http.ErrServerClosed) {
					t.Logf("failed starting main server")
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
				// the case when metrics server should be enabled
				assert.Equal(t, true, tt.prom.Enabled)
				assert.Nil(t, err)
				assert.Equal(t, tt.statusCode, resp.StatusCode)

				defer resp.Body.Close()
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
	assert.Nil(t, err)
	prometheusListenAddr := fmt.Sprintf("0.0.0.0:%d", prometheusServerPort)

	mainServerPort, err := freeport.GetFreePort()
	assert.Nil(t, err)
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

	ingestJWTSecret := "fkczyomvdprgvtmvkuhvprxuggkbgwld"
	svr := NewServer(ctx, msvc,
		WithListenAddr(mainListenAddr),
		WithJwtSecret([]byte(ingestJWTSecret)),
		WithMetrics(&telemetry.Config{
			Prometheus: prom,
		}))

	go func() {
		if err := svr.Start(stop); err != nil && !errors.Is(err, http.ErrServerClosed) {
			t.Logf("failed starting main server")
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

		assert.Nil(t, err)
		assert.NotNil(t, resp)

		defer resp.Body.Close()

		b, err := io.ReadAll(resp.Body)
		assert.Nil(t, err)

		metrics := string(b)

		assert.NotNil(t, metrics)

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
			assert.True(t, strings.Contains(metrics, m))
		}
	})

	t.Run("test counter metrics", func(t *testing.T) {
		client := graphqlmetricsv1connect.NewGraphQLMetricsServiceClient(
			http.DefaultClient,
			fmt.Sprintf("http://%s", mainListenAddr),
			brotli.WithCompression(),
			connect.WithSendCompression(brotli.Name),
		)

		req := &connect.Request[graphqlmetricsv1.PublishGraphQLRequestMetricsRequest]{}
		req.Header().Add("Authorization", fmt.Sprintf("Bearer %s", bearerToken))

		ctx := setClaims(ctx, &GraphAPITokenClaims{
			FederatedGraphID: "fed123",
			OrganizationID:   "org123",
		})

		res, err := client.PublishGraphQLMetrics(ctx, req)
		assert.Nil(t, err)
		assert.NotNil(t, res)

		metrics, err := registry.Gather()
		assert.NotNil(t, metrics)
		assert.Nil(t, err)

		requestCount := findMetricFamilyByName(metrics, "http_requests_total")
		metric := requestCount.GetMetric()[0]
		count := metric.Counter.GetValue()
		assert.Equal(t, float64(1), count)
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
