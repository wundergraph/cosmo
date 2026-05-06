package cacheevents

import (
	"context"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/cacheevents/v1/cacheeventsv1connect"
	"github.com/wundergraph/cosmo/router/internal/exporter"
	"go.uber.org/zap"
)

func TestNewExporter_ConstructsAndShutsDown(t *testing.T) {
	t.Parallel()

	client := cacheeventsv1connect.NewCacheEventsServiceClient(http.DefaultClient, "http://localhost:0")
	sink := NewSink(SinkConfig{Client: client, Logger: zap.NewNop()})

	exp, err := NewExporter(zap.NewNop(), sink, exporter.NewDefaultExporterSettings())
	require.NoError(t, err)
	require.NotNil(t, exp)

	// Shutdown must be a clean no-op when nothing was recorded.
	require.NoError(t, exp.Shutdown(context.Background()))
}

func TestNewExporter_RejectsBadSettings(t *testing.T) {
	t.Parallel()

	client := cacheeventsv1connect.NewCacheEventsServiceClient(http.DefaultClient, "http://localhost:0")
	sink := NewSink(SinkConfig{Client: client, Logger: zap.NewNop()})

	// Settings validation lives on the generic exporter — surface it here so
	// we know the wrapper's contract: invalid settings produce an error.
	bad := *exporter.NewDefaultExporterSettings()
	bad.BatchSize = 0
	bad.QueueSize = 0
	_, err := NewExporter(zap.NewNop(), sink, &bad)
	require.Error(t, err, "exporter must reject zero-sized batch/queue")
}
