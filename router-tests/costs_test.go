package integration

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	semconv "go.opentelemetry.io/otel/semconv/v1.21.0"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/metric"
	otel "github.com/wundergraph/cosmo/router/pkg/otel"
)

func TestOperationCost(t *testing.T) {
	t.Parallel()

	t.Run("cost analysis", func(t *testing.T) {
		t.Parallel()

		// These tests verify cost analysis behavior with @cost and @listSize
		// directives loaded from the test config (config.json).
		// Each test uses a different query to cover distinct directive features.

		t.Run("listSize assumedSize overrides estimated_list_size and blocks when over limit", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.CostAnalysis = &config.CostAnalysis{
						Enabled:           true,
						Mode:              config.CostAnalysisModeEnforce,
						MaxEstimatedLimit: 9,
						EstimatedListSize: 5,
						ExposeHeaders:     true,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				// employees has @listSize(assumedSize: 50) which overrides EstimatedListSize(5)
				res, _ := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: `{ employees { id details { forename surname } } }`,
				})
				require.Equal(t, 400, res.Response.StatusCode)
				require.Contains(t, res.Body, "exceeds the maximum allowed limit")

				// @listSize(assumedSize: 50) overrides EstimatedListSize; cost = 50 * 2 = 100
				estimated := res.Response.Header.Get(core.CostEstimatedHeader)
				require.NotEmpty(t, estimated, "estimated cost header should be present")
				require.Equal(t, "100", estimated)

				// the actual cost should not be calculated nor exposed
				require.Empty(t, res.Response.Header.Get(core.CostActualHeader))
			})
		})

		t.Run("field and argument cost weights via @cost directive", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.CostAnalysis = &config.CostAnalysis{
						Enabled:           true,
						Mode:              config.CostAnalysisModeEnforce,
						MaxEstimatedLimit: 50,
						EstimatedListSize: 10,
						ExposeHeaders:     true,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employee(id:1) { id details { forename surname } } }`,
				})
				require.Contains(t, res.Body, `"data":`)

				// employee: @cost(weight: 5); argument id: @cost(weight: 2); details: 1 = 8
				require.Equal(t, "8", res.Response.Header.Get(core.CostEstimatedHeader))
				require.Equal(t, "8", res.Response.Header.Get(core.CostActualHeader))
			})
		})

		t.Run("field without listSize uses estimated_list_size", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.CostAnalysis = &config.CostAnalysis{
						Enabled:           true,
						Mode:              config.CostAnalysisModeEnforce,
						MaxEstimatedLimit: 50,
						EstimatedListSize: 3,
						ExposeHeaders:     true,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ teammates(team: ENGINEERING) { id details { forename } } }`,
				})
				require.Contains(t, res.Body, `"data":`)

				// teammates has NO @listSize, so it uses EstimatedListSize(3)
				require.Equal(t, "7", res.Response.Header.Get(core.CostEstimatedHeader))
				require.Equal(t, "15", res.Response.Header.Get(core.CostActualHeader))
			})
		})

		t.Run("listSize:assumedSize always overrides estimated_list_size", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.CostAnalysis = &config.CostAnalysis{
						Enabled:           true,
						Mode:              config.CostAnalysisModeEnforce,
						MaxEstimatedLimit: 200,
						EstimatedListSize: 200, // Very high, but @listSize(assumedSize: 50) overrides it
						ExposeHeaders:     true,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employees { id } }`,
				})
				require.Contains(t, res.Body, `"data":`)

				// @listSize(assumedSize: 50) on employees overrides EstimatedListSize(200)
				estimated := res.Response.Header.Get(core.CostEstimatedHeader)
				require.NotEmpty(t, estimated, "estimated cost header should be present")
				require.Equal(t, "50", estimated)
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
						Enabled: false,
						Mode:    config.CostAnalysisModeEnforce,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employees { id details { forename surname } } }`,
				})
				require.Contains(t, res.Body, `"data":`)
			})
		})

		t.Run("measure mode does not block and exposes field cost headers", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.CostAnalysis = &config.CostAnalysis{
						Enabled:           true,
						Mode:              config.CostAnalysisModeMeasure,
						MaxEstimatedLimit: 1, // Would block in the enforce mode
						EstimatedListSize: 10,
						ExposeHeaders:     true,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employee(id:1) { id details { forename surname } } }`,
				})
				require.Contains(t, res.Body, `"data":`)

				// employee: @cost(weight: 5), argument id: @cost(weight: 2), Details: 1 = 8
				require.Equal(t, "8", res.Response.Header.Get(core.CostEstimatedHeader))
				require.Equal(t, "8", res.Response.Header.Get(core.CostActualHeader))
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
						ExposeHeaders:     true,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ teammates(team: ENGINEERING) { id details { forename } } }`,
				})
				require.Contains(t, res.Body, `"data":`)

				// teammates has no @listSize, uses EstimatedListSize(10)
				require.Equal(t, "21", res.Response.Header.Get(core.CostEstimatedHeader))
				require.Equal(t, "15", res.Response.Header.Get(core.CostActualHeader))
			})
		})

		t.Run("nested list with inner object fields", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.CostAnalysis = &config.CostAnalysis{
						Enabled:           true,
						Mode:              config.CostAnalysisModeEnforce,
						MaxEstimatedLimit: 10000,
						EstimatedListSize: 5,
						ExposeHeaders:     true,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employees { id role { departments title } } }`,
				})
				require.Contains(t, res.Body, `"data":`)

				require.Equal(t, "600", res.Response.Header.Get(core.CostEstimatedHeader))
				require.Equal(t, "280", res.Response.Header.Get(core.CostActualHeader))
			})
		})
	})

	t.Run("metrics", func(t *testing.T) {
		t.Parallel()

		t.Run("Should record actual cost metrics", func(t *testing.T) {
			t.Parallel()

			metricReader := sdkmetric.NewManualReader()

			testenv.Run(t, &testenv.Config{
				MetricReader: metricReader,
				MetricOptions: testenv.MetricOptions{
					OTLPCostStats: config.CostStats{
						EstimatedEnabled: true,
						ActualEnabled:    true,
					},
				},
				ModifySecurityConfiguration: func(cfg *config.SecurityConfiguration) {
					cfg.CostAnalysis = &config.CostAnalysis{
						Enabled:           true,
						Mode:              config.CostAnalysisModeMeasure,
						EstimatedListSize: 15,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employees { id details { forename surname } } }`,
				})
				require.Contains(t, res.Body, `"employees"`)

				var rm metricdata.ResourceMetrics
				err := metricReader.Collect(context.Background(), &rm)
				require.NoError(t, err)

				var foundEstimated, foundActual bool
				var estimatedHistogram, actualHistogram metricdata.Histogram[int64]

				for _, scopeMetric := range rm.ScopeMetrics {
					for _, m := range scopeMetric.Metrics {
						switch m.Name {
						case metric.OperationCostEstimatedHistogram:
							estimatedHistogram, foundEstimated = m.Data.(metricdata.Histogram[int64])
						case metric.OperationCostActualHistogram:
							actualHistogram, foundActual = m.Data.(metricdata.Histogram[int64])
						}
					}
				}

				require.True(t, foundEstimated, "estimated cost metric should be recorded")
				require.True(t, foundActual, "actual cost metric should be recorded")

				require.NotEmpty(t, estimatedHistogram.DataPoints)
				require.NotEmpty(t, actualHistogram.DataPoints)

				// Aggregate across all datapoints to avoid relying on ordering
				var estimatedSum, actualSum int64
				for _, dp := range estimatedHistogram.DataPoints {
					estimatedSum += dp.Sum
				}
				for _, dp := range actualHistogram.DataPoints {
					actualSum += dp.Sum
				}

				// @listSize(assumedSize: 50) overrides EstimatedListSize(15); cost = 50 * 2 = 100
				require.Equal(t, int64(100), estimatedSum)
				require.Equal(t, int64(20), actualSum)

				// Verify that cost metrics carry the correct operation attributes
				for _, dp := range []metricdata.HistogramDataPoint[int64]{
					estimatedHistogram.DataPoints[0],
					actualHistogram.DataPoints[0],
				} {
					val, ok := dp.Attributes.Value(otel.WgOperationName)
					require.True(t, ok, "cost metric should have wg.operation.name attribute")
					require.Equal(t, "", val.AsString())

					val, ok = dp.Attributes.Value(otel.WgOperationType)
					require.True(t, ok, "cost metric should have wg.operation.type attribute")
					require.Equal(t, "query", val.AsString())

					val, ok = dp.Attributes.Value(otel.WgOperationProtocol)
					require.True(t, ok, "cost metric should have wg.operation.protocol attribute")
					require.Equal(t, "http", val.AsString())

					val, ok = dp.Attributes.Value(otel.WgClientName)
					require.True(t, ok, "cost metric should have wg.client.name attribute")
					require.Equal(t, "unknown", val.AsString())

					val, ok = dp.Attributes.Value(otel.WgClientVersion)
					require.True(t, ok, "cost metric should have wg.client.version attribute")
					require.Equal(t, "missing", val.AsString())

					require.True(t, dp.Attributes.HasValue(semconv.HTTPStatusCodeKey),
						"cost metric should have http.status_code attribute")
				}
			})
		})

		t.Run("Should record multiple operations with different directive types", func(t *testing.T) {
			t.Parallel()

			metricReader := sdkmetric.NewManualReader()

			testenv.Run(t, &testenv.Config{
				MetricReader: metricReader,
				MetricOptions: testenv.MetricOptions{
					OTLPCostStats: config.CostStats{
						EstimatedEnabled: true,
						ActualEnabled:    true,
					},
				},
				ModifySecurityConfiguration: func(cfg *config.SecurityConfiguration) {
					cfg.CostAnalysis = &config.CostAnalysis{
						Enabled:           true,
						Mode:              config.CostAnalysisModeMeasure,
						EstimatedListSize: 10,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				// Query 1: @listSize(assumedSize: 50) on employees
				res1 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employees { id } }`,
				})
				require.JSONEq(t, employeesIDData, res1.Body)

				// Query 2: @cost(weight: 5) + @cost(weight: 2) on employee(id:)
				res2 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employee(id:1) { id details { forename } } }`,
				})
				require.Contains(t, res2.Body, `"employee"`)

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
				MetricOptions: testenv.MetricOptions{
					OTLPCostStats: config.CostStats{
						EstimatedEnabled: true,
						ActualEnabled:    true,
					},
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
				var foundEstimated, foundActual bool
				for _, scopeMetric := range rm.ScopeMetrics {
					for _, m := range scopeMetric.Metrics {
						if m.Name == metric.OperationCostEstimatedHistogram {
							foundEstimated = true
						}
						if m.Name == metric.OperationCostActualHistogram {
							foundActual = true
						}
					}
				}
				require.False(t, foundEstimated)
				require.False(t, foundActual)
			})
		})

		t.Run("Should not record cost metrics when cost analysis is disabled", func(t *testing.T) {
			t.Parallel()

			metricReader := sdkmetric.NewManualReader()

			testenv.Run(t, &testenv.Config{
				MetricReader: metricReader,
				MetricOptions: testenv.MetricOptions{
					OTLPCostStats: config.CostStats{
						EstimatedEnabled: true,
						ActualEnabled:    true,
					},
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

				var foundEstimated, foundActual bool
				for _, scopeMetric := range rm.ScopeMetrics {
					for _, m := range scopeMetric.Metrics {
						switch m.Name {
						case metric.OperationCostEstimatedHistogram:
							foundEstimated = true
						case metric.OperationCostActualHistogram:
							foundActual = true
						}
					}
				}

				require.False(t, foundEstimated)
				require.False(t, foundActual)
			})
		})
	})

	t.Run("response headers", func(t *testing.T) {
		t.Parallel()

		t.Run("Should not expose cost headers when expose_headers is disabled", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(cfg *config.SecurityConfiguration) {
					cfg.CostAnalysis = &config.CostAnalysis{
						Enabled:           true,
						Mode:              config.CostAnalysisModeMeasure,
						EstimatedListSize: 5,
						ExposeHeaders:     false,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employees { id details { forename surname } } }`,
				})
				require.Contains(t, res.Body, `"employees"`)

				require.Empty(t, res.Response.Header.Get(core.CostEstimatedHeader))
				require.Empty(t, res.Response.Header.Get(core.CostActualHeader))
			})
		})

		t.Run("Should not expose cost headers when cost analysis is disabled", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(cfg *config.SecurityConfiguration) {
					cfg.CostAnalysis = &config.CostAnalysis{
						Enabled:       false,
						ExposeHeaders: true,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employees { id } }`,
				})
				require.Contains(t, res.Body, `"employees"`)

				require.Empty(t, res.Response.Header.Get(core.CostEstimatedHeader))
				require.Empty(t, res.Response.Header.Get(core.CostActualHeader))
			})
		})
	})
}
