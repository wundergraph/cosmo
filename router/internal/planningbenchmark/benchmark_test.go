package planningbenchmark

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/core"
)

type BenchmarkConfig struct {
	ExecutionConfigPath string `json:"executionConfigPath"`
	OperationPath       string `json:"operationPath"`
}

func BenchmarkPlanning(b *testing.B) {
	cfgContent, err := os.ReadFile("benchmark_config.json")
	require.NoError(b, err)

	var cfg BenchmarkConfig
	require.NoError(b, json.Unmarshal(cfgContent, &cfg))

	logger := zap.NewNop()

	pg, err := core.NewPlanGenerator(cfg.ExecutionConfigPath, logger, 0)
	require.NoError(b, err)

	pl, err := pg.GetPlanner()
	require.NoError(b, err)

	b.ReportAllocs()
	b.ResetTimer()

	for b.Loop() {
		b.StopTimer()
		opDoc, err := pl.PrepareOperation(cfg.OperationPath)
		require.NoError(b, err)
		b.SetBytes(int64(len(opDoc.Input.RawBytes)))
		b.StartTimer()

		_, err = pl.OnlyPlanOperation(opDoc)
		require.NoError(b, err)
	}
}
