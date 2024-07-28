package core

import (
	"context"
	"fmt"
	"net/http"
	"os"
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
		name    string
		prom    telemetry.PrometheusConfig
		statusCode int
	}

	tests := []tc{
		{
			name: "enabled",
			prom: telemetry.PrometheusConfig{
				Enabled:    true,
				ListenAddr: "127.0.0.1:8089",
				Path:       "/metrics",
			},
			statusCode: 200,
		},
	}

	db := test.GetTestDatabase(t)

	for _, tt := range tests {
		msvc := NewMetricsService(zap.NewNop(), db)
		svr := NewServer(msvc,
			WithListenAddr("127.0.0.1:0"),
			WithMetrics(&telemetry.Config{
				Prometheus: tt.prom,
			}))

		go func() {
			// start graphqlmetrics server
			err := svr.Start()
			assert.Nil(t, err)
		}()
		go func() {
			// start the prometheus server
			err := svr.StartPrometheusServer()

			// should start just fine
			if tt.prom.Enabled {
				assert.Nil(t, err)
			}

			if !tt.prom.Enabled {
				// assert that the prometheus server can't be enabled 
				// as it was never configured
				assert.NotNil(t, err)
			}
		}()
		defer svr.Shutdown(context.Background())
		time.Sleep(100 * time.Millisecond)

		endpoint := fmt.Sprintf("http://%s%s", tt.prom.ListenAddr, tt.prom.Path)
		resp, err := http.Get(endpoint)
		assert.Nil(t, err)

		defer resp.Body.Close()

		assert.Equal(t, resp.StatusCode, tt.statusCode)
	}
}
