package connectrpc

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"go.uber.org/zap"
)

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

// GraphQLRequest represents a GraphQL request structure
type GraphQLRequest struct {
	Query     string          `json:"query"`
	Variables json.RawMessage `json:"variables,omitempty"`
}

// GraphQLError represents an error returned in a GraphQL response
type GraphQLError struct {
	Message string `json:"message"`
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

	// Check for HTTP errors
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GraphQL request failed with status %d: %s", resp.StatusCode, string(responseBody))
	}

	// Parse the GraphQL response to unwrap the data field
	var graphqlResponse GraphQLResponse
	if err := json.Unmarshal(responseBody, &graphqlResponse); err != nil {
		// If we can't parse it, return the raw response
		h.logger.Warn("failed to parse GraphQL response", zap.Error(err))
		return responseBody, nil
	}

	// Log GraphQL errors if present
	if len(graphqlResponse.Errors) > 0 {
		var errorMessages []string
		for _, gqlErr := range graphqlResponse.Errors {
			errorMessages = append(errorMessages, gqlErr.Message)
		}
		h.logger.Warn("GraphQL response contains errors",
			zap.Strings("errors", errorMessages))
	}

	// Return only the data field if it's not null/empty
	// The proto response message expects just the data payload: {...}
	// Not the GraphQL wrapper: {"data": {...}, "errors": [...]}
	if len(graphqlResponse.Data) > 0 && string(graphqlResponse.Data) != "null" {
		return graphqlResponse.Data, nil
	}

	// If there's no data or data is null, return the full response (which might contain errors)
	return responseBody, nil
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

// GetOperations returns information about available operations
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
