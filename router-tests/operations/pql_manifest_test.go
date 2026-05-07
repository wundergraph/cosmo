package integration

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router-tests/testutils"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.uber.org/zap/zapcore"
)

// getCDNRequests returns all recorded HTTP requests from the CDN test server.
// The CDN test server records every request path it receives. Calling GET on
// its base URL returns these as a JSON array of strings (e.g. "GET /org/graph/operations/...").
func getCDNRequests(t *testing.T, cdnURL string) []string {
	t.Helper()
	resp, err := http.Get(cdnURL)
	require.NoError(t, err)
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)

	var requests []string
	err = json.Unmarshal(body, &requests)
	require.NoError(t, err)
	return requests
}

func TestPQLManifest(t *testing.T) {
	t.Parallel()

	expectedEmployeesBody := `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`
	persistedNotFoundResp := `{"errors":[{"message":"PersistedQueryNotFound","extensions":{"code":"PERSISTED_QUERY_NOT_FOUND"}}]}`

	manifestConfig := config.PersistedOperationsConfig{
		Manifest: config.PQLManifestConfig{
			Enabled:      true,
			PollInterval: 10 * time.Second,
			PollJitter:   5 * time.Second,
		},
	}

	manifestConfigWithWarmup := config.PersistedOperationsConfig{
		Manifest: config.PQLManifestConfig{
			Enabled:      true,
			PollInterval: 10 * time.Second,
			PollJitter:   5 * time.Second,
			Warmup: config.PQLManifestWarmupConfig{
				Enabled: true,
				Workers: 4,
				Timeout: 30 * time.Second,
			},
		},
	}

	t.Run("lookup succeeds for known operations", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithPersistedOperationsConfig(manifestConfig),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
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
			require.Equal(t, expectedEmployeesBody, res.Body)

			// Verify startup log
			logEntries := xEnv.Observer().FilterMessageSnippet("Loaded PQL manifest").All()
			require.Len(t, logEntries, 1)
		})
	})

	t.Run("rejects unknown operation hash", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithPersistedOperationsConfig(manifestConfig),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "0000000000000000000000000000000000000000000000000000000000000000"}}`),
			})
			require.Equal(t, persistedNotFoundResp, res.Body)
		})
	})

	t.Run("no CDN requests for individual operations", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithPersistedOperationsConfig(manifestConfig),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")

			// Make multiple requests
			for i := 0; i < 3; i++ {
				res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					OperationName: []byte(`"Employees"`),
					Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "dc67510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
					Header:        header,
				})
				require.NoError(t, err)
				require.Equal(t, expectedEmployeesBody, res.Body)
			}

			// With manifest enabled, the router should never call CDN for individual operations
			for _, req := range getCDNRequests(t, xEnv.CDN.URL) {
				require.False(t, strings.Contains(req, "/operations/my-client/"),
					"expected no individual operation CDN requests, but got: %s", req)
			}
		})
	})

	t.Run("defaults to Cosmo CDN when no storage provider configured", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithPersistedOperationsConfig(manifestConfig),
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
			require.Equal(t, expectedEmployeesBody, res.Body)

			hasManifestRequest := false
			for _, req := range getCDNRequests(t, xEnv.CDN.URL) {
				if strings.Contains(req, "/operations/manifest.json") {
					hasManifestRequest = true
				}
				require.False(t, strings.Contains(req, "/operations/my-client/"),
					"expected no individual operation CDN requests, but got: %s", req)
			}
			require.True(t, hasManifestRequest, "CDN should be called for manifest when no storage provider is configured")
		})
	})

	t.Run("safelist with manifest allows known queries", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithPersistedOperationsConfig(config.PersistedOperationsConfig{
					Manifest: config.PQLManifestConfig{
						Enabled:      true,
						PollInterval: 10 * time.Second,
						PollJitter:   5 * time.Second,
					},
					Safelist: config.SafelistConfiguration{Enabled: true},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"Employees"`),
				Header:        header,
				Query:         "query Employees {\n employees {\n id\n }\n}",
			})
			require.NoError(t, err)
			require.Equal(t, expectedEmployeesBody, res.Body)
		})
	})

	t.Run("safelist with manifest rejects unknown queries", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithPersistedOperationsConfig(config.PersistedOperationsConfig{
					Manifest: config.PQLManifestConfig{
						Enabled:      true,
						PollInterval: 10 * time.Second,
						PollJitter:   5 * time.Second,
					},
					Safelist: config.SafelistConfiguration{Enabled: true},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"Employees"`),
				Header:        header,
				Query:         "query Employees {\n\n\n employees {\n id\n }\n}",
			})
			require.NoError(t, err)
			require.Equal(t, persistedNotFoundResp, res.Body)
		})
	})

	t.Run("log_unknown with manifest logs and allows unknown queries", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithPersistedOperationsConfig(config.PersistedOperationsConfig{
					Manifest: config.PQLManifestConfig{
						Enabled:      true,
						PollInterval: 10 * time.Second,
						PollJitter:   5 * time.Second,
					},
					LogUnknown: true,
				}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			nonPersistedQuery := "query Employees {\n\n\n employees {\n id\n }\n}"
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"Employees"`),
				Header:        header,
				Query:         nonPersistedQuery,
			})
			require.NoError(t, err)
			require.Equal(t, expectedEmployeesBody, res.Body)

			logEntries := xEnv.Observer().FilterMessageSnippet("Unknown persisted operation found").All()
			require.Len(t, logEntries, 1)
			requestContext := logEntries[0].ContextMap()
			require.Equal(t, nonPersistedQuery, requestContext["query"])
		})
	})

	t.Run("log_unknown with manifest returns not found for hash-only request", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithPersistedOperationsConfig(config.PersistedOperationsConfig{
					Manifest: config.PQLManifestConfig{
						Enabled:      true,
						PollInterval: 10 * time.Second,
						PollJitter:   5 * time.Second,
					},
					LogUnknown: true,
				}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.WarnLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")

			// Hash-only request with no query body — should return PersistedQueryNotFound, not "empty request body"
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "0000000000000000000000000000000000000000000000000000000000000000"}}`),
				Header:     header,
			})
			require.Equal(t, persistedNotFoundResp, res.Body)

			logEntries := xEnv.Observer().FilterMessageSnippet("Unknown persisted operation found").All()
			require.Len(t, logEntries, 1)
		})
	})

	t.Run("without manifest CDN is used for individual operations", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")

			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"Employees"`),
				Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "dc67510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
				Header:        header,
			})
			require.NoError(t, err)
			require.Equal(t, expectedEmployeesBody, res.Body)

			hasOperationRequest := false
			hasManifestRequest := false
			for _, req := range getCDNRequests(t, xEnv.CDN.URL) {
				if strings.Contains(req, "/operations/my-client/") {
					hasOperationRequest = true
				}
				if strings.Contains(req, "/operations/manifest.json") {
					hasManifestRequest = true
				}
			}
			require.True(t, hasOperationRequest, "CDN should be called for individual operations when manifest is disabled")
			require.False(t, hasManifestRequest, "CDN should not fetch manifest when manifest is disabled")
		})
	})

	t.Run("without manifest safelist still uses CDN", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithPersistedOperationsConfig(config.PersistedOperationsConfig{
					Safelist: config.SafelistConfiguration{Enabled: true},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")

			// Known persisted query should succeed via CDN lookup
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"Employees"`),
				Header:        header,
				Query:         "query Employees {\n employees {\n id\n }\n}",
			})
			require.NoError(t, err)
			require.Equal(t, expectedEmployeesBody, res.Body)

			// Unknown query should be rejected
			res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"Employees"`),
				Header:        header,
				Query:         "query Employees {\n\n\n employees {\n id\n }\n}",
			})
			require.NoError(t, err)
			require.Equal(t, persistedNotFoundResp, res.Body)

			hasOperationRequest := false
			hasManifestRequest := false
			for _, req := range getCDNRequests(t, xEnv.CDN.URL) {
				if strings.Contains(req, "/operations/my-client/") {
					hasOperationRequest = true
				}
				if strings.Contains(req, "/operations/manifest.json") {
					hasManifestRequest = true
				}
			}
			require.True(t, hasOperationRequest, "CDN should be called for individual operations when manifest is disabled")
			require.False(t, hasManifestRequest, "CDN should not fetch manifest when manifest is disabled")
		})
	})

	t.Run("without manifest log_unknown still uses CDN", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithPersistedOperationsConfig(config.PersistedOperationsConfig{
					LogUnknown: true,
				}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			nonPersistedQuery := "query Employees {\n\n\n employees {\n id\n }\n}"
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")

			// Unknown query should be logged but allowed
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"Employees"`),
				Header:        header,
				Query:         nonPersistedQuery,
			})
			require.NoError(t, err)
			require.Equal(t, expectedEmployeesBody, res.Body)

			logEntries := xEnv.Observer().FilterMessageSnippet("Unknown persisted operation found").All()
			require.Len(t, logEntries, 1)

			hasManifestRequest := false
			for _, req := range getCDNRequests(t, xEnv.CDN.URL) {
				if strings.Contains(req, "/operations/manifest.json") {
					hasManifestRequest = true
				}
			}
			require.False(t, hasManifestRequest, "CDN should not fetch manifest when manifest is disabled")
		})
	})

	t.Run("log_unknown with safelist and manifest logs and rejects unknown queries", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithPersistedOperationsConfig(config.PersistedOperationsConfig{
					Manifest: config.PQLManifestConfig{
						Enabled:      true,
						PollInterval: 10 * time.Second,
						PollJitter:   5 * time.Second,
					},
					LogUnknown: true,
					Safelist:   config.SafelistConfiguration{Enabled: true},
				}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			nonPersistedQuery := "query Employees {\n\n\n employees {\n id\n }\n}"
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"Employees"`),
				Header:        header,
				Query:         nonPersistedQuery,
			})
			require.NoError(t, err)
			require.Equal(t, persistedNotFoundResp, res.Body)

			logEntries := xEnv.Observer().FilterMessageSnippet("Unknown persisted operation found").All()
			require.Len(t, logEntries, 1)
			requestContext := logEntries[0].ContextMap()
			require.Equal(t, nonPersistedQuery, requestContext["query"])
		})
	})

	t.Run("manifest reload preserves cache hits", func(t *testing.T) {
		t.Parallel()

		employeesHash := "dc67510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"
		employeesQuery := "query Employees {\n  employees {\n    id\n    }\n}"

		manifestV1, _ := json.Marshal(map[string]interface{}{
			"version":     1,
			"revision":    "rev-v1",
			"generatedAt": "2024-01-01T00:00:00Z",
			"operations": map[string]string{
				employeesHash: employeesQuery,
			},
		})
		// manifestV2 has the same operation but a new revision
		manifestV2, _ := json.Marshal(map[string]interface{}{
			"version":     1,
			"revision":    "rev-v2",
			"generatedAt": "2024-01-02T00:00:00Z",
			"operations": map[string]string{
				employeesHash: employeesQuery,
			},
		})

		var currentManifest atomic.Value
		currentManifest.Store(manifestV1)

		var manifestFetchCount atomic.Int32

		cdnServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.HasSuffix(r.URL.Path, "/operations/manifest.json") {
				manifest := currentManifest.Load().([]byte)

				var m struct {
					Revision string `json:"revision"`
				}
				_ = json.Unmarshal(manifest, &m)

				ifNoneMatch := r.Header.Get("If-None-Match")
				if ifNoneMatch == `"`+m.Revision+`"` {
					w.Header().Set("ETag", ifNoneMatch)
					w.WriteHeader(http.StatusNotModified)
					return
				}

				manifestFetchCount.Add(1)
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("ETag", `"`+m.Revision+`"`)
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write(manifest)
				return
			}

			w.WriteHeader(http.StatusNotFound)
		}))
		defer cdnServer.Close()

		testenv.Run(t, &testenv.Config{
			CdnSever: cdnServer,
			RouterOptions: []core.Option{
				core.WithPersistedOperationsConfig(config.PersistedOperationsConfig{
					Manifest: config.PQLManifestConfig{
						Enabled:      true,
						PollInterval: 100 * time.Millisecond,
						PollJitter:   5 * time.Millisecond,
						Warmup: config.PQLManifestWarmupConfig{
							Enabled: true,
							Workers: 4,
							Timeout: 30 * time.Second,
						},
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")

			// 1. First request is a cache HIT from warmup
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"Employees"`),
				Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "` + employeesHash + `"}}`),
				Header:        header,
			})
			require.NoError(t, err)
			require.Equal(t, expectedEmployeesBody, res.Body)
			require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))

			// 2. Swap to manifest v2 (new revision, same operations)
			currentManifest.Store(manifestV2)

			// 3. Wait for the poller to pick up the new manifest
			require.Eventually(t, func() bool {
				return manifestFetchCount.Load() >= 2
			}, 5*time.Second, 50*time.Millisecond)

			// 4. After manifest reload, the operation should still be a cache HIT
			// because the SHA is the same — no revision in the cache key.
			res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"Employees"`),
				Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "` + employeesHash + `"}}`),
				Header:        header,
			})
			require.NoError(t, err)
			require.Equal(t, expectedEmployeesBody, res.Body)
			require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		})
	})

	t.Run("manifest warmup serves first request from cache", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithPersistedOperationsConfig(manifestConfigWithWarmup),
			},
			// No AssertCacheMetrics here: Workers=4 with no rate limit means the 2 employees
			// variants (same normalized form) race for validation/plan caches, making exact
			// counts non-deterministic. Cache correctness is verified via response headers below.
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")

			// The very first request should hit ALL caches because the manifest warmup
			// pre-processed all operations through the full pipeline at startup.
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"Employees"`),
				Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "dc67510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
				Header:        header,
			})
			require.NoError(t, err)
			require.Equal(t, expectedEmployeesBody, res.Body)
			require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
			require.Equal(t, "HIT", res.Response.Header.Get(core.NormalizationCacheHeader))
			require.Equal(t, "HIT", res.Response.Header.Get(core.VariablesNormalizationCacheHeader))
			require.Equal(t, "HIT", res.Response.Header.Get(core.VariablesRemappingCacheHeader))
			require.Equal(t, "HIT", res.Response.Header.Get(core.ExecutionPlanCacheHeader))
		})
	})

	t.Run("manifest warmup cache hit is independent of client name", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithPersistedOperationsConfig(manifestConfigWithWarmup),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Warmup runs without a client name. Requests from any client should still hit
			// all caches because PQL manifest cache keys exclude clientName.
			for _, clientName := range []string{"client-a", "client-b", "another-client"} {
				header := make(http.Header)
				header.Add("graphql-client-name", clientName)

				res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					OperationName: []byte(`"Employees"`),
					Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "dc67510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
					Header:        header,
				})
				require.NoError(t, err)
				require.Equal(t, expectedEmployeesBody, res.Body)
				require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader),
					"expected persisted operation cache HIT for client %q", clientName)
				require.Equal(t, "HIT", res.Response.Header.Get(core.NormalizationCacheHeader),
					"expected normalization cache HIT for client %q", clientName)
				require.Equal(t, "HIT", res.Response.Header.Get(core.VariablesNormalizationCacheHeader),
					"expected variables normalization cache HIT for client %q", clientName)
				require.Equal(t, "HIT", res.Response.Header.Get(core.VariablesRemappingCacheHeader),
					"expected variables remapping cache HIT for client %q", clientName)
				require.Equal(t, "HIT", res.Response.Header.Get(core.ExecutionPlanCacheHeader),
					"expected execution plan cache HIT for client %q", clientName)
			}
		})
	})

	t.Run("APQ GET request with operation query parameter and manifest-known operation hits cache", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithPersistedOperationsConfig(manifestConfigWithWarmup),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
				Query:      "{__typename}",
				Extensions: []byte(`{"persistedQuery":{"version":1,"sha256Hash":"ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}}`),
			})
			require.NoError(t, err)
			require.Equal(t, `{"data":{"__typename":"Query"}}`, res.Body)
			require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		})
	})

	t.Run("disabled persisted operations suppresses manifest", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithPersistedOperationsConfig(config.PersistedOperationsConfig{
					Disabled: true,
					Manifest: config.PQLManifestConfig{
						Enabled:      true,
						PollInterval: 10 * time.Second,
						PollJitter:   5 * time.Second,
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// With persisted operations disabled, manifest should not load.
			// A regular query should still work.
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: "query { employees { id } }",
			})
			require.NoError(t, err)
			require.Equal(t, expectedEmployeesBody, res.Body)

			// No manifest requests should be made to CDN
			hasManifestRequest := false
			for _, req := range getCDNRequests(t, xEnv.CDN.URL) {
				if strings.Contains(req, "/operations/manifest.json") {
					hasManifestRequest = true
				}
			}
			require.False(t, hasManifestRequest, "CDN should not fetch manifest when persisted operations are disabled")
		})
	})

	t.Run("filesystem provider rejected for manifest", func(t *testing.T) {
		t.Parallel()
		testenv.FailsOnStartup(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithPersistedOperationsConfig(config.PersistedOperationsConfig{
					Manifest: config.PQLManifestConfig{
						Enabled:      true,
						PollInterval: 10 * time.Second,
						PollJitter:   5 * time.Second,
					},
					Storage: config.PersistedOperationsStorageConfig{
						ProviderID: "local",
					},
				}),
				core.WithStorageProviders(config.StorageProviders{
					FileSystem: []config.FileSystemStorageProvider{
						{ID: "local", Path: "."},
					},
				}),
			},
		}, func(t *testing.T, err error) {
			require.ErrorContains(t, err, "filesystem storage provider")
			require.ErrorContains(t, err, "not supported for PQL manifest")
		})
	})

	t.Run("warmup disabled skips cache pre-processing", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithPersistedOperationsConfig(config.PersistedOperationsConfig{
					Manifest: config.PQLManifestConfig{
						Enabled:      true,
						PollInterval: 10 * time.Second,
						PollJitter:   5 * time.Second,
						Warmup: config.PQLManifestWarmupConfig{
							Enabled: false,
						},
					},
				}),
			},
			AssertCacheMetrics: &testenv.CacheMetricsAssertions{
				BaseGraphAssertions: testenv.CacheMetricsAssertion{
					// No warmup → all caches cold on first request.
					// 2 persisted normalization misses: loadPersistedOperationFromCache checks
					// once without operation name, once with (because OperationName is set).
					PersistedQueryNormalizationMisses: 2,
					ValidationMisses:                  1,
					PlanMisses:                        1,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")

			// With warmup disabled, the first request should still resolve the persisted operation
			// from the manifest, but all processing caches should be cold.
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"Employees"`),
				Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "dc67510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
				Header:        header,
			})
			require.NoError(t, err)
			require.Equal(t, expectedEmployeesBody, res.Body)
			require.Equal(t, "MISS", res.Response.Header.Get(core.PersistedOperationCacheHeader))
			require.Equal(t, "MISS", res.Response.Header.Get(core.NormalizationCacheHeader))
			require.Equal(t, "MISS", res.Response.Header.Get(core.ExecutionPlanCacheHeader))
		})
	})

	t.Run("warmup with custom workers and timeout", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithPersistedOperationsConfig(config.PersistedOperationsConfig{
					Manifest: config.PQLManifestConfig{
						Enabled:      true,
						PollInterval: 10 * time.Second,
						PollJitter:   5 * time.Second,
						Warmup: config.PQLManifestWarmupConfig{
							Enabled:        true,
							Workers:        2,
							ItemsPerSecond: 100,
							Timeout:        10 * time.Second,
						},
					},
				}),
			},
			AssertCacheMetrics: &testenv.CacheMetricsAssertions{
				BaseGraphAssertions: testenv.CacheMetricsAssertion{
					// Custom warmup config (Workers=2, ItemsPerSecond=100) still warms all caches.
					// 3 manifest ops → 2 unique plans during warmup, 1 hit from the request.
					PersistedQueryNormalizationHits: 1,
					ValidationMisses:                2,
					ValidationHits:                  2,
					PlanMisses:                      2,
					PlanHits:                        2,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")

			// With custom warmup config, all caches should still be warm on the first request.
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"Employees"`),
				Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "dc67510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
				Header:        header,
			})
			require.NoError(t, err)
			require.Equal(t, expectedEmployeesBody, res.Body)
			require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
			require.Equal(t, "HIT", res.Response.Header.Get(core.NormalizationCacheHeader))
			require.Equal(t, "HIT", res.Response.Header.Get(core.ExecutionPlanCacheHeader))
		})
	})

	t.Run("cache warmup and manifest warmup both warm overlapping operations", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
					Enabled: true,
					Source: config.CacheWarmupSource{
						Filesystem: &config.CacheWarmupFileSystemSource{
							// Contains hash dc675... which also exists in the manifest.
							Path: "testdata/cache_warmup/json_po_manifest_overlap",
						},
					},
				}),
				core.WithPersistedOperationsConfig(config.PersistedOperationsConfig{
					Manifest: config.PQLManifestConfig{
						Enabled:      true,
						PollInterval: 10 * time.Second,
						PollJitter:   5 * time.Second,
						Warmup: config.PQLManifestWarmupConfig{
							Enabled:        true,
							Workers:        2,
							ItemsPerSecond: 100,
							Timeout:        30 * time.Second,
						},
					},
				}),
			},
			AssertCacheMetrics: &testenv.CacheMetricsAssertions{
				BaseGraphAssertions: testenv.CacheMetricsAssertion{
					// Cache warmup plans dc675... (1 plan+validation miss).
					// waitForCaches() flushes ristretto so all entries are visible.
					// Manifest warmup: dc675... hits plan cache, 33651... hits (same
					// normalized form), ecf4e... misses (unique query).
					// Request for dc675... hits all caches.
					// Total: 2 misses (dc675 warmup + ecf4e manifest), 3 hits (dc675+33651 manifest + request).
					PersistedQueryNormalizationHits: 1,
					ValidationMisses:                2,
					ValidationHits:                  3,
					PlanMisses:                      2,
					PlanHits:                        3,
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
			require.Equal(t, expectedEmployeesBody, res.Body)
			require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		})
	})

	t.Run("in-memory APQ skips save for manifest-known operations", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ApqConfig: config.AutomaticPersistedQueriesConfig{
				Enabled: true,
				Cache: config.AutomaticPersistedQueriesCacheConfig{
					Size: 1024 * 1024,
					TTL:  2,
				},
			},
			RouterOptions: []core.Option{
				core.WithPersistedOperationsConfig(manifestConfig),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")

			// Send query + hash for a manifest-known operation.
			// For in-memory APQ, this should NOT be saved to APQ — the manifest is authoritative.
			// sha256("{__typename}") = ecf4e... which is in the manifest.
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:      `{__typename}`,
				Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}}`),
				Header:     header,
			})
			require.NoError(t, err)
			require.Equal(t, `{"data":{"__typename":"Query"}}`, res.Body)

			// Wait for APQ TTL to expire. If the operation was saved to APQ,
			// a hash-only request would fail after this.
			time.Sleep(3 * time.Second)

			// Hash-only request must still succeed — served from manifest, not expired APQ.
			res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}}`),
				Header:     header,
			})
			require.NoError(t, err)
			require.Equal(t, `{"data":{"__typename":"Query"}}`, res.Body)
		})
	})

	t.Run("APQ works for non-manifest operations when both enabled", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ApqConfig: config.AutomaticPersistedQueriesConfig{
				Enabled: true,
				Cache: config.AutomaticPersistedQueriesCacheConfig{
					Size: 1024 * 1024,
				},
			},
			RouterOptions: []core.Option{
				core.WithPersistedOperationsConfig(manifestConfig),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")

			// Use an operation NOT in the manifest. APQ should work normally.
			// sha256("query { employees { id details { forename } } }") = 6083e15e...
			nonManifestHash := "6083e15eded39dbd64279ae4cffbc6e3bee52b177f7003ebba9532a17e6231f2"
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:      `query { employees { id details { forename } } }`,
				Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "` + nonManifestHash + `"}}`),
				Header:     header,
			})
			require.NoError(t, err)
			require.Contains(t, res.Body, `"data"`)

			// Subsequent hash-only request should succeed — APQ saved the operation.
			res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "` + nonManifestHash + `"}}`),
				Header:     header,
			})
			require.NoError(t, err)
			require.Contains(t, res.Body, `"data"`)
		})
	})

	t.Run("manifest warmup emits planning time metrics", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()

		testenv.Run(t, &testenv.Config{
			MetricReader: metricReader,
			RouterOptions: []core.Option{
				core.WithPersistedOperationsConfig(manifestConfigWithWarmup),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// No requests — collect metrics emitted purely by manifest warmup at startup.
			rm := metricdata.ResourceMetrics{}
			err := metricReader.Collect(context.Background(), &rm)
			require.NoError(t, err)

			metricScope := testutils.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")
			require.NotNil(t, metricScope)

			m := testutils.GetMetricByName(metricScope, "router.graphql.operation.planning_time")
			require.NotNil(t, m, "planning_time metric should be emitted during manifest warmup")

			dataPoints := m.Data.(metricdata.Histogram[float64]).DataPoints
			require.NotEmpty(t, dataPoints)

			// Find the warmup data point (cache miss during warmup planning)
			warmupDP := findDataPoint(t, dataPoints, false)
			require.Greater(t, warmupDP.Count, uint64(0), "manifest warmup should record planning time metrics")
			require.Greater(t, warmupDP.Sum, float64(0), "manifest warmup planning time should be non-zero")
		})
	})

	t.Run("fails to start when initial CDN manifest fetch fails", func(t *testing.T) {
		t.Parallel()

		cdnServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.HasSuffix(r.URL.Path, "/operations/manifest.json") {
				// Return 404 (not 500) to avoid retryablehttp's 5 retries with exponential backoff.
				w.WriteHeader(http.StatusNotFound)
				return
			}
			w.WriteHeader(http.StatusNotFound)
		}))
		defer cdnServer.Close()

		testenv.FailsOnStartup(t, &testenv.Config{
			CdnSever: cdnServer,
			RouterOptions: []core.Option{
				core.WithPersistedOperationsConfig(config.PersistedOperationsConfig{
					Manifest: config.PQLManifestConfig{
						Enabled:      true,
						PollInterval: 10 * time.Second,
						PollJitter:   5 * time.Second,
					},
				}),
			},
		}, func(t *testing.T, err error) {
			require.ErrorContains(t, err, "PQL manifest not found on CDN")
		})
	})
}
