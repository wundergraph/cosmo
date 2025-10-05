package connect_rpc

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"connectrpc.com/vanguard"
	"go.uber.org/zap"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
)

// Options contains configuration for the Connect RPC server
type Options struct {
	ListenAddr         string
	ProtoDir           string
	Logger             *zap.Logger
	Enabled            bool
	RouterGraphQLURL   string
}

// Server manages the Connect RPC server using vanguard-go
type Server struct {
	server         *http.Server
	transcoder     *vanguard.Transcoder
	listenAddr     string
	logger         *zap.Logger
	protoLoader    *ProtoLoader
	operations     *OperationMapper
	httpClient     *http.Client
	routerGraphQLURL string
}

// GraphQLRequest represents a GraphQL operation request
type GraphQLRequest struct {
	Query         string                 `json:"query"`
	OperationName string                 `json:"operationName"`
	Variables     map[string]interface{} `json:"variables"`
}

// NewServer creates a new Connect RPC server with functional options (matching MCP server pattern)
func NewServer(routerGraphQLURL string, opts ...func(*Options)) (*Server, error) {
	// Default options
	options := &Options{
		ListenAddr: "localhost:5026",
		Logger:     zap.NewNop(),
		Enabled:    true,
		RouterGraphQLURL: routerGraphQLURL,
	}

	// Apply all option functions
	for _, opt := range opts {
		opt(options)
	}

	if options.RouterGraphQLURL == "" && routerGraphQLURL != "" {
		options.RouterGraphQLURL = routerGraphQLURL
	}

	if options.ProtoDir == "" {
		return nil, fmt.Errorf("proto directory is required")
	}

	s := &Server{
		listenAddr:       options.ListenAddr,
		logger:           options.Logger,
		httpClient:       &http.Client{},
		routerGraphQLURL: options.RouterGraphQLURL,
	}

	// Load proto files from directory
	protoLoader, err := NewProtoLoaderFromDir(options.ProtoDir, options.Logger)
	if err != nil {
		return nil, fmt.Errorf("failed to load proto files from directory %s: %w", options.ProtoDir, err)
	}
	s.protoLoader = protoLoader

	// Register proto file descriptors with the global proto registry
	// This allows vanguard to resolve service schemas
	if err := s.registerProtoFiles(protoLoader.GetFiles()); err != nil {
		return nil, fmt.Errorf("failed to register proto files: %w", err)
	}

	// Reconstruct GraphQL operations from proto service definitions
	services := protoLoader.GetServices()
	operationMapper, err := NewOperationMapper(services, options.Logger)
	if err != nil {
		return nil, fmt.Errorf("failed to create operation mapper: %w", err)
	}
	s.operations = operationMapper

	// Create vanguard services for each proto service
	vanguardServices := make([]*vanguard.Service, 0)
	for _, serviceDesc := range services {
		// Create a handler for this service that translates to GraphQL
		handler := s.createServiceHandler(serviceDesc)

		// Create vanguard service
		serviceName := string(serviceDesc.FullName())
		vanguardService := vanguard.NewService(serviceName, handler)

		vanguardServices = append(vanguardServices, vanguardService)

		s.logger.Info("Registered Connect RPC service",
			zap.String("service", serviceName),
			zap.Int("methods", serviceDesc.Methods().Len()))
	}

	// Create the vanguard transcoder
	transcoder, err := vanguard.NewTranscoder(vanguardServices)
	if err != nil {
		return nil, fmt.Errorf("failed to create vanguard transcoder: %w", err)
	}
	s.transcoder = transcoder

	return s, nil
}

// Functional option functions (matching MCP server pattern)

// WithProtoDir sets the proto files directory
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

// createServiceHandler creates an HTTP handler for a proto service
// This handler receives requests transcoded by vanguard and executes GraphQL
func (s *Server) createServiceHandler(serviceDesc protoreflect.ServiceDescriptor) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		// Extract method name from the request path
		// Path format: /package.ServiceName/MethodName
		methodName := extractMethodFromPath(r.URL.Path, string(serviceDesc.FullName()))

		s.logger.Debug("Handling Connect RPC request",
			zap.String("method", methodName),
			zap.String("path", r.URL.Path))

		// Get the reconstructed GraphQL operation for this RPC method
		operation, err := s.operations.GetOperation(methodName)
		if err != nil {
			s.logger.Error("Operation not found",
				zap.String("method", methodName),
				zap.Error(err))
			http.Error(w, fmt.Sprintf("No GraphQL operation for method %s", methodName), http.StatusNotFound)
			return
		}

		// Parse variables from request body (proto message decoded by vanguard)
		protoVariables, err := parseRequestVariables(r)
		if err != nil {
			s.logger.Error("Failed to parse request variables",
				zap.Error(err))
			http.Error(w, "Failed to parse request", http.StatusBadRequest)
			return
		}

		// Convert proto variable names (snake_case) to GraphQL variable names (camelCase)
		variables := s.convertProtoVariablesToGraphQL(protoVariables)

		// Execute GraphQL operation via HTTP request to router
		graphqlReq := &GraphQLRequest{
			Query:         operation.Query,
			OperationName: operation.Name,
			Variables:     variables,
		}

		s.logger.Info("Executing GraphQL operation",
			zap.String("operation", operation.Name),
			zap.String("type", operation.OperationType),
			zap.Any("proto_variables", protoVariables),
			zap.Any("converted_variables", variables),
			zap.String("query", operation.Query))

		result, err := s.executeGraphQLHTTP(ctx, graphqlReq)
		if err != nil {
			s.logger.Error("GraphQL execution failed",
				zap.String("operation", operation.Name),
				zap.Error(err))
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Write response
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write(result); err != nil {
			s.logger.Error("Failed to write response", zap.Error(err))
		}
	})
}

// executeGraphQLHTTP executes GraphQL operation via HTTP request to the router
func (s *Server) executeGraphQLHTTP(ctx context.Context, req *GraphQLRequest) ([]byte, error) {
	// Create GraphQL request body
	reqBody, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal GraphQL request: %w", err)
	}

	// Create HTTP request to router GraphQL endpoint
	httpReq, err := http.NewRequestWithContext(ctx, "POST", s.routerGraphQLURL, bytes.NewReader(reqBody))
	if err != nil {
		return nil, fmt.Errorf("failed to create HTTP request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")

	// Execute request
	resp, err := s.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("failed to execute GraphQL request: %w", err)
	}
	defer resp.Body.Close()

	// Read response
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read GraphQL response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GraphQL request failed with status %d: %s", resp.StatusCode, string(body))
	}

	return body, nil
}

// Start starts the Connect RPC server
func (s *Server) Start() error {
	// Vanguard transcoder IS the HTTP handler
	s.server = &http.Server{
		Addr:         s.listenAddr,
		Handler:      s.transcoder,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	s.logger.Info("Connect RPC server started with Vanguard",
		zap.String("listen_addr", s.listenAddr),
		zap.String("router_graphql_url", s.routerGraphQLURL),
		zap.Int("operations", len(s.operations.GetAllOperations())))

	go func() {
		if err := s.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			s.logger.Error("Connect RPC server failed", zap.Error(err))
		}
	}()

	return nil
}

// Stop gracefully shuts down the Connect RPC server
func (s *Server) Stop(ctx context.Context) error {
	if s.server == nil {
		return nil
	}

	s.logger.Debug("Shutting down Connect RPC server")

	if err := s.server.Shutdown(ctx); err != nil {
		return fmt.Errorf("failed to shutdown Connect RPC server: %w", err)
	}

	return nil
}

// extractMethodFromPath extracts the method name from the RPC path
// Path format: /package.ServiceName/MethodName
func extractMethodFromPath(path, serviceName string) string {
	// Remove leading slash
	path = strings.TrimPrefix(path, "/")

	// Remove service name prefix if present
	if strings.HasPrefix(path, serviceName+"/") {
		path = strings.TrimPrefix(path, serviceName+"/")
	}

	// The remaining part should be the method name
	return path
}

// parseRequestVariables parses variables from the request body
func parseRequestVariables(r *http.Request) (map[string]interface{}, error) {
	if r.Body == nil {
		return make(map[string]interface{}), nil
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read request body: %w", err)
	}

	// Reset body for potential re-reading
	r.Body = io.NopCloser(bytes.NewBuffer(body))

	if len(body) == 0 {
		return make(map[string]interface{}), nil
	}

	var variables map[string]interface{}
	if err := json.Unmarshal(body, &variables); err != nil {
		return nil, fmt.Errorf("failed to unmarshal variables: %w", err)
	}

	return variables, nil
}

// registerProtoFiles registers proto file descriptors with the global proto registry
// This allows vanguard to resolve service schemas for protocol transcoding
func (s *Server) registerProtoFiles(files []protoreflect.FileDescriptor) error {
	for _, file := range files {
		// Register the file descriptor with the global registry
		err := protoregistry.GlobalFiles.RegisterFile(file)
		if err != nil {
			// If the file is already registered, that's okay - it might be a well-known type
			if err.Error() != "file already registered" && !strings.Contains(err.Error(), "already registered") {
				s.logger.Warn("Failed to register proto file",
					zap.String("file", string(file.FullName())),
					zap.Error(err))
				// Don't return error for registration conflicts, just log and continue
			} else {
				s.logger.Debug("Proto file already registered",
					zap.String("file", string(file.FullName())))
			}
		} else {
			s.logger.Debug("Registered proto file with global registry",
				zap.String("file", string(file.FullName())),
				zap.Int("services", file.Services().Len()))
		}
	}
	return nil
}

// convertProtoVariablesToGraphQL converts proto variable names (snake_case) to GraphQL variable names (camelCase)
func (s *Server) convertProtoVariablesToGraphQL(protoVariables map[string]interface{}) map[string]interface{} {
	graphqlVariables := make(map[string]interface{})
	
	for protoKey, value := range protoVariables {
		// Convert snake_case to camelCase
		graphqlKey := s.protoFieldToGraphQLField(protoKey)
		graphqlVariables[graphqlKey] = value
		
		s.logger.Debug("Converting proto variable to GraphQL",
			zap.String("proto_name", protoKey),
			zap.String("graphql_name", graphqlKey),
			zap.Any("value", value))
	}
	
	return graphqlVariables
}

// protoFieldToGraphQLField converts proto field naming (snake_case) to GraphQL (camelCase)
func (s *Server) protoFieldToGraphQLField(protoField string) string {
	// Convert snake_case to camelCase
	parts := strings.Split(protoField, "_")
	if len(parts) == 1 {
		return protoField
	}

	result := parts[0]
	for i := 1; i < len(parts); i++ {
		if len(parts[i]) > 0 {
			result += strings.ToUpper(parts[i][:1]) + parts[i][1:]
		}
	}
	return result
}