package integration

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestDeferARTPrimaryAndTerminalExtensions(t *testing.T) {
	requestExtensions := json.RawMessage(`{"client":{"requestId":"defer-art"}}`)
	observedRequests := newDeferARTRequestObserver()

	testenv.Run(t, &testenv.Config{
		RouterConfigJSONTemplate: testenv.ConfigDeferDemoJSONTemplate,
		EnableDeferDemoSubgraphs: true,
		ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
			cfg.EnableRequestTracing = true
		},
		ModifySubgraphExtensionPropagation: func(cfg *config.SubgraphExtensionPropagationConfiguration) {
			*cfg = config.SubgraphExtensionPropagationConfiguration{
				Enabled:                true,
				Algorithm:              config.SubgraphExtensionPropagationAlgorithmFirstWrite,
				AllowedExtensionFields: []string{"catalogExt", "pricingExt", "reviewsExt"},
			}
		},
		Subgraphs: testenv.SubgraphsConfig{
			Catalog: testenv.SubgraphConfig{Middleware: deferARTObserveAndInject(
				t, observedRequests, "catalog", `{"catalogExt":"initial"}`,
			)},
			Pricing: testenv.SubgraphConfig{Middleware: deferARTObserveAndInject(
				t, observedRequests, "pricing", `{"pricingExt":"deferred"}`,
			)},
			Reviews: testenv.SubgraphConfig{Middleware: deferARTObserveAndInject(
				t, observedRequests, "reviews", `{"reviewsExt":"deferred"}`,
			)},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		body, contentType := executeDeferARTRequest(t, xEnv, testenv.GraphQLRequest{
			Query: `query StorefrontDeferART {
				storefront {
					id
					name
					... @defer(label: "Pricing") {
						price
						priceHistory { date value }
					}
					... @defer(label: "Reviews") {
						reviews { id body stars }
						ratingSummary { average count }
					}
				}
			}`,
			Extensions: requestExtensions,
		})

		require.True(t, strings.HasPrefix(contentType, "multipart/mixed"), contentType)
		parts := decodeDeferARTParts(t, body)
		require.Len(t, parts, 3)

		initial := parts[0]
		require.Equal(t, true, initial["hasNext"])
		require.NotEmpty(t, initial["pending"])
		initialExtensions := requireDeferARTExtensions(t, initial)
		require.Equal(t, "initial", initialExtensions["catalogExt"])
		require.NotContains(t, initialExtensions, "pricingExt")
		require.NotContains(t, initialExtensions, "reviewsExt")
		require.Empty(t, deferARTStatuses(initialExtensions["trace"]), "the active trace must remain primary-only")
		require.Equal(t, map[string]int{"catalog": 1}, deferARTFetchCounts(initialExtensions["trace"], "source_name"))

		initialPlan := initialExtensions["queryPlan"]
		require.Equal(t, map[string]int{"catalog": 1, "pricing": 1, "reviews": 1}, deferARTFetchCounts(initialPlan, "subgraphName"))
		planBytes, err := json.Marshal(initialPlan)
		require.NoError(t, err)
		require.Contains(t, string(planBytes), `"label":"Pricing"`)
		require.Contains(t, string(planBytes), `"label":"Reviews"`)

		for _, intermediate := range parts[1 : len(parts)-1] {
			require.Equal(t, true, intermediate["hasNext"])
			require.NotContains(t, intermediate, "extensions")
		}

		terminal := parts[len(parts)-1]
		require.Equal(t, false, terminal["hasNext"])
		terminalExtensions := requireDeferARTExtensions(t, terminal)
		require.Equal(t, "initial", terminalExtensions["catalogExt"])
		require.Equal(t, "deferred", terminalExtensions["pricingExt"])
		require.Equal(t, "deferred", terminalExtensions["reviewsExt"])
		require.Equal(t, initialPlan, terminalExtensions["queryPlan"])
		require.Equal(t, map[string]string{
			"Pricing": "completed",
			"Reviews": "completed",
		}, deferARTStatuses(terminalExtensions["trace"]))
		require.Equal(t, map[string]int{"catalog": 1, "pricing": 1, "reviews": 1}, deferARTFetchCounts(terminalExtensions["trace"], "source_name"))

		require.Equal(t, int64(1), xEnv.SubgraphRequestCount.Catalog.Load())
		require.Equal(t, int64(1), xEnv.SubgraphRequestCount.Pricing.Load())
		require.Equal(t, int64(1), xEnv.SubgraphRequestCount.Reviews.Load())
		for _, source := range []string{"catalog", "pricing", "reviews"} {
			require.Len(t, observedRequests.extensions(source), 1, source)
			require.JSONEq(t, string(requestExtensions), string(observedRequests.extensions(source)[0]), source)
		}

		final := reconstructDeferARTSnapshot(t, body)
		require.Equal(t, terminalExtensions, final["extensions"])
		data := final["data"].(map[string]any)
		storefront := data["storefront"].([]any)
		require.Len(t, storefront, 3)
		for _, item := range storefront {
			product := item.(map[string]any)
			require.Contains(t, product, "priceHistory")
			require.Contains(t, product, "reviews")
		}
	})
}

func TestDeferARTAllPrunedIsSingleAuthoritativeFrame(t *testing.T) {
	observedRequests := newDeferARTRequestObserver()
	testenv.Run(t, &testenv.Config{
		ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
			cfg.EnableRequestTracing = true
		},
		ModifySubgraphExtensionPropagation: func(cfg *config.SubgraphExtensionPropagationConfiguration) {
			*cfg = config.SubgraphExtensionPropagationConfiguration{
				Enabled:                true,
				Algorithm:              config.SubgraphExtensionPropagationAlgorithmFirstWrite,
				AllowedExtensionFields: []string{"initialOnly"},
			}
		},
		Subgraphs: testenv.SubgraphsConfig{
			Employees: testenv.SubgraphConfig{Middleware: deferARTObserveAndInject(
				t, observedRequests, "employees", `{"initialOnly":true}`,
			)},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		body, contentType := executeDeferARTRequest(t, xEnv, testenv.GraphQLRequest{
			Query: `query PrunedDeferART {
				employee(id: 999) {
					id
					... @defer(label: "Availability") { isAvailable }
				}
			}`,
		})

		require.True(t, strings.HasPrefix(contentType, "multipart/mixed"), contentType)
		parts := decodeDeferARTParts(t, body)
		require.Len(t, parts, 1)
		require.True(t, bytes.HasSuffix(body, []byte("--graphql--")))

		frame := parts[0]
		require.Equal(t, false, frame["hasNext"])
		require.NotContains(t, frame, "pending")
		require.NotContains(t, frame, "incremental")
		require.JSONEq(t, `{"employee":null}`, mustDeferARTJSON(t, frame["data"]))

		extensions := requireDeferARTExtensions(t, frame)
		require.Equal(t, true, extensions["initialOnly"])
		require.Equal(t, map[string]string{"Availability": "skipped"}, deferARTStatuses(extensions["trace"]))
		require.Equal(t, map[string]int{"employees": 1, "availability": 1}, deferARTFetchCounts(extensions["trace"], "source_name"))
		require.Equal(t, map[string]int{"employees": 1, "availability": 1}, deferARTFetchCounts(extensions["queryPlan"], "subgraphName"))

		skippedBranch := deferARTBranch(extensions["trace"], "Availability")
		require.NotNil(t, skippedBranch)
		traceBytes, err := json.Marshal(skippedBranch)
		require.NoError(t, err)
		require.Contains(t, string(traceBytes), `"status":"skipped"`)
		require.NotContains(t, string(traceBytes), `"duration_load_nanoseconds"`)

		require.Equal(t, int64(1), xEnv.SubgraphRequestCount.Employees.Load())
		require.Equal(t, int64(0), xEnv.SubgraphRequestCount.Availability.Load())
		require.Len(t, observedRequests.extensions("employees"), 1)

		final := reconstructDeferARTSnapshot(t, body)
		require.Equal(t, extensions, final["extensions"])
		require.JSONEq(t, `{"employee":null}`, mustDeferARTJSON(t, final["data"]))
	})
}

func TestDeferARTTerminalErrorKeepsErrorAndResponseExtensions(t *testing.T) {
	observedRequests := newDeferARTRequestObserver()
	testenv.Run(t, &testenv.Config{
		ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
			cfg.EnableRequestTracing = true
		},
		ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
			cfg.Enabled = true
			cfg.Mode = config.SubgraphErrorPropagationModePassthrough
			cfg.PropagateStatusCodes = false
			cfg.AttachServiceName = false
			cfg.AllowedExtensionFields = []string{"code", "foo"}
		},
		ModifySubgraphExtensionPropagation: func(cfg *config.SubgraphExtensionPropagationConfiguration) {
			*cfg = config.SubgraphExtensionPropagationConfiguration{
				Enabled:                true,
				Algorithm:              config.SubgraphExtensionPropagationAlgorithmFirstWrite,
				AllowedExtensionFields: []string{"employeeExt"},
			}
		},
		Subgraphs: testenv.SubgraphsConfig{
			Employees: testenv.SubgraphConfig{Middleware: deferARTObserveAndInject(
				t, observedRequests, "employees", `{"employeeExt":"kept-through-error"}`,
			)},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		body, contentType := executeDeferARTRequest(t, xEnv, testenv.GraphQLRequest{
			Query: `query FailedDeferART {
				employee(id: 1) {
					id
					... @defer(label: "Failure") { rootFieldThrowsError }
				}
			}`,
		})

		require.True(t, strings.HasPrefix(contentType, "multipart/mixed"), contentType)
		parts := decodeDeferARTParts(t, body)
		require.Len(t, parts, 2)
		require.True(t, bytes.HasSuffix(body, []byte("--graphql--")))

		initialExtensions := requireDeferARTExtensions(t, parts[0])
		require.Equal(t, true, parts[0]["hasNext"])
		require.Empty(t, deferARTStatuses(initialExtensions["trace"]))
		require.Equal(t, "kept-through-error", initialExtensions["employeeExt"])
		require.Equal(t, map[string]int{"employees": 1}, deferARTFetchCounts(initialExtensions["trace"], "source_name"))

		terminal := parts[1]
		require.Equal(t, false, terminal["hasNext"])
		incremental, ok := terminal["incremental"].([]any)
		require.True(t, ok)
		require.Len(t, incremental, 1)
		incrementalItem := incremental[0].(map[string]any)
		errors, ok := incrementalItem["errors"].([]any)
		require.True(t, ok)
		require.Len(t, errors, 1)
		deferredError := errors[0].(map[string]any)
		require.Equal(t, "error resolving RootFieldThrowsError for Employee 1", deferredError["message"])
		require.Equal(t, map[string]any{"code": "ERROR_CODE", "foo": "bar"}, deferredError["extensions"])

		terminalExtensions := requireDeferARTExtensions(t, terminal)
		require.Equal(t, "kept-through-error", terminalExtensions["employeeExt"])
		require.Equal(t, initialExtensions["queryPlan"], terminalExtensions["queryPlan"])
		require.Equal(t, map[string]string{"Failure": "error"}, deferARTStatuses(terminalExtensions["trace"]))
		require.Equal(t, map[string]int{"employees": 2}, deferARTFetchCounts(terminalExtensions["trace"], "source_name"))

		require.Equal(t, int64(2), xEnv.SubgraphRequestCount.Employees.Load())
		require.Len(t, observedRequests.extensions("employees"), 2)

		final := reconstructDeferARTSnapshot(t, body)
		require.Equal(t, terminalExtensions, final["extensions"])
		rootErrors, ok := final["errors"].([]any)
		require.True(t, ok)
		require.Len(t, rootErrors, 1)
		require.Equal(t, map[string]any{"code": "ERROR_CODE", "foo": "bar"}, rootErrors[0].(map[string]any)["extensions"])
	})
}

func TestDeferARTNullPropagatedErrorCompletesWithoutIncrementalData(t *testing.T) {
	testenv.Run(t, &testenv.Config{
		ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
			cfg.EnableRequestTracing = true
		},
		ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
			cfg.Enabled = true
			cfg.Mode = config.SubgraphErrorPropagationModePassthrough
			cfg.PropagateStatusCodes = false
			cfg.AttachServiceName = false
			cfg.AllowedExtensionFields = []string{"code", "detail"}
		},
		Subgraphs: testenv.SubgraphsConfig{
			Mood: testenv.SubgraphConfig{Middleware: func(http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
					w.Header().Set("Content-Type", "application/json")
					_, err := io.WriteString(w, `{"data":{"_entities":[null]},"errors":[{"message":"deferred mood failed","path":["_entities",0,"currentMood"],"extensions":{"code":"MOOD_FAIL","detail":"deferred"}}]}`)
					if err != nil {
						t.Errorf("write mood error response: %v", err)
					}
				})
			}},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		body, _ := executeDeferARTRequest(t, xEnv, testenv.GraphQLRequest{
			Query: `query NullPropagatedDeferART {
				employee(id: 1) {
					id
					... @defer(label: "Mood") { currentMood }
				}
			}`,
		})
		parts := decodeDeferARTParts(t, body)
		require.Len(t, parts, 2)

		terminal := parts[1]
		require.Equal(t, false, terminal["hasNext"])
		require.NotContains(t, terminal, "incremental")
		completed, ok := terminal["completed"].([]any)
		require.True(t, ok)
		require.Len(t, completed, 1)
		completedErrors, ok := completed[0].(map[string]any)["errors"].([]any)
		require.True(t, ok)
		require.NotEmpty(t, completedErrors)

		var propagated map[string]any
		for _, value := range completedErrors {
			errorObject := value.(map[string]any)
			if errorObject["message"] == "deferred mood failed" {
				propagated = errorObject
				break
			}
		}
		require.NotNil(t, propagated)
		require.Equal(t, map[string]any{"code": "MOOD_FAIL", "detail": "deferred"}, propagated["extensions"])

		extensions := requireDeferARTExtensions(t, terminal)
		require.Equal(t, map[string]string{"Mood": "error"}, deferARTStatuses(extensions["trace"]))
		require.Equal(t, int64(1), xEnv.SubgraphRequestCount.Employees.Load())
		require.Equal(t, int64(1), xEnv.SubgraphRequestCount.Mood.Load())

		final := reconstructDeferARTSnapshot(t, body)
		rootErrors := final["errors"].([]any)
		require.NotEmpty(t, rootErrors)
		var reconstructedError map[string]any
		for _, value := range rootErrors {
			errorObject := value.(map[string]any)
			if errorObject["message"] == "deferred mood failed" {
				reconstructedError = errorObject
				break
			}
		}
		require.NotNil(t, reconstructedError)
		require.Equal(t, map[string]any{"code": "MOOD_FAIL", "detail": "deferred"}, reconstructedError["extensions"])
	})
}

func TestDeferARTExtensionPolicySpansPrimaryAndDeferredPhases(t *testing.T) {
	for _, test := range []struct {
		name      string
		algorithm config.SubgraphExtensionPropagationAlgorithm
		want      string
	}{
		{name: "first write keeps primary", algorithm: config.SubgraphExtensionPropagationAlgorithmFirstWrite, want: "primary"},
		{name: "last write accepts deferred", algorithm: config.SubgraphExtensionPropagationAlgorithmLastWrite, want: "deferred"},
	} {
		t.Run(test.name, func(t *testing.T) {
			observedRequests := newDeferARTRequestObserver()
			testenv.Run(t, &testenv.Config{
				ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
					cfg.EnableRequestTracing = true
				},
				ModifySubgraphExtensionPropagation: func(cfg *config.SubgraphExtensionPropagationConfiguration) {
					*cfg = config.SubgraphExtensionPropagationConfiguration{
						Enabled:                true,
						Algorithm:              test.algorithm,
						AllowedExtensionFields: []string{"winner", "trace", "queryPlan"},
					}
				},
				Subgraphs: testenv.SubgraphsConfig{
					Employees: testenv.SubgraphConfig{Middleware: deferARTObserveAndInject(
						t, observedRequests, "employees", `{"winner":"primary","notAllowed":"primary","trace":"spoofed","queryPlan":"spoofed"}`,
					)},
					Availability: testenv.SubgraphConfig{Middleware: deferARTObserveAndInject(
						t, observedRequests, "availability", `{"winner":"deferred","notAllowed":"deferred","trace":"spoofed","queryPlan":"spoofed"}`,
					)},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				body, _ := executeDeferARTRequest(t, xEnv, testenv.GraphQLRequest{
					Query: `query ExtensionPolicyDeferART {
						employees {
							id
							... @defer(label: "Availability") { isAvailable }
						}
					}`,
				})
				parts := decodeDeferARTParts(t, body)
				require.Len(t, parts, 2)

				initialExtensions := requireDeferARTExtensions(t, parts[0])
				require.Equal(t, "primary", initialExtensions["winner"])
				require.NotContains(t, initialExtensions, "notAllowed")
				require.IsType(t, map[string]any{}, initialExtensions["trace"])
				require.IsType(t, map[string]any{}, initialExtensions["queryPlan"])

				terminalExtensions := requireDeferARTExtensions(t, parts[1])
				require.Equal(t, test.want, terminalExtensions["winner"])
				require.NotContains(t, terminalExtensions, "notAllowed")
				require.IsType(t, map[string]any{}, terminalExtensions["trace"])
				require.IsType(t, map[string]any{}, terminalExtensions["queryPlan"])
				require.Equal(t, map[string]string{"Availability": "completed"}, deferARTStatuses(terminalExtensions["trace"]))

				require.Equal(t, int64(1), xEnv.SubgraphRequestCount.Employees.Load())
				require.Equal(t, int64(1), xEnv.SubgraphRequestCount.Availability.Load())
			})
		})
	}
}

func TestReconstructDeferARTSnapshotShallowMergesPartExtensions(t *testing.T) {
	body := []byte("\r\n--graphql\r\nContent-Type: application/json\r\n\r\n" +
		`{"data":{"root":{"fast":"ready"}},"pending":[{"id":"1","path":["root"]}],"extensions":{"initialOnly":true,"custom":{"old":true},"trace":{"state":"partial"}},"hasNext":true}` +
		"\r\n\r\n\r\n--graphql\r\nContent-Type: application/json\r\n\r\n" +
		`{"incremental":[{"id":"1","data":{"slow":"done"}}],"completed":[{"id":"1"}],"extensions":{"terminalOnly":true,"custom":{"new":true},"trace":{"state":"complete"}},"hasNext":false}` +
		"\r\n\r\n\r\n--graphql--")

	reconstructed, err := reconstructDeferResponse(body)
	require.NoError(t, err)
	var snapshot map[string]any
	require.NoError(t, json.Unmarshal(reconstructed, &snapshot))
	require.JSONEq(t, `{"root":{"fast":"ready","slow":"done"}}`, mustDeferARTJSON(t, snapshot["data"]))
	require.Equal(t, map[string]any{
		"initialOnly":  true,
		"terminalOnly": true,
		"custom":       map[string]any{"new": true},
		"trace":        map[string]any{"state": "complete"},
	}, snapshot["extensions"])
	require.NotContains(t, snapshot, "hasNext")
	require.NotContains(t, snapshot, "pending")
}

type deferARTRequestObserver struct {
	mu       sync.Mutex
	bySource map[string][]json.RawMessage
}

func newDeferARTRequestObserver() *deferARTRequestObserver {
	return &deferARTRequestObserver{bySource: make(map[string][]json.RawMessage)}
}

func (o *deferARTRequestObserver) record(source string, extensions json.RawMessage) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.bySource[source] = append(o.bySource[source], bytes.Clone(extensions))
}

func (o *deferARTRequestObserver) extensions(source string) []json.RawMessage {
	o.mu.Lock()
	defer o.mu.Unlock()
	return append([]json.RawMessage(nil), o.bySource[source]...)
}

func deferARTObserveAndInject(
	t *testing.T,
	observer *deferARTRequestObserver,
	source string,
	responseExtensions string,
) func(http.Handler) http.Handler {
	t.Helper()
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			requestBody, err := io.ReadAll(r.Body)
			if err != nil {
				t.Errorf("read %s request body: %v", source, err)
				http.Error(w, "failed to read request", http.StatusInternalServerError)
				return
			}
			r.Body = io.NopCloser(bytes.NewReader(requestBody))

			var request struct {
				Extensions json.RawMessage `json:"extensions"`
			}
			if err := json.Unmarshal(requestBody, &request); err != nil {
				t.Errorf("decode %s request body: %v", source, err)
				http.Error(w, "failed to decode request", http.StatusInternalServerError)
				return
			}
			observer.record(source, request.Extensions)

			recorder := httptest.NewRecorder()
			next.ServeHTTP(recorder, r)

			var response map[string]json.RawMessage
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Errorf("decode %s response body: %v", source, err)
				http.Error(w, "failed to decode response", http.StatusInternalServerError)
				return
			}
			response["extensions"] = json.RawMessage(responseExtensions)
			responseBody, err := json.Marshal(response)
			if err != nil {
				t.Errorf("encode %s response body: %v", source, err)
				http.Error(w, "failed to encode response", http.StatusInternalServerError)
				return
			}

			for name, values := range recorder.Header() {
				for _, value := range values {
					w.Header().Add(name, value)
				}
			}
			w.WriteHeader(recorder.Code)
			if _, err := w.Write(responseBody); err != nil {
				t.Errorf("write %s response body: %v", source, err)
			}
		})
	}
}

func executeDeferARTRequest(t *testing.T, xEnv *testenv.Environment, request testenv.GraphQLRequest) ([]byte, string) {
	t.Helper()
	payload, err := json.Marshal(request)
	require.NoError(t, err)
	req := xEnv.MakeGraphQLDeferRequest(http.MethodPost, bytes.NewReader(payload))
	req.Header.Set("X-WG-Trace", "true")
	req.Header.Set("X-WG-Include-Query-Plan", "true")

	res, err := xEnv.RouterClient.Do(req)
	require.NoError(t, err)
	defer func() { require.NoError(t, res.Body.Close()) }()
	require.Equal(t, http.StatusOK, res.StatusCode)
	body, err := io.ReadAll(res.Body)
	require.NoError(t, err)
	return body, res.Header.Get("Content-Type")
}

func decodeDeferARTParts(t *testing.T, body []byte) []map[string]any {
	t.Helper()
	rawParts := parseMultipartParts(body)
	parts := make([]map[string]any, 0, len(rawParts))
	for index, raw := range rawParts {
		var part map[string]any
		require.NoError(t, json.Unmarshal(raw, &part), "part %d: %s", index, raw)
		parts = append(parts, part)
	}
	return parts
}

func requireDeferARTExtensions(t *testing.T, part map[string]any) map[string]any {
	t.Helper()
	extensions, ok := part["extensions"].(map[string]any)
	require.True(t, ok, "missing extensions in %#v", part)
	return extensions
}

func mustDeferARTJSON(t *testing.T, value any) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	require.NoError(t, err)
	return string(encoded)
}

func deferARTFetchCounts(value any, sourceKey string) map[string]int {
	counts := make(map[string]int)
	var walk func(any)
	walk = func(value any) {
		switch node := value.(type) {
		case map[string]any:
			if fetch, ok := node["fetch"].(map[string]any); ok {
				if source, ok := fetch[sourceKey].(string); ok {
					counts[source]++
				}
			}
			for key, child := range node {
				if key != "fetch" {
					walk(child)
				}
			}
		case []any:
			for _, child := range node {
				walk(child)
			}
		}
	}
	walk(value)
	return counts
}

func deferARTStatuses(value any) map[string]string {
	statuses := make(map[string]string)
	var walk func(any)
	walk = func(value any) {
		switch node := value.(type) {
		case map[string]any:
			if descriptor, ok := node["defer"].(map[string]any); ok {
				label, labelOK := descriptor["label"].(string)
				status, statusOK := descriptor["status"].(string)
				if labelOK && statusOK {
					statuses[label] = status
				}
			}
			for _, child := range node {
				walk(child)
			}
		case []any:
			for _, child := range node {
				walk(child)
			}
		}
	}
	walk(value)
	return statuses
}

func deferARTBranch(value any, label string) map[string]any {
	switch node := value.(type) {
	case map[string]any:
		if descriptor, ok := node["defer"].(map[string]any); ok && descriptor["label"] == label {
			return node
		}
		for _, child := range node {
			if branch := deferARTBranch(child, label); branch != nil {
				return branch
			}
		}
	case []any:
		for _, child := range node {
			if branch := deferARTBranch(child, label); branch != nil {
				return branch
			}
		}
	}
	return nil
}

func reconstructDeferARTSnapshot(t *testing.T, body []byte) map[string]any {
	t.Helper()
	reconstructed, err := reconstructDeferResponse(body)
	require.NoError(t, err)
	var snapshot map[string]any
	require.NoError(t, json.Unmarshal(reconstructed, &snapshot))
	return snapshot
}
