package connectrpc

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"go.uber.org/zap"
)

// HandlerMode determines how the handler processes RPC requests
type HandlerMode string

const (
	// HandlerModeDynamic generates GraphQL operations dynamically from proto definitions
	HandlerModeDynamic HandlerMode = "dynamic"
	// HandlerModePredefined uses pre-defined GraphQL operations from the registry
	HandlerModePredefined HandlerMode = "predefined"
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
	mode              HandlerMode
	graphqlEndpoint   string
	httpClient        *http.Client
	logger            *zap.Logger
	operationBuilder  *OperationBuilder
	operationRegistry *OperationRegistry
	protoLoader       *ProtoLoader
}

// HandlerConfig contains configuration for the RPC handler
type HandlerConfig struct {
	Mode              HandlerMode
	GraphQLEndpoint   string
	HTTPClient        *http.Client
	Logger            *zap.Logger
	OperationBuilder  *OperationBuilder
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
		config.Logger = zap.NewNop()
	}

	// Validate mode-specific dependencies
	switch config.Mode {
	case HandlerModeDynamic:
		if config.OperationBuilder == nil {
			return nil, fmt.Errorf("operation builder is required for dynamic mode")
		}
		if config.ProtoLoader == nil {
			return nil, fmt.Errorf("proto loader is required for dynamic mode")
		}
		// In dynamic mode, we also need an operation registry for caching
		if config.OperationRegistry == nil {
			return nil, fmt.Errorf("operation registry is required for dynamic mode (for caching)")
		}
	case HandlerModePredefined:
		if config.OperationRegistry == nil {
			return nil, fmt.Errorf("operation registry is required for predefined mode")
		}
	default:
		return nil, fmt.Errorf("invalid handler mode: %s", config.Mode)
	}

	// Ensure the endpoint has a protocol
	if !strings.Contains(config.GraphQLEndpoint, "://") {
		config.GraphQLEndpoint = "http://" + config.GraphQLEndpoint
	}

	return &RPCHandler{
		mode:              config.Mode,
		graphqlEndpoint:   config.GraphQLEndpoint,
		httpClient:        config.HTTPClient,
		logger:            config.Logger,
		operationBuilder:  config.OperationBuilder,
		operationRegistry: config.OperationRegistry,
		protoLoader:       config.ProtoLoader,
	}, nil
}

// HandleRPC processes an RPC request and returns a response
// serviceName: fully qualified service name (e.g., "mypackage.MyService")
// methodName: the RPC method name (e.g., "GetUser")
// requestJSON: the JSON-encoded request body from Vanguard
// ctx: request context with headers
func (h *RPCHandler) HandleRPC(ctx context.Context, serviceName, methodName string, requestJSON []byte) ([]byte, error) {
	h.logger.Debug("handling RPC request",
		zap.String("service", serviceName),
		zap.String("method", methodName),
		zap.String("mode", string(h.mode)))

	var graphqlQuery string
	var variables json.RawMessage

	switch h.mode {
	case HandlerModeDynamic:
		// Dynamic mode: generate GraphQL operation from proto definition
		query, vars, err := h.handleDynamicMode(serviceName, methodName, requestJSON)
		if err != nil {
			return nil, fmt.Errorf("failed to handle dynamic mode: %w", err)
		}
		graphqlQuery = query
		variables = vars

	case HandlerModePredefined:
		// Predefined mode: look up operation from registry
		query, vars, err := h.handlePredefinedMode(methodName, requestJSON)
		if err != nil {
			return nil, fmt.Errorf("failed to handle predefined mode: %w", err)
		}
		graphqlQuery = query
		variables = vars

	default:
		return nil, fmt.Errorf("unsupported handler mode: %s", h.mode)
	}

	// Execute the GraphQL query
	responseJSON, err := h.executeGraphQL(ctx, graphqlQuery, variables)
	if err != nil {
		return nil, fmt.Errorf("failed to execute GraphQL query: %w", err)
	}

	return responseJSON, nil
}

// handleDynamicMode looks up a dynamically generated operation from the registry
// In Dynamic Mode, operations are pre-generated at startup and cached in the registry
func (h *RPCHandler) handleDynamicMode(serviceName, methodName string, requestJSON []byte) (string, json.RawMessage, error) {
	// Look up the operation in the registry (it was pre-generated at startup)
	operation := h.operationRegistry.GetOperation(methodName)
	if operation == nil {
		return "", nil, fmt.Errorf("operation not found in registry: %s (this should have been generated at startup)", methodName)
	}

	h.logger.Debug("using dynamically generated operation from registry",
		zap.String("service", serviceName),
		zap.String("method", methodName),
		zap.String("type", operation.OperationType))

	// Use the operation string and request JSON as variables
	return operation.OperationString, requestJSON, nil
}

// handlePredefinedMode looks up a pre-defined operation from the registry
func (h *RPCHandler) handlePredefinedMode(methodName string, requestJSON []byte) (string, json.RawMessage, error) {
	// Look up the operation in the registry
	// The method name should match the operation name
	operation := h.operationRegistry.GetOperation(methodName)
	if operation == nil {
		return "", nil, fmt.Errorf("operation not found in registry: %s", methodName)
	}

	h.logger.Debug("using predefined operation",
		zap.String("operation", operation.Name),
		zap.String("type", operation.OperationType))

	// Use the operation string and request JSON as variables
	return operation.OperationString, requestJSON, nil
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

	// Parse the GraphQL response to check for errors
	var graphqlResponse GraphQLResponse
	if err := json.Unmarshal(responseBody, &graphqlResponse); err != nil {
		// If we can't parse it, return the raw response
		h.logger.Warn("failed to parse GraphQL response", zap.Error(err))
		return responseBody, nil
	}

	// If there are GraphQL errors, log them but still return the response
	// Vanguard will handle error transcoding
	if len(graphqlResponse.Errors) > 0 {
		var errorMessages []string
		for _, gqlErr := range graphqlResponse.Errors {
			errorMessages = append(errorMessages, gqlErr.Message)
		}
		h.logger.Debug("GraphQL response contains errors",
			zap.Strings("errors", errorMessages))
	}

	return responseBody, nil
}

// Reload reloads the handler's dependencies (for predefined mode)
func (h *RPCHandler) Reload(schema *ast.Document, operationsDir string) error {
	if h.mode != HandlerModePredefined {
		return nil // Nothing to reload in dynamic mode
	}

	if h.operationRegistry == nil {
		return fmt.Errorf("operation registry is nil")
	}

	// Reload operations from directory
	if operationsDir != "" {
		if err := h.operationRegistry.LoadFromDirectory(operationsDir, schema); err != nil {
			return fmt.Errorf("failed to reload operations: %w", err)
		}
		h.logger.Info("reloaded operations",
			zap.Int("count", h.operationRegistry.Count()))
	}

	return nil
}

// GetMode returns the current handler mode
func (h *RPCHandler) GetMode() HandlerMode {
	return h.mode
}

// GetOperationCount returns the number of operations available
// For dynamic mode, returns the number of methods in all services
// For predefined mode, returns the number of operations in the registry
func (h *RPCHandler) GetOperationCount() int {
	switch h.mode {
	case HandlerModeDynamic:
		if h.protoLoader == nil {
			return 0
		}
		count := 0
		for _, service := range h.protoLoader.GetServices() {
			count += len(service.Methods)
		}
		return count
	case HandlerModePredefined:
		if h.operationRegistry == nil {
			return 0
		}
		return h.operationRegistry.Count()
	default:
		return 0
	}
}

// GetOperations returns information about available operations
// For dynamic mode, returns method definitions from proto loader
// For predefined mode, returns operations from the registry
func (h *RPCHandler) GetOperations() interface{} {
	switch h.mode {
	case HandlerModeDynamic:
		if h.protoLoader == nil {
			return nil
		}
		return h.protoLoader.GetServices()
	case HandlerModePredefined:
		if h.operationRegistry == nil {
			return nil
		}
		return h.operationRegistry.GetAllOperations()
	default:
		return nil
	}
}

// ValidateOperation checks if an operation is available
func (h *RPCHandler) ValidateOperation(serviceName, methodName string) error {
	switch h.mode {
	case HandlerModeDynamic:
		if h.protoLoader == nil {
			return fmt.Errorf("proto loader is not initialized")
		}
		_, err := h.protoLoader.GetMethod(serviceName, methodName)
		if err != nil {
			return fmt.Errorf("method not found: %w", err)
		}
		return nil
	case HandlerModePredefined:
		if h.operationRegistry == nil {
			return fmt.Errorf("operation registry is not initialized")
		}
		if !h.operationRegistry.HasOperation(methodName) {
			return fmt.Errorf("operation not found: %s", methodName)
		}
		return nil
	default:
		return fmt.Errorf("unsupported handler mode: %s", h.mode)
	}
}

// GetOperationInfo returns detailed information about a specific operation
func (h *RPCHandler) GetOperationInfo(serviceName, methodName string) (interface{}, error) {
	switch h.mode {
	case HandlerModeDynamic:
		if h.protoLoader == nil {
			return nil, fmt.Errorf("proto loader is not initialized")
		}
		method, err := h.protoLoader.GetMethod(serviceName, methodName)
		if err != nil {
			return nil, fmt.Errorf("method not found: %w", err)
		}
		return method, nil
	case HandlerModePredefined:
		if h.operationRegistry == nil {
			return nil, fmt.Errorf("operation registry is not initialized")
		}
		operation := h.operationRegistry.GetOperation(methodName)
		if operation == nil {
			return nil, fmt.Errorf("operation not found: %s", methodName)
		}
		return operation, nil
	default:
		return nil, fmt.Errorf("unsupported handler mode: %s", h.mode)
	}
}