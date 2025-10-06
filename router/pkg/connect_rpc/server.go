package connect_rpc

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/hashicorp/go-retryablehttp"
	"github.com/wundergraph/cosmo/router/pkg/mcpserver"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"go.uber.org/zap"
)

// Options represents configuration options for the ConnectRPCServer
type Options struct {
	// OperationsDir is the directory where GraphQL operations are stored
	OperationsDir string
	// ProtoDir is the directory where generated proto files are stored
	ProtoDir string
	// ListenAddr is the address where the server should listen to
	ListenAddr string
	// Enabled determines whether the Connect RPC server should be started
	Enabled bool
	// Logger is the logger to be used
	Logger *zap.Logger
	// RequestTimeout is the timeout for HTTP requests
	RequestTimeout time.Duration
	// ExcludeMutations determines whether mutation operations should be excluded
	ExcludeMutations bool
}

// ConnectRPCServer represents a Connect RPC server that works with GraphQL operations
type ConnectRPCServer struct {
	operationsDir         string
	protoDir              string
	listenAddr            string
	logger                *zap.Logger
	httpClient            *http.Client
	requestTimeout        time.Duration
	routerGraphQLEndpoint string
	httpServer            *http.Server
	excludeMutations      bool
	operationsManager     *ConnectRPCOperationsManager
	protoManager          *ProtoManager
	schemaCompiler        *mcpserver.SchemaCompiler
}

// NewConnectRPCServer creates a new Connect RPC server
func NewConnectRPCServer(routerGraphQLEndpoint string, opts ...func(*Options)) (*ConnectRPCServer, error) {
	if routerGraphQLEndpoint == "" {
		return nil, fmt.Errorf("routerGraphQLEndpoint cannot be empty")
	}

	if !strings.Contains(routerGraphQLEndpoint, "://") {
		routerGraphQLEndpoint = "http://" + routerGraphQLEndpoint
	}

	// Default options
	options := &Options{
		OperationsDir:  "operations",
		ProtoDir:       "proto",
		ListenAddr:     "0.0.0.0:5026",
		Enabled:        false,
		Logger:         zap.NewNop(),
		RequestTimeout: 30 * time.Second,
	}

	// Apply all option functions
	for _, opt := range opts {
		opt(options)
	}

	retryClient := retryablehttp.NewClient()
	retryClient.Logger = nil
	httpClient := retryClient.StandardClient()
	httpClient.Timeout = 60 * time.Second

	server := &ConnectRPCServer{
		operationsDir:         options.OperationsDir,
		protoDir:              options.ProtoDir,
		listenAddr:            options.ListenAddr,
		logger:                options.Logger,
		httpClient:            httpClient,
		requestTimeout:        options.RequestTimeout,
		routerGraphQLEndpoint: routerGraphQLEndpoint,
		excludeMutations:      options.ExcludeMutations,
	}

	return server, nil
}

// WithOperationsDir sets the operations directory
func WithOperationsDir(operationsDir string) func(*Options) {
	return func(o *Options) {
		o.OperationsDir = operationsDir
	}
}

// WithProtoDir sets the proto directory
func WithProtoDir(protoDir string) func(*Options) {
	return func(o *Options) {
		o.ProtoDir = protoDir
	}
}

// WithListenAddr sets the listen address
func WithListenAddr(listenAddr string) func(*Options) {
	return func(o *Options) {
		o.ListenAddr = listenAddr
	}
}

// WithLogger sets the logger
func WithLogger(logger *zap.Logger) func(*Options) {
	return func(o *Options) {
		o.Logger = logger
	}
}

// WithExcludeMutations sets the exclude mutations option
func WithExcludeMutations(excludeMutations bool) func(*Options) {
	return func(o *Options) {
		o.ExcludeMutations = excludeMutations
	}
}

// WithRequestTimeout sets the request timeout
func WithRequestTimeout(timeout time.Duration) func(*Options) {
	return func(o *Options) {
		o.RequestTimeout = timeout
	}
}

// WithEnabled sets the enabled option
func WithEnabled(enabled bool) func(*Options) {
	return func(o *Options) {
		o.Enabled = enabled
	}
}

// Start loads operations and starts the server
func (s *ConnectRPCServer) Start() error {
	httpServer, err := s.createHTTPServer()
	if err != nil {
		return fmt.Errorf("failed to create HTTP server: %w", err)
	}

	s.httpServer = httpServer

	logger := []zap.Field{
		zap.String("listen_addr", s.listenAddr),
		zap.String("operations_dir", s.operationsDir),
		zap.String("proto_dir", s.protoDir),
		zap.Bool("exclude_mutations", s.excludeMutations),
	}

	s.logger.Info("Connect RPC server started", logger...)

	go func() {
		defer s.logger.Info("Connect RPC server stopped")

		err := httpServer.ListenAndServe()
		if err != nil && err != http.ErrServerClosed {
			s.logger.Error("failed to start HTTP server", zap.Error(err))
		}
	}()

	return nil
}

// Reload reloads the operations and schema using Connect RPC specific components
func (s *ConnectRPCServer) Reload(schema *ast.Document) error {
	s.schemaCompiler = mcpserver.NewSchemaCompiler(s.logger)

	// Initialize ProtoManager for dynamic service discovery
	s.protoManager = NewProtoManager(s.protoDir, s.logger)

	// Load proto files to get service definitions
	if s.protoDir != "" {
		s.logger.Info("Loading proto files for dynamic service registration", zap.String("path", s.protoDir))
		if err := s.protoManager.LoadProtoFiles(); err != nil {
			s.logger.Error("Failed to load proto files",
				zap.String("proto_dir", s.protoDir),
				zap.Error(err))
			return fmt.Errorf("failed to load proto files: %w", err)
		}
		s.logger.Info("Proto files loaded successfully",
			zap.String("proto_dir", s.protoDir),
			zap.Int("services_loaded", len(s.protoManager.services)))
	}

	// Use Connect RPC specific operations manager
	s.operationsManager = NewConnectRPCOperationsManager(schema, s.logger, s.excludeMutations)

	if s.operationsDir != "" {
		s.logger.Info("Loading Connect RPC operations from directory", zap.String("path", s.operationsDir))
		if err := s.operationsManager.LoadOperationsFromDirectory(s.operationsDir); err != nil {
			s.logger.Error("Failed to load operations",
				zap.String("operations_dir", s.operationsDir),
				zap.Error(err))
			return fmt.Errorf("failed to load Connect RPC operations: %w", err)
		}
		operationCount := s.operationsManager.GetOperationCount()
		s.logger.Info("Connect RPC operations loaded successfully",
			zap.Int("operation_count", operationCount))
	}

	s.logger.Info("Connect RPC server reload completed successfully",
		zap.Int("total_operations", s.operationsManager.GetOperationCount()),
		zap.Int("total_services", len(s.protoManager.services)))

	if s.httpServer != nil {
		s.logger.Info("Recreating HTTP server routes after reload",
			zap.Int("proto_services_available", len(s.protoManager.services)))

		if err := s.recreateHTTPServerRoutes(); err != nil {
			s.logger.Error("Failed to recreate HTTP server routes", zap.Error(err))
			return fmt.Errorf("failed to recreate HTTP server routes: %w", err)
		}
	}

	return nil
}

// Stop gracefully shuts down the Connect RPC server
func (s *ConnectRPCServer) Stop(ctx context.Context) error {
	if s.httpServer == nil {
		return fmt.Errorf("server is not started")
	}

	s.logger.Debug("shutting down Connect RPC server")

	// Create a shutdown context with timeout
	shutdownCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if err := s.httpServer.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("failed to gracefully shutdown Connect RPC server: %w", err)
	}

	return nil
}

// createHTTPServer creates and configures the HTTP server
func (s *ConnectRPCServer) createHTTPServer() (*http.Server, error) {
	// Create HTTP server
	httpServer := &http.Server{
		Addr:         s.listenAddr,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	mux := http.NewServeMux()

	// Add CORS middleware
	corsMiddleware := s.withCORS("GET", "POST", "PUT", "DELETE")

	// Add debug endpoint for route inspection
	mux.Handle("/_debug/routes", corsMiddleware(http.HandlerFunc(s.handleDebugRoutes)))

	// Add direct Connect RPC handler for known services
	if s.protoManager != nil && len(s.protoManager.services) > 0 {
		s.logger.Info("Registering Connect RPC handlers",
			zap.Int("services_to_register", len(s.protoManager.services)))

		for serviceName := range s.protoManager.services {
			servicePattern := fmt.Sprintf("/%s/", serviceName)
			s.logger.Debug("Registering Connect RPC handler",
				zap.String("service", serviceName),
				zap.String("pattern", servicePattern))
			mux.Handle(servicePattern, corsMiddleware(http.HandlerFunc(s.handleConnectRPCRequest)))
		}
	} else {
		s.logger.Debug("No proto services available during server creation - will register after reload")
	}

	// Add a catch-all handler for unmatched requests
	mux.Handle("/", corsMiddleware(http.HandlerFunc(s.handleNotFound)))

	httpServer.Handler = mux
	return httpServer, nil
}

// recreateHTTPServerRoutes recreates HTTP server routes after proto services are loaded
func (s *ConnectRPCServer) recreateHTTPServerRoutes() error {
	if s.httpServer == nil {
		return fmt.Errorf("HTTP server not initialized")
	}

	s.logger.Info("Recreating HTTP server routes with proto services",
		zap.Int("proto_services_count", len(s.protoManager.services)))

	// Create a new mux with updated routes
	mux := http.NewServeMux()
	corsMiddleware := s.withCORS("GET", "POST", "PUT", "DELETE")

	// Add debug endpoint
	mux.Handle("/_debug/routes", corsMiddleware(http.HandlerFunc(s.handleDebugRoutes)))

	// Add direct Connect RPC handlers for known services
	if s.protoManager != nil && len(s.protoManager.services) > 0 {
		s.logger.Info("Registering Connect RPC handlers after reload",
			zap.Int("services_to_register", len(s.protoManager.services)))

		for serviceName := range s.protoManager.services {
			servicePattern := fmt.Sprintf("/%s/", serviceName)
			s.logger.Debug("Registering Connect RPC handler after reload",
				zap.String("service", serviceName),
				zap.String("pattern", servicePattern))
			mux.Handle(servicePattern, corsMiddleware(http.HandlerFunc(s.handleConnectRPCRequest)))
		}
	}

	// Add catch-all handler for unmatched requests
	mux.Handle("/", corsMiddleware(http.HandlerFunc(s.handleNotFound)))

	// Replace the server's handler
	s.httpServer.Handler = mux

	s.logger.Info("HTTP server routes recreated successfully",
		zap.Int("handlers_registered", len(s.protoManager.services)))

	return nil
}

// extractMethodNameFromProcedure extracts method name from Connect RPC procedure
func (s *ConnectRPCServer) extractMethodNameFromProcedure(procedure string) (string, error) {
	// Connect RPC procedure format: /package.Service/Method
	parts := strings.Split(strings.TrimPrefix(procedure, "/"), "/")
	if len(parts) != 2 {
		return "", fmt.Errorf("invalid procedure format: %s", procedure)
	}
	return parts[1], nil
}

// validateServicePath validates that the service path exists in proto definitions
func (s *ConnectRPCServer) validateServicePath(procedure string) error {
	parts := strings.Split(strings.TrimPrefix(procedure, "/"), "/")
	if len(parts) != 2 {
		return fmt.Errorf("invalid procedure format: %s", procedure)
	}

	servicePath := parts[0] // e.g., "employee.v1.EmployeeService"
	methodName := parts[1]  // e.g., "GetEmployeeByID"

	// If proto manager is not initialized, skip validation
	if s.protoManager == nil {
		s.logger.Warn("ProtoManager not initialized, skipping service path validation",
			zap.String("service_path", servicePath),
			zap.String("method", methodName))
		return nil
	}

	// Check if service exists in proto definitions
	serviceInfo, exists := s.protoManager.services[servicePath]
	if !exists {
		return fmt.Errorf("service not found: %s (available services: %v)",
			servicePath, s.getAvailableServices())
	}

	// Check if method exists in service
	for _, method := range serviceInfo.Methods {
		if method.Name == methodName {
			s.logger.Info("Service path validation successful",
				zap.String("service_path", servicePath),
				zap.String("method", methodName))
			return nil // Valid service and method
		}
	}

	return fmt.Errorf("method %s not found in service %s", methodName, servicePath)
}

// getAvailableServices returns a list of available service names for error reporting
func (s *ConnectRPCServer) getAvailableServices() []string {
	if s.protoManager == nil {
		return []string{}
	}

	var services []string
	for serviceName := range s.protoManager.services {
		services = append(services, serviceName)
	}
	return services
}

// executeGraphQLOperation executes a GraphQL query against the router endpoint
func (s *ConnectRPCServer) executeGraphQLOperation(ctx context.Context, query string, variables json.RawMessage) (json.RawMessage, error) {
	// Create the GraphQL request
	graphqlRequest := struct {
		Query     string          `json:"query"`
		Variables json.RawMessage `json:"variables,omitempty"`
	}{
		Query:     query,
		Variables: variables,
	}

	requestBody, err := json.Marshal(graphqlRequest)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal GraphQL request: %w", err)
	}

	// Create HTTP request
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.routerGraphQLEndpoint, strings.NewReader(string(requestBody)))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json; charset=utf-8")

	// Execute the request
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	body, err := json.RawMessage{}, error(nil)
	if err = json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	var graphqlResponse struct {
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
		Data json.RawMessage `json:"data"`
	}

	if err := json.Unmarshal(body, &graphqlResponse); err == nil && len(graphqlResponse.Errors) > 0 {
		var errorMessages []string
		for _, gqlErr := range graphqlResponse.Errors {
			errorMessages = append(errorMessages, gqlErr.Message)
		}
		return nil, fmt.Errorf("GraphQL errors: %s", strings.Join(errorMessages, "; "))
	}

	return body, nil
}


// handleDebugRoutes provides debug information about available routes and services
func (s *ConnectRPCServer) handleDebugRoutes(w http.ResponseWriter, r *http.Request) {
	debugInfo := map[string]interface{}{
		"timestamp": time.Now().UTC().Format(time.RFC3339),
		"server_status": map[string]interface{}{
			"operations_manager_initialized": s.operationsManager != nil,
			"proto_manager_initialized":      s.protoManager != nil,
		},
	}

	// Add proto services information
	if s.protoManager != nil {
		protoServices := make(map[string]interface{})
		for serviceName, serviceInfo := range s.protoManager.services {
			methods := make([]string, len(serviceInfo.Methods))
			for i, method := range serviceInfo.Methods {
				methods[i] = method.Name
			}
			protoServices[serviceName] = map[string]interface{}{
				"package":          serviceInfo.Package,
				"methods":          methods,
				"endpoint_pattern": fmt.Sprintf("/%s/*", serviceName),
			}
		}
		debugInfo["proto_services"] = protoServices
		debugInfo["proto_services_count"] = len(s.protoManager.services)
	} else {
		debugInfo["proto_services"] = "ProtoManager not initialized"
		debugInfo["proto_services_count"] = 0
	}

	// Add operations information
	if s.operationsManager != nil {
		operations := s.operationsManager.GetOperations()
		operationNames := make([]string, len(operations))
		for i, op := range operations {
			operationNames[i] = op.Name
		}
		debugInfo["graphql_operations"] = operationNames
		debugInfo["graphql_operations_count"] = len(operations)
	} else {
		debugInfo["graphql_operations"] = "OperationsManager not initialized"
		debugInfo["graphql_operations_count"] = 0
	}

	// Add server type information
	debugInfo["server_type"] = "pure_http"

	// Add configuration
	debugInfo["configuration"] = map[string]interface{}{
		"listen_addr":       s.listenAddr,
		"operations_dir":    s.operationsDir,
		"proto_dir":         s.protoDir,
		"exclude_mutations": s.excludeMutations,
		"graphql_endpoint":  s.routerGraphQLEndpoint,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(debugInfo)
}

// handleNotFound handles requests that don't match any registered service
func (s *ConnectRPCServer) handleNotFound(w http.ResponseWriter, r *http.Request) {
	s.logger.Debug("Request not found",
		zap.String("method", r.Method),
		zap.String("path", r.URL.Path))

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusNotFound)
	
	errorResponse := map[string]interface{}{
		"error": "Service not found",
		"path":  r.URL.Path,
		"available_services": s.getAvailableServices(),
	}
	
	json.NewEncoder(w).Encode(errorResponse)
}

// handleConnectRPCRequest handles Connect RPC requests
func (s *ConnectRPCServer) handleConnectRPCRequest(w http.ResponseWriter, r *http.Request) {
	s.logger.Debug("Handling Connect RPC request",
		zap.String("method", r.Method),
		zap.String("path", r.URL.Path),
		zap.String("content_type", r.Header.Get("Content-Type")))

	// Extract method name from URL path
	methodName, err := s.extractMethodNameFromProcedure(r.URL.Path)
	if err != nil {
		s.logger.Error("Failed to extract method name",
			zap.String("path", r.URL.Path),
			zap.Error(err))
		http.Error(w, fmt.Sprintf("failed to extract method name: %v", err), http.StatusBadRequest)
		return
	}

	// Validate service path exists in proto definitions
	if err := s.validateServicePath(r.URL.Path); err != nil {
		s.logger.Error("Service path validation failed",
			zap.String("path", r.URL.Path),
			zap.String("method", methodName),
			zap.Error(err))
		http.Error(w, fmt.Sprintf("service validation failed: %v", err), http.StatusNotFound)
		return
	}

	// Look up the GraphQL operation
	if s.operationsManager == nil {
		s.logger.Error("Operations manager not initialized")
		http.Error(w, "operations manager not initialized", http.StatusInternalServerError)
		return
	}

	operation := s.operationsManager.GetOperation(methodName)
	if operation == nil {
		s.logger.Error("No GraphQL operation found",
			zap.String("method", methodName),
			zap.Int("available_operations", s.operationsManager.GetOperationCount()))
		http.Error(w, fmt.Sprintf("no GraphQL operation found for method: %s", methodName), http.StatusNotFound)
		return
	}

	// Parse request body as JSON variables
	var variables json.RawMessage
	if r.Body != nil {
		if err := json.NewDecoder(r.Body).Decode(&variables); err != nil {
			s.logger.Error("Failed to decode request body", zap.Error(err))
			http.Error(w, fmt.Sprintf("failed to decode request body: %v", err), http.StatusBadRequest)
			return
		}
	}

	s.logger.Debug("Executing GraphQL operation",
		zap.String("method", methodName),
		zap.String("operation_name", operation.Name),
		zap.String("operation_type", operation.OperationType))

	// Execute GraphQL operation
	result, err := s.executeGraphQLOperation(r.Context(), operation.OperationString, variables)
	if err != nil {
		s.logger.Error("GraphQL execution failed",
			zap.String("method", methodName),
			zap.Error(err))
		http.Error(w, fmt.Sprintf("GraphQL execution failed: %v", err), http.StatusInternalServerError)
		return
	}

	s.logger.Debug("GraphQL execution successful",
		zap.String("method", methodName),
		zap.Int("response_size", len(result)))

	// Transform GraphQL response to proto format
	protoResponse, err := s.transformGraphQLResponseToProto(result, methodName)
	if err != nil {
		s.logger.Error("Failed to transform response to proto format",
			zap.String("method", methodName),
			zap.Error(err))
		http.Error(w, fmt.Sprintf("response transformation failed: %v", err), http.StatusInternalServerError)
		return
	}

	s.logger.Debug("Response transformed to proto format",
		zap.String("method", methodName),
		zap.Int("proto_response_size", len(protoResponse)))

	// Return the proto-formatted response
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(protoResponse)
}

// transformGraphQLResponseToProto transforms GraphQL response to proto message format
func (s *ConnectRPCServer) transformGraphQLResponseToProto(graphqlResponse json.RawMessage, methodName string) (json.RawMessage, error) {
	var gqlResp struct {
		Data   json.RawMessage `json:"data"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}

	if err := json.Unmarshal(graphqlResponse, &gqlResp); err != nil {
		return nil, fmt.Errorf("failed to parse GraphQL response: %w", err)
	}

	// Check for GraphQL errors
	if len(gqlResp.Errors) > 0 {
		var errorMessages []string
		for _, gqlErr := range gqlResp.Errors {
			errorMessages = append(errorMessages, gqlErr.Message)
		}
		return nil, fmt.Errorf("GraphQL errors: %s", strings.Join(errorMessages, "; "))
	}

	// Extract the data field - this removes the GraphQL "data" wrapper
	// For Connect RPC, we want to return the proto message directly
	if gqlResp.Data == nil {
		return json.RawMessage("{}"), nil
	}

	return gqlResp.Data, nil
}

// withCORS creates a CORS middleware
func (s *ConnectRPCServer) withCORS(allowedMethods ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			// Set CORS headers for all requests
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", strings.Join(append(allowedMethods, "OPTIONS"), ", "))
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization, Connect-Protocol-Version, Connect-Timeout-Ms")
			w.Header().Set("Access-Control-Max-Age", "86400") // 24 hours

			// Handle preflight OPTIONS requests
			if req.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}

			// Call the next handler
			next.ServeHTTP(w, req)
		})
	}
}
