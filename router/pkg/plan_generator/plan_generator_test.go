package plan_generator

import (
	"context"
	"encoding/json"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
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
	entries, _ := os.ReadDir(path.Join(getTestDataDir(), "queries", "base"))
	allFiles := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".graphql") {
			allFiles = append(allFiles, e.Name())
		}
	}
	filtered := "1.graphql"

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
		assert.Len(t, queries, len(allFiles))

		for _, fn := range allFiles {
			filename := fn
			t.Run(filename, func(t *testing.T) {
				queryPlan, err := os.ReadFile(path.Join(tempDir, filename))
				assert.NoError(t, err)
				expected, err := os.ReadFile(path.Join(getTestDataDir(), "plans", "base", filename))
				assert.NoError(t, err)
				assert.Equal(t, string(expected), string(queryPlan))
			})
		}

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

		queryPlan1, err := os.ReadFile(path.Join(tempDir, filtered))
		assert.NoError(t, err)
		queryPlan1Expected, err := os.ReadFile(path.Join(getTestDataDir(), "plans", "base", filtered))
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

		for _, filename := range allFiles {
			_, err = os.Stat(path.Join(tempDir, filename))
			assert.Error(t, err)
		}

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

		for _, filename := range allFiles {
			_, err = os.Stat(path.Join(tempDir, filename))
			assert.Error(t, err)
		}

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
		assert.Len(t, queries, len(allFiles))

		for _, fn := range allFiles {
			filename := fn
			t.Run(filename, func(t *testing.T) {
				queryPlan, err := os.ReadFile(path.Join(tempDir, filename))
				assert.NoError(t, err)
				expected, err := os.ReadFile(path.Join(getTestDataDir(), "plans", "base", filename))
				assert.NoError(t, err)
				assert.Equal(t, string(expected), string(queryPlan))
			})
		}
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

	t.Run("generates raw json plans when Raw is enabled", func(t *testing.T) {
		tempDir, err := os.MkdirTemp("", "plans-")
		require.NoError(t, err)
		defer func() {
			_ = os.RemoveAll(tempDir)
		}()

		cfg := QueryPlanConfig{
			SourceDir:       path.Join(getTestDataDir(), "queries", "base"),
			OutDir:          tempDir,
			ExecutionConfig: path.Join(getTestDataDir(), "execution_config", "base.json"),
			Timeout:         "30s",
			OutputFiles:     true,
			Raw:             true,
		}

		err = PlanGenerator(context.Background(), cfg)
		assert.NoError(t, err)

		entriesInOutDir, err := os.ReadDir(tempDir)
		assert.NoError(t, err)
		assert.Len(t, entriesInOutDir, len(allFiles))

		for _, de := range entriesInOutDir {
			name := de.Name()
			content, err := os.ReadFile(path.Join(tempDir, name))
			assert.NoError(t, err)
			var m map[string]interface{}

			// One of the queries produces a failed result
			if err := json.Unmarshal(content, &m); err != nil {
				assert.True(t, strings.HasPrefix(string(content), "Warning:"))
			} else {
				assert.NotEmpty(t, m)
			}
		}
	})

	t.Run("report file uses .json filenames when Raw is enabled", func(t *testing.T) {
		tempDir, err := os.MkdirTemp("", "plans-")
		require.NoError(t, err)
		defer func() {
			_ = os.RemoveAll(tempDir)
		}()

		cfg := QueryPlanConfig{
			SourceDir:       path.Join(getTestDataDir(), "queries", "base"),
			OutDir:          tempDir,
			ExecutionConfig: path.Join(getTestDataDir(), "execution_config", "base.json"),
			Timeout:         "30s",
			OutputReport:    true,
			Raw:             true,
		}

		err = PlanGenerator(context.Background(), cfg)
		assert.NoError(t, err)

		results, err := os.ReadFile(path.Join(tempDir, ReportFileName))
		assert.NoError(t, err)
		var writtenResults QueryPlanResults
		assert.NoError(t, json.Unmarshal(results, &writtenResults))
		assert.Len(t, writtenResults.Plans, len(allFiles))
		for _, pr := range writtenResults.Plans {
			assert.True(t, strings.HasSuffix(pr.FileName, ".json"))
		}
	})

	t.Run("generates non-raw textual plans when Raw is disabled", func(t *testing.T) {
		tempDir, err := os.MkdirTemp("", "plans-")
		require.NoError(t, err)
		defer func() {
			_ = os.RemoveAll(tempDir)
		}()

		cfg := QueryPlanConfig{
			SourceDir:       path.Join(getTestDataDir(), "queries", "base"),
			OutDir:          tempDir,
			ExecutionConfig: path.Join(getTestDataDir(), "execution_config", "base.json"),
			Timeout:         "30s",
			OutputFiles:     true,
		}

		err = PlanGenerator(context.Background(), cfg)
		assert.NoError(t, err)

		entriesInOutDir, err := os.ReadDir(tempDir)
		assert.NoError(t, err)
		assert.Len(t, entriesInOutDir, len(allFiles))

		for _, de := range entriesInOutDir {
			name := de.Name()
			assert.True(t, strings.HasSuffix(name, ".graphql"))
			content, err := os.ReadFile(path.Join(tempDir, name))
			assert.NoError(t, err)
			var m map[string]interface{}
			assert.Error(t, json.Unmarshal(content, &m))
			// Should be textual query plan or warning
			s := string(content)
			assert.True(t, strings.HasPrefix(s, "QueryPlan {") || strings.HasPrefix(s, "Warning:"))
		}
	})

}
