package integration

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap/zapcore"
)

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

			// Check CDN request log - only manifest request, no individual operation requests
			resp, err := http.Get(xEnv.CDN.URL)
			require.NoError(t, err)
			defer resp.Body.Close()
			body, err := io.ReadAll(resp.Body)
			require.NoError(t, err)

			var cdnRequests []string
			err = json.Unmarshal(body, &cdnRequests)
			require.NoError(t, err)

			// Should have manifest request(s) but no individual operation requests
			for _, req := range cdnRequests {
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

			// Verify CDN was hit for the individual operation
			resp, err := http.Get(xEnv.CDN.URL)
			require.NoError(t, err)
			defer resp.Body.Close()
			body, err := io.ReadAll(resp.Body)
			require.NoError(t, err)

			var cdnRequests []string
			err = json.Unmarshal(body, &cdnRequests)
			require.NoError(t, err)

			// CDN should have been called for the individual operation, not the manifest
			hasOperationRequest := false
			hasManifestRequest := false
			for _, req := range cdnRequests {
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

			// Verify CDN was hit for individual operations, not manifest
			resp, err := http.Get(xEnv.CDN.URL)
			require.NoError(t, err)
			defer resp.Body.Close()
			body, err := io.ReadAll(resp.Body)
			require.NoError(t, err)

			var cdnRequests []string
			err = json.Unmarshal(body, &cdnRequests)
			require.NoError(t, err)

			hasOperationRequest := false
			hasManifestRequest := false
			for _, req := range cdnRequests {
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

			// Verify CDN was used, not manifest
			resp, err := http.Get(xEnv.CDN.URL)
			require.NoError(t, err)
			defer resp.Body.Close()
			body, err := io.ReadAll(resp.Body)
			require.NoError(t, err)

			var cdnRequests []string
			err = json.Unmarshal(body, &cdnRequests)
			require.NoError(t, err)

			hasManifestRequest := false
			for _, req := range cdnRequests {
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
}
