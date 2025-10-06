package connect_rpc

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/hashicorp/go-retryablehttp"
	"github.com/wundergraph/cosmo/router/pkg/mcpserver"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"go.uber.org/zap"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
	"google.golang.org/protobuf/types/known/structpb"
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

	// Register dynamic Connect RPC handlers using Connect-Go's interceptor system
	if s.protoManager != nil && len(s.protoManager.services) > 0 {
		s.logger.Info("Registering Connect RPC handlers with interceptors",
			zap.Int("services_to_register", len(s.protoManager.services)))

		// Create Connect-Go interceptor for dynamic routing
		interceptor := s.createConnectInterceptor()

		for serviceName, serviceInfo := range s.protoManager.services {
			for _, method := range serviceInfo.Methods {
				methodPath := fmt.Sprintf("/%s/%s", serviceName, method.Name)

				s.logger.Debug("Registering Connect RPC handler with interceptor",
					zap.String("service", serviceName),
					zap.String("method", method.Name),
					zap.String("path", methodPath))

				// Create Connect handler with interceptor - Connect-Go handles all protocol detection
				// Enable GET requests for idempotent operations (marked with NO_SIDE_EFFECTS in proto)
				handler := connect.NewUnaryHandler(
					methodPath,
					func(ctx context.Context, req *connect.Request[structpb.Struct]) (*connect.Response[structpb.Struct], error) {
						// This should never be called since the interceptor handles everything
						return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("handler called - interceptor should handle all requests"))
					},
					connect.WithInterceptors(interceptor),
					connect.WithIdempotency(connect.IdempotencyNoSideEffects), // Enable GET for idempotent methods
				)

				mux.Handle(methodPath, corsMiddleware(handler))
			}
		}
	} else {
		s.logger.Debug("No proto services available during server creation - will register after reload")
	}

	// Add a catch-all handler for unmatched requests
	mux.Handle("/", corsMiddleware(http.HandlerFunc(s.handleNotFound)))

	// Enable HTTP/2 support for gRPC compatibility
	// h2c enables HTTP/2 cleartext (without TLS) which is needed for grpcurl -plaintext
	h2cHandler := h2c.NewHandler(mux, &http2.Server{})
	httpServer.Handler = h2cHandler

	s.logger.Info("HTTP server configured with HTTP/2 support for gRPC compatibility",
		zap.String("listen_addr", s.listenAddr),
		zap.Bool("http2_enabled", true))

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

	// Register dynamic Connect handlers for each proto service method
	if s.protoManager != nil && len(s.protoManager.services) > 0 {
		s.logger.Info("Registering Connect RPC handlers after reload",
			zap.Int("services_to_register", len(s.protoManager.services)))

		// Create Connect-Go interceptor for dynamic routing
		interceptor := s.createConnectInterceptor()

		for serviceName, serviceInfo := range s.protoManager.services {
			for _, method := range serviceInfo.Methods {
				methodPath := fmt.Sprintf("/%s/%s", serviceName, method.Name)

				s.logger.Debug("Registering Connect RPC handler after reload",
					zap.String("service", serviceName),
					zap.String("method", method.Name),
					zap.String("path", methodPath))

				s.logger.Debug("Creating Connect RPC handler with interceptor",
					zap.String("method_path", methodPath),
					zap.String("method_name", method.Name),
					zap.String("input_type", method.InputType),
					zap.String("output_type", method.OutputType))

				// Create Connect handler with interceptor - Connect-Go handles all protocol detection
				// Enable GET requests for idempotent operations (marked with NO_SIDE_EFFECTS in proto)
				handler := connect.NewUnaryHandler(
					methodPath,
					func(ctx context.Context, req *connect.Request[structpb.Struct]) (*connect.Response[structpb.Struct], error) {
						// This should never be called since the interceptor handles everything
						return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("handler called - interceptor should handle all requests"))
					},
					connect.WithInterceptors(interceptor),
					connect.WithIdempotency(connect.IdempotencyNoSideEffects), // Enable GET for idempotent methods
				)

				mux.Handle(methodPath, corsMiddleware(handler))
			}
		}
	}

	// Add catch-all handler for unmatched requests
	mux.Handle("/", corsMiddleware(http.HandlerFunc(s.handleNotFound)))

	// Enable HTTP/2 support for gRPC compatibility (same as createHTTPServer)
	h2cHandler := h2c.NewHandler(mux, &http2.Server{})
	s.httpServer.Handler = h2cHandler

	s.logger.Info("HTTP server routes recreated successfully with HTTP/2 support",
		zap.Int("handlers_registered", len(s.protoManager.services)),
		zap.Bool("http2_enabled", true))

	return nil
}

// createConnectInterceptor creates a Connect-Go interceptor for dynamic GraphQL routing
// This leverages Connect-Go's built-in protocol detection and encoding/decoding
func (s *ConnectRPCServer) createConnectInterceptor() connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			// Extract method name from Connect-Go procedure
			methodName := s.extractMethodFromProcedure(req.Spec().Procedure)

			// Get protocol info from Connect-Go (automatic detection)
			protocol := req.Peer().Protocol

			s.logger.Debug("Processing Connect RPC request",
				zap.String("method", methodName),
				zap.String("protocol", protocol))

			// Get the GraphQL operation
			operation := s.operationsManager.GetOperation(methodName)
			if operation == nil {
				s.logger.Error("No GraphQL operation found",
					zap.String("method", methodName),
					zap.Int("available_operations", s.operationsManager.GetOperationCount()))
				return nil, connect.NewError(connect.CodeNotFound,
					fmt.Errorf("no GraphQL operation found for method: %s", methodName))
			}

			// Parse request message - Connect-Go handles all protocol decoding automatically
			var variables json.RawMessage

			// Parse request message - Connect-Go handles all protocol decoding automatically
			if req.Any() != nil {
				var requestData interface{}

				// Handle different protocols
				if protocol == "connect" {
					// Connect protocol - convert structpb.Struct to map
					if connectStruct, ok := req.Any().(*structpb.Struct); ok {
						connectMap := make(map[string]interface{})
						for key, value := range connectStruct.GetFields() {
							var goValue interface{}
							switch v := value.GetKind().(type) {
							case *structpb.Value_NumberValue:
								goValue = v.NumberValue
							case *structpb.Value_StringValue:
								goValue = v.StringValue
							case *structpb.Value_BoolValue:
								goValue = v.BoolValue
							case *structpb.Value_NullValue:
								goValue = nil
							default:
								goValue = value.AsInterface()
							}
							connectMap[key] = goValue
						}
						requestData = connectMap
					} else {
						requestData = req.Any()
					}
				} else if protocol == "grpc" {
					// gRPC protocol - use JSON marshaling to extract data
					if jsonBytes, err := json.Marshal(req.Any()); err == nil {
						var extractedData map[string]interface{}
						if err := json.Unmarshal(jsonBytes, &extractedData); err == nil {
							requestData = extractedData
						} else {
							s.logger.Error("Failed to unmarshal JSON data from gRPC request",
								zap.String("method", methodName),
								zap.Error(err))
							requestData = map[string]interface{}{}
						}
					} else {
						s.logger.Error("Failed to marshal gRPC request to JSON",
							zap.String("method", methodName),
							zap.Error(err))
						requestData = map[string]interface{}{}
					}
				} else {
					// Other protocols
					requestData = req.Any()
				}

				// Transform input field names from snake_case to camelCase for GraphQL compatibility
				transformedRequest := s.transformFieldNamesSnakeToCamel(requestData)
				transformedBytes, err := json.Marshal(transformedRequest)
				if err != nil {
					s.logger.Error("Failed to marshal transformed request",
						zap.String("method", methodName),
						zap.Error(err))
					return nil, connect.NewError(connect.CodeInvalidArgument, err)
				}

				variables = json.RawMessage(transformedBytes)
			} else {
				variables = json.RawMessage("{}")
			}

			s.logger.Debug("Executing GraphQL operation",
				zap.String("method", methodName),
				zap.String("operation", operation.Name),
				zap.String("type", operation.OperationType))

			// Execute GraphQL operation
			result, err := s.executeGraphQLOperation(ctx, operation.OperationString, variables)
			if err != nil {
				s.logger.Error("GraphQL execution failed",
					zap.String("method", methodName),
					zap.Error(err))
				return nil, connect.NewError(connect.CodeInternal, err)
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
				return nil, connect.NewError(connect.CodeInternal, err)
			}

			// Convert JSON response to protobuf Struct (implements proto.Message)
			var responseData map[string]interface{}
			if err := json.Unmarshal(protoResponse, &responseData); err != nil {
				s.logger.Error("Failed to unmarshal response data",
					zap.String("method", methodName),
					zap.Error(err))
				return nil, connect.NewError(connect.CodeInternal, err)
			}

			// Transform field names from camelCase to snake_case for proto compatibility
			transformedData := s.transformFieldNames(responseData)

			// Create response using structpb.Struct (works for all protocols)
			transformedMap, ok := transformedData.(map[string]interface{})
			if !ok {
				s.logger.Error("Transformed data is not a map",
					zap.String("method", methodName),
					zap.Any("data_type", fmt.Sprintf("%T", transformedData)))
				return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("transformed data is not a map"))
			}

			protoStruct, err := structpb.NewStruct(transformedMap)
			if err != nil {
				s.logger.Error("Failed to create protobuf struct",
					zap.String("method", methodName),
					zap.Error(err))
				return nil, connect.NewError(connect.CodeInternal, err)
			}

			response := connect.NewResponse(protoStruct)

			s.logger.Debug("Response created successfully",
				zap.String("method", methodName),
				zap.String("protocol", protocol))

			return response, nil
		}
	}
}

// createDummyHandler creates a dummy handler since the real logic is in the interceptor
func (s *ConnectRPCServer) createDummyHandler() func(context.Context, *connect.Request[structpb.Struct]) (*connect.Response[structpb.Struct], error) {
	return func(ctx context.Context, req *connect.Request[structpb.Struct]) (*connect.Response[structpb.Struct], error) {
		// This should never be called since the interceptor handles everything
		s.logger.Error("🚨 DUMMY HANDLER CALLED - This means interceptor is NOT working!",
			zap.String("procedure", req.Spec().Procedure),
			zap.Any("msg", req.Msg),
			zap.String("msg_type", fmt.Sprintf("%T", req.Msg)))

		// Let's see what data we have in the dummy handler
		if req.Msg != nil {
			s.logger.Error("🚨 DUMMY HANDLER: Message data",
				zap.Any("message_fields", req.Msg.GetFields()),
				zap.String("message_string", req.Msg.String()))
		}

		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("dummy handler called - interceptor failed"))
	}
}

// extractMethodFromProcedure extracts method name from Connect-Go procedure
func (s *ConnectRPCServer) extractMethodFromProcedure(procedure string) string {
	// Procedure format: /service.v1.EmployeeService/GetEmployeeByID
	parts := strings.Split(strings.TrimPrefix(procedure, "/"), "/")
	if len(parts) >= 2 {
		return parts[1] // Return "GetEmployeeByID"
	}
	return procedure
}

// transformFieldNamesSnakeToCamel recursively transforms field names from snake_case to camelCase
// This ensures proto requests are converted to GraphQL field naming conventions
func (s *ConnectRPCServer) transformFieldNamesSnakeToCamel(data interface{}) interface{} {
	switch v := data.(type) {
	case map[string]interface{}:
		result := make(map[string]interface{})
		for key, value := range v {
			// Transform the key from snake_case to camelCase
			camelKey := s.snakeToCamel(key)
			// Recursively transform the value
			result[camelKey] = s.transformFieldNamesSnakeToCamel(value)
		}
		return result
	case []interface{}:
		result := make([]interface{}, len(v))
		for i, item := range v {
			result[i] = s.transformFieldNamesSnakeToCamel(item)
		}
		return result
	default:
		// Return primitive values as-is
		return v
	}
}

// transformFieldNames recursively transforms field names from camelCase to snake_case
// This ensures GraphQL responses match proto field naming conventions
func (s *ConnectRPCServer) transformFieldNames(data interface{}) interface{} {
	switch v := data.(type) {
	case map[string]interface{}:
		result := make(map[string]interface{})
		for key, value := range v {
			// Transform the key from camelCase to snake_case
			snakeKey := s.camelToSnake(key)
			// Recursively transform the value
			result[snakeKey] = s.transformFieldNames(value)
		}
		return result
	case []interface{}:
		result := make([]interface{}, len(v))
		for i, item := range v {
			result[i] = s.transformFieldNames(item)
		}
		return result
	default:
		// Return primitive values as-is
		return v
	}
}

// snakeToCamel converts snake_case strings to camelCase
func (s *ConnectRPCServer) snakeToCamel(str string) string {
	// Handle empty strings
	if str == "" {
		return str
	}

	// Split by underscores
	parts := strings.Split(str, "_")
	if len(parts) == 1 {
		// No underscores, return as-is (already camelCase or single word)
		return str
	}

	// First part stays lowercase, capitalize first letter of subsequent parts
	result := parts[0]
	for i := 1; i < len(parts); i++ {
		if len(parts[i]) > 0 {
			result += strings.ToUpper(string(parts[i][0])) + parts[i][1:]
		}
	}

	return result
}

// camelToSnake converts camelCase strings to snake_case
func (s *ConnectRPCServer) camelToSnake(str string) string {
	// Handle empty strings
	if str == "" {
		return str
	}

	// Use regex to find transitions from lowercase to uppercase
	re := regexp.MustCompile("([a-z0-9])([A-Z])")
	snake := re.ReplaceAllString(str, "${1}_${2}")

	// Convert to lowercase
	return strings.ToLower(snake)
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

	// Add proto services information with Connect RPC endpoints
	if s.protoManager != nil {
		protoServices := make(map[string]interface{})
		connectEndpoints := make([]string, 0)

		for serviceName, serviceInfo := range s.protoManager.services {
			methods := make([]map[string]interface{}, len(serviceInfo.Methods))
			for i, method := range serviceInfo.Methods {
				methodPath := fmt.Sprintf("/%s/%s", serviceName, method.Name)
				connectEndpoints = append(connectEndpoints, methodPath)
				methods[i] = map[string]interface{}{
					"name":     method.Name,
					"endpoint": methodPath,
					"input":    method.InputType,
					"output":   method.OutputType,
				}
			}
			protoServices[serviceName] = map[string]interface{}{
				"package": serviceInfo.Package,
				"methods": methods,
			}
		}
		debugInfo["proto_services"] = protoServices
		debugInfo["proto_services_count"] = len(s.protoManager.services)
		debugInfo["connect_endpoints"] = connectEndpoints
	} else {
		debugInfo["proto_services"] = "ProtoManager not initialized"
		debugInfo["proto_services_count"] = 0
		debugInfo["connect_endpoints"] = []string{}
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
	debugInfo["server_type"] = "connect_rpc"
	debugInfo["protocols_supported"] = []string{"Connect", "gRPC", "gRPC-Web"}

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
		"error":              "Service not found",
		"path":               r.URL.Path,
		"available_services": s.getAvailableServices(),
	}

	json.NewEncoder(w).Encode(errorResponse)
}

// parseConnectGetRequest parses GET request parameters for Connect protocol
// Note: This is a simplified implementation since Connect-Go doesn't expose HTTP request directly
func (s *ConnectRPCServer) parseConnectGetRequest(req connect.AnyRequest) (interface{}, error) {
	// For GET requests in Connect protocol, the parameters are typically passed in the URL
	// However, Connect-Go's AnyRequest interface doesn't expose the underlying HTTP request
	// This is a limitation we need to work around

	s.logger.Info("🔍 DIAGNOSTIC: GET request parsing attempted",
		zap.String("procedure", req.Spec().Procedure),
		zap.String("peer_protocol", req.Peer().Protocol))

	// Since we can't access the HTTP request directly through Connect-Go's interface,
	// we'll need to implement GET support at the HTTP handler level instead
	// For now, return an error indicating this limitation

	return nil, fmt.Errorf("GET request parsing not supported through Connect-Go interceptor - implement at HTTP handler level")
}

// transformGraphQLResponseToProto transforms GraphQL response to proto message format
// Connect-Go handles all protocol-specific encoding automatically
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
	// Connect-Go will handle protocol-specific encoding (Connect/gRPC/gRPC-Web) automatically
	if gqlResp.Data == nil {
		return json.RawMessage("{}"), nil
	}

	return gqlResp.Data, nil
}

// withCORS creates a CORS middleware with Connect RPC support
// Connect-Go handles protocol-specific headers automatically
func (s *ConnectRPCServer) withCORS(allowedMethods ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			// Set CORS headers for all requests
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", strings.Join(append(allowedMethods, "OPTIONS"), ", "))

			// Include Connect RPC, gRPC, and gRPC-Web headers
			// Connect-Go will handle protocol-specific headers automatically
			allowedHeaders := []string{
				"Content-Type",
				"Accept",
				"Authorization",
				"Connect-Protocol-Version",
				"Connect-Timeout-Ms",
				"Connect-Accept-Encoding",
				"Connect-Content-Encoding",
				"Grpc-Timeout",
				"Grpc-Encoding",
				"Grpc-Accept-Encoding",
				"Grpc-Message",
				"Grpc-Status",
				"Grpc-Status-Details-Bin",
			}
			w.Header().Set("Access-Control-Allow-Headers", strings.Join(allowedHeaders, ", "))
			w.Header().Set("Access-Control-Max-Age", "86400") // 24 hours

			// Handle preflight OPTIONS requests
			if req.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}

			// Call the next handler - Connect-Go handles all protocol detection
			next.ServeHTTP(w, req)
		})
	}
}
