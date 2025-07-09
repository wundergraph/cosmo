package modules_v1

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/modules_v1/custom_modules"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"go.uber.org/zap/zaptest"
)

func TestModuleV1ProvisionAndCleanupLifecycle(t *testing.T) {
	t.Parallel()

	t.Run("database module lifecycle", func(t *testing.T) {
		t.Parallel()

		dbModule := &custom_modules.DatabaseModule{}
		logger := zaptest.NewLogger(t)

		moduleCtx := &core.ModuleV1Context{
			Context: context.Background(),
			Module:  dbModule,
			Logger:  logger,
		}

		err := dbModule.Provision(moduleCtx)
		require.NoError(t, err)

		assert.Equal(t, 5, dbModule.GetConnectionCount())
		metrics := dbModule.GetMetrics()
		assert.Equal(t, 5, metrics.TotalConnections)

		err = dbModule.SimulateQuery("manual_test_query")
		require.NoError(t, err)

		updatedMetrics := dbModule.GetMetrics()
		assert.Equal(t, int64(1), updatedMetrics.TotalQueries)

		err = dbModule.Cleanup(moduleCtx)
		require.NoError(t, err)

		assert.Equal(t, 0, dbModule.GetConnectionCount())
		finalMetrics := dbModule.GetMetrics()
		assert.Equal(t, 0, finalMetrics.TotalConnections)
		assert.Equal(t, 0, finalMetrics.ActiveQueries)

		err = dbModule.SimulateQuery("post_cleanup_query")
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "database module not ready")
	})

	t.Run("no regression with the module system introduced", func(t *testing.T) {
		t.Parallel()

		dbModule := &custom_modules.DatabaseModule{}
		assert.Equal(t, 0, dbModule.GetConnectionCount())

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithCustomModulesV1(dbModule),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			assert.Equal(t, 5, dbModule.GetConnectionCount(), "should have 5 connections after provision")

			metrics := dbModule.GetMetrics()
			assert.Equal(t, 5, metrics.TotalConnections)
			assert.Equal(t, 0, metrics.ActiveQueries)
			assert.Equal(t, int64(0), metrics.TotalQueries)

			err := dbModule.SimulateQuery("test_query_1")
			require.NoError(t, err)

			err = dbModule.SimulateQuery("test_query_2")
			require.NoError(t, err)

			updatedMetrics := dbModule.GetMetrics()
			assert.Equal(t, int64(2), updatedMetrics.TotalQueries, "should have recorded 2 queries")

			time.Sleep(20 * time.Millisecond)
			finalMetrics := dbModule.GetMetrics()
			assert.Equal(t, 0, finalMetrics.ActiveQueries, "all queries should be completed")

			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:         `query MyQuery { employees { id } }`,
				OperationName: json.RawMessage(`"MyQuery"`),
			})
			require.NoError(t, err)
			assert.Equal(t, 200, res.Response.StatusCode)
			assert.JSONEq(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
		})

	})
}
