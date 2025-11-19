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

const configFileName = "benchmark_config.json"

func TestPlanning(t *testing.T) {
	cfgContent, err := os.ReadFile(configFileName)
	if err != nil {
		t.Skipf("unable to read %s: %v", configFileName, err)
	}

	var cfg BenchmarkConfig
	require.NoError(t, json.Unmarshal(cfgContent, &cfg))

	logger := zap.NewNop()

	pg, err := core.NewPlanGenerator(cfg.ExecutionConfigPath, logger, 0)
	require.NoError(t, err)

	pl, err := pg.GetPlanner()
	require.NoError(t, err)

	opDoc, _, err := pl.ParseAndPrepareOperation(cfg.OperationPath)
	require.NoError(t, err)

	start := time.Now()
	p, _, err := pl.PlanPreparedOperation(opDoc)
	require.NoError(t, err)
	t.Logf("Planning completed in %v", time.Since(start))

	t.Log(p.PrettyPrint())
}

func BenchmarkPlanning(b *testing.B) {
	cfgContent, err := os.ReadFile(configFileName)
	if err != nil {
		b.Skipf("unable to read %s: %v", configFileName, err)
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
		opDoc, _, err := pl.ParseAndPrepareOperation(cfg.OperationPath)
		require.NoError(b, err)
		b.SetBytes(int64(len(opDoc.Input.RawBytes)))
		b.StartTimer()

		_, _, err = pl.PlanPreparedOperation(opDoc)
		require.NoError(b, err)
	}
}
