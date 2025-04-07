package plan_generator

import (
	"context"
	"encoding/json"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func getTestDataDir() string {
	_, filename, _, _ := runtime.Caller(0)
	return path.Join(filepath.Dir(filename), "testdata")
}

func TestPlanGenerator(t *testing.T) {
	t.Run("checks queries path exists", func(t *testing.T) {
		tempDir, err := os.MkdirTemp("", "plans-")
		require.NoError(t, err)
		defer os.RemoveAll(tempDir)

		cfg := QueryPlanConfig{
			SourceDir:       path.Join(getTestDataDir(), "queries", "notexistant"),
			OutDir:          tempDir,
			ExecutionConfig: path.Join(getTestDataDir(), "execution_config", "base.json"),
			Timeout:         "30s",
			OutputFiles:     true,
		}

		err = PlanGenerator(context.Background(), cfg)
		assert.ErrorContains(t, err, "failed to read queries directory:")
	})

	t.Run("checks output path exists", func(t *testing.T) {
		t.Skip("This test is skipped because in github actions every output directory is writable")
		cfg := QueryPlanConfig{
			SourceDir:       path.Join(getTestDataDir(), "queries", "base"),
			OutDir:          "/notwritable",
			ExecutionConfig: path.Join(getTestDataDir(), "execution_config", "base.json"),
			Timeout:         "30s",
			OutputFiles:     true,
		}

		err := PlanGenerator(context.Background(), cfg)
		assert.ErrorContains(t, err, "failed to create output directory:")
	})

	t.Run("checks filter file exists", func(t *testing.T) {
		tempDir, err := os.MkdirTemp("", "plans-")
		require.NoError(t, err)
		defer os.RemoveAll(tempDir)

		cfg := QueryPlanConfig{
			SourceDir:       path.Join(getTestDataDir(), "queries", "base"),
			OutDir:          tempDir,
			ExecutionConfig: path.Join(getTestDataDir(), "execution_config", "base.json"),
			Filter:          path.Join(getTestDataDir(), "not_existant", "filter.txt"),
			Timeout:         "30s",
			OutputFiles:     true,
		}

		err = PlanGenerator(context.Background(), cfg)
		assert.ErrorContains(t, err, "failed to read filter file:")
	})

	t.Run("fail if execution config don't exists", func(t *testing.T) {
		tempDir, err := os.MkdirTemp("", "plans-")
		require.NoError(t, err)
		defer os.RemoveAll(tempDir)

		cfg := QueryPlanConfig{
			SourceDir:       path.Join(getTestDataDir(), "queries", "base"),
			OutDir:          tempDir,
			ExecutionConfig: path.Join(getTestDataDir(), "not_existant", "base.json"),
			Timeout:         "30s",
			OutputFiles:     true,
		}

		err = PlanGenerator(context.Background(), cfg)
		assert.ErrorContains(t, err, "failed to create plan generator:")
	})

	t.Run("fail with invalid execution config ", func(t *testing.T) {
		tempDir, err := os.MkdirTemp("", "plans-")
		require.NoError(t, err)
		defer os.RemoveAll(tempDir)

		cfg := QueryPlanConfig{
			SourceDir:       path.Join(getTestDataDir(), "queries", "base"),
			OutDir:          tempDir,
			ExecutionConfig: path.Join(getTestDataDir(), "execution_config", "wrong.json"),
			Timeout:         "30s",
			OutputFiles:     true,
		}

		err = PlanGenerator(context.Background(), cfg)
		assert.ErrorContains(t, err, "unexpected EOF")
	})

	t.Run("fails with wrong timeout duration", func(t *testing.T) {
		tempDir, err := os.MkdirTemp("", "plans-")
		require.NoError(t, err)
		defer os.RemoveAll(tempDir)

		cfg := QueryPlanConfig{
			SourceDir:       path.Join(getTestDataDir(), "queries", "base"),
			OutDir:          tempDir,
			ExecutionConfig: path.Join(getTestDataDir(), "execution_config", "base.json"),
			Timeout:         "30as",
			OutputFiles:     true,
		}

		err = PlanGenerator(context.Background(), cfg)
		assert.ErrorContains(t, err, "failed to parse timeout:")
	})

	t.Run("generates a plan for every file", func(t *testing.T) {
		tempDir, err := os.MkdirTemp("", "plans-")
		require.NoError(t, err)
		defer os.RemoveAll(tempDir)

		cfg := QueryPlanConfig{
			SourceDir:       path.Join(getTestDataDir(), "queries", "base"),
			OutDir:          tempDir,
			ExecutionConfig: path.Join(getTestDataDir(), "execution_config", "base.json"),
			Timeout:         "30s",
			OutputFiles:     true,
			Logger:          zap.NewNop(),
		}

		err = PlanGenerator(context.Background(), cfg)
		assert.NoError(t, err)

		queries, err := os.ReadDir(tempDir)
		assert.NoError(t, err)
		assert.Len(t, queries, 2)

		queryPlan1, err := os.ReadFile(path.Join(tempDir, "1.graphql"))
		assert.NoError(t, err)
		queryPlan1Expected, err := os.ReadFile(path.Join(getTestDataDir(), "plans", "base", "1.graphql"))
		assert.NoError(t, err)
		assert.Equal(t, string(queryPlan1Expected), string(queryPlan1))

		queryPlan2, err := os.ReadFile(path.Join(tempDir, "2.graphql"))
		assert.NoError(t, err)
		queryPlan2Expected, err := os.ReadFile(path.Join(getTestDataDir(), "plans", "base", "2.graphql"))
		assert.NoError(t, err)
		assert.Equal(t, string(queryPlan2Expected), string(queryPlan2))
	})

	t.Run("generates a plan for every file filtered", func(t *testing.T) {
		tempDir, err := os.MkdirTemp("", "plans-")
		require.NoError(t, err)
		defer os.RemoveAll(tempDir)

		cfg := QueryPlanConfig{
			SourceDir:       path.Join(getTestDataDir(), "queries", "base"),
			OutDir:          tempDir,
			ExecutionConfig: path.Join(getTestDataDir(), "execution_config", "base.json"),
			Filter:          path.Join(getTestDataDir(), "plans", "base", "filter.txt"),
			Timeout:         "30s",
			OutputFiles:     true,
		}

		err = PlanGenerator(context.Background(), cfg)
		assert.NoError(t, err)

		queries, err := os.ReadDir(tempDir)
		assert.NoError(t, err)
		assert.Len(t, queries, 1)

		queryPlan1, err := os.ReadFile(path.Join(tempDir, "1.graphql"))
		assert.NoError(t, err)
		queryPlan1Expected, err := os.ReadFile(path.Join(getTestDataDir(), "plans", "base", "1.graphql"))
		assert.NoError(t, err)
		assert.Equal(t, string(queryPlan1Expected), string(queryPlan1))
	})

	t.Run("generates a result file with every plan inside", func(t *testing.T) {
		tempDir, err := os.MkdirTemp("", "plans-")
		require.NoError(t, err)
		defer os.RemoveAll(tempDir)

		cfg := QueryPlanConfig{
			SourceDir:       path.Join(getTestDataDir(), "queries", "base"),
			OutDir:          tempDir,
			ExecutionConfig: path.Join(getTestDataDir(), "execution_config", "base.json"),
			Timeout:         "30s",
			OutputReport:    true,
		}

		err = PlanGenerator(context.Background(), cfg)
		assert.NoError(t, err)

		queries, err := os.ReadDir(tempDir)
		assert.NoError(t, err)
		assert.Len(t, queries, 1)

		_, err = os.Stat(path.Join(tempDir, "1.graphql"))
		assert.Error(t, err)

		_, err = os.Stat(path.Join(tempDir, "2.graphql"))
		assert.Error(t, err)

		results, err := os.ReadFile(path.Join(tempDir, ReportFileName))
		assert.NoError(t, err)
		resultsExpected, err := os.ReadFile(path.Join(getTestDataDir(), "plans", "base", ReportFileName))
		assert.NoError(t, err)
		assert.Equal(t, string(resultsExpected), string(results))
	})

	t.Run("will not fail on warnings and results should return the warnings and generate results file", func(t *testing.T) {
		tempDir, err := os.MkdirTemp("", "plans-")
		require.NoError(t, err)
		defer os.RemoveAll(tempDir)

		cfg := QueryPlanConfig{
			SourceDir:       path.Join(getTestDataDir(), "queries", "base"),
			OutDir:          tempDir,
			ExecutionConfig: path.Join(getTestDataDir(), "execution_config", "base.json"),
			Timeout:         "30s",
			FailOnPlanError: true,
			OutputReport:    true,
		}

		err = PlanGenerator(context.Background(), cfg)
		assert.NoError(t, err)

		queries, err := os.ReadDir(tempDir)
		assert.NoError(t, err)
		assert.Len(t, queries, 1)

		_, err = os.Stat(path.Join(tempDir, "1.graphql"))
		assert.Error(t, err)

		_, err = os.Stat(path.Join(tempDir, "2.graphql"))
		assert.Error(t, err)

		results, err := os.ReadFile(path.Join(tempDir, ReportFileName))
		assert.NoError(t, err)
		resultsExpected, err := os.ReadFile(path.Join(getTestDataDir(), "plans", "base", ReportFileName))
		assert.NoError(t, err)
		assert.Equal(t, string(resultsExpected), string(results))
	})

	t.Run("will not fail on warnings and files should have warnings and generate files", func(t *testing.T) {
		tempDir, err := os.MkdirTemp("", "plans-")
		require.NoError(t, err)
		defer os.RemoveAll(tempDir)

		cfg := QueryPlanConfig{
			SourceDir:       path.Join(getTestDataDir(), "queries", "base"),
			OutDir:          tempDir,
			ExecutionConfig: path.Join(getTestDataDir(), "execution_config", "base.json"),
			Timeout:         "30s",
			FailOnPlanError: true,
			OutputFiles:     true,
		}

		err = PlanGenerator(context.Background(), cfg)
		assert.NoError(t, err)

		queries, err := os.ReadDir(tempDir)
		assert.NoError(t, err)
		assert.Len(t, queries, 2)

		queryPlan1, err := os.ReadFile(path.Join(tempDir, "1.graphql"))
		assert.NoError(t, err)
		queryPlan1Expected, err := os.ReadFile(path.Join(getTestDataDir(), "plans", "base", "1.graphql"))
		assert.NoError(t, err)
		assert.Equal(t, string(queryPlan1Expected), string(queryPlan1))

		queryPlan2, err := os.ReadFile(path.Join(tempDir, "2.graphql"))
		assert.NoError(t, err)
		queryPlan2Expected, err := os.ReadFile(path.Join(getTestDataDir(), "plans", "base", "2.graphql"))
		assert.NoError(t, err)
		assert.Equal(t, string(queryPlan2Expected), string(queryPlan2))
	})

	t.Run("when reaching timeout an error should be returned", func(t *testing.T) {
		tempDir, err := os.MkdirTemp("", "plans-")
		require.NoError(t, err)
		defer os.RemoveAll(tempDir)

		cfg := QueryPlanConfig{
			SourceDir:       path.Join(getTestDataDir(), "queries", "base"),
			OutDir:          tempDir,
			ExecutionConfig: path.Join(getTestDataDir(), "execution_config", "base.json"),
			Timeout:         "1ns",
			OutputFiles:     true,
		}

		err = PlanGenerator(context.Background(), cfg)
		assert.ErrorIs(t, err, context.DeadlineExceeded)
	})

	t.Run("when reaching timeout the report should contains the error", func(t *testing.T) {
		tempDir, err := os.MkdirTemp("", "plans-")
		require.NoError(t, err)
		defer os.RemoveAll(tempDir)

		cfg := QueryPlanConfig{
			SourceDir:       path.Join(getTestDataDir(), "queries", "base"),
			OutDir:          tempDir,
			ExecutionConfig: path.Join(getTestDataDir(), "execution_config", "base.json"),
			Timeout:         "1ns",
			OutputReport:    true,
		}

		err = PlanGenerator(context.Background(), cfg)
		assert.ErrorIs(t, err, context.DeadlineExceeded)

		results, err := os.ReadFile(path.Join(tempDir, ReportFileName))
		assert.NoError(t, err)
		errMsg := context.DeadlineExceeded.Error()
		var writtenResults QueryPlanResults
		err = json.Unmarshal(results, &writtenResults)
		assert.NoError(t, err)
		assert.Equal(t, errMsg, writtenResults.Error)
	})
}
