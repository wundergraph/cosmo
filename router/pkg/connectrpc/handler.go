package connectrpc

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"connectrpc.com/connect"
	"go.uber.org/zap"
	"google.golang.org/protobuf/reflect/protoreflect"

	"github.com/wundergraph/cosmo/router/internal/headers"
)

var (
	ErrInternalServer = errors.New("internal server error")
)

// requestHeadersKey is a custom context key for storing request headers
type requestHeadersKey struct{}

// withRequestHeaders adds request headers to the context
func withRequestHeaders(ctx context.Context, headers http.Header) context.Context {
	return context.WithValue(ctx, requestHeadersKey{}, headers)
}

// headersFromContext extracts the request headers from the context
func headersFromContext(ctx context.Context) (http.Header, error) {
	value := ctx.Value(requestHeadersKey{})
	if value == nil {
		return nil, fmt.Errorf("missing request headers")
	}
	headers, ok := value.(http.Header)
	if !ok {
		return nil, fmt.Errorf("invalid request headers type")
	}
	return headers, nil
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
	ErrorClassificationCritical = "CRITICAL"
	ErrorClassificationPartial  = "PARTIAL"
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
	Path       []any                  `json:"path,omitempty"`
	Locations  []GraphQLErrorLocation `json:"locations,omitempty"`
	Extensions map[string]any         `json:"extensions,omitempty"`
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
	protoLoader       *ProtoLoader
}

// HandlerConfig contains configuration for the RPC handler
type HandlerConfig struct {
	GraphQLEndpoint   string
	HTTPClient        *http.Client
	Logger            *zap.Logger
	OperationRegistry *OperationRegistry
	ProtoLoader       *ProtoLoader
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
		return nil, fmt.Errorf("logger is required")
	}

	if config.OperationRegistry == nil {
		return nil, fmt.Errorf("operation registry is required")
	}

	if config.ProtoLoader == nil {
		return nil, fmt.Errorf("proto loader is required")
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
		protoLoader:       config.ProtoLoader,
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
		zap.String("method", methodName),
		zap.String("request_json", string(requestJSON)))

	// Look up operation from registry scoped to this service
	// This ensures operations can only be called from their owning service
	// The method name must exactly match the operation name
	operation := h.operationRegistry.GetOperationForService(serviceName, methodName)
	if operation == nil {
		// Log all available operations for this service to help diagnose the issue
		allOps := h.operationRegistry.GetAllOperationsForService(serviceName)
		var availableOps []string
		for _, op := range allOps {
			availableOps = append(availableOps, op.Name)
		}
		h.logger.Error("operation not found",
			zap.String("service", serviceName),
			zap.String("requested_method", methodName),
			zap.Strings("available_operations", availableOps))
		return nil, fmt.Errorf("operation not found for service %s: %s", serviceName, methodName)
	}

	h.logger.Debug("resolved operation",
		zap.String("service", serviceName),
		zap.String("rpc_method", methodName),
		zap.String("operation", operation.Name),
		zap.String("type", operation.OperationType))

	// Convert proto JSON to GraphQL variables
	// This handles:
	// - Field name mapping via graphql_variable_name options (e.g., hasPets → HAS_PETS)
	// - Enum prefix stripping (e.g., MOOD_HAPPY → HAPPY)
	// - Omitting _UNSPECIFIED enum values
	variables, err := h.convertProtoJSONToGraphQLVariables(serviceName, methodName, requestJSON)
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

// convertProtoJSONToGraphQLVariables processes proto JSON for GraphQL compatibility.
//
// IMPORTANT: Field names ARE converted here when graphql_variable_name field options are present.
// Protobuf JSON marshaling automatically converts field names from snake_case (in .proto files)
// to camelCase (in JSON) per the protobuf JSON specification. By the time this function receives
// the data, field names are already in camelCase format.
//
// This function performs two types of transformations:
//  1. Field name mapping: Uses graphql_variable_name field options to rename fields
//     Example: "hasPets" (proto JSON) → "HAS_PETS" (GraphQL variable)
//  2. Enum value transformations:
//     - Strips proto enum type prefixes: MOOD_HAPPY → HAPPY, STATUS_ACTIVE → ACTIVE
//     - Omits _UNSPECIFIED enum values (proto default values that don't exist in GraphQL)
//
// DESIGN RATIONALE:
// - Proto field options allow explicit mapping between proto JSON and GraphQL variable names
// - Proto enums include type prefix for namespacing (MOOD_HAPPY, STATUS_ACTIVE)
// - GraphQL enums omit the prefix for cleaner API (HAPPY, ACTIVE)
// - _UNSPECIFIED is proto's zero value (doesn't exist in GraphQL schemas)
//
// This matches the behavior of tools like protographic which generate GraphQL schemas
// from proto definitions.
func (h *RPCHandler) convertProtoJSONToGraphQLVariables(serviceName, methodName string, protoJSON []byte) (json.RawMessage, error) {
	if len(protoJSON) == 0 {
		return json.RawMessage("{}"), nil
	}

	var protoData map[string]any
	if err := json.Unmarshal(protoJSON, &protoData); err != nil {
		return nil, fmt.Errorf("failed to unmarshal proto JSON: %w", err)
	}

	// Get proto message descriptor for enum detection and field options
	// If protoLoader is not available, we can't do transformations, so return as-is
	if h.protoLoader == nil {
		return protoJSON, nil
	}

	method, err := h.protoLoader.GetMethod(serviceName, methodName)
	if err != nil {
		// Method not found in proto loader - this shouldn't happen in production
		// since operations are registered from proto definitions, but in tests
		// or edge cases we may not have the full schema loaded
		h.logger.Debug("method not found in proto loader, skipping transformations",
			zap.String("service", serviceName),
			zap.String("method", methodName),
			zap.Error(err))
		return protoJSON, nil
	}

	messageDesc := method.InputMessageDescriptor
	if messageDesc == nil {
		// This shouldn't happen with valid proto definitions
		h.logger.Warn("input message descriptor is nil, skipping transformations",
			zap.String("service", serviceName),
			zap.String("method", methodName))
		return protoJSON, nil
	}

	// Check if any transformations are actually needed
	needsTransformation := h.needsTransformation(protoData, messageDesc)
	if !needsTransformation {
		// Input already matches expected format, return as-is
		return protoJSON, nil
	}

	// Create a set to track fields that came from _UNSPECIFIED enums
	unspecifiedFields := make(map[string]bool)

	graphqlData := h.convertKeysRecursiveWithTracking(protoData, messageDesc, "", unspecifiedFields)

	graphqlJSON, err := json.Marshal(graphqlData)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal GraphQL variables: %w", err)
	}

	return graphqlJSON, nil
}

// convertKeysRecursiveWithTracking processes data recursively to:
// 1. Rename fields based on graphql_variable_name field options
// 2. Strip proto enum prefixes using schema information
// Tracks fields that came from _UNSPECIFIED enums and omits only those when empty.
func (h *RPCHandler) convertKeysRecursiveWithTracking(data any, messageDesc protoreflect.MessageDescriptor, pathPrefix string, unspecifiedFields map[string]bool) any {
	switch v := data.(type) {
	case map[string]any:
		result := make(map[string]any)
		for key, value := range v {
			fieldPath := pathPrefix + key

			var fieldDesc protoreflect.FieldDescriptor
			if messageDesc != nil {
				// Try to find field descriptor - protobuf JSON uses camelCase, but descriptors use original names
				fieldDesc = getFieldByJSONName(messageDesc, key)
			}

			convertedValue := h.convertValueRecursiveWithTracking(value, fieldDesc, fieldPath, unspecifiedFields)

			// Only omit empty strings that came from _UNSPECIFIED enum conversions
			if strVal, ok := convertedValue.(string); ok && strVal == "" {
				if unspecifiedFields[fieldPath] {
					// This empty string came from an _UNSPECIFIED enum, omit it
					continue
				}
				// Otherwise, it's a legitimate empty string, keep it
			}

			// Check if field has graphql_variable_name option
			outputKey := key
			if fieldDesc != nil {
				if graphqlVarName := getGraphQLVariableName(fieldDesc); graphqlVarName != "" {
					outputKey = graphqlVarName
				}
			}

			result[outputKey] = convertedValue
		}
		return result
	case []any:
		result := make([]any, len(v))
		for i, item := range v {
			itemPath := fmt.Sprintf("%s[%d].", pathPrefix, i)
			result[i] = h.convertKeysRecursiveWithTracking(item, messageDesc, itemPath, unspecifiedFields)
		}
		return result
	default:
		return h.convertValueRecursiveWithTracking(v, nil, pathPrefix, unspecifiedFields)
	}
}

// convertValueRecursiveWithTracking processes a value using field descriptor for schema-aware enum detection
// and marks fields that came from _UNSPECIFIED enums
func (h *RPCHandler) convertValueRecursiveWithTracking(value any, fieldDesc protoreflect.FieldDescriptor, fieldPath string, unspecifiedFields map[string]bool) any {
	switch v := value.(type) {
	case map[string]any:
		var nestedDesc protoreflect.MessageDescriptor
		if fieldDesc != nil {
			nestedDesc = getMessageType(fieldDesc)
		}
		return h.convertKeysRecursiveWithTracking(v, nestedDesc, fieldPath+".", unspecifiedFields)

	case []any:
		result := make([]any, len(v))
		for i, item := range v {
			itemPath := fmt.Sprintf("%s[%d]", fieldPath, i)
			result[i] = h.convertValueRecursiveWithTracking(item, fieldDesc, itemPath, unspecifiedFields)
		}
		return result

	case string:
		// Schema-aware: check if field is an enum type
		if fieldDesc != nil {
			enumDesc := getEnumType(fieldDesc)
			if enumDesc != nil {
				enumTypeName := string(enumDesc.Name())
				stripped := stripEnumPrefixWithType(v, enumTypeName)

				// Mark this field if it was an _UNSPECIFIED enum
				if stripped == "" && v != "" {
					// The original value was non-empty but became empty after stripping
					// This means it was an _UNSPECIFIED enum
					unspecifiedFields[fieldPath] = true
				}

				return stripped
			}
		}

		return v

	default:
		return v
	}
}

// stripEnumPrefixWithType removes the enum type prefix using the known enum type name from schema
// Example: stripEnumPrefixWithType("USER_STATUS_ACTIVE", "UserStatus") -> "ACTIVE"
// Special case: _UNSPECIFIED values are treated as empty string (will be omitted or null in GraphQL)
func stripEnumPrefixWithType(protoEnumValue, enumTypeName string) string {
	// Convert enum type name to UPPER_SNAKE_CASE (matching protographic's logic)
	prefix := toUpperSnakeCase(enumTypeName) + "_"

	if after, ok := strings.CutPrefix(protoEnumValue, prefix); ok {
		stripped := after

		// Handle _UNSPECIFIED values: these are proto-only (value 0) and don't exist in GraphQL
		// Return empty string so they can be omitted or treated as null
		if stripped == "UNSPECIFIED" {
			return ""
		}

		return stripped
	}

	// If prefix doesn't match, return as-is (shouldn't happen with valid proto)
	return protoEnumValue
}

// toUpperSnakeCase converts a string to UPPER_SNAKE_CASE
// Example: "UserStatus" -> "USER_STATUS"
func toUpperSnakeCase(s string) string {
	// If already contains underscores or is all uppercase, just uppercase it
	if strings.Contains(s, "_") || s == strings.ToUpper(s) {
		return strings.ToUpper(s)
	}

	var result strings.Builder
	for i, r := range s {
		// Add underscore before uppercase letters (except first character)
		if i > 0 && r >= 'A' && r <= 'Z' {
			// Check if previous character was lowercase
			prev := rune(s[i-1])
			if prev >= 'a' && prev <= 'z' {
				result.WriteByte('_')
			}
		}
		result.WriteRune(r)
	}
	return strings.ToUpper(result.String())
}

// makeCriticalGraphQLError creates a Connect error for GraphQL errors with no data (complete failure).
// This follows Relay's error classification pattern for critical errors.
func (h *RPCHandler) makeCriticalGraphQLError(errors []GraphQLError, httpStatus int) error {
	// Serialize GraphQL errors to JSON for metadata
	errorsJSON, _ := json.Marshal(errors)

	// Create Connect error with CRITICAL classification
	// Use CodeUnknown for GraphQL errors (not CodeInternal which implies server defects)
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

	// Create Connect error with PARTIAL classification
	connectErr := connect.NewError(
		connect.CodeUnknown, // Use Unknown for partial failures
		fmt.Errorf("GraphQL partial success with errors"),
	)
	connectErr.Meta().Set(MetaKeyErrorClassification, ErrorClassificationPartial)
	connectErr.Meta().Set(MetaKeyGraphQLErrors, string(errorsJSON))
	connectErr.Meta().Set(MetaKeyGraphQLPartialData, string(data))
	connectErr.Meta().Set(MetaKeyHTTPStatus, fmt.Sprintf("%d", httpStatus))

	// Log info for partial success (this is a valid GraphQL pattern)
	var errorMessages []string
	for _, gqlErr := range errors {
		errorMessages = append(errorMessages, gqlErr.Message)
	}
	h.logger.Info("PARTIAL GraphQL response - data returned with field errors",
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

	var requestBody bytes.Buffer
	if err := json.NewEncoder(&requestBody).Encode(graphqlRequest); err != nil {
		return nil, fmt.Errorf("failed to marshal GraphQL request: %w", err)
	}

	// Create HTTP request
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, h.graphqlEndpoint, &requestBody)
	if err != nil {
		return nil, fmt.Errorf("failed to create HTTP request: %w", err)
	}

	// Forward headers from the original RPC request
	reqHeaders, err := headersFromContext(ctx)
	if err != nil {
		h.logger.Debug("no headers in context", zap.Error(err))
	} else {
		// Copy headers, skipping those that shouldn't be forwarded
		for key, values := range reqHeaders {
			// Normalize header key to canonical form for case-insensitive comparison
			canonicalKey := http.CanonicalHeaderKey(key)
			if _, skip := headers.SkippedHeaders[canonicalKey]; skip {
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
		code := HTTPStatusToConnectCode(resp.StatusCode)

		// Log full response body server-side only
		h.logger.Error("HTTP error from GraphQL endpoint",
			zap.Int("status_code", resp.StatusCode),
			zap.String("connect_code", code.String()),
			zap.Int("response_body_length", len(responseBody)),
			zap.String("response_body", string(responseBody)))

		// Create Connect error with metadata
		// Note: We do NOT include the response body in client-facing metadata to prevent
		// leaking sensitive information (internal URLs, stack traces, auth tokens, etc.)
		connectErr := connect.NewError(code, fmt.Errorf("GraphQL request failed with HTTP %d", resp.StatusCode))
		connectErr.Meta().Set(MetaKeyErrorClassification, ErrorClassificationCritical)
		connectErr.Meta().Set(MetaKeyHTTPStatus, fmt.Sprintf("%d", resp.StatusCode))

		return nil, connectErr
	}

	// Parse the GraphQL response to check for errors
	var graphqlResponse GraphQLResponse
	if err := json.Unmarshal(responseBody, &graphqlResponse); err != nil {
		// If we can't parse it, return the raw response (backward compatibility)
		h.logger.Error("failed to parse GraphQL response",
			zap.Error(err),
			zap.Int("response_body_length", len(responseBody)))
		return nil, connect.NewError(connect.CodeInternal, ErrInternalServer)
	}

	// Check if we have GraphQL errors
	if len(graphqlResponse.Errors) > 0 {
		// Determine if this is CRITICAL or PARTIAL based on data presence
		// An empty object {} is valid data in GraphQL (e.g., when all fields are nullable and null)
		hasData := len(graphqlResponse.Data) > 0 && string(graphqlResponse.Data) != "null"

		if !hasData {
			// CRITICAL: Errors with no data - complete failure
			return nil, h.makeCriticalGraphQLError(graphqlResponse.Errors, resp.StatusCode)
		}

		// PARTIAL: Errors with partial data - partial success
		return nil, h.makePartialGraphQLError(graphqlResponse.Errors, graphqlResponse.Data, resp.StatusCode)
	}

	// Success case: Return only the data field
	// The proto response message expects just the data payload: {...}
	// Not the GraphQL wrapper: {"data": {...}, "errors": [...]}
	if len(graphqlResponse.Data) > 0 && string(graphqlResponse.Data) != "null" {
		return graphqlResponse.Data, nil
	}

	// Edge case: No errors but also no data (empty response)
	// Return empty object to ensure valid JSON for proto unmarshaling
	// The caller (vanguard_service.go) expects non-nil JSON bytes
	return []byte("{}"), nil
}

// GetOperationCount returns the number of operations available
func (h *RPCHandler) GetOperationCount() int {
	if h.operationRegistry == nil {
		return 0
	}
	return h.operationRegistry.Count()
}

// needsTransformation checks if any field in the data needs transformation
// (either has graphql_variable_name option or contains _UNSPECIFIED enum values)
func (h *RPCHandler) needsTransformation(data any, messageDesc protoreflect.MessageDescriptor) bool {
	switch v := data.(type) {
	case map[string]any:
		for key, value := range v {
			var fieldDesc protoreflect.FieldDescriptor
			if messageDesc != nil {
				fieldDesc = getFieldByJSONName(messageDesc, key)
			}

			// Check if this field has a graphql_variable_name option
			if fieldDesc != nil {
				if graphqlVarName := getGraphQLVariableName(fieldDesc); graphqlVarName != "" {
					// Field needs renaming
					return true
				}

				// Check if field is an enum (handle scalar and repeated enum values)
				if enumDesc := getEnumType(fieldDesc); enumDesc != nil {
					switch ev := value.(type) {
					case string:
						if ev != "" {
							return true
						}
					case []any:
						for _, item := range ev {
							if s, ok := item.(string); ok && s != "" {
								return true
							}
						}
					}
				}

				// Recursively check nested messages
				if msgDesc := getMessageType(fieldDesc); msgDesc != nil {
					if h.needsTransformation(value, msgDesc) {
						return true
					}
				}
			}
		}
		return false
	case []any:
		// Check array elements
		for _, item := range v {
			if h.needsTransformation(item, messageDesc) {
				return true
			}
		}
		return false
	default:
		return false
	}
}

// getGraphQLVariableName extracts the graphql_variable_name field option if present
func getGraphQLVariableName(fieldDesc protoreflect.FieldDescriptor) string {
	if fieldDesc == nil {
		return ""
	}

	opts := fieldDesc.Options()
	if opts == nil {
		return ""
	}

	// Get the descriptor for the options message
	optsReflect := opts.ProtoReflect()
	if !optsReflect.IsValid() {
		return ""
	}

	// The graphql_variable_name option is defined in proto/com/wundergraph/connectrpc/options/v1/annotations.proto
	// Extension fields are stored in the message's extension fields, not in
	// the descriptor's Extensions(). We need to iterate through the actual
	// extension fields that are SET on this particular options instance.

	// Range over all fields that are actually set on this options message
	var result string
	optsReflect.Range(func(fd protoreflect.FieldDescriptor, v protoreflect.Value) bool {
		// Check if this is the graphql_variable_name extension field
		if fd.IsExtension() && fd.Number() == GraphQLVariableNameFieldNumber {
			if v.IsValid() {
				result = v.String()
			}
			return false // Stop iteration
		}
		return true // Continue iteration
	})

	return result
}
