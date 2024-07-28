package core

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/stretchr/testify/assert"
	"github.com/wundergraph/cosmo/graphqlmetrics/pkg/telemetry"
	"github.com/wundergraph/cosmo/graphqlmetrics/test"
	"go.uber.org/zap"
)

func TestExposingPrometheusMetrics(t *testing.T) {
	if os.Getenv("INT_TESTS") != "true" {
		t.Skip("Skipping integration tests")
	}

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
				ListenAddr:   "0.0.0.0:8089",
				Path:         "/metrics",
				TestRegistry: prometheus.NewRegistry(),
			},
			statusCode: 200,
		},
		{
			name: "disabled",
			prom: telemetry.PrometheusConfig{
				Enabled:      false,
				ListenAddr:   "0.0.0.0:8089",
				Path:         "/metrics",
				TestRegistry: prometheus.NewRegistry(),
			},
			statusCode: -1,
		},
	}

	db := test.GetTestDatabase(t)
	msvc := NewMetricsService(zap.NewNop(), db)
	ctx := context.Background()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svr := NewServer(ctx, msvc,
				WithListenAddr("0.0.0.0:0"),
				WithMetrics(&telemetry.Config{
					Prometheus: tt.prom,
				}))

			var wg sync.WaitGroup
			wg.Add(2)

			mainReady := make(chan struct{})
			promReady := make(chan struct{})

			go func() {
				defer wg.Done()
				go func() {
					if err := svr.Start(); err != nil && !errors.Is(err, http.ErrServerClosed) {
						t.Logf("failed starting main server")
					}
				}()
				close(mainReady)
			}()
			go func() {
				defer wg.Done()
				go func() {
					if err := svr.StartPrometheusServer(); err != nil && !errors.Is(err, http.ErrServerClosed) {
						t.Logf("failed starting prometheus server")
					}
				}()
				close(promReady)
			}()

			defer func() {
				err := svr.Shutdown(context.Background())
				if err != nil {
					t.Fatalf("Failed to shut down server: %v", err)
				}
				wg.Wait()
			}()

			select {
			case <-mainReady:
				t.Log("Main server started successfully")
			case <-time.After(20 * time.Second):
				t.Fatal("Main server did not start in time")
			}

			select {
			case <-promReady:
				t.Log("Prometheus server started successfully")
			case <-time.After(20 * time.Second):
				t.Fatal("Prometheus server did not start in time")
			}

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
	prom := telemetry.PrometheusConfig{
		Enabled:      true,
		ListenAddr:   "0.0.0.0:8090",
		Path:         "/metrics",
		TestRegistry: prometheus.NewRegistry(),
	}

	db := test.GetTestDatabase(t)
	msvc := NewMetricsService(zap.NewNop(), db)
	ctx := context.Background()

	svr := NewServer(ctx, msvc,
		WithListenAddr("0.0.0.0:0"),
		WithMetrics(&telemetry.Config{
			Prometheus: prom,
		}))

	var wg sync.WaitGroup
	wg.Add(2)

	mainReady := make(chan struct{})
	promReady := make(chan struct{})

	go func() {
		defer wg.Done()
		go func() {
			if err := svr.Start(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				t.Logf("failed starting main server")
			}
		}()
		close(mainReady)
	}()
	go func() {
		defer wg.Done()
		go func() {
			if err := svr.StartPrometheusServer(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				t.Logf("failed starting prometheus server")
			}
		}()
		close(promReady)
	}()

	defer func() {
		err := svr.Shutdown(context.Background())
		if err != nil {
			t.Fatalf("Failed to shut down server: %v", err)
		}
		wg.Wait()
	}()

	select {
	case <-mainReady:
		t.Log("Main server started successfully")
	case <-time.After(20 * time.Second):
		t.Fatal("Main server did not start in time")
	}

	select {
	case <-promReady:
		t.Log("Prometheus server started successfully")
	case <-time.After(20 * time.Second):
		t.Fatal("Prometheus server did not start in time")
	}

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
}
