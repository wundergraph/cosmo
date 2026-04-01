package integration

import (
	"context"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	semconv "go.opentelemetry.io/otel/semconv/v1.21.0"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/metric"
	otel "github.com/wundergraph/cosmo/router/pkg/otel"
)

func TestOperationCost(t *testing.T) {
	t.Parallel()

	t.Run("cost control", func(t *testing.T) {
		t.Parallel()

		// These tests verify cost control behavior with @cost and @listSize
		// directives loaded from the test config (config.json).
		// Each test uses a different query to cover distinct directive features.

		t.Run("listSize assumedSize overrides estimated_list_size and blocks when over limit", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.CostControl = &config.CostControl{
						Enabled:           true,
						Mode:              config.CostControlModeEnforce,
						MaxEstimatedLimit: 9,
						EstimatedListSize: 5,
						ExposeHeaders:     true,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				// employees has @listSize(assumedSize: 50) which overrides EstimatedListSize(5)
				res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: `{ employees { id details { forename surname } } }`,
				})
				require.NoError(t, err)
				require.Equal(t, 400, res.Response.StatusCode)
				require.Contains(t, res.Body, "exceeds the maximum allowed limit")

				// @listSize(assumedSize: 50) overrides EstimatedListSize; cost = 50 * 2 = 100
				estimated := res.Response.Header.Get(core.CostEstimatedHeader)
				require.Equal(t, "100", estimated)

				// the actual cost should not be calculated nor exposed
				require.Empty(t, res.Response.Header.Get(core.CostActualHeader))
			})
		})

		t.Run("field and argument cost weights via @cost directive", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.CostControl = &config.CostControl{
						Enabled:           true,
						Mode:              config.CostControlModeEnforce,
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

		t.Run("field and argument cost weights are not rejected when equal to limit", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.CostControl = &config.CostControl{
						Enabled:           true,
						Mode:              config.CostControlModeEnforce,
						MaxEstimatedLimit: 8,
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
					securityConfiguration.CostControl = &config.CostControl{
						Enabled:           true,
						Mode:              config.CostControlModeEnforce,
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
					securityConfiguration.CostControl = &config.CostControl{
						Enabled:           true,
						Mode:              config.CostControlModeEnforce,
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
				require.Equal(t, "50", estimated)
			})
		})

		t.Run("disabled cost control does not block queries", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.CostControl = &config.CostControl{
						Enabled: false,
						Mode:    config.CostControlModeEnforce,
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
					securityConfiguration.CostControl = &config.CostControl{
						Enabled:           true,
						Mode:              config.CostControlModeMeasure,
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

		t.Run("nested list with inner object fields", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.CostControl = &config.CostControl{
						Enabled:           true,
						Mode:              config.CostControlModeEnforce,
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

				// 50 * (employees(1) + id(0) + 1 * (role(1) + 3 * departments(1) + 5 * title(1)))
				require.Equal(t, "500", res.Response.Header.Get(core.CostEstimatedHeader))
				require.Equal(t, "280", res.Response.Header.Get(core.CostActualHeader))
			})
		})

		t.Run("type weight on enum affects cost calculation", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.CostControl = &config.CostControl{
						Enabled:           true,
						Mode:              config.CostControlModeEnforce,
						MaxEstimatedLimit: 1000,
						EstimatedListSize: 10,
						ExposeHeaders:     true,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employee(id:1) { role { departments } } }`,
				})
				require.Contains(t, res.Body, `"data":`)

				// Department enum has @cost(weight: 1), overriding the default enum weight of 0.
				// employee(5) + 2 + 1 * (role(1) + 3 * departments(1)))
				require.Equal(t, "11", res.Response.Header.Get(core.CostEstimatedHeader))

				require.Equal(t, "10", res.Response.Header.Get(core.CostActualHeader))
			})
		})

		t.Run("type weight from correct subgraph used when entity spans multiple subgraphs", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.CostControl = &config.CostControl{
						Enabled:           true,
						Mode:              config.CostControlModeMeasure,
						MaxEstimatedLimit: 100000,
						EstimatedListSize: 10,
						ExposeHeaders:     true,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				// Query 1: weight from both subgraphs is applied
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ products { ... on Cosmo { upc repositoryURL engineers { id } } } }`,
				})
				require.Contains(t, res.Body, `"data":`)

				// The Cosmo type has @cost(weight: 5) in employees and @cost(weight: 8) in products.
				// When a field is planned across multiple data sources, type weights are summed
				// (not merged) because resolving from two subgraphs means more work for the router.
				//
				// products field (abstract, both DSes): fieldCost = 5 + 8 = 13
				// engineers (list, EstimatedListSize=10): (0 + 1) × 10 = 10
				// upc, repositoryURL, id: 0 (scalars)
				// total: (10 + 13) × 10 = 230
				estimated := res.Response.Header.Get(core.CostEstimatedHeader)
				require.Equal(t, "230", estimated)

				actual := res.Response.Header.Get(core.CostActualHeader)
				require.Equal(t, "45", actual)

				// Query 2: only employees-subgraph fields — Cosmo @cost(weight: 5) from employees applies
				res2 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ products { ... on Cosmo { upc engineers { id } } } }`,
				})
				require.Contains(t, res2.Body, `"data":`)
				estimated2 := res2.Response.Header.Get(core.CostEstimatedHeader)
				// employees-only: weight 5 applies from employees subgraph only
				require.Equal(t, "150", estimated2)

				actual2 := res2.Response.Header.Get(core.CostActualHeader)
				require.Equal(t, "21", actual2)
			})
		})

		t.Run("input object field cost weight on department", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.CostControl = &config.CostControl{
						Enabled:           true,
						Mode:              config.CostControlModeMeasure,
						MaxEstimatedLimit: 10000,
						EstimatedListSize: 10,
						ExposeHeaders:     true,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ findEmployeesBy(criteria: { department: ENGINEERING }) { id } }`,
				})
				require.Contains(t, res.Body, `"data":`)

				// 10*1 + 17
				require.Equal(t, "27", res.Response.Header.Get(core.CostEstimatedHeader))
				// 7*1 + 17
				require.Equal(t, "24", res.Response.Header.Get(core.CostActualHeader))
			})
		})

		t.Run("input object field cost weight on title", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.CostControl = &config.CostControl{
						Enabled:           true,
						Mode:              config.CostControlModeMeasure,
						MaxEstimatedLimit: 10000,
						EstimatedListSize: 10,
						ExposeHeaders:     true,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ findEmployeesBy(criteria: { title: "Founder" }) { id } }`,
				})
				require.Contains(t, res.Body, `"data":`)

				// 10 * 1 - 3
				require.Equal(t, "7", res.Response.Header.Get(core.CostEstimatedHeader))
				// 1 * 1 - 3
				require.Equal(t, "0", res.Response.Header.Get(core.CostActualHeader))
			})
		})

		t.Run("slicingArguments controls list size estimation", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.CostControl = &config.CostControl{
						Enabled:           true,
						Mode:              config.CostControlModeEnforce,
						MaxEstimatedLimit: 10000,
						EstimatedListSize: 100,
						ExposeHeaders:     true,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ sharedThings(numOfA: 3, numOfB: 10) { a } }`,
				})
				require.Contains(t, res.Body, `"data":`)

				// numOfA=3 overrides EstimatedListSize(100) as the list multiplier.
				require.Equal(t, "3", res.Response.Header.Get(core.CostEstimatedHeader))

				require.Equal(t, "3", res.Response.Header.Get(core.CostActualHeader))
			})
		})
	})

	t.Run("requireOneSlicingArgument validation", func(t *testing.T) {
		t.Parallel()

		// All tests use measure mode (less restrictive) to prove validation runs regardless of mode.
		measureCostControl := func(securityConfiguration *config.SecurityConfiguration) {
			securityConfiguration.CostControl = &config.CostControl{
				Enabled: true,
				Mode:    config.CostControlModeMeasure,
			}
		}

		t.Run("exactly one slicing argument provided - valid", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: measureCostControl,
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ slicedThings(first: 5) { a } }`,
				})
				require.Contains(t, res.Body, `"data":`)
				require.NotContains(t, res.Body, `"errors"`)
			})
		})

		t.Run("no slicing argument provided - error", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: measureCostControl,
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: `{ slicedThings { a } }`,
				})
				require.NoError(t, err)
				require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
				require.Contains(t, res.Body, `"errors"`)
				require.Contains(t, res.Body, `requires exactly one slicing argument, but none was provided`)
				require.NotContains(t, res.Body, `"data":`)
			})
		})

		t.Run("multiple slicing arguments provided - error", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: measureCostControl,
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: `{ slicedThings(first: 5, last: 3) { a } }`,
				})
				require.NoError(t, err)
				require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
				require.Contains(t, res.Body, `"errors"`)
				require.Contains(t, res.Body, `requires exactly one slicing argument, but 2 were provided`)
				require.NotContains(t, res.Body, `"data":`)
			})
		})

		t.Run("null variable for slicing argument - error", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: measureCostControl,
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query:     `query($f: Int) { slicedThings(first: $f) { a } }`,
					Variables: []byte(`{"f": null}`),
				})
				require.NoError(t, err)
				require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
				require.Contains(t, res.Body, `"errors"`)
				require.Contains(t, res.Body, `requires exactly one slicing argument, but none was provided`)
				require.NotContains(t, res.Body, `"data":`)
			})
		})

		t.Run("requireOneSlicingArgument disabled - no validation", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
					var dsID string
					for _, sg := range routerConfig.Subgraphs {
						if sg.Name == "products" {
							dsID = sg.Id
							break
						}
					}
					for _, ds := range routerConfig.EngineConfig.DatasourceConfigurations {
						if ds.Id != dsID || ds.CostConfiguration == nil {
							continue
						}
						for _, ls := range ds.CostConfiguration.ListSizes {
							if ls.TypeName == "Query" && ls.FieldName == "slicedThings" {
								disabled := false
								ls.RequireOneSlicingArgument = &disabled
							}
						}
					}
				},
				ModifySecurityConfiguration: measureCostControl,
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ slicedThings { a } }`,
				})
				require.Contains(t, res.Body, `"data":`)
				require.NotContains(t, res.Body, `"errors"`)
			})
		})
	})

	t.Run("metrics", func(t *testing.T) {
		t.Parallel()

		const employeesIDData = `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`

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
					cfg.CostControl = &config.CostControl{
						Enabled:           true,
						Mode:              config.CostControlModeMeasure,
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
					cfg.CostControl = &config.CostControl{
						Enabled:           true,
						Mode:              config.CostControlModeMeasure,
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
					cfg.CostControl = &config.CostControl{
						Enabled:           true,
						Mode:              config.CostControlModeMeasure,
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

		t.Run("Should not record cost metrics when cost control is disabled", func(t *testing.T) {
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
					cfg.CostControl = &config.CostControl{
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

	t.Run("plan cache hit", func(t *testing.T) {
		t.Parallel()

		t.Run("second identical request must return same cost as first (cache miss vs hit)", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.CostControl = &config.CostControl{
						Enabled:           true,
						Mode:              config.CostControlModeMeasure,
						EstimatedListSize: 10,
						ExposeHeaders:     true,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				query := testenv.GraphQLRequest{
					Query: `{ employee(id:1) { id details { forename surname } } }`,
				}

				// 1st request – plan cache MISS
				res1 := xEnv.MakeGraphQLRequestOK(query)
				require.Contains(t, res1.Body, `"data":`)
				require.Equal(t, "MISS", res1.Response.Header.Get(core.ExecutionPlanCacheHeader))
				require.Equal(t, "8", res1.Response.Header.Get(core.CostEstimatedHeader))
				require.Equal(t, "8", res1.Response.Header.Get(core.CostActualHeader))

				// 2nd request – plan cache HIT
				res2 := xEnv.MakeGraphQLRequestOK(query)
				require.Contains(t, res2.Body, `"data":`)
				require.Equal(t, "HIT", res2.Response.Header.Get(core.ExecutionPlanCacheHeader))
				require.Equal(t, "8", res2.Response.Header.Get(core.CostEstimatedHeader))
				require.Equal(t, "8", res2.Response.Header.Get(core.CostActualHeader))
			})
		})

		t.Run("2nd request with different argument must return same cost as 1st", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.CostControl = &config.CostControl{
						Enabled:           true,
						Mode:              config.CostControlModeMeasure,
						EstimatedListSize: 10,
						ExposeHeaders:     true,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				// 1st request – plan cache MISS
				query1 := testenv.GraphQLRequest{
					Query: `{ employee(id:1) { id details { forename surname } } }`,
				}
				res1 := xEnv.MakeGraphQLRequestOK(query1)
				require.Contains(t, res1.Body, `"data":`)

				estimated1 := res1.Response.Header.Get(core.CostEstimatedHeader)
				actual1 := res1.Response.Header.Get(core.CostActualHeader)
				require.Equal(t, "8", estimated1)
				require.Equal(t, "8", actual1)

				// 2nd request – plan cache HIT
				query2 := testenv.GraphQLRequest{
					Query: `{ employee(id:2) { id details { forename surname } } }`,
				}
				res2 := xEnv.MakeGraphQLRequestOK(query2)
				require.Contains(t, res2.Body, `"data":`)

				estimated2 := res2.Response.Header.Get(core.CostEstimatedHeader)
				actual2 := res2.Response.Header.Get(core.CostActualHeader)
				require.Equal(t, "8", estimated2)
				require.Equal(t, "8", actual2)
			})
		})

		t.Run("enforce mode rejects over-limit queries on cache hit", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.CostControl = &config.CostControl{
						Enabled:           true,
						Mode:              config.CostControlModeEnforce,
						MaxEstimatedLimit: 9,
						EstimatedListSize: 5,
						ExposeHeaders:     true,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				query := testenv.GraphQLRequest{
					// employees has @listSize(assumedSize: 50), estimated = 50*2 = 100 > limit 9
					Query: `{ employees { id details { forename surname } } }`,
				}

				// 1st request – cache miss – should be blocked (cost 100 > limit 9)
				res1, err := xEnv.MakeGraphQLRequest(query)
				require.NoError(t, err)
				require.Equal(t, 400, res1.Response.StatusCode, "1st request (cache miss) should be rejected")
				require.Contains(t, res1.Body, "exceeds the maximum allowed limit")

				estimated1 := res1.Response.Header.Get(core.CostEstimatedHeader)
				require.Equal(t, "100", estimated1)

				// 2nd request – cache hit – should also be blocked with same cost.
				res2, err := xEnv.MakeGraphQLRequest(query)
				require.NoError(t, err)

				estimated2 := res2.Response.Header.Get(core.CostEstimatedHeader)
				require.Equal(t, "100", estimated2,
					"estimated cost on cache hit (%s) differs from cache miss (%s)",
					estimated2, estimated1)
				require.Equal(t, 400, res2.Response.StatusCode,
					"second request (cache hit) should also be rejected but was allowed")
				require.Contains(t, res2.Body, "exceeds the maximum allowed limit")
			})
		})

		t.Run("cost metrics are consistent across cache miss and hit", func(t *testing.T) {
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
					cfg.CostControl = &config.CostControl{
						Enabled:           true,
						Mode:              config.CostControlModeMeasure,
						EstimatedListSize: 10,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				query := testenv.GraphQLRequest{
					Query: `{ employee(id:1) { id details { forename surname } } }`,
				}

				// Fire the same query 3 times: 1 cache miss + 2 cache hits
				for i := 0; i < 3; i++ {
					res := xEnv.MakeGraphQLRequestOK(query)
					require.Contains(t, res.Body, `"data":`)
				}

				var rm metricdata.ResourceMetrics
				err := metricReader.Collect(context.Background(), &rm)
				require.NoError(t, err)

				var estimatedHistogram metricdata.Histogram[int64]
				var foundEstimated bool

				for _, scopeMetric := range rm.ScopeMetrics {
					for _, m := range scopeMetric.Metrics {
						if m.Name == metric.OperationCostEstimatedHistogram {
							estimatedHistogram, foundEstimated = m.Data.(metricdata.Histogram[int64])
						}
					}
				}
				require.True(t, foundEstimated, "estimated cost metric should exist")

				// Sum all recorded estimated costs across data points.
				var totalCount uint64
				var totalSum int64
				for _, dp := range estimatedHistogram.DataPoints {
					totalCount += dp.Count
					totalSum += dp.Sum
				}

				require.Equal(t, uint64(3), totalCount, "should have 3 cost recordings (1 miss + 2 hits)")

				// employee(id:1) cost = 8 per request.  3 requests = 24.
				require.Equal(t, int64(24), totalSum, "total estimated cost sum should be 3×8=24")
			})
		})

		t.Run("input object field costs are consistent across cache hits for different queries", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.CostControl = &config.CostControl{
						Enabled:           true,
						Mode:              config.CostControlModeMeasure,
						EstimatedListSize: 10,
						ExposeHeaders:     true,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				// 1st request – plan cache MISS
				resDept1 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ findEmployeesBy(criteria: { department: ENGINEERING }) { id } }`,
				})
				require.Contains(t, resDept1.Body, `"data":`)
				require.Equal(t, "MISS", resDept1.Response.Header.Get(core.ExecutionPlanCacheHeader))
				require.Equal(t, "27", resDept1.Response.Header.Get(core.CostEstimatedHeader))
				require.Equal(t, "24", resDept1.Response.Header.Get(core.CostActualHeader))

				// 2nd request – plan cache HIT (same normalized query, different input field)
				// Cost is recalculated per request based on actual input field values
				resTitle1 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ findEmployeesBy(criteria: { title: "Founder" }) { id } }`,
				})
				require.Contains(t, resTitle1.Body, `"data":`)
				require.Equal(t, "HIT", resTitle1.Response.Header.Get(core.ExecutionPlanCacheHeader))
				require.Equal(t, "7", resTitle1.Response.Header.Get(core.CostEstimatedHeader))
				require.Equal(t, "0", resTitle1.Response.Header.Get(core.CostActualHeader))

				// 3rd request – cache HIT, same input field as 1st, different value
				resDept2 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ findEmployeesBy(criteria: { department: MARKETING }) { id } }`,
				})
				require.Contains(t, resDept2.Body, `"data":`)
				require.Equal(t, "HIT", resDept2.Response.Header.Get(core.ExecutionPlanCacheHeader))
				require.Equal(t, "27", resDept2.Response.Header.Get(core.CostEstimatedHeader))
				require.Equal(t, "20", resDept2.Response.Header.Get(core.CostActualHeader))

				// 4th request – cache HIT, same input field as 2nd, different value
				resTitle2 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ findEmployeesBy(criteria: { title: "Director" }) { id } }`,
				})
				require.Contains(t, resTitle2.Body, `"data":`)
				require.Equal(t, "HIT", resTitle2.Response.Header.Get(core.ExecutionPlanCacheHeader))
				require.Equal(t, "7", resTitle2.Response.Header.Get(core.CostEstimatedHeader))
				require.Equal(t, "0", resTitle2.Response.Header.Get(core.CostActualHeader))
			})
		})
	})

	t.Run("negative weights", func(t *testing.T) {
		t.Parallel()

		// Helper to find the employees datasource and modify its cost configuration.
		modifyEmployeesCost := func(routerConfig *nodev1.RouterConfig, modify func(cc *nodev1.CostConfiguration)) {
			var dsID string
			for _, sg := range routerConfig.Subgraphs {
				if sg.Name == "employees" {
					dsID = sg.Id
					break
				}
			}
			if dsID == "" {
				return
			}
			for _, ds := range routerConfig.EngineConfig.DatasourceConfigurations {
				if ds.Id != dsID || ds.CostConfiguration == nil {
					continue
				}
				modify(ds.CostConfiguration)
			}
		}

		t.Run("negative field weight clips total to zero", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
					modifyEmployeesCost(routerConfig, func(cc *nodev1.CostConfiguration) {
						for _, f := range cc.FieldWeights {
							if f.TypeName == "Query" && f.FieldName == "employee" {
								neg := int32(-3)
								f.Weight = &neg
							}
						}
					})
				},
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.CostControl = &config.CostControl{
						Enabled:           true,
						Mode:              config.CostControlModeMeasure,
						MaxEstimatedLimit: 10000,
						EstimatedListSize: 10,
						ExposeHeaders:     true,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				// Baseline cost is 8 with employee weight=5 and id arg weight=2.
				// With employee weight=-3: argsCost=2, round((1 + (-3)) * 1) = -2 → total = 2 + (-2) = 0, clipped to 0
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employee(id:1) { id details { forename surname } } }`,
				})
				require.Contains(t, res.Body, `"data":`)
				require.Equal(t, "0", res.Response.Header.Get(core.CostEstimatedHeader))
				require.Equal(t, "0", res.Response.Header.Get(core.CostActualHeader))
			})
		})

		t.Run("negative type weight on list field clips to zero", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
					modifyEmployeesCost(routerConfig, func(cc *nodev1.CostConfiguration) {
						if cc.TypeWeights == nil {
							cc.TypeWeights = make(map[string]int32)
						}
						cc.TypeWeights["Department"] = -10
					})
				},
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.CostControl = &config.CostControl{
						Enabled:           true,
						Mode:              config.CostControlModeMeasure,
						MaxEstimatedLimit: 10000,
						EstimatedListSize: 10,
						ExposeHeaders:     true,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				// Baseline with Department type weight=1 gives estimated=18.
				// With Department type weight=-10, the negative subtree cost clips at zero.
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employee(id:1) { role { departments } } }`,
				})
				require.Contains(t, res.Body, `"data":`)

				require.Equal(t, "8", res.Response.Header.Get(core.CostEstimatedHeader))
			})
		})

		t.Run("negative argument weight reduces cost but does not zero it", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
					modifyEmployeesCost(routerConfig, func(cc *nodev1.CostConfiguration) {
						for _, f := range cc.FieldWeights {
							if f.TypeName == "Query" && f.FieldName == "employee" {
								if f.ArgumentWeights == nil {
									f.ArgumentWeights = make(map[string]int32)
								}
								f.ArgumentWeights["id"] = -5
							}
						}
					})
				},
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.CostControl = &config.CostControl{
						Enabled:           true,
						Mode:              config.CostControlModeMeasure,
						MaxEstimatedLimit: 10000,
						EstimatedListSize: 10,
						ExposeHeaders:     true,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				// With arg id weight=-5: argsCost=-5, round((1 + 5) * 1) = 6 → total = -5 + 6 = 1
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employee(id:1) { id details { forename surname } } }`,
				})
				require.Contains(t, res.Body, `"data":`)
				require.Equal(t, "1", res.Response.Header.Get(core.CostEstimatedHeader))
				require.Equal(t, "1", res.Response.Header.Get(core.CostActualHeader))
			})
		})

		t.Run("negative field weight partially offsets positive cost", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
					modifyEmployeesCost(routerConfig, func(cc *nodev1.CostConfiguration) {
						for _, f := range cc.FieldWeights {
							if f.TypeName == "Query" && f.FieldName == "employee" {
								neg := int32(-1)
								f.Weight = &neg
							}
						}
					})
				},
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.CostControl = &config.CostControl{
						Enabled:           true,
						Mode:              config.CostControlModeMeasure,
						MaxEstimatedLimit: 10000,
						EstimatedListSize: 10,
						ExposeHeaders:     true,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				// With employee weight=-1: argsCost=2, round((1 + (-1)) * 1) = 0 → total = 2 + 0 = 2
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employee(id:1) { id details { forename surname } } }`,
				})
				require.Contains(t, res.Body, `"data":`)
				require.Equal(t, "2", res.Response.Header.Get(core.CostEstimatedHeader))
				require.Equal(t, "2", res.Response.Header.Get(core.CostActualHeader))
			})
		})
	})

	t.Run("sizedFields", func(t *testing.T) {
		t.Parallel()

		t.Run("sizedFields with assumedSize", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(cfg *config.SecurityConfiguration) {
					cfg.CostControl = &config.CostControl{
						Enabled:           true,
						Mode:              config.CostControlModeMeasure,
						MaxEstimatedLimit: 10000,
						EstimatedListSize: 10,
						ExposeHeaders:     true,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employee(id:1) {
								role {
									departments
								}
							} }`,
				})
				require.Contains(t, res.Body, `"data":`)

				// Without sizedFields: estimated=18 (departments uses defaultListSize=10)
				// With sizedFields(assumedSize=3): departments multiplier=3 instead of 10:
				// employee.arg(2) + 1 * (employee(5) + 1 * (role(1) + (3 * departments(1))))
				require.Equal(t, "11", res.Response.Header.Get(core.CostEstimatedHeader))

				// employee.arg(2) + 1 * (employee(5) + 1 * (role(1) + (2 * departments(1))))
				require.Equal(t, "10", res.Response.Header.Get(core.CostActualHeader))
			})
		})

		t.Run("sizedFields only applies to named children, unlisted siblings use defaultListSize", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(cfg *config.SecurityConfiguration) {
					cfg.CostControl = &config.CostControl{
						Enabled:           true,
						Mode:              config.CostControlModeMeasure,
						MaxEstimatedLimit: 10000,
						EstimatedListSize: 10,
						ExposeHeaders:     true,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employee(id:1) { role { departments employees { id } } } }`,
				})
				require.Contains(t, res.Body, `"data":`)

				// Without sizedFields: estimated=28 (both departments and employees use defaultListSize=10)
				// With sizedFields(assumedSize=3): departments multiplier=3 instead of 10, employees stays at 10:
				// employee.arg(2) + 1 * (employee(5) + 1 * (role(1) + (3 * departments(1)) + (10 * employees(1))))
				require.Equal(t, "21", res.Response.Header.Get(core.CostEstimatedHeader))

				// employee.arg(2) + 1 * (employee(5) + 1 * (role(1) + (2 * departments(1)) + (7 * employees(1))))
				require.Equal(t, "17", res.Response.Header.Get(core.CostActualHeader))
			})
		})
	})

	t.Run("response headers", func(t *testing.T) {
		t.Parallel()

		t.Run("Should not expose cost headers when expose_headers is disabled", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(cfg *config.SecurityConfiguration) {
					cfg.CostControl = &config.CostControl{
						Enabled:           true,
						Mode:              config.CostControlModeMeasure,
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

		t.Run("Should not expose cost headers when cost control is disabled", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(cfg *config.SecurityConfiguration) {
					cfg.CostControl = &config.CostControl{
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
