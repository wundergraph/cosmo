package integration

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
)

func TestCacheWarmup(t *testing.T) {
	t.Parallel()

	t.Run("cache warmup tests for filesystem", func(t *testing.T) {
		t.Parallel()
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
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
						Enabled: true,
						Source:  "filesystem",
						Path:    "testenv/testdata/cache_warmup/simple",
					}),
				},
				AssertCacheMetrics: &testenv.CacheMetricsAssertions{
					BaseGraphAssertions: testenv.CacheMetricsAssertion{
						QueryNormalizationMisses: 3,
						QueryNormalizationHits:   4,
						ValidationMisses:         3,
						ValidationHits:           4,
						PlanMisses:               3,
						PlanHits:                 4,
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
			})
		})
		t.Run("cache warmup invalid files", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
						Enabled: true,
						Source:  "filesystem",
						Path:    "testenv/testdata/cache_warmup/invalid",
					}),
				},
				AssertCacheMetrics: &testenv.CacheMetricsAssertions{
					BaseGraphAssertions: testenv.CacheMetricsAssertion{
						QueryNormalizationMisses: 2,
						QueryNormalizationHits:   0,
						ValidationMisses:         2,
						ValidationHits:           0,
						PlanMisses:               1,
						PlanHits:                 0,
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
						Source:  "filesystem",
						Path:    "testenv/testdata/cache_warmup/json",
					}),
				},
				AssertCacheMetrics: &testenv.CacheMetricsAssertions{
					BaseGraphAssertions: testenv.CacheMetricsAssertion{
						QueryNormalizationMisses: 3,
						QueryNormalizationHits:   5,
						ValidationMisses:         3,
						ValidationHits:           5,
						PlanMisses:               3,
						PlanHits:                 5,
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
		t.Run("cache warmup json with variables", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
						Enabled: true,
						Source:  "filesystem",
						Path:    "testenv/testdata/cache_warmup/json_variables",
					}),
				},
				AssertCacheMetrics: &testenv.CacheMetricsAssertions{
					BaseGraphAssertions: testenv.CacheMetricsAssertion{
						QueryNormalizationMisses: 1,
						QueryNormalizationHits:   1,
						ValidationMisses:         1,
						ValidationHits:           1,
						PlanMisses:               1,
						PlanHits:                 1,
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query($id: Int!) { employee(id: $id) { id } }`,
					Variables: json.RawMessage(`{"id": 1}`),
				})
				require.Equal(t, `{"data":{"employee":{"id":1}}}`, res.Body)
			})
		})
		t.Run("cache warmup json with variables mismatch", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
						Enabled: true,
						Source:  "filesystem",
						Path:    "testenv/testdata/cache_warmup/json_variables",
					}),
				},
				AssertCacheMetrics: &testenv.CacheMetricsAssertions{
					BaseGraphAssertions: testenv.CacheMetricsAssertion{
						QueryNormalizationMisses: 1,
						QueryNormalizationHits:   1,
						ValidationMisses:         1,
						ValidationHits:           1,
						PlanMisses:               1,
						PlanHits:                 1,
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query($id: Int!) { employee(id: $id) { id } }`,
					Variables: json.RawMessage(`{"id": 2}`),
				})
				require.Equal(t, `{"data":{"employee":{"id":2}}}`, res.Body)
			})
		})
		t.Run("cache warmup persisted operation", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
						Enabled: true,
						Source:  "filesystem",
						Path:    "testenv/testdata/cache_warmup/json_po",
					}),
				},
				AssertCacheMetrics: &testenv.CacheMetricsAssertions{
					BaseGraphAssertions: testenv.CacheMetricsAssertion{
						PersistedQueryNormalizationHits:   1,
						PersistedQueryNormalizationMisses: 1,
						ValidationMisses:                  1,
						ValidationHits:                    1,
						PlanMisses:                        1,
						PlanHits:                          1,
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
			})
		})
		t.Run("cache warmup persisted operation client mismatch", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
						Enabled: true,
						Source:  "filesystem",
						Path:    "testenv/testdata/cache_warmup/json_po",
					}),
				},
				AssertCacheMetrics: &testenv.CacheMetricsAssertions{
					BaseGraphAssertions: testenv.CacheMetricsAssertion{
						PersistedQueryNormalizationHits:   0, // 1x warmup miss, 1x request miss because of client mismatch
						PersistedQueryNormalizationMisses: 2, // same as above
						ValidationMisses:                  1, // 1x warmup miss, no second miss because client mismatch stops request chain
						ValidationHits:                    0, // no hits because of client mismatch
						PlanMisses:                        1, // 1x warmup miss
						PlanHits:                          0, // no hits because client mismatch stops request chain
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
		t.Run("cache warmup workers throttle", func(t *testing.T) {
			t.Parallel()
			logger, err := zap.NewDevelopment()
			require.NoError(t, err)
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithLogger(logger),
					core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
						Enabled:        true,
						Source:         "filesystem",
						Path:           "testenv/testdata/cache_warmup/rate_limit",
						Workers:        4,
						ItemsPerSecond: 10,
						Timeout:        time.Second * 5,
					}),
				},
				AssertCacheMetrics: &testenv.CacheMetricsAssertions{
					BaseGraphAssertions: testenv.CacheMetricsAssertion{
						QueryNormalizationMisses: 10,
						QueryNormalizationHits:   1,
						ValidationMisses:         10,
						ValidationHits:           1,
						PlanMisses:               10,
						PlanHits:                 1,
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
						Enabled:        true,
						Source:         "filesystem",
						Path:           "testenv/testdata/cache_warmup/simple",
						Workers:        2,
						ItemsPerSecond: 100,
					}),
				},
				AssertCacheMetrics: &testenv.CacheMetricsAssertions{
					BaseGraphAssertions: testenv.CacheMetricsAssertion{
						QueryNormalizationMisses: 3,
						QueryNormalizationHits:   2,
						ValidationMisses:         3,
						ValidationHits:           2,
						QueryHashMisses:          3,
						QueryHashHits:            2,
						PlanMisses:               3,
						PlanHits:                 2,
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
	})

	t.Run("cache warmup tests for cdn", func(t *testing.T) {
		t.Parallel()

		// keep in sync with testdata/cache_warmup/cdn/operation.json
		cdnOperationCount := int64(4)
		cdnPOCount := int64(1)

		t.Run("cache warmup disabled with CDN config", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
						Enabled: false,
						Source:  "cdn",
					}),
				},
				AssertCacheMetrics: &testenv.CacheMetricsAssertions{
					BaseGraphAssertions: testenv.CacheMetricsAssertion{
						QueryNormalizationMisses: 1,
						QueryNormalizationHits:   0,
						ValidationMisses:         1,
						ValidationHits:           0,
						PlanMisses:               1,
						PlanHits:                 0,
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
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
						Enabled: true,
						Source:  "cdn",
					}),
				},
				AssertCacheMetrics: &testenv.CacheMetricsAssertions{
					BaseGraphAssertions: testenv.CacheMetricsAssertion{
						QueryNormalizationMisses:          cdnOperationCount,
						QueryNormalizationHits:            3,
						PersistedQueryNormalizationMisses: cdnPOCount,
						PersistedQueryNormalizationHits:   0,
						ValidationMisses:                  cdnOperationCount,
						ValidationHits:                    4,
						PlanMisses:                        cdnOperationCount,
						PlanHits:                          4,
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
			})
		})

		t.Run("should correctly warm the cache with data from the operation.json and hit persisted operations", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
						Enabled: true,
						Source:  "cdn",
					}),
				},
				AssertCacheMetrics: &testenv.CacheMetricsAssertions{
					BaseGraphAssertions: testenv.CacheMetricsAssertion{
						QueryNormalizationMisses:          cdnOperationCount,
						QueryNormalizationHits:            0,
						PersistedQueryNormalizationMisses: cdnPOCount,
						PersistedQueryNormalizationHits:   1,
						ValidationMisses:                  cdnOperationCount,
						ValidationHits:                    2,
						PlanMisses:                        cdnOperationCount,
						PlanHits:                          2,
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
			})
		})

		t.Run("should correctly warm the feature flag cache", func(t *testing.T) {
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
						Enabled: true,
						Source:  "cdn",
					}),
				},
				AssertCacheMetrics: &testenv.CacheMetricsAssertions{
					BaseGraphAssertions: testenv.CacheMetricsAssertion{
						QueryNormalizationMisses:          cdnOperationCount,
						QueryNormalizationHits:            0,
						PersistedQueryNormalizationMisses: cdnPOCount,
						PersistedQueryNormalizationHits:   0,
						ValidationMisses:                  cdnOperationCount,
						ValidationHits:                    1,
						PlanMisses:                        cdnOperationCount,
						PlanHits:                          1,
					},
					FeatureFlagAssertions: map[string]testenv.CacheMetricsAssertion{
						"myff": {
							QueryNormalizationMisses: cdnOperationCount,
							QueryNormalizationHits:   1,
							ValidationMisses:         cdnOperationCount,
							ValidationHits:           1,
							PlanMisses:               cdnOperationCount,
							PlanHits:                 1,
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employees { id productCount } }`,
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
