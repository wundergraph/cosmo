package connect_rpc

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"connectrpc.com/vanguard"
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
	vanguardServer        *vanguard.Transcoder
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
	s.logger.Info("DIAGNOSTIC: Connect RPC server reload started",
		zap.String("operations_dir", s.operationsDir),
		zap.String("proto_dir", s.protoDir),
		zap.Int("schema_directive_definitions", len(schema.DirectiveDefinitions)),
		zap.Bool("operations_manager_was_nil", s.operationsManager == nil),
		zap.Bool("proto_manager_was_nil", s.protoManager == nil))

	s.schemaCompiler = mcpserver.NewSchemaCompiler(s.logger)
	
	// Initialize ProtoManager for dynamic service discovery
	s.protoManager = NewProtoManager(s.protoDir, s.logger)
	s.logger.Debug("DIAGNOSTIC: ProtoManager initialized",
		zap.Bool("proto_manager_initialized", s.protoManager != nil))
	
	// Load proto files to get service definitions
	if s.protoDir != "" {
		s.logger.Info("Loading proto files for dynamic service registration", zap.String("path", s.protoDir))
		if err := s.protoManager.LoadProtoFiles(); err != nil {
			s.logger.Error("DIAGNOSTIC: Failed to load proto files",
				zap.String("proto_dir", s.protoDir),
				zap.Error(err))
			return fmt.Errorf("failed to load proto files: %w", err)
		}
		s.logger.Info("DIAGNOSTIC: Proto files loaded successfully",
			zap.String("proto_dir", s.protoDir),
			zap.Int("services_loaded", len(s.protoManager.services)))
	}

	// Use Connect RPC specific operations manager
	s.operationsManager = NewConnectRPCOperationsManager(schema, s.logger, s.excludeMutations)
	s.logger.Debug("DIAGNOSTIC: Operations manager initialized",
		zap.Bool("operations_manager_initialized", s.operationsManager != nil))

	if s.operationsDir != "" {
		s.logger.Info("Loading Connect RPC operations from directory", zap.String("path", s.operationsDir))
		if err := s.operationsManager.LoadOperationsFromDirectory(s.operationsDir); err != nil {
			s.logger.Error("DIAGNOSTIC: Failed to load operations",
				zap.String("operations_dir", s.operationsDir),
				zap.Error(err))
			return fmt.Errorf("failed to load Connect RPC operations: %w", err)
		}
		operationCount := s.operationsManager.GetOperationCount()
		s.logger.Info("DIAGNOSTIC: Connect RPC operations loaded successfully",
			zap.Int("operation_count", operationCount))
		
		// Log available operations for debugging
		if operationCount > 0 {
			operations := s.operationsManager.GetOperations()
			operationNames := make([]string, len(operations))
			for i, op := range operations {
				operationNames[i] = op.Name
			}
			s.logger.Debug("DIAGNOSTIC: Available operations after reload",
				zap.Strings("operation_names", operationNames))
		}
	}

	// Recreate Vanguard transcoder with dynamic services
	if err := s.recreateVanguardTranscoder(); err != nil {
		s.logger.Error("DIAGNOSTIC: Failed to recreate Vanguard transcoder", zap.Error(err))
		return fmt.Errorf("failed to recreate Vanguard transcoder: %w", err)
	}

	s.logger.Info("DIAGNOSTIC: Connect RPC server reload completed successfully",
		zap.Bool("operations_manager_initialized", s.operationsManager != nil),
		zap.Bool("proto_manager_initialized", s.protoManager != nil),
		zap.Bool("schema_compiler_initialized", s.schemaCompiler != nil),
		zap.Bool("vanguard_server_initialized", s.vanguardServer != nil),
		zap.Int("total_operations", s.operationsManager.GetOperationCount()),
		zap.Int("total_services", len(s.protoManager.services)))

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

// createHTTPServer creates and configures the HTTP server with vanguard
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

	// Use Vanguard transcoder for proper Connect RPC protocol handling
	if s.vanguardServer != nil {
		s.logger.Info("Using Vanguard transcoder for Connect RPC protocol handling",
			zap.Bool("dynamic_services", true))
		
		// Let Vanguard handle all Connect RPC protocols (proto, JSON, gRPC, gRPC-Web)
		mux.Handle("/", corsMiddleware(s.vanguardServer))
	} else {
		s.logger.Warn("Vanguard transcoder not initialized, using fallback handler")
		mux.Handle("/", corsMiddleware(http.HandlerFunc(s.handleConnectRPCRequestHTTP)))
	}

	httpServer.Handler = mux
	return httpServer, nil
}

// recreateVanguardTranscoder creates a new Vanguard transcoder with dynamic services
func (s *ConnectRPCServer) recreateVanguardTranscoder() error {
	if s.protoManager == nil {
		s.logger.Warn("ProtoManager not initialized, creating empty Vanguard transcoder")
		transcoder, err := vanguard.NewTranscoder([]*vanguard.Service{})
		if err != nil {
			return fmt.Errorf("failed to create empty Vanguard transcoder: %w", err)
		}
		s.vanguardServer = transcoder
		return nil
	}

	// Create dynamic services from proto definitions
	services, err := s.createDynamicVanguardServices()
	if err != nil {
		return fmt.Errorf("failed to create dynamic Vanguard services: %w", err)
	}

	s.logger.Info("Creating Vanguard transcoder with dynamic services",
		zap.Int("service_count", len(services)))

	// Create new transcoder with dynamic services
	transcoder, err := vanguard.NewTranscoder(services)
	if err != nil {
		return fmt.Errorf("failed to create Vanguard transcoder: %w", err)
	}

	s.vanguardServer = transcoder
	return nil
}

// createDynamicVanguardServices creates Vanguard services from proto definitions
func (s *ConnectRPCServer) createDynamicVanguardServices() ([]*vanguard.Service, error) {
	// For now, return empty services since we need proper proto compilation
	// The main fix is in the service path validation, not the Vanguard setup
	s.logger.Info("Skipping dynamic Vanguard service creation",
		zap.String("reason", "Requires proper proto compilation for full implementation"),
		zap.String("current_approach", "Using fallback handler with service validation"))
	
	return []*vanguard.Service{}, nil
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

// handleConnectRPCRequestHTTP handles incoming HTTP requests and routes them to GraphQL (fallback handler)
func (s *ConnectRPCServer) handleConnectRPCRequestHTTP(w http.ResponseWriter, r *http.Request) {
	s.logger.Info("Using fallback HTTP handler (Vanguard not available)",
		zap.String("path", r.URL.Path),
		zap.String("method", r.Method))

	// Validate service path against proto definitions
	if err := s.validateServicePath(r.URL.Path); err != nil {
		http.Error(w, fmt.Sprintf("invalid service path: %v", err), http.StatusNotFound)
		return
	}

	// Extract method name from URL path
	methodName, err := s.extractMethodNameFromProcedure(r.URL.Path)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to extract method name: %v", err), http.StatusBadRequest)
		return
	}

	// Look up the GraphQL operation
	if s.operationsManager == nil {
		http.Error(w, "operations manager not initialized", http.StatusInternalServerError)
		return
	}

	operation := s.operationsManager.GetOperation(methodName)
	if operation == nil {
		http.Error(w, fmt.Sprintf("no GraphQL operation found for method: %s", methodName), http.StatusNotFound)
		return
	}

	// Parse request body as JSON variables
	var variables json.RawMessage
	if r.Body != nil {
		if err := json.NewDecoder(r.Body).Decode(&variables); err != nil {
			http.Error(w, fmt.Sprintf("failed to decode request body: %v", err), http.StatusBadRequest)
			return
		}
	}

	s.logger.Info("Processing Connect RPC request via fallback handler",
		zap.String("path", r.URL.Path),
		zap.String("method", methodName),
		zap.String("operation", operation.Name),
		zap.String("variables", string(variables)))

	// Execute GraphQL operation
	result, err := s.executeGraphQLQuery(r.Context(), operation.OperationString, variables)
	if err != nil {
		http.Error(w, fmt.Sprintf("GraphQL execution failed: %v", err), http.StatusInternalServerError)
		return
	}

	// Return the result as JSON response
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(result)
}

// executeGraphQLQuery executes a GraphQL query against the router endpoint
func (s *ConnectRPCServer) executeGraphQLQuery(ctx context.Context, query string, variables json.RawMessage) (json.RawMessage, error) {
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
	req, err := http.NewRequestWithContext(ctx, "POST", s.routerGraphQLEndpoint, strings.NewReader(string(requestBody)))
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

	// Read response body
	body, err := json.RawMessage{}, error(nil)
	if err = json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	// Check for GraphQL errors
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

// stripOpenAPIDirective removes @openapi directive from GraphQL operation string
// since the GraphQL router doesn't recognize this directive
func (s *ConnectRPCServer) stripOpenAPIDirective(operationString string) string {
	// Use regex to remove @openapi directive and its arguments
	// Pattern matches: @openapi(...) including multi-line arguments
	lines := strings.Split(operationString, "\n")
	var cleanedLines []string
	inOpenAPIDirective := false
	parenCount := 0
	
	for _, line := range lines {
		trimmedLine := strings.TrimSpace(line)
		
		// Check if line starts @openapi directive
		if strings.Contains(trimmedLine, "@openapi") {
			inOpenAPIDirective = true
			// Count opening parentheses in this line
			parenCount += strings.Count(line, "(") - strings.Count(line, ")")
			// If directive closes on same line, we're done
			if parenCount <= 0 {
				inOpenAPIDirective = false
			}
			continue
		}
		
		// If we're inside the directive, count parentheses and skip line
		if inOpenAPIDirective {
			parenCount += strings.Count(line, "(") - strings.Count(line, ")")
			if parenCount <= 0 {
				inOpenAPIDirective = false
			}
			continue
		}
		
		// Keep lines that are not part of @openapi directive
		cleanedLines = append(cleanedLines, line)
	}
	
	return strings.Join(cleanedLines, "\n")
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
