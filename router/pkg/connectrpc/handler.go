package connectrpc

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"connectrpc.com/connect"
	"go.uber.org/zap"
)

// httpStatusToConnectCode maps HTTP status codes to Connect error codes
// Based on Connect RPC specification and common HTTP status code semantics
func httpStatusToConnectCode(statusCode int) connect.Code {
	switch statusCode {
	case http.StatusBadRequest: // 400
		return connect.CodeInvalidArgument
	case http.StatusUnauthorized: // 401
		return connect.CodeUnauthenticated
	case http.StatusForbidden: // 403
		return connect.CodePermissionDenied
	case http.StatusNotFound: // 404
		return connect.CodeNotFound
	case http.StatusConflict: // 409
		return connect.CodeAborted
	case http.StatusPreconditionFailed: // 412
		return connect.CodeFailedPrecondition
	case http.StatusRequestEntityTooLarge: // 413
		return connect.CodeResourceExhausted
	case http.StatusRequestedRangeNotSatisfiable: // 416
		return connect.CodeOutOfRange
	case http.StatusTooManyRequests: // 429
		return connect.CodeResourceExhausted
	case http.StatusRequestTimeout: // 408
		return connect.CodeDeadlineExceeded
	case http.StatusGatewayTimeout: // 504
		return connect.CodeDeadlineExceeded
	case http.StatusNotImplemented: // 501
		return connect.CodeUnimplemented
	case http.StatusServiceUnavailable: // 503
		return connect.CodeUnavailable
	case http.StatusInternalServerError: // 500
		return connect.CodeInternal
	default:
		// For any other status code (including 2xx success codes),
		// return CodeUnknown as a safe default
		return connect.CodeUnknown
	}
}

// requestHeadersKey is a custom context key for storing request headers
type requestHeadersKey struct{}

// withRequestHeaders adds request headers to the context
func withRequestHeaders(ctx context.Context, headers http.Header) context.Context {
	return context.WithValue(ctx, requestHeadersKey{}, headers)
}

// headersFromContext extracts the request headers from the context
func headersFromContext(ctx context.Context) (http.Header, error) {
	headers, ok := ctx.Value(requestHeadersKey{}).(http.Header)
	if !ok {
		return nil, fmt.Errorf("missing request headers")
	}
	return headers, nil
}

// skippedHeaders are headers that should not be forwarded to the GraphQL endpoint
var skippedHeaders = map[string]struct{}{
	"Connection":               {},
	"Keep-Alive":               {},
	"Proxy-Authenticate":       {},
	"Proxy-Authorization":      {},
	"Te":                       {},
	"Trailer":                  {},
	"Transfer-Encoding":        {},
	"Upgrade":                  {},
	"Host":                     {},
	"Content-Length":           {},
	"Content-Type":             {},
	"Accept":                   {},
	"Accept-Encoding":          {},
	"Accept-Charset":           {},
	"Alt-Svc":                  {},
	"Proxy-Connection":         {},
	"Sec-Websocket-Extensions": {},
	"Sec-Websocket-Key":        {},
	"Sec-Websocket-Protocol":   {},
	"Sec-Websocket-Version":    {},
}

// Metadata keys for Connect error metadata
const (
	MetaKeyHTTPStatus          = "http-status"
	MetaKeyErrorClassification = "error-classification"
	MetaKeyGraphQLErrors       = "graphql-errors"
	MetaKeyGraphQLPartialData  = "graphql-partial-data"
	MetaKeyHTTPResponseBody    = "http-response-body"
)

// Error classification values
const (
	ErrorClassificationCritical    = "CRITICAL"
	ErrorClassificationNonCritical = "NON-CRITICAL"
)

// GraphQLRequest represents a GraphQL request structure
type GraphQLRequest struct {
	Query     string          `json:"query"`
	Variables json.RawMessage `json:"variables,omitempty"`
}

// GraphQLErrorLocation represents the location of an error in the GraphQL query
type GraphQLErrorLocation struct {
	Line   int `json:"line"`
	Column int `json:"column"`
}

// GraphQLError represents an error returned in a GraphQL response
type GraphQLError struct {
	Message    string                 `json:"message"`
	Path       []interface{}          `json:"path,omitempty"`
	Locations  []GraphQLErrorLocation `json:"locations,omitempty"`
	Extensions map[string]interface{} `json:"extensions,omitempty"`
}

// GraphQLResponse represents a GraphQL response structure
type GraphQLResponse struct {
	Errors []GraphQLError  `json:"errors,omitempty"`
	Data   json.RawMessage `json:"data,omitempty"`
}

// RPCHandler handles RPC requests and orchestrates GraphQL execution
type RPCHandler struct {
	graphqlEndpoint   string
	httpClient        *http.Client
	logger            *zap.Logger
	operationRegistry *OperationRegistry
}

// HandlerConfig contains configuration for the RPC handler
type HandlerConfig struct {
	GraphQLEndpoint   string
	HTTPClient        *http.Client
	Logger            *zap.Logger
	OperationRegistry *OperationRegistry
}

// NewRPCHandler creates a new RPC handler
func NewRPCHandler(config HandlerConfig) (*RPCHandler, error) {
	if config.GraphQLEndpoint == "" {
		return nil, fmt.Errorf("graphql endpoint cannot be empty")
	}

	if config.HTTPClient == nil {
		return nil, fmt.Errorf("http client cannot be nil")
	}

	if config.Logger == nil {
		config.Logger = zap.NewNop()
	}

	if config.OperationRegistry == nil {
		return nil, fmt.Errorf("operation registry is required")
	}

	// Ensure the endpoint has a protocol
	if !strings.Contains(config.GraphQLEndpoint, "://") {
		config.GraphQLEndpoint = "http://" + config.GraphQLEndpoint
	}

	return &RPCHandler{
		graphqlEndpoint:   config.GraphQLEndpoint,
		httpClient:        config.HTTPClient,
		logger:            config.Logger,
		operationRegistry: config.OperationRegistry,
	}, nil
}

// HandleRPC processes an RPC request and returns a response
// serviceName: fully qualified service name (e.g., "mypackage.MyService")
// methodName: the RPC method name (e.g., "GetUser" or "QueryGetUser")
// requestJSON: the JSON-encoded request body
// ctx: request context with headers
func (h *RPCHandler) HandleRPC(ctx context.Context, serviceName, methodName string, requestJSON []byte) ([]byte, error) {
	h.logger.Debug("handling RPC request",
		zap.String("service", serviceName),
		zap.String("method", methodName))

	// Strip Query/Mutation/Subscription prefix from method name if present
	// This allows RPC methods like "QueryGetUser" to map to GraphQL operations named "GetUser"
	operationName := stripOperationTypePrefix(methodName)

	// Look up operation from registry scoped to this service
	// This ensures operations can only be called from their owning service
	operation := h.operationRegistry.GetOperationForService(serviceName, operationName)
	if operation == nil {
		// If not found with stripped name, try the original method name
		operation = h.operationRegistry.GetOperationForService(serviceName, methodName)
		if operation == nil {
			return nil, fmt.Errorf("operation not found for service %s: %s (also tried: %s)", serviceName, methodName, operationName)
		}
	}

	h.logger.Debug("using predefined operation",
		zap.String("service", serviceName),
		zap.String("rpc_method", methodName),
		zap.String("operation", operation.Name),
		zap.String("type", operation.OperationType))

	// Convert proto JSON (snake_case) to GraphQL variables (camelCase)
	variables, err := h.convertProtoJSONToGraphQLVariables(requestJSON)
	if err != nil {
		return nil, fmt.Errorf("failed to convert proto JSON to GraphQL variables: %w", err)
	}

	// Execute the GraphQL query
	responseJSON, err := h.executeGraphQL(ctx, operation.OperationString, variables)
	if err != nil {
		return nil, fmt.Errorf("failed to execute GraphQL query: %w", err)
	}

	return responseJSON, nil
}

// convertProtoJSONToGraphQLVariables converts proto JSON (snake_case) to GraphQL variables (camelCase)
func (h *RPCHandler) convertProtoJSONToGraphQLVariables(protoJSON []byte) (json.RawMessage, error) {
	// Handle empty JSON - return empty object
	if len(protoJSON) == 0 {
		return json.RawMessage("{}"), nil
	}

	// Parse the proto JSON
	var protoData map[string]interface{}
	if err := json.Unmarshal(protoJSON, &protoData); err != nil {
		return nil, fmt.Errorf("failed to unmarshal proto JSON: %w", err)
	}

	// Convert keys from snake_case to camelCase
	graphqlData := make(map[string]interface{})
	for key, value := range protoData {
		camelKey := snakeToCamel(key)
		graphqlData[camelKey] = value
	}

	// Marshal back to JSON
	graphqlJSON, err := json.Marshal(graphqlData)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal GraphQL variables: %w", err)
	}

	return graphqlJSON, nil
}

// snakeToCamel converts snake_case to camelCase
func snakeToCamel(s string) string {
	parts := strings.Split(s, "_")
	if len(parts) == 1 {
		return s
	}

	result := parts[0]
	for i := 1; i < len(parts); i++ {
		if len(parts[i]) > 0 {
			result += strings.ToUpper(parts[i][:1]) + parts[i][1:]
		}
	}
	return result
}

// stripOperationTypePrefix removes Query/Mutation/Subscription prefix from method name
// This allows RPC methods like "QueryGetUser" to map to GraphQL operations named "GetUser"
func stripOperationTypePrefix(methodName string) string {
	prefixes := []string{"Query", "Mutation", "Subscription"}
	for _, prefix := range prefixes {
		if strings.HasPrefix(methodName, prefix) {
			stripped := strings.TrimPrefix(methodName, prefix)
			// Only strip if there's something left after the prefix
			if len(stripped) > 0 {
				return stripped
			}
		}
	}
	return methodName
}

// makeCriticalGraphQLError creates a Connect error for GraphQL errors with no data (complete failure).
// This follows Relay's error classification pattern for critical errors.
func (h *RPCHandler) makeCriticalGraphQLError(errors []GraphQLError, httpStatus int) error {
	// Serialize GraphQL errors to JSON for metadata
	errorsJSON, _ := json.Marshal(errors)
	
	// Create Connect error with CRITICAL classification
	// Use CodeUnknown for GraphQL errors (not CodeInternal which implies server bugs)
	connectErr := connect.NewError(
		connect.CodeUnknown,
		fmt.Errorf("GraphQL operation failed: %s", errors[0].Message),
	)
	connectErr.Meta().Set(MetaKeyErrorClassification, ErrorClassificationCritical)
	connectErr.Meta().Set(MetaKeyGraphQLErrors, string(errorsJSON))
	connectErr.Meta().Set(MetaKeyHTTPStatus, fmt.Sprintf("%d", httpStatus))
	
	// Log all error messages
	var errorMessages []string
	for _, gqlErr := range errors {
		errorMessages = append(errorMessages, gqlErr.Message)
	}
	h.logger.Error("CRITICAL GraphQL errors - no data returned",
		zap.Strings("error_messages", errorMessages),
		zap.Int("error_count", len(errors)))
	
	return connectErr
}

// makePartialGraphQLError creates a Connect error for GraphQL errors with partial data (partial success).
// This follows Relay's pattern for field-level errors where some data was successfully retrieved.
func (h *RPCHandler) makePartialGraphQLError(errors []GraphQLError, data json.RawMessage, httpStatus int) error {
	// Serialize errors to JSON for metadata
	errorsJSON, _ := json.Marshal(errors)
	
	// Compact the partial data JSON to remove whitespace
	var compactData bytes.Buffer
	if err := json.Compact(&compactData, data); err == nil {
		data = compactData.Bytes()
	}
	
	// Create Connect error with NON-CRITICAL classification
	connectErr := connect.NewError(
		connect.CodeUnknown, // Use Unknown for partial failures
		fmt.Errorf("GraphQL partial success with errors"),
	)
	connectErr.Meta().Set(MetaKeyErrorClassification, ErrorClassificationNonCritical)
	connectErr.Meta().Set(MetaKeyGraphQLErrors, string(errorsJSON))
	connectErr.Meta().Set(MetaKeyGraphQLPartialData, string(data))
	connectErr.Meta().Set(MetaKeyHTTPStatus, fmt.Sprintf("%d", httpStatus))
	
	// Log warning for partial success
	var errorMessages []string
	for _, gqlErr := range errors {
		errorMessages = append(errorMessages, gqlErr.Message)
	}
	h.logger.Warn("NON-CRITICAL GraphQL errors - partial data returned",
		zap.Strings("error_messages", errorMessages),
		zap.Int("error_count", len(errors)),
		zap.Bool("has_partial_data", true))
	
	return connectErr
}

// executeGraphQL executes a GraphQL query against the router endpoint
func (h *RPCHandler) executeGraphQL(ctx context.Context, query string, variables json.RawMessage) ([]byte, error) {
	// Create the GraphQL request
	graphqlRequest := GraphQLRequest{
		Query:     query,
		Variables: variables,
	}

	requestBody, err := json.Marshal(graphqlRequest)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal GraphQL request: %w", err)
	}

	// Create HTTP request
	req, err := http.NewRequestWithContext(ctx, "POST", h.graphqlEndpoint, bytes.NewReader(requestBody))
	if err != nil {
		return nil, fmt.Errorf("failed to create HTTP request: %w", err)
	}

	// Forward headers from the original RPC request
	headers, err := headersFromContext(ctx)
	if err != nil {
		h.logger.Debug("no headers in context", zap.Error(err))
	} else {
		// Copy headers, skipping those that shouldn't be forwarded
		for key, values := range headers {
			if _, skip := skippedHeaders[key]; skip {
				continue
			}
			for _, value := range values {
				req.Header.Add(key, value)
			}
		}
	}

	// Set required headers for GraphQL
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	req.Header.Set("Accept", "application/json")

	// Execute the request
	resp, err := h.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to execute HTTP request: %w", err)
	}
	defer resp.Body.Close()

	// Read the response body
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	// Check for HTTP errors (non-2xx status codes)
	if resp.StatusCode != http.StatusOK {
		// Map HTTP status to Connect error code
		code := httpStatusToConnectCode(resp.StatusCode)
		
		// Create Connect error with metadata
		connectErr := connect.NewError(code, fmt.Errorf("GraphQL request failed with HTTP %d", resp.StatusCode))
		connectErr.Meta().Set(MetaKeyErrorClassification, ErrorClassificationCritical)
		connectErr.Meta().Set(MetaKeyHTTPStatus, fmt.Sprintf("%d", resp.StatusCode))
		connectErr.Meta().Set(MetaKeyHTTPResponseBody, string(responseBody))
		
		h.logger.Error("HTTP error from GraphQL endpoint",
			zap.Int("status_code", resp.StatusCode),
			zap.String("connect_code", code.String()),
			zap.String("response_body", string(responseBody)))
		
		return nil, connectErr
	}

	// Parse the GraphQL response to check for errors
	var graphqlResponse GraphQLResponse
	if err := json.Unmarshal(responseBody, &graphqlResponse); err != nil {
		// If we can't parse it, return the raw response (backward compatibility)
		h.logger.Warn("failed to parse GraphQL response", zap.Error(err))
		return responseBody, nil
	}

	// Check if we have GraphQL errors
	if len(graphqlResponse.Errors) > 0 {
		// Determine if this is CRITICAL or NON-CRITICAL based on data presence
		hasData := len(graphqlResponse.Data) > 0 && string(graphqlResponse.Data) != "null" && string(graphqlResponse.Data) != "{}"
		
		if !hasData {
			// CRITICAL: Errors with no data - complete failure
			return nil, h.makeCriticalGraphQLError(graphqlResponse.Errors, resp.StatusCode)
		}
		
		// NON-CRITICAL: Errors with partial data - partial success
		return nil, h.makePartialGraphQLError(graphqlResponse.Errors, graphqlResponse.Data, resp.StatusCode)
	}

	// Success case: Return only the data field
	// The proto response message expects just the data payload: {...}
	// Not the GraphQL wrapper: {"data": {...}, "errors": [...]}
	if len(graphqlResponse.Data) > 0 && string(graphqlResponse.Data) != "null" {
		return graphqlResponse.Data, nil
	}

	// Edge case: No errors but also no data (empty response)
	// Return empty object for backward compatibility
	return []byte("{}"), nil
}

// Reload reloads the handler's dependencies
// NOTE: This method is deprecated and will be removed.
// Operations should be reloaded per-service using LoadOperationsForService.
func (h *RPCHandler) Reload(operationsDir string) error {
	if h.operationRegistry == nil {
		return fmt.Errorf("operation registry is nil")
	}

	// This method is no longer functional with service-scoped operations
	// Operations must be loaded per service using LoadOperationsForService
	h.logger.Warn("Reload() is deprecated - operations must be loaded per service")
	
	return nil
}

// GetOperationCount returns the number of operations available
func (h *RPCHandler) GetOperationCount() int {
	if h.operationRegistry == nil {
		return 0
	}
	return h.operationRegistry.Count()
}

// GetOperations returns information about available operations.
// The returned data should be treated as read-only.
func (h *RPCHandler) GetOperations() interface{} {
	if h.operationRegistry == nil {
		return nil
	}
	return h.operationRegistry.GetAllOperations()
}

// ValidateOperation checks if an operation is available for a specific service
func (h *RPCHandler) ValidateOperation(serviceName, methodName string) error {
	if h.operationRegistry == nil {
		return fmt.Errorf("operation registry is not initialized")
	}
	if !h.operationRegistry.HasOperationForService(serviceName, methodName) {
		return fmt.Errorf("operation not found for service %s: %s", serviceName, methodName)
	}
	return nil
}

// GetOperationInfo returns detailed information about a specific operation for a service
func (h *RPCHandler) GetOperationInfo(serviceName, methodName string) (interface{}, error) {
	if h.operationRegistry == nil {
		return nil, fmt.Errorf("operation registry is not initialized")
	}
	operation := h.operationRegistry.GetOperationForService(serviceName, methodName)
	if operation == nil {
		return nil, fmt.Errorf("operation not found for service %s: %s", serviceName, methodName)
	}
	return operation, nil
}
