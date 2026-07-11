package core

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestWriteDeferAdvisorResponsePublishesOnlyTheAnalysisExtension(t *testing.T) {
	t.Parallel()

	envelope := &advisorResponseEnvelope{
		Data:   json.RawMessage(`{"value":null}`),
		Errors: json.RawMessage(`[{"message":"field failed","extensions":{"code":"UPSTREAM"}}]`),
	}
	envelope.Extensions.Trace = json.RawMessage(`{"version":"1","fetches":{}}`)
	envelope.Extensions.QueryPlan = json.RawMessage(`{"version":"1"}`)
	result := &deferAdvisorResult{
		Outcome:     deferAdvisorOutcomeInconclusive,
		Reason:      "baseline returned GraphQL errors",
		Runs:        1,
		Fetches:     []deferAdvisorFetchStats{},
		Fields:      []deferAdvisorFieldStats{},
		Suggestions: []deferAdvisorSuggestion{},
	}
	response := httptest.NewRecorder()

	writeDeferAdvisorResponse(response, envelope, result)

	assert.Equal(t, http.StatusOK, response.Code)
	assert.Equal(t, "application/json", response.Header().Get("Content-Type"))
	assert.JSONEq(t, `{
		"data":{"value":null},
		"errors":[{"message":"field failed","extensions":{"code":"UPSTREAM"}}],
		"extensions":{"deferAdvisor":{
			"outcome":"inconclusive",
			"reason":"baseline returned GraphQL errors",
			"runs":1,
			"totalDurationMs":{"avgMs":0,"minMs":0,"maxMs":0},
			"fetches":[],
			"fields":[],
			"suggestions":[]
		}}
	}`, response.Body.String())
	assert.NotContains(t, response.Body.String(), `"trace"`)
	assert.NotContains(t, response.Body.String(), `"queryPlan"`)
}

func TestWriteDeferAdvisorResponseOmitsAbsentBaselineErrors(t *testing.T) {
	t.Parallel()

	envelope := &advisorResponseEnvelope{Data: json.RawMessage(`null`)}
	result := &deferAdvisorResult{
		Outcome:     deferAdvisorOutcomeNoCandidates,
		Runs:        1,
		Fetches:     []deferAdvisorFetchStats{},
		Fields:      []deferAdvisorFieldStats{},
		Suggestions: []deferAdvisorSuggestion{},
	}
	response := httptest.NewRecorder()

	writeDeferAdvisorResponse(response, envelope, result)

	assert.NotContains(t, response.Body.String(), `"errors"`)
}
