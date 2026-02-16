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

func TestOperationCost(t *testing.T) {
	t.Parallel()

	t.Run("cost analysis", func(t *testing.T) {
		t.Parallel()

		// These tests verify that cost is calculated using default values
		// when no @cost or @listSize directives are specified in the schema.

		t.Run("enforce mode blocks queries exceeding estimated cost limit", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.CostAnalysis = &config.CostAnalysis{
						Enabled:           true,
						Mode:              config.CostAnalysisModeEnforce,
						MaxEstimatedLimit: 9,
						EstimatedListSize: 5,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res, _ := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: `{ employees { id details { forename surname } } }`,
				})
				// cost = 5 * (1 + 1)
				require.Equal(t, 400, res.Response.StatusCode)
				require.Contains(t, res.Body, "exceeds the maximum allowed limit")
			})
		})

		t.Run("enforce mode allows queries under estimated cost limit", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.CostAnalysis = &config.CostAnalysis{
						Enabled:           true,
						Mode:              config.CostAnalysisModeEnforce,
						MaxEstimatedLimit: 11,
						EstimatedListSize: 5,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employees { id details { forename surname } } }`,
				})
				// cost = 5 * (1 + 1)
				require.Equal(t, 200, res.Response.StatusCode)
				require.Contains(t, res.Body, `"data":`)
			})
		})

		t.Run("enforce mode with non-list query", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.CostAnalysis = &config.CostAnalysis{
						Enabled:           true,
						Mode:              config.CostAnalysisModeEnforce,
						MaxEstimatedLimit: 2, // employee (1) + details (1) = 2
						EstimatedListSize: 10,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employee(id:1) { id details { forename } } }`,
				})
				// Cost: 1 + 1
				require.Equal(t, 200, res.Response.StatusCode)
				require.Contains(t, res.Body, `"data":`)
			})
		})

		t.Run("estimated list size configuration affects cost calculation", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.CostAnalysis = &config.CostAnalysis{
						Enabled:           true,
						Mode:              config.CostAnalysisModeEnforce,
						MaxEstimatedLimit: 2,
						EstimatedListSize: 2, // Small list size
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employees { id } }`,
				})
				// cost: 2 * 1
				require.Contains(t, res.Body, `"data":`)
			})
		})

		t.Run("Should fail on startup when cost analysis is enabled without estimated_list_size", func(t *testing.T) {
			t.Parallel()

			testenv.FailsOnStartup(t, &testenv.Config{
				ModifySecurityConfiguration: func(cfg *config.SecurityConfiguration) {
					cfg.CostAnalysis = &config.CostAnalysis{
						Enabled: true,
						Mode:    config.CostAnalysisModeMeasure,
					}
				},
			}, func(t *testing.T, err error) {
				require.ErrorContains(t, err, "cost analysis is enabled but 'estimated_list_size' is not set")
			})
		})

		t.Run("disabled cost analysis does not block queries", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.CostAnalysis = &config.CostAnalysis{
						Enabled:           false,
						Mode:              config.CostAnalysisModeEnforce,
						MaxEstimatedLimit: 1,
						EstimatedListSize: 10,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employees { id details { forename surname } } }`,
				})
				// cost = 10 * (1 + 1)
				require.Contains(t, res.Body, `"data":`)
			})
		})

		t.Run("measure mode does not block queries", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.CostAnalysis = &config.CostAnalysis{
						Enabled:           true,
						Mode:              config.CostAnalysisModeMeasure,
						MaxEstimatedLimit: 1, // Would block in enforce mode
						EstimatedListSize: 10,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employees { id details { forename surname } } }`,
				})
				require.Contains(t, res.Body, `"data":`)
			})
		})

		t.Run("enforce mode with zero estimated limit does not block", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.CostAnalysis = &config.CostAnalysis{
						Enabled:           true,
						Mode:              config.CostAnalysisModeEnforce,
						MaxEstimatedLimit: 0, // Zero limit means no enforcement
						EstimatedListSize: 10,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employees { id details { forename surname } } }`,
				})
				require.Contains(t, res.Body, `"data":`)
			})
		})

		t.Run("nested list fields multiply estimated cost", func(t *testing.T) {
			// Just one additional test; more thorough testing is done in the engine.
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.CostAnalysis = &config.CostAnalysis{
						Enabled:           true,
						Mode:              config.CostAnalysisModeEnforce,
						MaxEstimatedLimit: 10,
						EstimatedListSize: 5,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employees { id details { forename } } }`,
				})
				// cost = 5 * (1 + 1)
				require.Contains(t, res.Body, `"data":`)
			})
		})
	})

	t.Run("metrics", func(t *testing.T) {
		t.Parallel()

		t.Run("Should record actual and delta cost metrics", func(t *testing.T) {
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

				require.True(t, foundEstimated)
				require.True(t, foundActual)
				require.True(t, foundDelta)

				require.NotEmpty(t, estimatedHistogram.DataPoints)
				require.NotEmpty(t, actualHistogram.DataPoints)
				require.NotEmpty(t, deltaHistogram.DataPoints)

				estimatedCost := estimatedHistogram.DataPoints[0].Sum
				actualCost := actualHistogram.DataPoints[0].Sum
				deltaCost := deltaHistogram.DataPoints[0].Sum

				require.Equal(t, int64(20), estimatedCost)
				require.Equal(t, int64(20), actualCost)
				require.Equal(t, int64(0), deltaCost)
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

		t.Run("Should not record cost metrics for operations with errors", func(t *testing.T) {
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
						EstimatedListSize: 10,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: `{ employees { id `,
				})
				require.NoError(t, err)

				// The request should fail (either 400 or 200 with errors)
				// What matters is that the operation didn't successfully plan
				require.Contains(t, res.Body, "error", "response should contain errors")

				var rm metricdata.ResourceMetrics
				err = metricReader.Collect(context.Background(), &rm)
				require.NoError(t, err)

				// Cost metrics should NOT be recorded for operations that fail to parse/plan
				var foundEstimated bool
			outer:
				for _, scopeMetric := range rm.ScopeMetrics {
					for _, m := range scopeMetric.Metrics {
						if m.Name == metric.OperationCostEstimatedHistogram {
							foundEstimated = true
							break outer
						}
					}
				}
				require.False(t, foundEstimated, "cost metrics should not be recorded for operations with parse/plan errors")
			})
		})

		t.Run("Should not record cost metrics when cost analysis is disabled", func(t *testing.T) {
			t.Parallel()

			metricReader := sdkmetric.NewManualReader()

			testenv.Run(t, &testenv.Config{
				MetricReader: metricReader,
				ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
					cfg.EnableRequestTracing = true
				},
				ModifySecurityConfiguration: func(cfg *config.SecurityConfiguration) {
					cfg.CostAnalysis = &config.CostAnalysis{
						Enabled: false,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employees { id } }`,
				})
				require.JSONEq(t, employeesIDData, res.Body)

				var rm metricdata.ResourceMetrics
				err := metricReader.Collect(context.Background(), &rm)
				require.NoError(t, err)

				var foundEstimated, foundActual, foundDelta bool
				for _, scopeMetric := range rm.ScopeMetrics {
					for _, m := range scopeMetric.Metrics {
						switch m.Name {
						case metric.OperationCostEstimatedHistogram:
							foundEstimated = true
						case metric.OperationCostActualHistogram:
							foundActual = true
						case metric.OperationCostDeltaHistogram:
							foundDelta = true
						}
					}
				}

				require.False(t, foundEstimated)
				require.False(t, foundActual)
				require.False(t, foundDelta)
			})
		})
	})
}
