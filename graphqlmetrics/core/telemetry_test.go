package core

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"sync"
	"testing"
	"time"

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
