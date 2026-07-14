package core

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
)

var errDeferAdvisorRequestTooLarge = fmt.Errorf("defer advisor request body exceeds the %d byte limit", deferAdvisorMaxRequestBodyBytes)

type deferAdvisorRequestReadError struct {
	cause error
}

func (e *deferAdvisorRequestReadError) Error() string {
	return "defer advisor failed to read the request body"
}

func (e *deferAdvisorRequestReadError) Unwrap() error {
	return e.cause
}

const (
	// DeferAdvisorHeader enables defer advisor mode.
	DeferAdvisorHeader = "X-WG-Defer-Advisor"
	// DeferAdvisorRunsHeader sets the number of profiling runs.
	DeferAdvisorRunsHeader = "X-WG-Defer-Advisor-Runs"
	// DeferAdvisorSkipValidationHeader omits measured optimized-query timing.
	DeferAdvisorSkipValidationHeader = "X-WG-Defer-Advisor-Skip-Validation"

	deferAdvisorDefaultRuns         = 3
	deferAdvisorMaxRuns             = 10
	deferAdvisorMaxRequestBodyBytes = 1 << 20
)

type graphqlRequestBody struct {
	Query         string          `json:"query"`
	OperationName string          `json:"operationName,omitempty"`
	Variables     json.RawMessage `json:"variables,omitempty"`
	Extensions    json.RawMessage `json:"extensions,omitempty"`
}

func validateDeferAdvisorContentType(value string) error {
	mediaType, _, err := mime.ParseMediaType(value)
	if err != nil || !strings.EqualFold(mediaType, "application/json") {
		return fmt.Errorf("defer advisor requires Content-Type application/json")
	}
	return nil
}

func readDeferAdvisorRequestBody(w http.ResponseWriter, r *http.Request) ([]byte, error) {
	if r.ContentLength > deferAdvisorMaxRequestBodyBytes {
		return nil, errDeferAdvisorRequestTooLarge
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, deferAdvisorMaxRequestBodyBytes))
	if err == nil {
		return body, nil
	}
	var maxBytesError *http.MaxBytesError
	if errors.As(err, &maxBytesError) {
		return nil, errDeferAdvisorRequestTooLarge
	}
	return nil, &deferAdvisorRequestReadError{cause: err}
}

func parseDeferAdvisorRuns(value string) (int, error) {
	if value == "" {
		return deferAdvisorDefaultRuns, nil
	}
	runs, err := strconv.Atoi(value)
	if err != nil || runs < 1 || runs > deferAdvisorMaxRuns {
		return 0, fmt.Errorf("%s must be an integer between 1 and %d", DeferAdvisorRunsHeader, deferAdvisorMaxRuns)
	}
	return runs, nil
}

func prepareDeferAdvisorRequest(body []byte) (graphqlRequestBody, []byte, error) {
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return graphqlRequestBody{}, nil, fmt.Errorf("defer advisor requires a JSON object request body")
	}

	var request graphqlRequestBody
	if err := json.Unmarshal(body, &request); err != nil {
		return graphqlRequestBody{}, nil, fmt.Errorf("defer advisor requires a valid JSON request body: %w", err)
	}
	if strings.TrimSpace(request.Query) == "" {
		return graphqlRequestBody{}, nil, fmt.Errorf("defer advisor requires an explicit query; persisted-query-only requests are not supported")
	}
	if !isJSONObjectOrNull(request.Variables) {
		return graphqlRequestBody{}, nil, fmt.Errorf("defer advisor variables must be a JSON object or null")
	}
	if !isJSONObjectOrNull(request.Extensions) {
		return graphqlRequestBody{}, nil, fmt.Errorf("defer advisor extensions must be a JSON object or null")
	}
	if hasPersistedQueryExtension(request.Extensions) {
		return graphqlRequestBody{}, nil, fmt.Errorf("defer advisor does not support persistedQuery extensions")
	}

	document, report := astparser.ParseGraphqlDocumentString(request.Query)
	if report.HasErrors() {
		return graphqlRequestBody{}, nil, fmt.Errorf("defer advisor failed to parse the operation: %s", report.Error())
	}
	operationRef, err := selectOperationDefinition(&document, request.OperationName)
	if err != nil {
		return graphqlRequestBody{}, nil, err
	}
	operationType := document.OperationDefinitions[operationRef].OperationType
	if operationType != ast.OperationTypeQuery {
		return graphqlRequestBody{}, nil, fmt.Errorf(
			"defer advisor only supports query operations; selected operation is %s",
			advisorOperationTypeName(operationType),
		)
	}

	request.Query, err = stripDeferDirectives(request.Query)
	if err != nil {
		return graphqlRequestBody{}, nil, fmt.Errorf("defer advisor failed to strip @defer directives: %w", err)
	}
	rebuilt, err := json.Marshal(request)
	if err != nil {
		return graphqlRequestBody{}, nil, fmt.Errorf("defer advisor failed to rebuild the request body: %w", err)
	}
	return request, rebuilt, nil
}

func isJSONObjectOrNull(value json.RawMessage) bool {
	trimmed := bytes.TrimSpace(value)
	return len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) || trimmed[0] == '{'
}

func hasPersistedQueryExtension(value json.RawMessage) bool {
	trimmed := bytes.TrimSpace(value)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return false
	}
	var extensions map[string]json.RawMessage
	if err := json.Unmarshal(trimmed, &extensions); err != nil {
		return false
	}
	for key := range extensions {
		if strings.EqualFold(key, "persistedQuery") {
			return true
		}
	}
	return false
}

func advisorOperationTypeName(operationType ast.OperationType) string {
	switch operationType {
	case ast.OperationTypeMutation:
		return "mutation"
	case ast.OperationTypeSubscription:
		return "subscription"
	case ast.OperationTypeQuery:
		return "query"
	default:
		return "unknown"
	}
}
