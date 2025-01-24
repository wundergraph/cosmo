package integration

import (
	"context"
	"net/http"
	"os"
	"testing"
	"time"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.opentelemetry.io/otel/sdk/metric/metricdata/metricdatatest"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"google.golang.org/protobuf/encoding/protojson"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestCacheWarmup(t *testing.T) {
	t.Parallel()

	t.Run("cache warmup tests for filesystem", func(t *testing.T) {
		t.Parallel()

		const employeeWarmedQueryCount = 1

		t.Run("cache warmup disabled", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { employees { id } }`,
				})
				require.JSONEq(t, employeesIDData, res.Body)
			})
		})
		t.Run("cache warmup enabled", func(t *testing.T) {
			t.Parallel()

			const employeeQueryCount = 2

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
						Enabled: true,
						Source: config.CacheWarmupSource{
							Filesystem: &config.CacheWarmupFileSystemSource{
								Path: "testenv/testdata/cache_warmup/simple",
							},
						},
					}),
				},
				AssertCacheMetrics: &testenv.AssertCacheMetrics{
					After: &testenv.CacheMetricsAssertions{
						BaseGraphAssertions: testenv.CacheMetricsAssertion{
							QueryNormalizationMisses: 3 + employeeWarmedQueryCount + employeeQueryCount,
							QueryNormalizationHits:   4,
							ValidationMisses:         3 + employeeWarmedQueryCount,
							ValidationHits:           4 + employeeQueryCount,
							PlanMisses:               3 + employeeWarmedQueryCount,
							PlanHits:                 4 + employeeQueryCount,
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { employees { id } }`,
				})
				require.Equal(t, employeesIDData, res.Body)
				res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { employees { id } }`,
				})
				require.Equal(t, employeesIDData, res.Body)
				res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { employees { id details { forename } } }`,
				})
				require.Equal(t, `{"data":{"employees":[{"id":1,"details":{"forename":"Jens"}},{"id":2,"details":{"forename":"Dustin"}},{"id":3,"details":{"forename":"Stefan"}},{"id":4,"details":{"forename":"Björn"}},{"id":5,"details":{"forename":"Sergiy"}},{"id":7,"details":{"forename":"Suvij"}},{"id":8,"details":{"forename":"Nithin"}},{"id":10,"details":{"forename":"Eelco"}},{"id":11,"details":{"forename":"Alexandra"}},{"id":12,"details":{"forename":"David"}}]}}`, res.Body)
				res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { employees { id details { forename surname } } }`,
				})
				require.Equal(t, `{"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":3,"details":{"forename":"Stefan","surname":"Avram"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"}},{"id":7,"details":{"forename":"Suvij","surname":"Surya"}},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"}},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}},{"id":12,"details":{"forename":"David","surname":"Stutt"}}]}}`, res.Body)

				res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query m($id: Int!){ employee(id: $id) { id details { forename surname } } }`,
					Variables: []byte(`{"id": 1}`),
				})
				require.Equal(t, "HIT", res.Response.Header.Get("x-wg-execution-plan-cache"))
				require.Equal(t, `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)

				res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { employee(id: 2) { id details { forename surname } } }`,
				})
				require.Equal(t, "HIT", res.Response.Header.Get("x-wg-execution-plan-cache"))
				require.Equal(t, `{"data":{"employee":{"id":2,"details":{"forename":"Dustin","surname":"Deus"}}}}`, res.Body)
			})
		})
		t.Run("cache warmup invalid files", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
						Enabled: true,
						Source: config.CacheWarmupSource{
							Filesystem: &config.CacheWarmupFileSystemSource{
								Path: "testenv/testdata/cache_warmup/invalid",
							},
						},
					}),
				},
				AssertCacheMetrics: &testenv.AssertCacheMetrics{
					After: &testenv.CacheMetricsAssertions{
						BaseGraphAssertions: testenv.CacheMetricsAssertion{
							QueryNormalizationMisses: 2,
							QueryNormalizationHits:   0,
							ValidationMisses:         2,
							ValidationHits:           0,
							PlanMisses:               1,
							PlanHits:                 0,
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { employees { id } }`,
				})
				require.Equal(t, employeesIDData, res.Body)
			})
		})
		t.Run("cache warmup json", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
						Enabled: true,
						Source: config.CacheWarmupSource{
							Filesystem: &config.CacheWarmupFileSystemSource{
								Path: "testenv/testdata/cache_warmup/json",
							},
						},
					}),
				},
				AssertCacheMetrics: &testenv.AssertCacheMetrics{
					After: &testenv.CacheMetricsAssertions{
						BaseGraphAssertions: testenv.CacheMetricsAssertion{
							QueryNormalizationMisses: 3,
							QueryNormalizationHits:   5,
							ValidationMisses:         3,
							ValidationHits:           5,
							PlanMisses:               3,
							PlanHits:                 5,
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { employees { id details { forename } } }`,
				})
				require.Equal(t, `{"data":{"employees":[{"id":1,"details":{"forename":"Jens"}},{"id":2,"details":{"forename":"Dustin"}},{"id":3,"details":{"forename":"Stefan"}},{"id":4,"details":{"forename":"Björn"}},{"id":5,"details":{"forename":"Sergiy"}},{"id":7,"details":{"forename":"Suvij"}},{"id":8,"details":{"forename":"Nithin"}},{"id":10,"details":{"forename":"Eelco"}},{"id":11,"details":{"forename":"Alexandra"}},{"id":12,"details":{"forename":"David"}}]}}`, res.Body)
				res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { employees { id details { forename surname } } }`,
				})
				require.Equal(t, `{"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":3,"details":{"forename":"Stefan","surname":"Avram"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"}},{"id":7,"details":{"forename":"Suvij","surname":"Surya"}},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"}},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}},{"id":12,"details":{"forename":"David","surname":"Stutt"}}]}}`, res.Body)
				res, err := xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
					Query: `query { employees { id details { forename surname } } }`,
				}, map[string]string{
					"graphql-client-name":    "test",
					"graphql-client-version": "1.0.0",
				})
				require.NoError(t, err)
				require.Equal(t, `{"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":3,"details":{"forename":"Stefan","surname":"Avram"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"}},{"id":7,"details":{"forename":"Suvij","surname":"Surya"}},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"}},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}},{"id":12,"details":{"forename":"David","surname":"Stutt"}}]}}`, res.Body)
				res, err = xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
					Query: `query { employees { id details { forename surname } } }`,
				}, map[string]string{
					"graphql-client-name":    "test",
					"graphql-client-version": "1.0.0",
				})
				require.NoError(t, err)
				require.Equal(t, `{"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":3,"details":{"forename":"Stefan","surname":"Avram"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"}},{"id":7,"details":{"forename":"Suvij","surname":"Surya"}},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"}},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}},{"id":12,"details":{"forename":"David","surname":"Stutt"}}]}}`, res.Body)
				res, err = xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
					Query: `query { employees { id details { forename surname } } }`,
				}, map[string]string{
					"graphql-client-name":    "test",
					"graphql-client-version": "1.0.1",
				})
				require.NoError(t, err)
				require.Equal(t, `{"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":3,"details":{"forename":"Stefan","surname":"Avram"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"}},{"id":7,"details":{"forename":"Suvij","surname":"Surya"}},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"}},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}},{"id":12,"details":{"forename":"David","surname":"Stutt"}}]}}`, res.Body)
			})
		})
		t.Run("cache warmup persisted operation", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
						Enabled: true,
						Source: config.CacheWarmupSource{
							Filesystem: &config.CacheWarmupFileSystemSource{
								Path: "testenv/testdata/cache_warmup/json_po",
							},
						},
					}),
				},
				AssertCacheMetrics: &testenv.AssertCacheMetrics{
					After: &testenv.CacheMetricsAssertions{
						BaseGraphAssertions: testenv.CacheMetricsAssertion{
							PersistedQueryNormalizationHits:   2,
							PersistedQueryNormalizationMisses: 1,
							ValidationHits:                    2,
							ValidationMisses:                  1,
							PlanHits:                          2,
							PlanMisses:                        1,
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				header := make(http.Header)
				header.Add("graphql-client-name", "my-client")
				res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					OperationName: []byte(`"Employees"`),
					Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "dc67510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
					Header:        header,
				})
				require.NoError(t, err)
				require.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)

				res2, err2 := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "dc67510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
					Header:     header,
				})
				require.NoError(t, err2)
				require.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res2.Body)
			})
		})
		t.Run("cache warmup persisted operation client mismatch", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
						Enabled: true,
						Source: config.CacheWarmupSource{
							Filesystem: &config.CacheWarmupFileSystemSource{
								Path: "testenv/testdata/cache_warmup/json_po",
							},
						},
					}),
				},
				AssertCacheMetrics: &testenv.AssertCacheMetrics{
					After: &testenv.CacheMetricsAssertions{
						BaseGraphAssertions: testenv.CacheMetricsAssertion{
							PersistedQueryNormalizationHits:   0, // 1x warmup miss, 1x request miss because of client mismatch, , 1x request miss because checking with operation name
							PersistedQueryNormalizationMisses: 3, // same as above
							ValidationMisses:                  1, // 1x warmup miss, no second miss because client mismatch stops request chain
							ValidationHits:                    0, // no hits because of client mismatch
							PlanMisses:                        1, // 1x warmup miss
							PlanHits:                          0, // no hits because client mismatch stops request chain
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				header := make(http.Header)
				header.Add("graphql-client-name", "my-other-client")
				res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					OperationName: []byte(`"Employees"`),
					Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "dc67510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
					Header:        header,
				})
				require.NoError(t, err)
				require.Equal(t, `{"errors":[{"message":"PersistedQueryNotFound","extensions":{"code":"PERSISTED_QUERY_NOT_FOUND"}}]}`, res.Body)
			})
		})
		t.Run("cache warmup persisted operation with multiple operations", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
						Enabled: true,
						Source: config.CacheWarmupSource{
							Filesystem: &config.CacheWarmupFileSystemSource{
								Path: "testenv/testdata/cache_warmup/json_po_multi_operations",
							},
						},
					}),
				},
				AssertCacheMetrics: &testenv.AssertCacheMetrics{
					After: &testenv.CacheMetricsAssertions{
						BaseGraphAssertions: testenv.CacheMetricsAssertion{
							PersistedQueryNormalizationHits:   1, // 1x hit after warmup, when called with operation name. No hit from second request because of missing operation name, it recomputes it
							PersistedQueryNormalizationMisses: 3, // 1x miss during warmup, 1 miss for first operation trying without operation name, 1 miss for second operation trying without operation name
							ValidationHits:                    2,
							ValidationMisses:                  1,
							PlanHits:                          2,
							PlanMisses:                        1,
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				header := make(http.Header)
				header.Add("graphql-client-name", "my-client")
				res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					OperationName: []byte(`"A"`),
					Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "724399f210ef3f16e6e5427a70bb9609ecea7297e99c3e9241d5912d04eabe60"}}`),
					Header:        header,
				})
				require.NoError(t, err)
				require.Equal(t, `{"data":{"a":{"id":1,"details":{"pets":null}}}}`, res.Body)

				res2, err2 := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "724399f210ef3f16e6e5427a70bb9609ecea7297e99c3e9241d5912d04eabe60"}}`),
					Header:     header,
				})
				require.NoError(t, err2)
				require.Equal(t, `{"data":{"a":{"id":1,"details":{"pets":null}}}}`, res2.Body)
			})
		})

		t.Run("cache warmup workers throttle", func(t *testing.T) {
			t.Parallel()
			logger, err := zap.NewDevelopment()
			require.NoError(t, err)
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithLogger(logger),
					core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
						Enabled: true,
						Source: config.CacheWarmupSource{
							Filesystem: &config.CacheWarmupFileSystemSource{
								Path: "testenv/testdata/cache_warmup/rate_limit",
							},
						},
						Workers:        4,
						ItemsPerSecond: 10,
						Timeout:        time.Second * 5,
					}),
				},
				AssertCacheMetrics: &testenv.AssertCacheMetrics{
					After: &testenv.CacheMetricsAssertions{
						BaseGraphAssertions: testenv.CacheMetricsAssertion{
							QueryNormalizationMisses: 10,
							QueryNormalizationHits:   1,
							ValidationMisses:         10,
							ValidationHits:           1,
							PlanMisses:               10,
							PlanHits:                 1,
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { a: employees { id } }`,
				})
				require.Equal(t, `{"data":{"a":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
			})
		})
		t.Run("cache warmup with operation hash cache", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				CustomMetricAttributes: []config.CustomAttribute{
					{
						Key: "sha256",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldOperationSha256,
						},
					},
				},
				RouterOptions: []core.Option{
					core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
						Enabled: true,
						Source: config.CacheWarmupSource{
							Filesystem: &config.CacheWarmupFileSystemSource{
								Path: "testenv/testdata/cache_warmup/simple",
							},
						},
						Workers:        2,
						ItemsPerSecond: 100,
					}),
				},
				AssertCacheMetrics: &testenv.AssertCacheMetrics{
					After: &testenv.CacheMetricsAssertions{
						BaseGraphAssertions: testenv.CacheMetricsAssertion{
							QueryNormalizationMisses: 3 + employeeWarmedQueryCount,
							QueryNormalizationHits:   2,
							ValidationMisses:         3 + employeeWarmedQueryCount,
							ValidationHits:           2,
							QueryHashMisses:          3 + employeeWarmedQueryCount,
							QueryHashHits:            2,
							PlanMisses:               3 + employeeWarmedQueryCount,
							PlanHits:                 2,
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { employees { id } }`,
				})
				require.Equal(t, employeesIDData, res.Body)
				res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { employees { id } }`,
				})
				require.Equal(t, employeesIDData, res.Body)
			})
		})

		t.Run("operation with include directive", func(t *testing.T) {
			t.Parallel()

			data, err := os.ReadFile("testenv/testdata/cache_warmup/skip_include/operations.json")
			require.NoError(t, err)
			var warmupOperations nodev1.CacheWarmerOperations
			unmarshalOpts := protojson.UnmarshalOptions{DiscardUnknown: true}
			err = unmarshalOpts.Unmarshal(data, &warmupOperations)
			require.NoError(t, err)

			warmupMisses := int64(0)
			for _, operation := range warmupOperations.Operations {
				if operation.Request.VariableVariations == nil {
					warmupMisses++
				} else {
					warmupMisses += int64(len(operation.Request.VariableVariations))
				}
			}

			testenv.Run(t, &testenv.Config{
				ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
					routerConfig.FeatureFlagConfigs = nil
				},
				RouterOptions: []core.Option{
					core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
						Enabled: true,
						Source: config.CacheWarmupSource{
							Filesystem: &config.CacheWarmupFileSystemSource{
								Path: "testenv/testdata/cache_warmup/skip_include",
							},
						},
					}),
				},
				AssertCacheMetrics: &testenv.AssertCacheMetrics{
					After: &testenv.CacheMetricsAssertions{
						BaseGraphAssertions: testenv.CacheMetricsAssertion{
							PersistedQueryNormalizationMisses: 2,
							QueryNormalizationMisses:          warmupMisses - 2, // subtract 2 as these are covered by the persisted query normalization
							QueryNormalizationHits:            2,
							ValidationMisses:                  warmupMisses,
							ValidationHits:                    2,
							PlanMisses:                        warmupMisses,
							PlanHits:                          2,
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query IncludeQuery($include: Boolean!) {employees { id details @include(if: $include) { forename } } }`,
					Variables: []byte(`{"include": true}`),
				})
				require.Equal(t, `{"data":{"employees":[{"id":1,"details":{"forename":"Jens"}},{"id":2,"details":{"forename":"Dustin"}},{"id":3,"details":{"forename":"Stefan"}},{"id":4,"details":{"forename":"Björn"}},{"id":5,"details":{"forename":"Sergiy"}},{"id":7,"details":{"forename":"Suvij"}},{"id":8,"details":{"forename":"Nithin"}},{"id":10,"details":{"forename":"Eelco"}},{"id":11,"details":{"forename":"Alexandra"}},{"id":12,"details":{"forename":"David"}}]}}`, res.Body)
				res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query IncludeQuery($include: Boolean!) {employees { id details @include(if: $include) { forename } } }`,
					Variables: []byte(`{"include": false}`),
				})
				require.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
			})
		})

		t.Run("operation with skip directive", func(t *testing.T) {
			t.Parallel()

			data, err := os.ReadFile("testenv/testdata/cache_warmup/skip_include/operations.json")
			require.NoError(t, err)
			var warmupOperations nodev1.CacheWarmerOperations
			unmarshalOpts := protojson.UnmarshalOptions{DiscardUnknown: true}
			err = unmarshalOpts.Unmarshal(data, &warmupOperations)
			require.NoError(t, err)

			warmupMisses := int64(0)
			for _, operation := range warmupOperations.Operations {
				if operation.Request.VariableVariations == nil {
					warmupMisses++
				} else {
					warmupMisses += int64(len(operation.Request.VariableVariations))
				}
			}

			testenv.Run(t, &testenv.Config{
				ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
					routerConfig.FeatureFlagConfigs = nil
				},
				RouterOptions: []core.Option{
					core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
						Enabled: true,
						Source: config.CacheWarmupSource{
							Filesystem: &config.CacheWarmupFileSystemSource{
								Path: "testenv/testdata/cache_warmup/skip_include",
							},
						},
					}),
				},
				AssertCacheMetrics: &testenv.AssertCacheMetrics{
					After: &testenv.CacheMetricsAssertions{
						BaseGraphAssertions: testenv.CacheMetricsAssertion{
							PersistedQueryNormalizationMisses: 2,
							QueryNormalizationMisses:          warmupMisses - 2, // subtract 2 as these are covered by the persisted query normalization
							QueryNormalizationHits:            2,
							ValidationMisses:                  warmupMisses,
							ValidationHits:                    2,
							PlanMisses:                        warmupMisses,
							PlanHits:                          2,
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query SkipQuery($skip: Boolean!) {employees { id isAvailable details @skip(if: $skip) { forename surname } } }`,
					Variables: []byte(`{"skip": true}`),
				})
				require.Equal(t, `{"data":{"employees":[{"id":1,"isAvailable":false},{"id":2,"isAvailable":false},{"id":3,"isAvailable":false},{"id":4,"isAvailable":false},{"id":5,"isAvailable":false},{"id":7,"isAvailable":false},{"id":8,"isAvailable":false},{"id":10,"isAvailable":false},{"id":11,"isAvailable":false},{"id":12,"isAvailable":false}]}}`, res.Body)
				res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query SkipQuery($skip: Boolean!) {employees { id isAvailable details @skip(if: $skip) { forename surname } } }`,
					Variables: []byte(`{"skip": false}`),
				})
				require.Equal(t, `{"data":{"employees":[{"id":1,"isAvailable":false,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"isAvailable":false,"details":{"forename":"Dustin","surname":"Deus"}},{"id":3,"isAvailable":false,"details":{"forename":"Stefan","surname":"Avram"}},{"id":4,"isAvailable":false,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":5,"isAvailable":false,"details":{"forename":"Sergiy","surname":"Petrunin"}},{"id":7,"isAvailable":false,"details":{"forename":"Suvij","surname":"Surya"}},{"id":8,"isAvailable":false,"details":{"forename":"Nithin","surname":"Kumar"}},{"id":10,"isAvailable":false,"details":{"forename":"Eelco","surname":"Wiersma"}},{"id":11,"isAvailable":false,"details":{"forename":"Alexandra","surname":"Neuse"}},{"id":12,"isAvailable":false,"details":{"forename":"David","surname":"Stutt"}}]}}`, res.Body)
			})
		})

		t.Run("operation with skip and include directive", func(t *testing.T) {
			t.Parallel()

			data, err := os.ReadFile("testenv/testdata/cache_warmup/skip_include/operations.json")
			require.NoError(t, err)
			var warmupOperations nodev1.CacheWarmerOperations
			unmarshalOpts := protojson.UnmarshalOptions{DiscardUnknown: true}
			err = unmarshalOpts.Unmarshal(data, &warmupOperations)
			require.NoError(t, err)

			warmupMisses := int64(0)
			for _, operation := range warmupOperations.Operations {
				if operation.Request.VariableVariations == nil {
					warmupMisses++
				} else {
					warmupMisses += int64(len(operation.Request.VariableVariations))
				}
			}

			testenv.Run(t, &testenv.Config{
				ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
					routerConfig.FeatureFlagConfigs = nil
				},
				RouterOptions: []core.Option{
					core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
						Enabled: true,
						Source: config.CacheWarmupSource{
							Filesystem: &config.CacheWarmupFileSystemSource{
								Path: "testenv/testdata/cache_warmup/skip_include",
							},
						},
					}),
				},
				AssertCacheMetrics: &testenv.AssertCacheMetrics{
					After: &testenv.CacheMetricsAssertions{
						BaseGraphAssertions: testenv.CacheMetricsAssertion{
							PersistedQueryNormalizationMisses: 2,
							QueryNormalizationMisses:          warmupMisses - 2 + 1, // 1x miss for the missing combination in the cache (3rd request)
							// subtract 2 as these are covered by the persisted query normalization
							QueryNormalizationHits: 2,
							ValidationMisses:       warmupMisses + 1, // 1x miss for the missing combination in the cache (3rd request)
							ValidationHits:         2,
							PlanMisses:             warmupMisses + 1, // 1x miss for the missing combination in the cache (3rd request)
							PlanHits:               2,
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query IncludeQuery($include: Boolean!, $skip: Boolean!) { employees { id details { nationality forename @include(if: $include) surname @skip(if: $skip) } } }`,
					Variables: []byte(`{"skip": true, "include": true}`),
				})
				require.Equal(t, `{"data":{"employees":[{"id":1,"details":{"nationality":"GERMAN","forename":"Jens"}},{"id":2,"details":{"nationality":"GERMAN","forename":"Dustin"}},{"id":3,"details":{"nationality":"AMERICAN","forename":"Stefan"}},{"id":4,"details":{"nationality":"GERMAN","forename":"Björn"}},{"id":5,"details":{"nationality":"UKRAINIAN","forename":"Sergiy"}},{"id":7,"details":{"nationality":"INDIAN","forename":"Suvij"}},{"id":8,"details":{"nationality":"INDIAN","forename":"Nithin"}},{"id":10,"details":{"nationality":"DUTCH","forename":"Eelco"}},{"id":11,"details":{"nationality":"GERMAN","forename":"Alexandra"}},{"id":12,"details":{"nationality":"ENGLISH","forename":"David"}}]}}`, res.Body)
				res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query IncludeQuery($include: Boolean!, $skip: Boolean!) { employees { id details { nationality forename @include(if: $include) surname @skip(if: $skip) } } }`,
					Variables: []byte(`{"skip": false, "include": false}`),
				})
				require.Equal(t, `{"data":{"employees":[{"id":1,"details":{"nationality":"GERMAN","surname":"Neuse"}},{"id":2,"details":{"nationality":"GERMAN","surname":"Deus"}},{"id":3,"details":{"nationality":"AMERICAN","surname":"Avram"}},{"id":4,"details":{"nationality":"GERMAN","surname":"Schwenzer"}},{"id":5,"details":{"nationality":"UKRAINIAN","surname":"Petrunin"}},{"id":7,"details":{"nationality":"INDIAN","surname":"Surya"}},{"id":8,"details":{"nationality":"INDIAN","surname":"Kumar"}},{"id":10,"details":{"nationality":"DUTCH","surname":"Wiersma"}},{"id":11,"details":{"nationality":"GERMAN","surname":"Neuse"}},{"id":12,"details":{"nationality":"ENGLISH","surname":"Stutt"}}]}}`, res.Body)
				res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query IncludeQuery($include: Boolean!, $skip: Boolean!) { employees { id details { nationality forename @include(if: $include) surname @skip(if: $skip) } } }`,
					Variables: []byte(`{"skip": false, "include": true}`), // missing combination in the cache
				})
				require.Equal(t, `{"data":{"employees":[{"id":1,"details":{"nationality":"GERMAN","forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"nationality":"GERMAN","forename":"Dustin","surname":"Deus"}},{"id":3,"details":{"nationality":"AMERICAN","forename":"Stefan","surname":"Avram"}},{"id":4,"details":{"nationality":"GERMAN","forename":"Björn","surname":"Schwenzer"}},{"id":5,"details":{"nationality":"UKRAINIAN","forename":"Sergiy","surname":"Petrunin"}},{"id":7,"details":{"nationality":"INDIAN","forename":"Suvij","surname":"Surya"}},{"id":8,"details":{"nationality":"INDIAN","forename":"Nithin","surname":"Kumar"}},{"id":10,"details":{"nationality":"DUTCH","forename":"Eelco","surname":"Wiersma"}},{"id":11,"details":{"nationality":"GERMAN","forename":"Alexandra","surname":"Neuse"}},{"id":12,"details":{"nationality":"ENGLISH","forename":"David","surname":"Stutt"}}]}}`, res.Body)
			})
		})

		t.Run("operation with skip and include directive different order should not matter", func(t *testing.T) {
			t.Parallel()

			data, err := os.ReadFile("testenv/testdata/cache_warmup/skip_include/operations.json")
			require.NoError(t, err)
			var warmupOperations nodev1.CacheWarmerOperations
			unmarshalOpts := protojson.UnmarshalOptions{DiscardUnknown: true}
			err = unmarshalOpts.Unmarshal(data, &warmupOperations)
			require.NoError(t, err)

			warmupMisses := int64(0)
			for _, operation := range warmupOperations.Operations {
				if operation.Request.VariableVariations == nil {
					warmupMisses++
				} else {
					warmupMisses += int64(len(operation.Request.VariableVariations))
				}
			}

			testenv.Run(t, &testenv.Config{
				ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
					routerConfig.FeatureFlagConfigs = nil
				},
				RouterOptions: []core.Option{
					core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
						Enabled: true,
						Source: config.CacheWarmupSource{
							Filesystem: &config.CacheWarmupFileSystemSource{
								Path: "testenv/testdata/cache_warmup/skip_include",
							},
						},
					}),
				},
				AssertCacheMetrics: &testenv.AssertCacheMetrics{
					After: &testenv.CacheMetricsAssertions{
						BaseGraphAssertions: testenv.CacheMetricsAssertion{
							PersistedQueryNormalizationMisses: 2,
							QueryNormalizationMisses:          warmupMisses - 2 + 1, // 1x miss for the missing combination in the cache (3rd request)
							// subtract 2 as these are covered by the persisted query normalization
							QueryNormalizationHits: 2,
							ValidationMisses:       warmupMisses + 1, // 1x miss for the missing combination in the cache (3rd request)
							ValidationHits:         2,
							PlanMisses:             warmupMisses + 1, // 1x miss for the missing combination in the cache (3rd request)
							PlanHits:               2,
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query IncludeQuery($include: Boolean!, $skip: Boolean!) { employees { id details { nationality forename @include(if: $include) surname @skip(if: $skip) } } }`,
					Variables: []byte(`{"include": true,"skip": true}`),
				})
				require.Equal(t, `{"data":{"employees":[{"id":1,"details":{"nationality":"GERMAN","forename":"Jens"}},{"id":2,"details":{"nationality":"GERMAN","forename":"Dustin"}},{"id":3,"details":{"nationality":"AMERICAN","forename":"Stefan"}},{"id":4,"details":{"nationality":"GERMAN","forename":"Björn"}},{"id":5,"details":{"nationality":"UKRAINIAN","forename":"Sergiy"}},{"id":7,"details":{"nationality":"INDIAN","forename":"Suvij"}},{"id":8,"details":{"nationality":"INDIAN","forename":"Nithin"}},{"id":10,"details":{"nationality":"DUTCH","forename":"Eelco"}},{"id":11,"details":{"nationality":"GERMAN","forename":"Alexandra"}},{"id":12,"details":{"nationality":"ENGLISH","forename":"David"}}]}}`, res.Body)
				res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query IncludeQuery($include: Boolean!, $skip: Boolean!) { employees { id details { nationality forename @include(if: $include) surname @skip(if: $skip) } } }`,
					Variables: []byte(`{"include": false,"skip": false}`),
				})
				require.Equal(t, `{"data":{"employees":[{"id":1,"details":{"nationality":"GERMAN","surname":"Neuse"}},{"id":2,"details":{"nationality":"GERMAN","surname":"Deus"}},{"id":3,"details":{"nationality":"AMERICAN","surname":"Avram"}},{"id":4,"details":{"nationality":"GERMAN","surname":"Schwenzer"}},{"id":5,"details":{"nationality":"UKRAINIAN","surname":"Petrunin"}},{"id":7,"details":{"nationality":"INDIAN","surname":"Surya"}},{"id":8,"details":{"nationality":"INDIAN","surname":"Kumar"}},{"id":10,"details":{"nationality":"DUTCH","surname":"Wiersma"}},{"id":11,"details":{"nationality":"GERMAN","surname":"Neuse"}},{"id":12,"details":{"nationality":"ENGLISH","surname":"Stutt"}}]}}`, res.Body)
				res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query IncludeQuery($include: Boolean!, $skip: Boolean!) { employees { id details { nationality forename @include(if: $include) surname @skip(if: $skip) } } }`,
					Variables: []byte(`{"include": true,"skip": false}`), // missing combination in the cache
				})
				require.Equal(t, `{"data":{"employees":[{"id":1,"details":{"nationality":"GERMAN","forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"nationality":"GERMAN","forename":"Dustin","surname":"Deus"}},{"id":3,"details":{"nationality":"AMERICAN","forename":"Stefan","surname":"Avram"}},{"id":4,"details":{"nationality":"GERMAN","forename":"Björn","surname":"Schwenzer"}},{"id":5,"details":{"nationality":"UKRAINIAN","forename":"Sergiy","surname":"Petrunin"}},{"id":7,"details":{"nationality":"INDIAN","forename":"Suvij","surname":"Surya"}},{"id":8,"details":{"nationality":"INDIAN","forename":"Nithin","surname":"Kumar"}},{"id":10,"details":{"nationality":"DUTCH","forename":"Eelco","surname":"Wiersma"}},{"id":11,"details":{"nationality":"GERMAN","forename":"Alexandra","surname":"Neuse"}},{"id":12,"details":{"nationality":"ENGLISH","forename":"David","surname":"Stutt"}}]}}`, res.Body)
			})
		})

		t.Run("persisted operation with skip include", func(t *testing.T) {
			t.Parallel()

			data, err := os.ReadFile("testenv/testdata/cache_warmup/skip_include/operations.json")
			require.NoError(t, err)
			var warmupOperations nodev1.CacheWarmerOperations
			unmarshalOpts := protojson.UnmarshalOptions{DiscardUnknown: true}
			err = unmarshalOpts.Unmarshal(data, &warmupOperations)
			require.NoError(t, err)

			warmupMisses := int64(0)
			for _, operation := range warmupOperations.Operations {
				if operation.Request.VariableVariations == nil {
					warmupMisses++
				} else {
					warmupMisses += int64(len(operation.Request.VariableVariations))
				}
			}

			testenv.Run(t, &testenv.Config{
				ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
					routerConfig.FeatureFlagConfigs = nil
				},
				RouterOptions: []core.Option{
					core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
						Enabled: true,
						Source: config.CacheWarmupSource{
							Filesystem: &config.CacheWarmupFileSystemSource{
								Path: "testenv/testdata/cache_warmup/skip_include",
							},
						},
					}),
				},
				AssertCacheMetrics: &testenv.AssertCacheMetrics{
					Before: &testenv.CacheMetricsAssertions{
						BaseGraphAssertions: testenv.CacheMetricsAssertion{
							QueryNormalizationMisses:          warmupMisses - 2, // subtract 2 as these are covered by the persisted query normalization
							PersistedQueryNormalizationMisses: 2,
							ValidationMisses:                  warmupMisses,
							PlanMisses:                        warmupMisses,
						},
					},
					After: &testenv.CacheMetricsAssertions{
						BaseGraphAssertions: testenv.CacheMetricsAssertion{
							PersistedQueryNormalizationMisses: 2,
							QueryNormalizationMisses:          warmupMisses - 2, // subtract 2 as these are covered by the persisted query normalization
							ValidationMisses:                  warmupMisses,
							PlanMisses:                        warmupMisses,

							PersistedQueryNormalizationHits: 2,
							ValidationHits:                  2,
							PlanHits:                        2,
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				header := make(http.Header)
				header.Add("graphql-client-name", "my-client")
				res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "persistedSkipInclude"}}`),
					Header:     header,
					Variables:  []byte(`{"skip": true, "include": true}`),
				})
				require.NoError(t, err)
				require.Equal(t, `{"data":{"employees":[{"id":1,"details":{"nationality":"GERMAN","f":"Jens"}},{"id":2,"details":{"nationality":"GERMAN","f":"Dustin"}},{"id":3,"details":{"nationality":"AMERICAN","f":"Stefan"}},{"id":4,"details":{"nationality":"GERMAN","f":"Björn"}},{"id":5,"details":{"nationality":"UKRAINIAN","f":"Sergiy"}},{"id":7,"details":{"nationality":"INDIAN","f":"Suvij"}},{"id":8,"details":{"nationality":"INDIAN","f":"Nithin"}},{"id":10,"details":{"nationality":"DUTCH","f":"Eelco"}},{"id":11,"details":{"nationality":"GERMAN","f":"Alexandra"}},{"id":12,"details":{"nationality":"ENGLISH","f":"David"}}]}}`, res.Body)
				res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "persistedSkipInclude"}}`),
					Header:     header,
					Variables:  []byte(`{"skip": false, "include": false}`),
				})
				require.NoError(t, err)
				require.Equal(t, `{"data":{"employees":[{"id":1,"details":{"nationality":"GERMAN","s":"Neuse"}},{"id":2,"details":{"nationality":"GERMAN","s":"Deus"}},{"id":3,"details":{"nationality":"AMERICAN","s":"Avram"}},{"id":4,"details":{"nationality":"GERMAN","s":"Schwenzer"}},{"id":5,"details":{"nationality":"UKRAINIAN","s":"Petrunin"}},{"id":7,"details":{"nationality":"INDIAN","s":"Surya"}},{"id":8,"details":{"nationality":"INDIAN","s":"Kumar"}},{"id":10,"details":{"nationality":"DUTCH","s":"Wiersma"}},{"id":11,"details":{"nationality":"GERMAN","s":"Neuse"}},{"id":12,"details":{"nationality":"ENGLISH","s":"Stutt"}}]}}`, res.Body)
			})
		})
	})

	t.Run("cache warmup tests for cdn", func(t *testing.T) {
		t.Parallel()

		// keep in sync with testenv/testdata/cache_warmup/cdn/operation.json
		cdnOperationCount := int64(5)
		cdnPOCount := int64(1)
		featureOperationCount := int64(1)
		invalidOperationCount := int64(1)

		t.Run("cache warmup disabled with CDN config", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
						Enabled: false,
					}),
				},
				AssertCacheMetrics: &testenv.AssertCacheMetrics{
					After: &testenv.CacheMetricsAssertions{
						BaseGraphAssertions: testenv.CacheMetricsAssertion{
							QueryNormalizationMisses: 1,
							QueryNormalizationHits:   0,
							ValidationMisses:         1,
							ValidationHits:           0,
							PlanMisses:               1,
							PlanHits:                 0,
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { employees { id } }`,
				})
				require.JSONEq(t, employeesIDData, res.Body)
			})
		})

		t.Run("should correctly warm the cache with data from the operation.json file", func(t *testing.T) {
			t.Parallel()
			const employeeQueryCount = 2
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
						Enabled: true,
					}),
				},
				AssertCacheMetrics: &testenv.AssertCacheMetrics{
					After: &testenv.CacheMetricsAssertions{
						BaseGraphAssertions: testenv.CacheMetricsAssertion{
							// we have additional 2 misses for the employeeQueryCount - because their content differs from what we have in cdn
							// this will be possible to solve only by having operation variants populated
							QueryNormalizationMisses:          cdnOperationCount + featureOperationCount + invalidOperationCount + employeeQueryCount,
							QueryNormalizationHits:            3,
							PersistedQueryNormalizationMisses: cdnPOCount,
							PersistedQueryNormalizationHits:   0,
							ValidationMisses:                  cdnOperationCount + cdnPOCount + featureOperationCount + invalidOperationCount,
							ValidationHits:                    3 + employeeQueryCount,
							PlanMisses:                        cdnOperationCount + cdnPOCount,
							PlanHits:                          3 + employeeQueryCount,
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { employees { id } }`,
				})
				require.Equal(t, employeesIDData, res.Body)
				res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { employees { id details { forename } } }`,
				})
				require.Equal(t, `{"data":{"employees":[{"id":1,"details":{"forename":"Jens"}},{"id":2,"details":{"forename":"Dustin"}},{"id":3,"details":{"forename":"Stefan"}},{"id":4,"details":{"forename":"Björn"}},{"id":5,"details":{"forename":"Sergiy"}},{"id":7,"details":{"forename":"Suvij"}},{"id":8,"details":{"forename":"Nithin"}},{"id":10,"details":{"forename":"Eelco"}},{"id":11,"details":{"forename":"Alexandra"}},{"id":12,"details":{"forename":"David"}}]}}`, res.Body)
				res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { employees { id details { forename surname } } }`,
				})
				require.Equal(t, `{"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":3,"details":{"forename":"Stefan","surname":"Avram"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"}},{"id":7,"details":{"forename":"Suvij","surname":"Surya"}},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"}},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}},{"id":12,"details":{"forename":"David","surname":"Stutt"}}]}}`, res.Body)

				// For the next 2 queries below we will:
				// - miss normalization cache
				// - hit validation cache
				// - hit plan cache

				res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query m($id: Int!){ employee(id: $id) { id details { forename surname } } }`,
					Variables: []byte(`{"id": 1}`),
				})
				require.Equal(t, "HIT", res.Response.Header.Get("x-wg-execution-plan-cache"))
				require.Equal(t, `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)

				res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { employee(id: 2) { id details { forename surname } } }`,
				})
				require.Equal(t, "HIT", res.Response.Header.Get("x-wg-execution-plan-cache"))
				require.Equal(t, `{"data":{"employee":{"id":2,"details":{"forename":"Dustin","surname":"Deus"}}}}`, res.Body)
			})
		})

		t.Run("should correctly warm the cache with data from the operation.json and hit persisted operations", func(t *testing.T) {
			t.Parallel()

			expected := `{"data":{"employees":[{"details":{"forename":"Jens","hasChildren":true,"location":{"key":{"name":"Germany"}},"maritalStatus":"MARRIED","middlename":"","nationality":"GERMAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":null,"surname":"Neuse"}},{"details":{"forename":"Dustin","hasChildren":false,"location":{"key":{"name":"Germany"}},"maritalStatus":"ENGAGED","middlename":"Klaus","nationality":"GERMAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":null,"surname":"Deus"}},{"details":{"forename":"Stefan","hasChildren":false,"location":{"key":{"name":"America"}},"maritalStatus":"ENGAGED","middlename":"","nationality":"AMERICAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":[{"class":"REPTILE","gender":"UNKNOWN","name":"Snappy","__typename":"Alligator","dangerous":"yes"}],"surname":"Avram"}},{"details":{"forename":"Björn","hasChildren":true,"location":{"key":{"name":"Germany"}},"maritalStatus":"MARRIED","middlename":"Volker","nationality":"GERMAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":[{"class":"MAMMAL","gender":"FEMALE","name":"Abby","__typename":"Dog","breed":"GOLDEN_RETRIEVER"},{"class":"MAMMAL","gender":"MALE","name":"Survivor","__typename":"Pony"}],"surname":"Schwenzer"}},{"details":{"forename":"Sergiy","hasChildren":false,"location":{"key":{"name":"Ukraine"}},"maritalStatus":"ENGAGED","middlename":"","nationality":"UKRAINIAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":[{"class":"MAMMAL","gender":"FEMALE","name":"Blotch","__typename":"Cat","type":"STREET"},{"class":"MAMMAL","gender":"MALE","name":"Grayone","__typename":"Cat","type":"STREET"},{"class":"MAMMAL","gender":"MALE","name":"Rusty","__typename":"Cat","type":"STREET"},{"class":"MAMMAL","gender":"FEMALE","name":"Manya","__typename":"Cat","type":"HOME"},{"class":"MAMMAL","gender":"MALE","name":"Peach","__typename":"Cat","type":"STREET"},{"class":"MAMMAL","gender":"MALE","name":"Panda","__typename":"Cat","type":"HOME"},{"class":"MAMMAL","gender":"FEMALE","name":"Mommy","__typename":"Cat","type":"STREET"},{"class":"MAMMAL","gender":"FEMALE","name":"Terry","__typename":"Cat","type":"HOME"},{"class":"MAMMAL","gender":"FEMALE","name":"Tilda","__typename":"Cat","type":"HOME"},{"class":"MAMMAL","gender":"MALE","name":"Vasya","__typename":"Cat","type":"HOME"}],"surname":"Petrunin"}},{"details":{"forename":"Suvij","hasChildren":false,"location":{"key":{"name":"India"}},"maritalStatus":null,"middlename":"","nationality":"INDIAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":null,"surname":"Surya"}},{"details":{"forename":"Nithin","hasChildren":false,"location":{"key":{"name":"India"}},"maritalStatus":null,"middlename":"","nationality":"INDIAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":null,"surname":"Kumar"}},{"details":{"forename":"Eelco","hasChildren":false,"location":{"key":{"name":"Netherlands"}},"maritalStatus":null,"middlename":"","nationality":"DUTCH","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":[{"class":"MAMMAL","gender":"UNKNOWN","name":"Vanson","__typename":"Mouse"}],"surname":"Wiersma"}},{"details":{"forename":"Alexandra","hasChildren":true,"location":{"key":{"name":"Germany"}},"maritalStatus":"MARRIED","middlename":"","nationality":"GERMAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":null,"surname":"Neuse"}},{"details":{"forename":"David","hasChildren":false,"location":{"key":{"name":"England"}},"maritalStatus":"MARRIED","middlename":null,"nationality":"ENGLISH","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":[{"class":"MAMMAL","gender":"FEMALE","name":"Pepper","__typename":"Cat","type":"HOME"}],"surname":"Stutt"}}]}}`

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
						Enabled: true,
					}),
				},
				AssertCacheMetrics: &testenv.AssertCacheMetrics{
					After: &testenv.CacheMetricsAssertions{
						BaseGraphAssertions: testenv.CacheMetricsAssertion{
							QueryNormalizationMisses:          cdnOperationCount + featureOperationCount + invalidOperationCount,
							QueryNormalizationHits:            0,
							PersistedQueryNormalizationMisses: cdnPOCount + 2,
							PersistedQueryNormalizationHits:   1,
							ValidationMisses:                  cdnOperationCount + cdnPOCount + featureOperationCount + invalidOperationCount,
							ValidationHits:                    2,
							PlanMisses:                        cdnOperationCount + cdnPOCount,
							PlanHits:                          2,
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				header := make(http.Header)
				header.Add("graphql-client-name", "my-client")
				res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					OperationName: []byte(`"Employees"`),
					Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "1167510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
					Header:        header,
				})

				require.NoError(t, err)
				require.Equal(t, expected, res.Body)

				res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					OperationName: []byte(`"A"`),
					Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "e24399f210ef3f16e6e5427a70bb9609ecea7297e99c3e9241d5912d04eabe60"}}`),
					Header:        header,
				})
				require.NoError(t, err)
				require.Equal(t, "HIT", res.Response.Header.Get("x-wg-execution-plan-cache"))
				require.Equal(t, `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)
			})
		})

		t.Run("should correctly also warm the feature flag cache", func(t *testing.T) {
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
						Enabled: true,
					}),
				},
				AssertCacheMetrics: &testenv.AssertCacheMetrics{
					After: &testenv.CacheMetricsAssertions{
						BaseGraphAssertions: testenv.CacheMetricsAssertion{
							QueryNormalizationMisses:          cdnOperationCount + featureOperationCount + invalidOperationCount,
							QueryNormalizationHits:            0,
							PersistedQueryNormalizationMisses: cdnPOCount,
							PersistedQueryNormalizationHits:   0,
							ValidationMisses:                  cdnOperationCount + cdnPOCount + featureOperationCount + invalidOperationCount,
							ValidationHits:                    0,
							PlanMisses:                        cdnOperationCount + cdnPOCount,
							PlanHits:                          0,
						},
						FeatureFlagAssertions: map[string]testenv.CacheMetricsAssertion{
							"myff": {
								QueryNormalizationMisses:          cdnOperationCount + featureOperationCount + invalidOperationCount,
								QueryNormalizationHits:            1,
								PersistedQueryNormalizationMisses: cdnPOCount,
								PersistedQueryNormalizationHits:   0,
								ValidationMisses:                  cdnOperationCount + cdnPOCount + featureOperationCount + invalidOperationCount,
								ValidationHits:                    1,
								PlanMisses:                        cdnOperationCount + featureOperationCount + featureOperationCount,
								PlanHits:                          1,
							},
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { employees { id productCount } }`,
					Header: map[string][]string{
						"X-Feature-Flag": {"myff"},
					},
				})
				require.Equal(t, res.Response.Header.Get("X-Feature-Flag"), "myff")
				require.JSONEq(t, `{"data":{"employees":[{"id":1,"productCount":5},{"id":2,"productCount":2},{"id":3,"productCount":2},{"id":4,"productCount":3},{"id":5,"productCount":2},{"id":7,"productCount":0},{"id":8,"productCount":2},{"id":10,"productCount":3},{"id":11,"productCount":1},{"id":12,"productCount":4}]}}`, res.Body)
			})
		})
	})
}

func TestCacheWarmupMetrics(t *testing.T) {
	t.Run("should emit planning times metrics during warmup", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()

		testenv.Run(t, &testenv.Config{
			MetricReader: metricReader,
			RouterOptions: []core.Option{
				core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
					Enabled: true,
					Source: config.CacheWarmupSource{
						Filesystem: &config.CacheWarmupFileSystemSource{
							Path: "testenv/testdata/cache_warmup/single",
						},
					},
				}),
			},
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				routerConfig.FeatureFlagConfigs = nil
			},
			AssertCacheMetrics: &testenv.AssertCacheMetrics{
				After: &testenv.CacheMetricsAssertions{
					BaseGraphAssertions: testenv.CacheMetricsAssertion{
						QueryNormalizationMisses: 1,
						QueryNormalizationHits:   2,
						ValidationMisses:         1,
						ValidationHits:           2,
						PlanMisses:               1,
						PlanHits:                 2,
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.Equal(t, "HIT", res.Response.Header.Get("x-wg-execution-plan-cache"))
			require.Equal(t, employeesIDData, res.Body)
			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.Equal(t, "HIT", res.Response.Header.Get("x-wg-execution-plan-cache"))

			rm := metricdata.ResourceMetrics{}
			err := metricReader.Collect(context.Background(), &rm)

			require.NoError(t, err)
			require.Len(t, rm.ScopeMetrics, 2)

			metricScope := GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")
			require.NotNil(t, metricScope)

			require.Len(t, metricScope.Metrics, 6)

			operationPlanningTimeMetric := metricdata.Metrics{
				Name:        "router.graphql.operation.planning_time",
				Description: "Operation planning time in milliseconds",
				Unit:        "ms",
				Data: metricdata.Histogram[float64]{
					Temporality: metricdata.CumulativeTemporality,
					DataPoints: []metricdata.HistogramDataPoint[float64]{
						{
							Attributes: attribute.NewSet(
								otel.WgClientName.String(""),
								otel.WgClientVersion.String(""),
								// This is a miss, because we just planned it
								otel.WgEnginePlanCacheHit.Bool(false),
								otel.WgFeatureFlag.String(""),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Count: 1,
						},
						{
							Attributes: attribute.NewSet(
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								// This is a hit, because we planned it for the base graph
								otel.WgEnginePlanCacheHit.Bool(true),
								otel.WgOperationHash.String("1163600561566987607"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Count: 2,
						},
					},
				},
			}

			m := *GetMetricByName(metricScope, "router.graphql.operation.planning_time")

			// One when warming up the operation and one when executing the operation
			require.Len(t, m.Data.(metricdata.Histogram[float64]).DataPoints, 2)

			// Warming up the operation
			require.Equal(t, m.Data.(metricdata.Histogram[float64]).DataPoints[0].Count, uint64(1))

			// Executing the operation. Is exported as an aggregated value
			require.Equal(t, m.Data.(metricdata.Histogram[float64]).DataPoints[1].Count, uint64(2))

			// Ensure we collected non-zero planning times
			require.Greater(t, m.Data.(metricdata.Histogram[float64]).DataPoints[0].Sum, float64(0))
			require.Greater(t, m.Data.(metricdata.Histogram[float64]).DataPoints[1].Sum, float64(0))

			metricdatatest.AssertEqual(t, operationPlanningTimeMetric, m, metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
		})
	})
}
