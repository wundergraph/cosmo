package core

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"slices"
	"strings"
	"time"
)

type deferAdvisorReplayExecutor struct {
	runner deferAdvisorLoopbackRunner
}

func newDeferAdvisorReplayExecutor(target http.Handler) deferAdvisorReplayExecutor {
	return deferAdvisorReplayExecutor{runner: newDeferAdvisorLoopbackRunner(target)}
}

type advisorReplayResponseEnvelope struct {
	Data       json.RawMessage `json:"data"`
	Errors     json.RawMessage `json:"errors"`
	Extensions json.RawMessage `json:"extensions"`
}

type advisorReplayExtensions struct {
	Trace     json.RawMessage `json:"trace"`
	QueryPlan json.RawMessage `json:"queryPlan"`
}

type advisorReplayGraphQLResponse struct {
	data   json.RawMessage
	errors json.RawMessage
}

type advisorBaselineInconclusiveReason string

const advisorBaselineInconclusiveGraphQLErrors advisorBaselineInconclusiveReason = "graphql_errors"

type advisorBaselinePhaseResult struct {
	lastResponse       advisorReplayGraphQLResponse
	totalsMs           []float64
	inconclusiveReason advisorBaselineInconclusiveReason
}

type advisorSplitTarget struct {
	fetch *advisorFetch
	field string
}

func (e deferAdvisorReplayExecutor) fetchPlanModel(parent *http.Request, body []byte) ([]*advisorFetch, error) {
	recorder, _, err := e.runner.run(parent, body, func(request *http.Request) {
		request.Header.Set("X-WG-Include-Query-Plan", "true")
		request.Header.Set("X-WG-Skip-Loader", "true")
	})
	if err != nil {
		return nil, fmt.Errorf("defer advisor plan replay failed: %w", err)
	}

	var envelope advisorReplayResponseEnvelope
	if err := decodeAdvisorJSONReplay("plan replay", recorder, &envelope); err != nil {
		return nil, err
	}
	if envelope.Data == nil {
		return nil, fmt.Errorf("defer advisor plan replay returned no data value")
	}
	if !advisorGraphQLDataValid(envelope.Data) {
		return nil, fmt.Errorf("defer advisor plan replay data must be an object or null")
	}
	hasErrors, err := advisorRawErrorsPresent(envelope.Errors)
	if err != nil {
		return nil, fmt.Errorf("defer advisor plan replay returned invalid errors: %w", err)
	}
	if envelope.Extensions != nil && !advisorRawJSONObject(envelope.Extensions) {
		return nil, fmt.Errorf("defer advisor plan replay extensions must be a JSON object")
	}
	if hasErrors {
		return nil, fmt.Errorf("defer advisor plan replay returned GraphQL errors")
	}
	if envelope.Extensions == nil {
		return nil, fmt.Errorf("defer advisor plan replay returned no extensions object")
	}
	var extensions advisorReplayExtensions
	if err := json.Unmarshal(envelope.Extensions, &extensions); err != nil {
		return nil, fmt.Errorf("defer advisor plan replay returned invalid extensions: %w", err)
	}
	if extensions.QueryPlan == nil {
		return nil, fmt.Errorf("defer advisor plan replay returned no query plan")
	}
	if !advisorRawJSONObject(extensions.QueryPlan) {
		return nil, fmt.Errorf("defer advisor plan replay query plan must be a JSON object")
	}
	var plan advisorQueryPlanNode
	if err := json.Unmarshal(extensions.QueryPlan, &plan); err != nil {
		return nil, fmt.Errorf("defer advisor failed to parse query plan: %w", err)
	}
	fetches, err := buildFetchModel(&plan)
	if err != nil {
		return nil, fmt.Errorf("defer advisor failed to analyze query plan: %w", err)
	}
	return fetches, nil
}

func (e deferAdvisorReplayExecutor) runBaseline(parent *http.Request, body []byte, runs int, fetches []*advisorFetch) (*advisorBaselinePhaseResult, error) {
	if runs <= 0 {
		return nil, fmt.Errorf("defer advisor baseline runs must be positive")
	}

	measuredFetches := cloneAdvisorFetchStructure(fetches)
	result := &advisorBaselinePhaseResult{
		totalsMs: make([]float64, 0, runs),
	}
	for run := 1; run <= runs; run++ {
		recorder, elapsed, err := e.runner.run(parent, body, addAdvisorBaselineTraceHeaders)
		if err != nil {
			return nil, fmt.Errorf("defer advisor baseline replay %d of %d failed: %w", run, runs, err)
		}

		var envelope advisorReplayResponseEnvelope
		phase := fmt.Sprintf("baseline replay %d of %d", run, runs)
		if err := decodeAdvisorJSONReplay(phase, recorder, &envelope); err != nil {
			return nil, err
		}
		if envelope.Data == nil {
			return nil, fmt.Errorf("defer advisor %s returned no data value", phase)
		}
		if !advisorGraphQLDataValid(envelope.Data) {
			return nil, fmt.Errorf("defer advisor %s data must be an object or null", phase)
		}
		hasErrors, err := advisorRawErrorsPresent(envelope.Errors)
		if err != nil {
			return nil, fmt.Errorf("defer advisor %s returned invalid errors: %w", phase, err)
		}
		if envelope.Extensions != nil && !advisorRawJSONObject(envelope.Extensions) {
			return nil, fmt.Errorf("defer advisor %s extensions must be a JSON object", phase)
		}
		if hasErrors {
			return &advisorBaselinePhaseResult{
				lastResponse: advisorReplayGraphQLResponse{
					data:   slices.Clone(envelope.Data),
					errors: slices.Clone(envelope.Errors),
				},
				inconclusiveReason: advisorBaselineInconclusiveGraphQLErrors,
			}, nil
		}
		if envelope.Extensions == nil {
			return nil, fmt.Errorf("defer advisor %s returned no extensions object", phase)
		}
		var extensions advisorReplayExtensions
		if err := json.Unmarshal(envelope.Extensions, &extensions); err != nil {
			return nil, fmt.Errorf("defer advisor %s returned invalid extensions: %w", phase, err)
		}
		if extensions.Trace == nil {
			return nil, fmt.Errorf("defer advisor %s returned no trace", phase)
		}
		if !advisorRawJSONObject(extensions.Trace) {
			return nil, fmt.Errorf("defer advisor %s trace must be a JSON object", phase)
		}
		var trace advisorTraceEnvelope
		if err := json.Unmarshal(extensions.Trace, &trace); err != nil {
			return nil, fmt.Errorf("defer advisor %s returned an invalid trace: %w", phase, err)
		}
		if err := mergeTraceDurations(measuredFetches, trace.Fetches); err != nil {
			return nil, fmt.Errorf("defer advisor %s trace does not match the query plan: %w", phase, err)
		}

		result.totalsMs = append(result.totalsMs, advisorDurationMilliseconds(elapsed))
		result.lastResponse = advisorReplayGraphQLResponse{
			data:   slices.Clone(envelope.Data),
			errors: slices.Clone(envelope.Errors),
		}
	}
	for i := range fetches {
		fetches[i].durationsMs = append(fetches[i].durationsMs, measuredFetches[i].durationsMs...)
	}
	return result, nil
}

func (e deferAdvisorReplayExecutor) runMaxSplit(parent *http.Request, request graphqlRequestBody, query string, runs int, fetches []*advisorFetch) error {
	if runs <= 0 {
		return fmt.Errorf("defer advisor max-split runs must be positive")
	}
	targets, expectedLabels, err := advisorMaxSplitTargets(fetches)
	if err != nil {
		return err
	}
	if len(expectedLabels) == 0 {
		return fmt.Errorf("defer advisor max-split has no expected labels")
	}

	samples := make(map[advisorSplitTarget][]float64, len(targets))
	for run := 1; run <= runs; run++ {
		phase := fmt.Sprintf("max-split replay %d of %d", run, runs)
		measurement, err := e.runDefer(parent, request, query, phase)
		if err != nil {
			return err
		}
		if err := validateAdvisorDeferLabels(phase, measurement.arrivals, expectedLabels); err != nil {
			return err
		}
		for _, label := range expectedLabels {
			target := targets[label]
			latency := advisorDurationMilliseconds(measurement.arrivals[label] - measurement.initialAt)
			samples[target] = append(samples[target], latency)
		}
	}

	for _, label := range expectedLabels {
		target := targets[label]
		if target.fetch.fieldLatenciesMs == nil {
			target.fetch.fieldLatenciesMs = make(map[string][]float64)
		}
		target.fetch.fieldLatenciesMs[target.field] = append(target.fetch.fieldLatenciesMs[target.field], samples[target]...)
	}
	return nil
}

func (e deferAdvisorReplayExecutor) runOptimized(parent *http.Request, request graphqlRequestBody, query string, runs int) ([]*advisorDeferRun, error) {
	if runs <= 0 {
		return nil, fmt.Errorf("defer advisor optimized runs must be positive")
	}
	measurements := make([]*advisorDeferRun, 0, runs)
	for run := 1; run <= runs; run++ {
		phase := fmt.Sprintf("optimized replay %d of %d", run, runs)
		measurement, err := e.runDefer(parent, request, query, phase)
		if err != nil {
			return nil, err
		}
		measurements = append(measurements, measurement)
	}
	return measurements, nil
}

func (e deferAdvisorReplayExecutor) runDefer(parent *http.Request, request graphqlRequestBody, query, replay string) (*advisorDeferRun, error) {
	request.Query = query
	body, err := json.Marshal(request)
	if err != nil {
		return nil, fmt.Errorf("defer advisor %s request could not be encoded: %w", replay, err)
	}
	recorder, _, err := e.runner.run(parent, body, func(loopback *http.Request) {
		loopback.Header.Set("Accept", "multipart/mixed; deferSpec=20220824")
	})
	if err != nil {
		return nil, fmt.Errorf("defer advisor %s failed: %w", replay, err)
	}
	if recorder.status != http.StatusOK {
		return nil, fmt.Errorf(
			"defer advisor %s returned HTTP status %d: %s",
			replay,
			recorder.status,
			advisorReplayBodyForError(recorder.fullBody()),
		)
	}
	if err := validateAdvisorMultipartContentType(recorder.header.Get("Content-Type")); err != nil {
		return nil, fmt.Errorf("defer advisor %s %w", replay, err)
	}
	measurement, err := parseAdvisorDeferSegments(recorder.segments)
	if err != nil {
		return nil, fmt.Errorf("defer advisor %s returned an invalid stream: %w", replay, err)
	}
	return measurement, nil
}

func advisorMaxSplitTargets(fetches []*advisorFetch) (map[string]advisorSplitTarget, []string, error) {
	targets := make(map[string]advisorSplitTarget)
	var labels []string
	for i, fetch := range fetches {
		if fetch == nil {
			return nil, nil, fmt.Errorf("defer advisor max-split fetch %d is nil", i+1)
		}
		if len(fetch.dependsOn) == 0 {
			continue
		}
		for _, field := range fetch.fields {
			label := maxSplitLabel(fetch, field)
			if _, exists := targets[label]; exists {
				return nil, nil, fmt.Errorf("defer advisor max-split repeats label %q", label)
			}
			targets[label] = advisorSplitTarget{fetch: fetch, field: field}
			labels = append(labels, label)
		}
	}
	slices.Sort(labels)
	return targets, labels, nil
}

func validateAdvisorDeferLabels(replay string, arrivals map[string]time.Duration, expectedLabels []string) error {
	expected := make(map[string]struct{}, len(expectedLabels))
	for _, label := range expectedLabels {
		expected[label] = struct{}{}
	}
	missing := make([]string, 0)
	for _, label := range expectedLabels {
		if _, exists := arrivals[label]; !exists {
			missing = append(missing, label)
		}
	}
	unexpected := make([]string, 0)
	for label := range arrivals {
		if _, exists := expected[label]; !exists {
			unexpected = append(unexpected, label)
		}
	}
	slices.Sort(unexpected)
	if len(missing) != 0 || len(unexpected) != 0 {
		return fmt.Errorf("defer advisor %s label set mismatch: missing %q; unexpected %q", replay, missing, unexpected)
	}
	return nil
}

func validateAdvisorMultipartContentType(value string) error {
	mediaType, parameters, err := mime.ParseMediaType(value)
	if err != nil || !strings.EqualFold(mediaType, multipartMime) ||
		len(parameters) != 2 || parameters["boundary"] != multipartBoundary || parameters["deferspec"] != "20220824" {
		return fmt.Errorf(
			"returned Content-Type %q; expected multipart/mixed; deferSpec=20220824; boundary=graphql",
			value,
		)
	}
	return nil
}

func addAdvisorBaselineTraceHeaders(request *http.Request) {
	for _, option := range []string{
		requestTraceOptionExcludeParseStats,
		requestTraceOptionExcludeNormalizeStats,
		requestTraceOptionExcludeValidateStats,
		requestTraceOptionExcludePlannerStats,
		requestTraceOptionExcludeRawInputData,
		requestTraceOptionExcludeInput,
		requestTraceOptionExcludeOutput,
	} {
		request.Header.Add(RequestTraceHeader, option)
	}
}

func cloneAdvisorFetchStructure(fetches []*advisorFetch) []*advisorFetch {
	cloned := make([]*advisorFetch, len(fetches))
	for i, fetch := range fetches {
		if fetch == nil {
			continue
		}
		copy := *fetch
		copy.dependsOn = slices.Clone(fetch.dependsOn)
		copy.fields = slices.Clone(fetch.fields)
		copy.clientParentPath = slices.Clone(fetch.clientParentPath)
		copy.durationsMs = nil
		copy.fieldLatenciesMs = nil
		cloned[i] = &copy
	}
	return cloned
}

func decodeAdvisorJSONReplay(replay string, recorder *loopbackRecorder, destination any) error {
	body := recorder.fullBody()
	if recorder.status != http.StatusOK {
		return fmt.Errorf(
			"defer advisor %s returned HTTP status %d: %s",
			replay,
			recorder.status,
			advisorReplayBodyForError(body),
		)
	}
	contentType := recorder.header.Get("Content-Type")
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil || !strings.EqualFold(mediaType, jsonContent) {
		return fmt.Errorf("defer advisor %s returned Content-Type %q; expected application/json", replay, contentType)
	}
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return fmt.Errorf("defer advisor %s response must be a JSON object", replay)
	}

	decoder := json.NewDecoder(bytes.NewReader(trimmed))
	if err := decoder.Decode(destination); err != nil {
		return fmt.Errorf("defer advisor %s returned invalid JSON: %w", replay, err)
	}
	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return fmt.Errorf("defer advisor %s returned invalid JSON: trailing data after the response object", replay)
		}
		return fmt.Errorf("defer advisor %s returned invalid JSON: %w", replay, err)
	}
	return nil
}

func advisorRawJSONObject(raw json.RawMessage) bool {
	trimmed := bytes.TrimSpace(raw)
	return len(trimmed) != 0 && trimmed[0] == '{'
}

func advisorReplayBodyForError(body []byte) string {
	const maximum = 512
	if len(body) > maximum {
		return string(body[:maximum]) + "..."
	}
	return string(body)
}
