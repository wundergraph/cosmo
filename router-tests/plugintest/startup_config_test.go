package plugintest

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-plugin/config"
	"github.com/wundergraph/cosmo/router/pkg/grpcconnector/grpccommon"
)

// The router serializes its tracing config for plugins, and router-plugin
// reads it back with its own types.
func TestStartupConfigExporterSamplingRate(t *testing.T) {
	t.Parallel()

	data, err := json.Marshal(grpccommon.GRPCStartupParams{
		Telemetry: &grpccommon.GRPCTelemetry{
			Tracing: &grpccommon.GRPCTracing{
				Sampler: 0.5,
				Exporters: []grpccommon.GRPCExporter{
					{Endpoint: "http://inherits"},
					{Endpoint: "http://lower", SamplingRate: new(0.1)},
					{Endpoint: "http://never", SamplingRate: new(0.0)},
				},
			},
		},
	})
	require.NoError(t, err)

	var startupConfig config.StartupConfig
	require.NoError(t, json.Unmarshal(data, &startupConfig))

	require.NotNil(t, startupConfig.Telemetry)
	require.NotNil(t, startupConfig.Telemetry.Tracing)
	tracing := startupConfig.Telemetry.Tracing
	assert.Equal(t, 0.5, tracing.Sampler)
	require.Len(t, tracing.Exporters, 3)
	assert.Nil(t, tracing.Exporters[0].SamplingRate)
	require.NotNil(t, tracing.Exporters[1].SamplingRate)
	assert.Equal(t, 0.1, *tracing.Exporters[1].SamplingRate)
	require.NotNil(t, tracing.Exporters[2].SamplingRate)
	assert.Equal(t, 0.0, *tracing.Exporters[2].SamplingRate)
}
