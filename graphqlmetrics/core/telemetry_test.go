package core

import (
	"context"
	"fmt"
	"net/http"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/wundergraph/cosmo/graphqlmetrics/pkg/telemetry"
	"go.uber.org/zap"

	v1 "github.com/wundergraph/cosmo/graphqlmetrics/gen/proto/wg/cosmo/graphqlmetrics/v1"
)

type mockMS struct{}

func (ms *mockMS) PublishGraphQLMetrics(context.Context, *connect.Request[v1.PublishGraphQLRequestMetricsRequest]) (*connect.Response[v1.PublishOperationCoverageReportResponse], error) {
	return nil, nil
}

func TestPrometheusExport(t *testing.T) {
	ms := &mockMS{}
	type test struct {
		svr     *Server
		name    string
		wantErr bool
	}
	tests := []test{
		{
			name: "with-prometheus-server-enabled",
			svr: NewServer(ms, WithMetrics(
				telemetry.NewTelemetryConfig(
					telemetry.PrometheusConfig{
						Enabled:    true,
						ListenAddr: "127.0.0.1:8089",
						Path:       "/metrics",
					},
				),
			)),
			wantErr: false,
		},
		{
			name: "without-prometheus-server-enabled",
			svr: NewServer(ms, WithMetrics(
				telemetry.NewTelemetryConfig(
					telemetry.PrometheusConfig{
						Enabled:    false,
						ListenAddr: "127.0.0.1:8089",
						Path:       "/metrics",
					},
				),
			)),
			wantErr: true,
		},
	}

	for _, tt := range tests {
		// as the server setup is all encapsulated within main,
		// at least check, if the new code is covered and if the
		// handlers for the prometheus server are registered
		go func() {
			if err := tt.svr.StartPrometheusServer(); err != nil {
				tt.svr.logger.Error("Could not start prometheus server", zap.Error(err))
			}
		}()
		defer tt.svr.ShutdownPrometheusServer(context.Background())

		time.Sleep(100 * time.Millisecond)

		endpoint := fmt.Sprintf("http://%s%s", tt.svr.metricConfig.Prometheus.ListenAddr, tt.svr.metricConfig.Prometheus.Path)
		resp, err := http.Get(endpoint)

		if err != nil {
			t.Fatalf("Failed to get /metrics endpoint: %v", err)
		}
		defer resp.Body.Close()

		// Check the response status code
		if tt.wantErr && (resp.StatusCode != http.StatusOK) {
			t.Fatalf("Expected status code 200, got %v", resp.StatusCode)
		}
	}
}
