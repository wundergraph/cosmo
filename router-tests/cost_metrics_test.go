package integration

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/metric"
)

func TestOperationCostMetrics(t *testing.T) {
	t.Parallel()

	t.Run("Should record actual and delta cost metrics when actualListSizes is available", func(t *testing.T) {
		t.Parallel()

		metricReader := sdkmetric.NewManualReader()

		testenv.Run(t, &testenv.Config{
			MetricReader: metricReader,
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.EnableRequestTracing = true
			},
			ModifySecurityConfiguration: func(cfg *config.SecurityConfiguration) {
				cfg.CostAnalysis = &config.CostAnalysis{
					Enabled:           true,
					Mode:              config.CostAnalysisModeMeasure,
					EstimatedListSize: 10,
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id details { forename surname } } }`,
			})
			require.Contains(t, res.Body, `"employees"`)

			// Collect metrics
			var rm metricdata.ResourceMetrics
			err := metricReader.Collect(context.Background(), &rm)
			require.NoError(t, err)

			var foundEstimated, foundActual, foundDelta bool
			var estimatedHistogram, actualHistogram, deltaHistogram metricdata.Histogram[int64]

			for _, scopeMetric := range rm.ScopeMetrics {
				for _, m := range scopeMetric.Metrics {
					switch m.Name {
					case metric.OperationCostEstimatedHistogram:
						estimatedHistogram, foundEstimated = m.Data.(metricdata.Histogram[int64])
					case metric.OperationCostActualHistogram:
						actualHistogram, foundActual = m.Data.(metricdata.Histogram[int64])
					case metric.OperationCostDeltaHistogram:
						deltaHistogram, foundDelta = m.Data.(metricdata.Histogram[int64])
					}
				}
			}

			require.True(t, foundEstimated, "estimated cost metric should be recorded")
			require.True(t, foundActual, "actual cost metric should be recorded")
			require.True(t, foundDelta, "delta cost metric should be recorded")

			require.NotEmpty(t, estimatedHistogram.DataPoints)
			require.NotEmpty(t, actualHistogram.DataPoints)
			require.NotEmpty(t, deltaHistogram.DataPoints)

			estimatedCost := estimatedHistogram.DataPoints[0].Sum
			actualCost := actualHistogram.DataPoints[0].Sum
			deltaCost := deltaHistogram.DataPoints[0].Sum

			require.Greater(t, estimatedCost, int64(0), "estimated cost should be greater than 0")
			require.Greater(t, actualCost, int64(0), "actual cost should be greater than 0")

			require.Equal(t, actualCost-estimatedCost, deltaCost, "delta should equal actual - estimated")
		})
	})

	t.Run("Should record multiple operations separately", func(t *testing.T) {
		t.Parallel()

		metricReader := sdkmetric.NewManualReader()

		testenv.Run(t, &testenv.Config{
			MetricReader: metricReader,
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.EnableRequestTracing = true
			},
			ModifySecurityConfiguration: func(cfg *config.SecurityConfiguration) {
				cfg.CostAnalysis = &config.CostAnalysis{
					Enabled:           true,
					Mode:              config.CostAnalysisModeMeasure,
					EstimatedListSize: 10,
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res1 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res1.Body)

			res2 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id details { forename } } }`,
			})
			require.Contains(t, res2.Body, `"employees"`)

			var rm metricdata.ResourceMetrics
			err := metricReader.Collect(context.Background(), &rm)
			require.NoError(t, err)

			var foundEstimated bool
			var estimatedHistogram metricdata.Histogram[int64]

			for _, scopeMetric := range rm.ScopeMetrics {
				for _, m := range scopeMetric.Metrics {
					if m.Name == metric.OperationCostEstimatedHistogram {
						estimatedHistogram, foundEstimated = m.Data.(metricdata.Histogram[int64])
						break
					}
				}
				if foundEstimated {
					break
				}
			}

			require.True(t, foundEstimated)
			require.NotEmpty(t, estimatedHistogram.DataPoints)

			var totalCount uint64
			for _, dp := range estimatedHistogram.DataPoints {
				totalCount += dp.Count
			}

			require.Equal(t, uint64(2), totalCount, "should have recorded 2 operations")
		})
	})
}
