package integration

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
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
			logEntries := xEnv.Observer().FilterMessageSnippet("Loaded initial PQL manifest").All()
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

	t.Run("manifest update invalidates normalization cache", func(t *testing.T) {
		t.Parallel()

		employeesHash := "dc67510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"
		employeesQuery := "query Employees {\n  employees {\n    id\n    }\n}"

		// manifestV1 has the Employees operation
		manifestV1, _ := json.Marshal(map[string]interface{}{
			"version":     1,
			"revision":    "rev-v1",
			"generatedAt": "2024-01-01T00:00:00Z",
			"operations": map[string]string{
				employeesHash: employeesQuery,
			},
		})
		// manifestV2 removes the Employees operation
		manifestV2, _ := json.Marshal(map[string]interface{}{
			"version":     1,
			"revision":    "rev-v2",
			"generatedAt": "2024-01-02T00:00:00Z",
			"operations":  map[string]string{},
		})

		var currentManifest atomic.Value
		currentManifest.Store(manifestV1)

		cdnServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.HasSuffix(r.URL.Path, "/operations/manifest.json") {
				// Read the request body to check revision
				body, _ := io.ReadAll(r.Body)
				var reqBody struct {
					Revision string `json:"revision"`
				}
				_ = json.Unmarshal(body, &reqBody)

				manifest := currentManifest.Load().([]byte)

				// Parse manifest to get its revision
				var m struct {
					Revision string `json:"revision"`
				}
				_ = json.Unmarshal(manifest, &m)

				if reqBody.Revision == m.Revision {
					w.WriteHeader(http.StatusNotModified)
					return
				}

				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write(manifest)
				return
			}

			// For non-manifest requests, return 404
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
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")

			// 1. Operation succeeds with manifest v1
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"Employees"`),
				Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "` + employeesHash + `"}}`),
				Header:        header,
			})
			require.NoError(t, err)
			require.Equal(t, expectedEmployeesBody, res.Body)

			// 2. Make the same request again to populate the normalization cache
			res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"Employees"`),
				Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "` + employeesHash + `"}}`),
				Header:        header,
			})
			require.NoError(t, err)
			require.Equal(t, expectedEmployeesBody, res.Body)

			// 3. Swap to manifest v2 (which removes the operation)
			currentManifest.Store(manifestV2)

			// 4. Wait for poller to pick up the new manifest and cache to be invalidated
			require.EventuallyWithT(t, func(ct *assert.CollectT) {
				res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					OperationName: []byte(`"Employees"`),
					Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "` + employeesHash + `"}}`),
					Header:        header,
				})
				assert.Equal(ct, persistedNotFoundResp, res.Body)
			}, 5*time.Second, 100*time.Millisecond)
		})
	})
}
