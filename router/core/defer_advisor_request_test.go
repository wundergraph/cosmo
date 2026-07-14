package core

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestValidateDeferAdvisorContentType(t *testing.T) {
	t.Parallel()

	tests := []struct {
		value string
		err   string
	}{
		{value: "application/json"},
		{value: "application/json; charset=utf-8"},
		{value: "Application/JSON"},
		{err: "defer advisor requires Content-Type application/json"},
		{value: "text/plain", err: "defer advisor requires Content-Type application/json"},
		{value: "application/json; charset", err: "defer advisor requires Content-Type application/json"},
	}
	for _, test := range tests {
		test := test
		t.Run(test.value, func(t *testing.T) {
			t.Parallel()

			err := validateDeferAdvisorContentType(test.value)

			if test.err == "" {
				require.NoError(t, err)
			} else {
				require.EqualError(t, err, test.err)
			}
		})
	}
}

func TestReadDeferAdvisorRequestBodyEnforcesTheByteLimit(t *testing.T) {
	t.Parallel()

	t.Run("accepts the exact limit", func(t *testing.T) {
		t.Parallel()

		input := bytes.Repeat([]byte("x"), deferAdvisorMaxRequestBodyBytes)
		request := httptest.NewRequest(http.MethodPost, "/graphql", bytes.NewReader(input))
		body, err := readDeferAdvisorRequestBody(httptest.NewRecorder(), request)

		require.NoError(t, err)
		assert.Equal(t, input, body)
	})

	t.Run("rejects one byte over the limit", func(t *testing.T) {
		t.Parallel()

		input := bytes.Repeat([]byte("x"), deferAdvisorMaxRequestBodyBytes+1)
		request := httptest.NewRequest(http.MethodPost, "/graphql", bytes.NewReader(input))
		body, err := readDeferAdvisorRequestBody(httptest.NewRecorder(), request)

		assert.Nil(t, body)
		assert.True(t, errors.Is(err, errDeferAdvisorRequestTooLarge))
		require.EqualError(t, err, "defer advisor request body exceeds the 1048576 byte limit")
	})

	t.Run("rejects a streamed body one byte over the limit", func(t *testing.T) {
		t.Parallel()

		input := bytes.Repeat([]byte("x"), deferAdvisorMaxRequestBodyBytes+1)
		request := httptest.NewRequest(http.MethodPost, "/graphql", bytes.NewReader(input))
		request.ContentLength = -1
		body, err := readDeferAdvisorRequestBody(httptest.NewRecorder(), request)

		assert.Nil(t, body)
		assert.True(t, errors.Is(err, errDeferAdvisorRequestTooLarge))
		require.EqualError(t, err, "defer advisor request body exceeds the 1048576 byte limit")
	})

	t.Run("returns a stable read error", func(t *testing.T) {
		t.Parallel()

		readFailure := errors.New("private reader detail")
		request := httptest.NewRequest(http.MethodPost, "/graphql", nil)
		request.Body = &failingDeferAdvisorReadCloser{err: readFailure}
		request.ContentLength = -1
		body, err := readDeferAdvisorRequestBody(httptest.NewRecorder(), request)

		assert.Nil(t, body)
		assert.True(t, errors.Is(err, readFailure))
		require.EqualError(t, err, "defer advisor failed to read the request body")
	})
}

func TestPrepareDeferAdvisorRequestSelectsAQueryExactly(t *testing.T) {
	t.Parallel()

	input := []byte("{\"query\":\"mutation Change { change } query Read { read }\",\"operationName\":\"Read\",\"variables\":{\"id\":\"1\"},\"extensions\":{\"client\":{\"name\":\"playground\"}}}")
	request, body, err := prepareDeferAdvisorRequest(input)
	require.NoError(t, err)

	assert.Equal(t, "Read", request.OperationName)
	assert.Equal(t, json.RawMessage("{\"id\":\"1\"}"), request.Variables)
	assert.Equal(t, json.RawMessage("{\"client\":{\"name\":\"playground\"}}"), request.Extensions)
	var rebuilt graphqlRequestBody
	require.NoError(t, json.Unmarshal(body, &rebuilt))
	assert.Equal(t, request, rebuilt)
}

func TestPrepareDeferAdvisorRequestStripsExistingDefer(t *testing.T) {
	t.Parallel()

	request, body, err := prepareDeferAdvisorRequest([]byte("{\"query\":\"query Read { fast ... @defer(label: \\\"slow\\\") { slow } }\",\"operationName\":\"Read\"}"))
	require.NoError(t, err)

	assert.Equal(t, "query Read {\n  fast\n  slow\n}", request.Query)
	var rebuilt graphqlRequestBody
	require.NoError(t, json.Unmarshal(body, &rebuilt))
	assert.Equal(t, request, rebuilt)
}

func TestPrepareDeferAdvisorRequestRejectsUnsafeOperationsBeforeReplay(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		body string
		err  string
	}{
		{
			name: "mutation",
			body: "{\"query\":\"mutation Change { change }\",\"operationName\":\"Change\"}",
			err:  "defer advisor only supports query operations; selected operation is mutation",
		},
		{
			name: "subscription",
			body: "{\"query\":\"subscription Watch { watch }\",\"operationName\":\"Watch\"}",
			err:  "defer advisor only supports query operations; selected operation is subscription",
		},
		{
			name: "selected mutation among operations",
			body: "{\"query\":\"query Read { read } mutation Change { change }\",\"operationName\":\"Change\"}",
			err:  "defer advisor only supports query operations; selected operation is mutation",
		},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			request, body, err := prepareDeferAdvisorRequest([]byte(test.body))

			assert.Equal(t, graphqlRequestBody{}, request)
			assert.Nil(t, body)
			require.EqualError(t, err, test.err)
		})
	}
}

func TestPrepareDeferAdvisorRequestRequiresExactOperationSelection(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		body string
		err  string
	}{
		{
			name: "ambiguous operations",
			body: "{\"query\":\"query One { one } query Two { two }\"}",
			err:  "operation name is required when multiple operations are defined",
		},
		{
			name: "missing named operation",
			body: "{\"query\":\"query One { one }\",\"operationName\":\"Missing\"}",
			err:  "operation \"Missing\" not found",
		},
		{
			name: "no operation",
			body: "{\"query\":\"fragment Fields on Query { value }\"}",
			err:  "operation \"\" not found",
		},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			_, _, err := prepareDeferAdvisorRequest([]byte(test.body))

			require.EqualError(t, err, test.err)
		})
	}
}

func TestPrepareDeferAdvisorRequestValidatesTheGraphQLEnvelope(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		body string
		err  string
	}{
		{name: "malformed JSON", body: "{", err: "defer advisor requires a valid JSON request body: unexpected end of JSON input"},
		{name: "batch request", body: "[{\"query\":\"query { value }\"}]", err: "defer advisor requires a JSON object request body"},
		{name: "missing query", body: "{}", err: "defer advisor requires an explicit query; persisted-query-only requests are not supported"},
		{
			name: "persisted query only",
			body: "{\"extensions\":{\"persistedQuery\":{\"version\":1,\"sha256Hash\":\"abc\"}}}",
			err:  "defer advisor requires an explicit query; persisted-query-only requests are not supported",
		},
		{
			name: "explicit query with persisted query extension",
			body: "{\"query\":\"query { value }\",\"extensions\":{\"persistedQuery\":{\"version\":1,\"sha256Hash\":\"abc\"}}}",
			err:  "defer advisor does not support persistedQuery extensions",
		},
		{
			name: "mixed-case persisted query extension",
			body: "{\"query\":\"query { value }\",\"extensions\":{\"PersistedQuery\":{\"version\":1,\"sha256Hash\":\"abc\"}}}",
			err:  "defer advisor does not support persistedQuery extensions",
		},
		{name: "variables array", body: "{\"query\":\"query { value }\",\"variables\":[]}", err: "defer advisor variables must be a JSON object or null"},
		{name: "extensions string", body: "{\"query\":\"query { value }\",\"extensions\":\"bad\"}", err: "defer advisor extensions must be a JSON object or null"},
		{name: "malformed GraphQL", body: "{\"query\":\"query Broken {\"}", err: "defer advisor failed to parse the operation:"},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			_, _, err := prepareDeferAdvisorRequest([]byte(test.body))

			if test.name == "malformed GraphQL" {
				require.ErrorContains(t, err, test.err)
			} else {
				require.EqualError(t, err, test.err)
			}
		})
	}
}

type failingDeferAdvisorReadCloser struct {
	err error
}

func (f *failingDeferAdvisorReadCloser) Read([]byte) (int, error) {
	return 0, f.err
}

func (f *failingDeferAdvisorReadCloser) Close() error {
	return nil
}

func TestParseDeferAdvisorRuns(t *testing.T) {
	t.Parallel()

	tests := []struct {
		value string
		runs  int
		err   string
	}{
		{runs: deferAdvisorDefaultRuns},
		{value: "1", runs: 1},
		{value: "10", runs: 10},
		{value: "0", err: "X-WG-Defer-Advisor-Runs must be an integer between 1 and 10"},
		{value: "11", err: "X-WG-Defer-Advisor-Runs must be an integer between 1 and 10"},
		{value: "1.5", err: "X-WG-Defer-Advisor-Runs must be an integer between 1 and 10"},
		{value: "not-a-number", err: "X-WG-Defer-Advisor-Runs must be an integer between 1 and 10"},
	}
	for _, test := range tests {
		test := test
		t.Run(test.value, func(t *testing.T) {
			t.Parallel()

			runs, err := parseDeferAdvisorRuns(test.value)

			assert.Equal(t, test.runs, runs)
			if test.err == "" {
				require.NoError(t, err)
			} else {
				require.EqualError(t, err, test.err)
			}
		})
	}
}
