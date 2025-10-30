package planningbenchmark

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/core"
)

type BenchmarkConfig struct {
	ExecutionConfigPath string `json:"executionConfigPath"`
	OperationPath       string `json:"operationPath"`
}

func TestPlanning(t *testing.T) {
	cfgContent, err := os.ReadFile("benchmark_config.json")
	if err != nil {
		t.Skipf("unable to read benchmark_config.json: %v", err)
	}

	var cfg BenchmarkConfig
	require.NoError(t, json.Unmarshal(cfgContent, &cfg))

	logger := zap.NewNop()

	pg, err := core.NewPlanGenerator(cfg.ExecutionConfigPath, logger, 0)
	require.NoError(t, err)

	pl, err := pg.GetPlanner()
	require.NoError(t, err)

	opDoc, err := pl.ParseAndPrepareOperation(cfg.OperationPath)
	require.NoError(t, err)

	start := time.Now()
	_, err = pl.PlanPreparedOperation(opDoc)
	require.NoError(t, err)
	t.Logf("Planning completed in %v", time.Since(start))
}

func BenchmarkPlanning(b *testing.B) {
	cfgContent, err := os.ReadFile("benchmark_config.json")
	if err != nil {
		b.Skipf("unable to read benchmark_config.json: %v", err)
	}

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
		opDoc, err := pl.ParseAndPrepareOperation(cfg.OperationPath)
		require.NoError(b, err)
		b.SetBytes(int64(len(opDoc.Input.RawBytes)))
		b.StartTimer()

		_, err = pl.PlanPreparedOperation(opDoc)
		require.NoError(b, err)
	}
}
