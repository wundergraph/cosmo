package connectrpc

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"connectrpc.com/vanguard"
	"github.com/hashicorp/go-retryablehttp"
	"github.com/wundergraph/cosmo/router/pkg/schemaloader"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"go.uber.org/zap"
)

// ServerConfig holds configuration for the ConnectRPC server
type ServerConfig struct {
	// ProtoDir is the directory containing proto files
	ProtoDir string
	// OperationsDir is the directory containing pre-defined GraphQL operations (optional, for predefined mode)
	OperationsDir string
	// ListenAddr is the address to listen on
	ListenAddr string
	// GraphQLEndpoint is the router's GraphQL endpoint
	GraphQLEndpoint string
	// Mode determines whether to use dynamic or predefined operations
	Mode HandlerMode
	// Logger for structured logging
	Logger *zap.Logger
	// RequestTimeout for HTTP requests
	RequestTimeout time.Duration
}

// Server is the main ConnectRPC server that handles gRPC/Connect/gRPC-Web requests
type Server struct {
	config            ServerConfig
	logger            *zap.Logger
	httpServer        *http.Server
	transcoder        *vanguard.Transcoder
	protoLoader       *ProtoLoader
	operationBuilder  *OperationBuilder
	operationRegistry *OperationRegistry
	rpcHandler        *RPCHandler
	vanguardService   *VanguardService
	httpClient        *http.Client
}

// NewServer creates a new ConnectRPC server
func NewServer(config ServerConfig) (*Server, error) {
	// Validate configuration
	if config.ProtoDir == "" {
		return nil, fmt.Errorf("proto directory cannot be empty")
	}

	if config.GraphQLEndpoint == "" {
		return nil, fmt.Errorf("graphql endpoint cannot be empty")
	}

	if config.Mode == "" {
		config.Mode = HandlerModeDynamic
	}

	if config.ListenAddr == "" {
		config.ListenAddr = "0.0.0.0:50051"
	}

	if config.Logger == nil {
		config.Logger = zap.NewNop()
	}

	if config.RequestTimeout == 0 {
		config.RequestTimeout = 30 * time.Second
	}

	// Add protocol if missing
	if !strings.Contains(config.GraphQLEndpoint, "://") {
		config.GraphQLEndpoint = "http://" + config.GraphQLEndpoint
	}

	// Create HTTP client with retry
	retryClient := retryablehttp.NewClient()
	retryClient.Logger = nil
	httpClient := retryClient.StandardClient()
	httpClient.Timeout = config.RequestTimeout

	server := &Server{
		config:     config,
		logger:     config.Logger,
		httpClient: httpClient,
	}

	return server, nil
}

// Start initializes and starts the ConnectRPC server
func (s *Server) Start() error {
	s.logger.Info("starting ConnectRPC server",
		zap.String("listen_addr", s.config.ListenAddr),
		zap.String("proto_dir", s.config.ProtoDir),
		zap.String("mode", string(s.config.Mode)),
		zap.String("graphql_endpoint", s.config.GraphQLEndpoint))

	// Load proto files
	s.protoLoader = NewProtoLoader(s.logger)
	if err := s.protoLoader.LoadFromDirectory(s.config.ProtoDir); err != nil {
		return fmt.Errorf("failed to load proto files: %w", err)
	}

	services := s.protoLoader.GetServices()
	s.logger.Info("loaded proto services",
		zap.Int("count", len(services)))

	// Initialize components based on mode
	if err := s.initializeComponents(); err != nil {
		return fmt.Errorf("failed to initialize components: %w", err)
	}

	// Create Vanguard service wrapper
	vanguardService, err := NewVanguardService(VanguardServiceConfig{
		Handler:     s.rpcHandler,
		ProtoLoader: s.protoLoader,
		Logger:      s.logger,
	})
	if err != nil {
		return fmt.Errorf("failed to create vanguard service: %w", err)
	}
	s.vanguardService = vanguardService

	// Create Vanguard transcoder
	transcoder, err := vanguard.NewTranscoder(vanguardService.GetServices())
	if err != nil {
		return fmt.Errorf("failed to create vanguard transcoder: %w", err)
	}
	s.transcoder = transcoder

	// Create HTTP server
	s.httpServer = &http.Server{
		Addr:         s.config.ListenAddr,
		Handler:      s.createHandler(),
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Start server in goroutine
	go func() {
		s.logger.Info("ConnectRPC server listening",
			zap.String("addr", s.config.ListenAddr))

		if err := s.httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			s.logger.Error("server error", zap.Error(err))
		}
	}()

	return nil
}

// Stop gracefully shuts down the server
func (s *Server) Stop(ctx context.Context) error {
	if s.httpServer == nil {
		return fmt.Errorf("server is not started")
	}

	s.logger.Info("shutting down ConnectRPC server")

	shutdownCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if err := s.httpServer.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("failed to shutdown server: %w", err)
	}

	s.logger.Info("ConnectRPC server stopped")
	return nil
}

// Reload reloads the server configuration and operations
func (s *Server) Reload(schema *ast.Document) error {
	s.logger.Info("reloading ConnectRPC server")

	// Reload proto files
	s.protoLoader = NewProtoLoader(s.logger)
	if err := s.protoLoader.LoadFromDirectory(s.config.ProtoDir); err != nil {
		return fmt.Errorf("failed to reload proto files: %w", err)
	}

	// Reinitialize components
	if err := s.initializeComponents(); err != nil {
		return fmt.Errorf("failed to reinitialize components: %w", err)
	}

	// Reload RPC handler
	if s.config.Mode == HandlerModePredefined && schema != nil {
		if err := s.rpcHandler.Reload(schema, s.config.OperationsDir); err != nil {
			return fmt.Errorf("failed to reload RPC handler: %w", err)
		}
	}

	// Recreate Vanguard service
	vanguardService, err := NewVanguardService(VanguardServiceConfig{
		Handler:     s.rpcHandler,
		ProtoLoader: s.protoLoader,
		Logger:      s.logger,
	})
	if err != nil {
		return fmt.Errorf("failed to recreate vanguard service: %w", err)
	}
	s.vanguardService = vanguardService

	// Recreate transcoder
	transcoder, err := vanguard.NewTranscoder(vanguardService.GetServices())
	if err != nil {
		return fmt.Errorf("failed to recreate vanguard transcoder: %w", err)
	}
	s.transcoder = transcoder

	// Update HTTP server handler
	s.httpServer.Handler = s.createHandler()

	s.logger.Info("ConnectRPC server reloaded successfully")
	return nil
}

// initializeComponents initializes the server components based on the mode
func (s *Server) initializeComponents() error {
	var err error

	switch s.config.Mode {
	case HandlerModeDynamic:
		// Create operation builder
		s.operationBuilder = NewOperationBuilder()

		// Create operation registry for storing dynamically generated operations
		s.operationRegistry = NewOperationRegistry(s.logger)

		// Pre-generate all operations from proto definitions and add to registry
		if err := s.preGenerateOperations(); err != nil {
			return fmt.Errorf("failed to pre-generate operations: %w", err)
		}

		// Create RPC handler in dynamic mode
		s.rpcHandler, err = NewRPCHandler(HandlerConfig{
			Mode:              HandlerModeDynamic,
			GraphQLEndpoint:   s.config.GraphQLEndpoint,
			HTTPClient:        s.httpClient,
			Logger:            s.logger,
			OperationBuilder:  s.operationBuilder,
			OperationRegistry: s.operationRegistry,
			ProtoLoader:       s.protoLoader,
		})
		if err != nil {
			return fmt.Errorf("failed to create RPC handler: %w", err)
		}

	case HandlerModePredefined:
		// Create operation registry
		s.operationRegistry = NewOperationRegistry(s.logger)

		// Create RPC handler in predefined mode
		s.rpcHandler, err = NewRPCHandler(HandlerConfig{
			Mode:              HandlerModePredefined,
			GraphQLEndpoint:   s.config.GraphQLEndpoint,
			HTTPClient:        s.httpClient,
			Logger:            s.logger,
			OperationRegistry: s.operationRegistry,
		})
		if err != nil {
			return fmt.Errorf("failed to create RPC handler: %w", err)
		}

	default:
		return fmt.Errorf("invalid handler mode: %s", s.config.Mode)
	}

	return nil
}

// createHandler creates the HTTP handler
func (s *Server) createHandler() http.Handler {
	mux := http.NewServeMux()

	// Mount transcoder at root
	mux.Handle("/", s.transcoder)

	return mux
}

// GetServiceCount returns the number of registered services
func (s *Server) GetServiceCount() int {
	if s.vanguardService == nil {
		return 0
	}
	return s.vanguardService.GetServiceCount()
}

// GetServiceNames returns the names of all registered services
func (s *Server) GetServiceNames() []string {
	if s.vanguardService == nil {
		return nil
	}
	return s.vanguardService.GetServiceNames()
}

// GetMode returns the current handler mode
func (s *Server) GetMode() HandlerMode {
	if s.rpcHandler == nil {
		return ""
	}
	return s.rpcHandler.GetMode()
}

// preGenerateOperations generates GraphQL operations for all proto methods
// and adds them to the operation registry (used in Dynamic Mode)
func (s *Server) preGenerateOperations() error {
	services := s.protoLoader.GetServices()
	generatedCount := 0

	for _, service := range services {
		for _, method := range service.Methods {
			// Build the GraphQL operation
			graphqlQuery, err := s.operationBuilder.BuildOperation(&method)
			if err != nil {
				return fmt.Errorf("failed to build operation for %s.%s: %w", service.FullName, method.Name, err)
			}

			// Determine operation type from method name
			opType := "query"
			if strings.HasPrefix(method.Name, "Mutation") {
				opType = "mutation"
			}

			// Add to registry
			s.operationRegistry.AddOperation(&schemaloader.Operation{
				Name:            method.Name,
				OperationType:   opType,
				OperationString: graphqlQuery,
				Description:     fmt.Sprintf("Auto-generated from %s.%s", service.FullName, method.Name),
			})

			generatedCount++
		}
	}

	s.logger.Info("pre-generated operations for dynamic mode",
		zap.Int("count", generatedCount),
		zap.Int("services", len(services)))

	return nil
}

// GetOperationCount returns the number of operations/methods available
func (s *Server) GetOperationCount() int {
	if s.rpcHandler == nil {
		return 0
	}
	return s.rpcHandler.GetOperationCount()
}
