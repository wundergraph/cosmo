package core

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDeferAdvisorReplayExecutorFetchesThePlanModel(t *testing.T) {
	t.Parallel()

	var calls int
	executor := newDeferAdvisorReplayExecutor(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		assert.Equal(t, "true", r.Header.Get("X-WG-Include-Query-Plan"))
		assert.Equal(t, "true", r.Header.Get("X-WG-Skip-Loader"))
		assert.Empty(t, r.Header.Get(RequestTraceHeader))
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_, _ = w.Write([]byte(advisorPlanResponseJSON()))
	}))
	parent, budget := advisorPhaseRequest(t, 1)

	fetches, err := executor.fetchPlanModel(parent, []byte(`{"query":"query { products { slow } }"}`))

	require.NoError(t, err)
	require.Len(t, fetches, 2)
	assert.Equal(t, 0, fetches[0].fetchID)
	assert.Equal(t, []string{"products"}, fetches[0].fields)
	assert.Equal(t, 1, fetches[1].fetchID)
	assert.Equal(t, []string{"slow", "fast"}, fetches[1].fields)
	assert.Equal(t, []string{"products"}, fetches[1].clientParentPath)
	assert.Equal(t, 1, calls)
	assert.Equal(t, uint32(1), budget.used.Load())
}

func TestDeferAdvisorReplayExecutorRejectsInvalidPlanResponses(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		status      int
		contentType string
		body        string
		errContains string
	}{
		{
			name:        "status",
			status:      http.StatusServiceUnavailable,
			contentType: "application/json",
			body:        `{"errors":[{"message":"unavailable"}]}`,
			errContains: `defer advisor plan replay returned HTTP status 503: {"errors":[{"message":"unavailable"}]}`,
		},
		{
			name:        "missing content type",
			body:        advisorPlanResponseJSON(),
			errContains: `defer advisor plan replay returned Content-Type ""; expected application/json`,
		},
		{
			name:        "wrong content type",
			contentType: "text/plain",
			body:        advisorPlanResponseJSON(),
			errContains: `defer advisor plan replay returned Content-Type "text/plain"; expected application/json`,
		},
		{
			name:        "malformed content type",
			contentType: `application/json; charset="`,
			body:        advisorPlanResponseJSON(),
			errContains: `defer advisor plan replay returned Content-Type "application/json; charset=\""; expected application/json`,
		},
		{
			name:        "non object JSON",
			contentType: "application/json",
			body:        `[]`,
			errContains: "defer advisor plan replay response must be a JSON object",
		},
		{
			name:        "malformed JSON",
			contentType: "application/json",
			body:        `{"data":`,
			errContains: "defer advisor plan replay returned invalid JSON:",
		},
		{
			name:        "trailing JSON",
			contentType: "application/json",
			body:        advisorPlanResponseJSON() + `{}`,
			errContains: "defer advisor plan replay returned invalid JSON: trailing data after the response object",
		},
		{
			name:        "GraphQL errors",
			contentType: "application/json",
			body:        `{"data":null,"errors":[{"message":"planning failed"}],"extensions":{"queryPlan":{}}}`,
			errContains: "defer advisor plan replay returned GraphQL errors",
		},
		{
			name:        "invalid extensions on GraphQL errors",
			contentType: "application/json",
			body:        `{"data":null,"errors":[{"message":"planning failed"}],"extensions":[]}`,
			errContains: "defer advisor plan replay extensions must be a JSON object",
		},
		{
			name:        "malformed GraphQL errors",
			contentType: "application/json",
			body:        `{"data":null,"errors":[],"extensions":{"queryPlan":{}}}`,
			errContains: "defer advisor plan replay returned invalid errors: errors must be a non-empty array when present",
		},
		{
			name:        "missing data",
			contentType: "application/json",
			body:        `{"extensions":{"queryPlan":{}}}`,
			errContains: "defer advisor plan replay returned no data value",
		},
		{
			name:        "invalid data shape",
			contentType: "application/json",
			body:        `{"data":[],"extensions":{"queryPlan":{}}}`,
			errContains: "defer advisor plan replay data must be an object or null",
		},
		{
			name:        "missing extensions",
			contentType: "application/json",
			body:        `{"data":null}`,
			errContains: "defer advisor plan replay returned no extensions object",
		},
		{
			name:        "null extensions",
			contentType: "application/json",
			body:        `{"data":null,"extensions":null}`,
			errContains: "defer advisor plan replay extensions must be a JSON object",
		},
		{
			name:        "array extensions",
			contentType: "application/json",
			body:        `{"data":null,"extensions":[]}`,
			errContains: "defer advisor plan replay extensions must be a JSON object",
		},
		{
			name:        "missing query plan",
			contentType: "application/json",
			body:        `{"data":null,"extensions":{}}`,
			errContains: "defer advisor plan replay returned no query plan",
		},
		{
			name:        "null query plan",
			contentType: "application/json",
			body:        `{"data":null,"extensions":{"queryPlan":null}}`,
			errContains: "defer advisor plan replay query plan must be a JSON object",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			executor := newDeferAdvisorReplayExecutor(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				if test.contentType != "" {
					w.Header().Set("Content-Type", test.contentType)
				}
				if test.status != 0 {
					w.WriteHeader(test.status)
				}
				_, _ = w.Write([]byte(test.body))
			}))
			parent, budget := advisorPhaseRequest(t, 1)

			fetches, err := executor.fetchPlanModel(parent, []byte(`{"query":"query { products { slow } }"}`))

			require.Error(t, err)
			assert.Contains(t, err.Error(), test.errContains)
			assert.Nil(t, fetches)
			assert.Equal(t, uint32(1), budget.used.Load())
		})
	}
}

func TestDeferAdvisorReplayExecutorRunsBaselineSequentially(t *testing.T) {
	t.Parallel()

	responses := []string{
		advisorTraceResponseJSON(1_000_000, 5_000_000, `{"products":[{"slow":1}]}`, ""),
		advisorTraceResponseJSON(2_000_000, 6_000_000, `{"products":[{"slow":2}]}`, ""),
	}
	var calls int
	executor := newDeferAdvisorReplayExecutor(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Less(t, calls, len(responses))
		assert.Equal(t, []string{
			requestTraceOptionExcludeParseStats,
			requestTraceOptionExcludeNormalizeStats,
			requestTraceOptionExcludeValidateStats,
			requestTraceOptionExcludePlannerStats,
			requestTraceOptionExcludeRawInputData,
			requestTraceOptionExcludeInput,
			requestTraceOptionExcludeOutput,
		}, r.Header.Values(RequestTraceHeader))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(responses[calls]))
		calls++
	}))
	parent, budget := advisorPhaseRequest(t, 2)
	fetches := advisorPhaseFetchModel(t)

	result, err := executor.runBaseline(parent, []byte(`{"query":"query { products { slow } }"}`), 2, fetches)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Empty(t, result.inconclusiveReason)
	assert.JSONEq(t, `{"products":[{"slow":2}]}`, string(result.lastResponse.data))
	assert.Nil(t, result.lastResponse.errors)
	assert.Len(t, result.totalsMs, 2)
	for _, total := range result.totalsMs {
		assert.GreaterOrEqual(t, total, 0.0)
	}
	assert.Equal(t, []float64{1, 2}, fetches[0].durationsMs)
	assert.Equal(t, []float64{5, 6}, fetches[1].durationsMs)
	assert.Equal(t, 2, calls)
	assert.Equal(t, uint32(2), budget.used.Load())
}

func TestDeferAdvisorReplayExecutorReturnsAnInconclusiveBaselineOnGraphQLErrors(t *testing.T) {
	t.Parallel()

	executor := newDeferAdvisorReplayExecutor(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":null,"errors":[{"message":"subgraph failed","extensions":{"code":"DOWNSTREAM_ERROR"}}]}`))
	}))
	parent, budget := advisorPhaseRequest(t, 3)
	fetches := advisorPhaseFetchModel(t)
	fetches[0].durationsMs = []float64{99}

	result, err := executor.runBaseline(parent, []byte(`{"query":"query { products { slow } }"}`), 3, fetches)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, advisorBaselineInconclusiveGraphQLErrors, result.inconclusiveReason)
	assert.JSONEq(t, `null`, string(result.lastResponse.data))
	assert.JSONEq(t, `[{"message":"subgraph failed","extensions":{"code":"DOWNSTREAM_ERROR"}}]`, string(result.lastResponse.errors))
	assert.Empty(t, result.totalsMs)
	assert.Equal(t, []float64{99}, fetches[0].durationsMs)
	assert.Empty(t, fetches[1].durationsMs)
	assert.Equal(t, uint32(1), budget.used.Load())
}

func TestDeferAdvisorReplayExecutorAcceptsAnErrorsOnlyInconclusiveBaseline(t *testing.T) {
	t.Parallel()

	executor := newDeferAdvisorReplayExecutor(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"errors":[{"message":"request failed"}]}`))
	}))
	parent, budget := advisorPhaseRequest(t, 1)
	fetches := advisorPhaseFetchModel(t)

	result, err := executor.runBaseline(parent, []byte(`{"query":"query { products { slow } }"}`), 1, fetches)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, advisorBaselineInconclusiveGraphQLErrors, result.inconclusiveReason)
	assert.Nil(t, result.lastResponse.data)
	assert.JSONEq(t, `[{"message":"request failed"}]`, string(result.lastResponse.errors))
	assert.Empty(t, result.totalsMs)
	assert.Empty(t, fetches[0].durationsMs)
	assert.Empty(t, fetches[1].durationsMs)
	assert.Equal(t, uint32(1), budget.used.Load())
}

func TestDeferAdvisorReplayExecutorRejectsInvalidBaselineResponses(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		status      int
		contentType string
		body        string
		errContains string
	}{
		{
			name:        "status",
			status:      http.StatusBadGateway,
			contentType: "application/json",
			body:        `upstream unavailable`,
			errContains: "defer advisor baseline replay 1 of 1 returned HTTP status 502: upstream unavailable",
		},
		{
			name:        "content type",
			contentType: "application/graphql-response+json",
			body:        advisorTraceResponseJSON(1, 1, `null`, ""),
			errContains: `defer advisor baseline replay 1 of 1 returned Content-Type "application/graphql-response+json"; expected application/json`,
		},
		{
			name:        "missing data",
			contentType: "application/json",
			body:        `{"extensions":{"trace":{}}}`,
			errContains: "defer advisor baseline replay 1 of 1 returned no data value",
		},
		{
			name:        "invalid data",
			contentType: "application/json",
			body:        `{"data":[],"extensions":{"trace":{}}}`,
			errContains: "defer advisor baseline replay 1 of 1 data must be an object or null",
		},
		{
			name:        "invalid errors",
			contentType: "application/json",
			body:        `{"data":null,"errors":null}`,
			errContains: "defer advisor baseline replay 1 of 1 returned invalid errors: errors must be a non-empty array when present",
		},
		{
			name:        "missing extensions",
			contentType: "application/json",
			body:        `{"data":null}`,
			errContains: "defer advisor baseline replay 1 of 1 returned no extensions object",
		},
		{
			name:        "null extensions",
			contentType: "application/json",
			body:        `{"data":null,"extensions":null}`,
			errContains: "defer advisor baseline replay 1 of 1 extensions must be a JSON object",
		},
		{
			name:        "invalid extensions on GraphQL error",
			contentType: "application/json",
			body:        `{"data":null,"errors":[{"message":"failed"}],"extensions":[]}`,
			errContains: "defer advisor baseline replay 1 of 1 extensions must be a JSON object",
		},
		{
			name:        "missing trace",
			contentType: "application/json",
			body:        `{"data":null,"extensions":{}}`,
			errContains: "defer advisor baseline replay 1 of 1 returned no trace",
		},
		{
			name:        "null trace",
			contentType: "application/json",
			body:        `{"data":null,"extensions":{"trace":null}}`,
			errContains: "defer advisor baseline replay 1 of 1 trace must be a JSON object",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			executor := newDeferAdvisorReplayExecutor(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				if test.contentType != "" {
					w.Header().Set("Content-Type", test.contentType)
				}
				if test.status != 0 {
					w.WriteHeader(test.status)
				}
				_, _ = w.Write([]byte(test.body))
			}))
			parent, budget := advisorPhaseRequest(t, 1)
			fetches := advisorPhaseFetchModel(t)

			result, err := executor.runBaseline(parent, []byte(`{"query":"query { products { slow } }"}`), 1, fetches)

			require.Error(t, err)
			assert.Contains(t, err.Error(), test.errContains)
			assert.Nil(t, result)
			assert.Empty(t, fetches[0].durationsMs)
			assert.Empty(t, fetches[1].durationsMs)
			assert.Equal(t, uint32(1), budget.used.Load())
		})
	}
}

func TestDeferAdvisorReplayExecutorDoesNotPartiallyCommitBaselineMeasurements(t *testing.T) {
	t.Parallel()

	responses := []string{
		advisorTraceResponseJSON(1_000_000, 5_000_000, `{"products":[]}`, ""),
		`{"data":{"products":[]},"extensions":{}}`,
	}
	var calls int
	executor := newDeferAdvisorReplayExecutor(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(responses[calls]))
		calls++
	}))
	parent, budget := advisorPhaseRequest(t, 2)
	fetches := advisorPhaseFetchModel(t)
	fetches[0].durationsMs = []float64{91}
	fetches[1].durationsMs = []float64{92}

	result, err := executor.runBaseline(parent, []byte(`{"query":"query { products { slow } }"}`), 2, fetches)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "defer advisor baseline replay 2 of 2 returned no trace")
	assert.Nil(t, result)
	assert.Equal(t, []float64{91}, fetches[0].durationsMs)
	assert.Equal(t, []float64{92}, fetches[1].durationsMs)
	assert.Equal(t, uint32(2), budget.used.Load())
}

func TestDeferAdvisorReplayExecutorDoesNotCommitBaselineWhenTheBudgetEndsMidPhase(t *testing.T) {
	t.Parallel()

	var calls int
	executor := newDeferAdvisorReplayExecutor(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(advisorTraceResponseJSON(1_000_000, 5_000_000, `{"products":[]}`, "")))
	}))
	parent, budget := advisorPhaseRequest(t, 1)
	fetches := advisorPhaseFetchModel(t)
	fetches[0].durationsMs = []float64{91}
	fetches[1].durationsMs = []float64{92}

	result, err := executor.runBaseline(parent, []byte(`{"query":"query { products { slow } }"}`), 2, fetches)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "defer advisor baseline replay 2 of 2 failed: defer advisor replay budget exhausted after 1 loopbacks")
	assert.Nil(t, result)
	assert.Equal(t, []float64{91}, fetches[0].durationsMs)
	assert.Equal(t, []float64{92}, fetches[1].durationsMs)
	assert.Equal(t, 1, calls)
	assert.Equal(t, uint32(1), budget.used.Load())
}

func TestDeferAdvisorReplayExecutorAttributesAOneIDListStream(t *testing.T) {
	t.Parallel()

	var calls int
	executor := newDeferAdvisorReplayExecutor(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		assert.Equal(t, "multipart/mixed; deferSpec=20220824", r.Header.Get("Accept"))
		body := new(bytes.Buffer)
		_, err := body.ReadFrom(r.Body)
		require.NoError(t, err)
		var request graphqlRequestBody
		require.NoError(t, json.Unmarshal(body.Bytes(), &request))
		assert.Equal(t, "query Split { products { slow } }", request.Query)
		assert.JSONEq(t, `{"includeSlow":true}`, string(request.Variables))

		writeAdvisorMultipartSegments(t, w,
			advisorDeferDataSegment(0, true, `{"data":{"products":[{},{}]},"pending":[{"id":"1","path":["products"],"label":"adv_1_slow"}],"hasNext":true}`),
			advisorDeferDataSegment(0, false, `{"incremental":[{"id":"1","subPath":[0],"data":{"slow":1}},{"id":"1","subPath":[1],"data":{"slow":2}}],"completed":[{"id":"1"}],"hasNext":false}`),
			advisorDeferCloseSegment(0),
		)
	}))
	parent, budget := advisorPhaseRequest(t, 1)
	fetches := advisorPhaseFetchModel(t)
	fetches[1].fields = []string{"slow"}
	request := graphqlRequestBody{
		Query:     "query Original { products { slow } }",
		Variables: json.RawMessage(`{"includeSlow":true}`),
	}

	err := executor.runMaxSplit(parent, request, "query Split { products { slow } }", 1, fetches)

	require.NoError(t, err)
	assert.Equal(t, 1, calls)
	assert.Equal(t, uint32(1), budget.used.Load())
	require.Contains(t, fetches[1].fieldLatenciesMs, "slow")
	require.Len(t, fetches[1].fieldLatenciesMs["slow"], 1)
	assert.GreaterOrEqual(t, fetches[1].fieldLatenciesMs["slow"][0], 0.0)
	assert.NotContains(t, fetches[1].fieldLatenciesMs, "adv_1_slow")
}

func TestDeferAdvisorReplayExecutorRejectsInvalidMaxSplitResponses(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		status      int
		contentType string
		segments    []loopbackSegment
		body        string
		errContains string
	}{
		{
			name:        "status",
			status:      http.StatusBadGateway,
			contentType: "application/json",
			body:        `upstream unavailable`,
			errContains: "defer advisor max-split replay 1 of 1 returned HTTP status 502: upstream unavailable",
		},
		{
			name:        "missing content type",
			segments:    advisorOneLabelSegments("adv_1_slow"),
			errContains: `defer advisor max-split replay 1 of 1 returned Content-Type ""; expected multipart/mixed; deferSpec=20220824; boundary=graphql`,
		},
		{
			name:        "wrong media type",
			contentType: "application/json",
			segments:    advisorOneLabelSegments("adv_1_slow"),
			errContains: `defer advisor max-split replay 1 of 1 returned Content-Type "application/json"; expected multipart/mixed; deferSpec=20220824; boundary=graphql`,
		},
		{
			name:        "missing defer spec",
			contentType: `multipart/mixed; boundary="graphql"`,
			segments:    advisorOneLabelSegments("adv_1_slow"),
			errContains: `expected multipart/mixed; deferSpec=20220824; boundary=graphql`,
		},
		{
			name:        "wrong boundary",
			contentType: `multipart/mixed; deferSpec=20220824; boundary="other"`,
			segments:    advisorOneLabelSegments("adv_1_slow"),
			errContains: `expected multipart/mixed; deferSpec=20220824; boundary=graphql`,
		},
		{
			name:        "extra parameter",
			contentType: `multipart/mixed; deferSpec=20220824; boundary="graphql"; charset=utf-8`,
			segments:    advisorOneLabelSegments("adv_1_slow"),
			errContains: `expected multipart/mixed; deferSpec=20220824; boundary=graphql`,
		},
		{
			name:        "GraphQL errors",
			contentType: `multipart/mixed; deferSpec=20220824; boundary="graphql"`,
			segments: []loopbackSegment{
				advisorDeferDataSegment(0, true, `{"data":null,"errors":[{"message":"failed"}],"hasNext":false}`),
				advisorDeferCloseSegment(0),
			},
			errContains: "defer advisor multipart part 1 contains GraphQL errors",
		},
		{
			name:        "missing label",
			contentType: `multipart/mixed; deferSpec=20220824; boundary="graphql"`,
			segments:    advisorOneLabelSegments("adv_1_slow"),
			errContains: `label set mismatch: missing ["adv_1_fast"]; unexpected []`,
		},
		{
			name:        "unknown label",
			contentType: `multipart/mixed; deferSpec=20220824; boundary="graphql"`,
			segments:    advisorLabelsSegments("adv_1_fast", "adv_1_slow", "unknown"),
			errContains: `label set mismatch: missing []; unexpected ["unknown"]`,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			executor := newDeferAdvisorReplayExecutor(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				if test.contentType != "" {
					w.Header().Set("Content-Type", test.contentType)
				}
				if test.status != 0 {
					w.WriteHeader(test.status)
				}
				if test.body != "" {
					_, _ = w.Write([]byte(test.body))
					return
				}
				writeAdvisorRawSegments(t, w, test.segments...)
			}))
			parent, budget := advisorPhaseRequest(t, 1)
			fetches := advisorPhaseFetchModel(t)

			err := executor.runMaxSplit(parent, graphqlRequestBody{Query: "query { products { slow fast } }"}, "query Split { products { slow fast } }", 1, fetches)

			require.Error(t, err)
			assert.Contains(t, err.Error(), test.errContains)
			assert.Nil(t, fetches[1].fieldLatenciesMs)
			assert.Equal(t, uint32(1), budget.used.Load())
		})
	}
}

func TestDeferAdvisorReplayExecutorDoesNotPartiallyCommitMaxSplitMeasurements(t *testing.T) {
	t.Parallel()

	responses := [][]loopbackSegment{
		advisorLabelsSegments("adv_1_fast", "adv_1_slow"),
		advisorLabelsSegments("adv_1_fast", "adv_1_slow", "unknown"),
	}
	var calls int
	executor := newDeferAdvisorReplayExecutor(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", `multipart/mixed; deferSpec=20220824; boundary="graphql"`)
		writeAdvisorRawSegments(t, w, responses[calls]...)
		calls++
	}))
	parent, budget := advisorPhaseRequest(t, 2)
	fetches := advisorPhaseFetchModel(t)
	fetches[1].fieldLatenciesMs = map[string][]float64{"slow": {99}}

	err := executor.runMaxSplit(parent, graphqlRequestBody{Query: "query { products { slow fast } }"}, "query Split { products { slow fast } }", 2, fetches)

	require.Error(t, err)
	assert.Contains(t, err.Error(), `defer advisor max-split replay 2 of 2 label set mismatch: missing []; unexpected ["unknown"]`)
	assert.Equal(t, map[string][]float64{"slow": {99}}, fetches[1].fieldLatenciesMs)
	assert.Equal(t, 2, calls)
	assert.Equal(t, uint32(2), budget.used.Load())
}

func TestDeferAdvisorReplayExecutorDoesNotCommitMaxSplitWhenTheBudgetEndsMidPhase(t *testing.T) {
	t.Parallel()

	var calls int
	executor := newDeferAdvisorReplayExecutor(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		writeAdvisorMultipartSegments(t, w, advisorLabelsSegments("adv_1_fast", "adv_1_slow")...)
	}))
	parent, budget := advisorPhaseRequest(t, 1)
	fetches := advisorPhaseFetchModel(t)
	fetches[1].fieldLatenciesMs = map[string][]float64{"slow": {99}}

	err := executor.runMaxSplit(parent, graphqlRequestBody{}, "query Split { products { slow fast } }", 2, fetches)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "defer advisor max-split replay 2 of 2 failed: defer advisor replay budget exhausted after 1 loopbacks")
	assert.Equal(t, map[string][]float64{"slow": {99}}, fetches[1].fieldLatenciesMs)
	assert.Equal(t, 1, calls)
	assert.Equal(t, uint32(1), budget.used.Load())
}

func TestDeferAdvisorReplayExecutorRunsOptimizedStreamsSequentially(t *testing.T) {
	t.Parallel()

	var calls int
	executor := newDeferAdvisorReplayExecutor(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		assert.Equal(t, "multipart/mixed; deferSpec=20220824", r.Header.Get("Accept"))
		var request graphqlRequestBody
		require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
		assert.Equal(t, "query Optimized { products { slow } }", request.Query)
		writeAdvisorMultipartSegments(t, w, advisorOneLabelSegments("details")...)
	}))
	parent, budget := advisorPhaseRequest(t, 2)

	runs, err := executor.runOptimized(
		parent,
		graphqlRequestBody{Query: "query Original { products { slow } }"},
		"query Optimized { products { slow } }",
		2,
	)

	require.NoError(t, err)
	require.Len(t, runs, 2)
	for _, run := range runs {
		require.NotNil(t, run)
		assert.Contains(t, run.arrivals, "details")
		assert.GreaterOrEqual(t, run.terminalAt, run.initialAt)
		assert.GreaterOrEqual(t, run.closedAt, run.terminalAt)
	}
	assert.Equal(t, 2, calls)
	assert.Equal(t, uint32(2), budget.used.Load())
}

func TestDeferAdvisorReplayExecutorReturnsNoPartialOptimizedRuns(t *testing.T) {
	t.Parallel()

	var calls int
	executor := newDeferAdvisorReplayExecutor(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		if calls == 2 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadGateway)
			_, _ = w.Write([]byte(`failed`))
			return
		}
		writeAdvisorMultipartSegments(t, w, advisorOneLabelSegments("details")...)
	}))
	parent, budget := advisorPhaseRequest(t, 2)

	runs, err := executor.runOptimized(
		parent,
		graphqlRequestBody{Query: "query Original { products { slow } }"},
		"query Optimized { products { slow } }",
		2,
	)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "defer advisor optimized replay 2 of 2 returned HTTP status 502: failed")
	assert.Nil(t, runs)
	assert.Equal(t, 2, calls)
	assert.Equal(t, uint32(2), budget.used.Load())
}

func TestDeferAdvisorReplayExecutorRejectsNonPositiveRunCountsWithoutReplaying(t *testing.T) {
	t.Parallel()

	var calls int
	executor := newDeferAdvisorReplayExecutor(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		calls++
	}))
	parent, budget := advisorPhaseRequest(t, 3)
	fetches := advisorPhaseFetchModel(t)

	baseline, baselineErr := executor.runBaseline(parent, nil, 0, fetches)
	splitErr := executor.runMaxSplit(parent, graphqlRequestBody{}, "query Split { products { slow } }", 0, fetches)
	optimized, optimizedErr := executor.runOptimized(parent, graphqlRequestBody{}, "query Optimized { products { slow } }", 0)

	assert.Nil(t, baseline)
	require.EqualError(t, baselineErr, "defer advisor baseline runs must be positive")
	require.EqualError(t, splitErr, "defer advisor max-split runs must be positive")
	assert.Nil(t, optimized)
	require.EqualError(t, optimizedErr, "defer advisor optimized runs must be positive")
	assert.Zero(t, calls)
	assert.Equal(t, uint32(0), budget.used.Load())
}

func writeAdvisorMultipartSegments(t *testing.T, w http.ResponseWriter, segments ...loopbackSegment) {
	t.Helper()
	w.Header().Set("Content-Type", `multipart/mixed; deferSpec=20220824; boundary="graphql"`)
	writeAdvisorRawSegments(t, w, segments...)
}

func writeAdvisorRawSegments(t *testing.T, w http.ResponseWriter, segments ...loopbackSegment) {
	t.Helper()
	flusher, ok := w.(http.Flusher)
	require.True(t, ok)
	for _, segment := range segments {
		_, err := w.Write(segment.body)
		require.NoError(t, err)
		flusher.Flush()
	}
}

func advisorOneLabelSegments(label string) []loopbackSegment {
	return advisorLabelsSegments(label)
}

func advisorLabelsSegments(labels ...string) []loopbackSegment {
	pending := make([]map[string]any, 0, len(labels))
	incremental := make([]map[string]any, 0, len(labels))
	completed := make([]map[string]any, 0, len(labels))
	for i, label := range labels {
		id := fmt.Sprint(i + 1)
		pending = append(pending, map[string]any{"id": id, "path": []any{"products"}, "label": label})
		incremental = append(incremental, map[string]any{"id": id, "data": map[string]any{"value": i + 1}})
		completed = append(completed, map[string]any{"id": id})
	}
	initial, _ := json.Marshal(map[string]any{"data": map[string]any{"products": []any{}}, "pending": pending, "hasNext": true})
	terminal, _ := json.Marshal(map[string]any{"incremental": incremental, "completed": completed, "hasNext": false})
	return []loopbackSegment{
		advisorDeferDataSegment(0, true, string(initial)),
		advisorDeferDataSegment(0, false, string(terminal)),
		advisorDeferCloseSegment(0),
	}
}

func advisorPhaseFetchModel(t *testing.T) []*advisorFetch {
	t.Helper()
	var envelope struct {
		Extensions struct {
			QueryPlan json.RawMessage `json:"queryPlan"`
		} `json:"extensions"`
	}
	require.NoError(t, json.Unmarshal([]byte(advisorPlanResponseJSON()), &envelope))
	var plan advisorQueryPlanNode
	require.NoError(t, json.Unmarshal(envelope.Extensions.QueryPlan, &plan))
	fetches, err := buildFetchModel(&plan)
	require.NoError(t, err)
	return fetches
}

func advisorPhaseRequest(t *testing.T, replayLimit uint32) (*http.Request, *deferAdvisorReplayBudget) {
	t.Helper()
	budget := newDeferAdvisorReplayBudget(replayLimit)
	ctx := withDeferAdvisorReplayBudget(context.Background(), budget)
	return advisorRunnerRequest(t, ctx), budget
}

func advisorPlanResponseJSON() string {
	return `{
		"data": null,
		"extensions": {
			"queryPlan": {
				"kind": "Sequence",
				"children": [
					{"kind":"Single","fetch":{"kind":"Single","path":"","subgraphName":"products","fetchId":0,"query":"{ products { __typename } }"}},
					{"kind":"Single","fetch":{"kind":"BatchEntity","path":"products.@","subgraphName":"details","fetchId":1,"dependsOnFetchIds":[0],"query":"query($representations: [_Any!]!){ _entities(representations: $representations) { ... on Product { slow fast } } }"}}
				]
			}
		}
	}`
}

func advisorTraceResponseJSON(rootNanos, detailsNanos int64, data string, errors string) string {
	if data == "" {
		data = `null`
	}
	errorField := ""
	if errors != "" {
		errorField = fmt.Sprintf(`,"errors":%s`, errors)
	}
	return fmt.Sprintf(`{
		"data": %s%s,
		"extensions": {
			"trace": {
				"fetches": {
					"kind":"Sequence",
					"children":[
						{"kind":"Single","fetch":{"kind":"Single","path":"","source_name":"products","trace":{"duration_load_nanoseconds":%d}}},
						{"kind":"Single","fetch":{"kind":"BatchEntity","path":"products.@","source_name":"details","trace":{"duration_load_nanoseconds":%d}}}
					]
				}
			}
		}
	}`, data, errorField, rootNanos, detailsNanos)
}
