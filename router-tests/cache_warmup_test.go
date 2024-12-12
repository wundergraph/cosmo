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
)

func TestCacheWarmup(t *testing.T) {
	t.Skip("skipping until metric renaming done")
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
					Path:    "testenv/testdata/cache_warmup",
				}),
			},
			AssertCacheMetrics: &testenv.CacheMetricsAssertion{
				QueryNormalizationMisses: 3,
				QueryNormalizationHits:   4,
				ValidationMisses:         3,
				ValidationHits:           4,
				ExecutionMisses:          3,
				ExecutionHits:            4,
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
					Path:    "testenv/testdata/invalid_cache_warmup",
				}),
			},
			AssertCacheMetrics: &testenv.CacheMetricsAssertion{
				QueryNormalizationMisses: 2,
				QueryNormalizationHits:   0,
				ValidationMisses:         2,
				ValidationHits:           0,
				ExecutionMisses:          1,
				ExecutionHits:            0,
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
					Path:    "testenv/testdata/cache_warmup_json",
				}),
			},
			AssertCacheMetrics: &testenv.CacheMetricsAssertion{
				QueryNormalizationMisses: 3,
				QueryNormalizationHits:   5,
				ValidationMisses:         3,
				ValidationHits:           5,
				ExecutionMisses:          3,
				ExecutionHits:            5,
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
				Query: `query { employees { id details { forename surname } isAvailable } }`,
			}, map[string]string{
				"graphql-client-name":    "test",
				"graphql-client-version": "1.0.0",
			})
			require.NoError(t, err)
			require.Equal(t, `{"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"isAvailable":false},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"isAvailable":false},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"isAvailable":false},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"isAvailable":false},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"isAvailable":false},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"isAvailable":false},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"isAvailable":false},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"isAvailable":false},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"isAvailable":false},{"id":12,"details":{"forename":"David","surname":"Stutt"},"isAvailable":false}]}}`, res.Body)
			res, err = xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
				Query: `query { employees { id details { forename surname } isAvailable } }`,
			}, map[string]string{
				"graphql-client-name":    "test",
				"graphql-client-version": "1.0.0",
			})
			require.NoError(t, err)
			require.Equal(t, `{"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"isAvailable":false},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"isAvailable":false},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"isAvailable":false},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"isAvailable":false},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"isAvailable":false},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"isAvailable":false},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"isAvailable":false},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"isAvailable":false},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"isAvailable":false},{"id":12,"details":{"forename":"David","surname":"Stutt"},"isAvailable":false}]}}`, res.Body)
			res, err = xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
				Query: `query { employees { id details { forename surname } isAvailable } }`,
			}, map[string]string{
				"graphql-client-name":    "test",
				"graphql-client-version": "1.0.1",
			})
			require.NoError(t, err)
			require.Equal(t, `{"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"isAvailable":false},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"isAvailable":false},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"isAvailable":false},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"isAvailable":false},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"isAvailable":false},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"isAvailable":false},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"isAvailable":false},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"isAvailable":false},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"isAvailable":false},{"id":12,"details":{"forename":"David","surname":"Stutt"},"isAvailable":false}]}}`, res.Body)
		})
	})
	t.Run("cache warmup json with variables", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
					Enabled: true,
					Source:  "filesystem",
					Path:    "testenv/testdata/cache_warmup_json_variables",
				}),
			},
			AssertCacheMetrics: &testenv.CacheMetricsAssertion{
				QueryNormalizationMisses: 1,
				QueryNormalizationHits:   1,
				ValidationMisses:         1,
				ValidationHits:           1,
				ExecutionMisses:          1,
				ExecutionHits:            1,
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
					Path:    "testenv/testdata/cache_warmup_json_variables",
				}),
			},
			AssertCacheMetrics: &testenv.CacheMetricsAssertion{
				QueryNormalizationMisses: 1,
				QueryNormalizationHits:   1,
				ValidationMisses:         1,
				ValidationHits:           1,
				ExecutionMisses:          1,
				ExecutionHits:            1,
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
					Path:    "testenv/testdata/cache_warmup_json_po",
				}),
			},
			AssertCacheMetrics: &testenv.CacheMetricsAssertion{
				QueryNormalizationMisses: 1,
				QueryNormalizationHits:   1,
				ValidationMisses:         1,
				ValidationHits:           1,
				ExecutionMisses:          1,
				ExecutionHits:            1,
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
					Path:    "testenv/testdata/cache_warmup_json_po",
				}),
			},
			AssertCacheMetrics: &testenv.CacheMetricsAssertion{
				QueryNormalizationMisses: 0,
				QueryNormalizationHits:   0,
				ValidationMisses:         1,
				ValidationHits:           0,
				ExecutionMisses:          1,
				ExecutionHits:            0,
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
			require.Equal(t, `{"errors":[{"message":"persisted query not found","extensions":{"code":"PERSISTED_QUERY_NOT_FOUND"}}]}`, res.Body)
		})
	})
	t.Run("cache warmup workers throttle", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
					Enabled:  true,
					Source:   "filesystem",
					Path:     "testenv/testdata/cache_warmup",
					Workers:  2,
					Throttle: time.Millisecond * 10,
				}),
			},
			AssertCacheMetrics: &testenv.CacheMetricsAssertion{
				QueryNormalizationMisses: 1,
				QueryNormalizationHits:   2,
				ValidationMisses:         1,
				ValidationHits:           2,
				ExecutionMisses:          1,
				ExecutionHits:            2,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.Equal(t, employeesIDData, res.Body)
			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
		})
	})
}
