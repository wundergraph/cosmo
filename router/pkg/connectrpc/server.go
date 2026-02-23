package connectrpc

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"time"

	"connectrpc.com/vanguard"
	"github.com/hashicorp/go-retryablehttp"
	"go.uber.org/zap"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"

	"github.com/wundergraph/cosmo/router/pkg/cors"
	"github.com/wundergraph/cosmo/router/pkg/schemaloader"
)

// ServerConfig holds configuration for the ConnectRPC server
type ServerConfig struct {
	// ServicesDir is the root directory containing all service subdirectories
	// Each service directory should contain proto files and GraphQL operations
	ServicesDir string
	// ListenAddr is the address to listen on
	ListenAddr string
	// GraphQLEndpoint is the router's GraphQL endpoint
	GraphQLEndpoint string
	// Logger for structured logging
	Logger *zap.Logger
	// RequestTimeout for HTTP requests
	RequestTimeout time.Duration
	// CorsConfig is the CORS configuration for the ConnectRPC server
	CorsConfig *cors.Config
}

// Server is the main ConnectRPC server that handles gRPC/Connect/gRPC-Web requests
type Server struct {
	config            ServerConfig
	logger            *zap.Logger
	httpServer        *http.Server
	listener          net.Listener
	transcoder        *vanguard.Transcoder
	protoLoader       *ProtoLoader
	operationRegistry *OperationRegistry
	rpcHandler        *RPCHandler
	vanguardService   *VanguardService
	httpClient        *http.Client
}

// NewServer creates a new ConnectRPC server and loads all services
func NewServer(config ServerConfig) (*Server, error) {
	// Validate configuration
	if config.ServicesDir == "" {
		return nil, fmt.Errorf("services directory must be provided")
	}

	if config.ListenAddr == "" {
		config.ListenAddr = "0.0.0.0:5026"
	}

	if config.Logger == nil {
		return nil, fmt.Errorf("logger is required")
	}

	if config.RequestTimeout == 0 {
		config.RequestTimeout = 30 * time.Second
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

	startTime := time.Now()

	// Discover services from the services directory
	discoveredServices, err := DiscoverServices(ServiceDiscoveryConfig{
		ServicesDir: config.ServicesDir,
		Logger:      config.Logger,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to discover services: %w", err)
	}

	// Create proto loader first (needed by handler)
	server.protoLoader = NewProtoLoader(server.logger)

	// Load proto files for each discovered service
	packageServiceMap := make(map[string][]string) // package -> list of services

	for _, service := range discoveredServices {
		// Load proto files for this service
		if err := server.protoLoader.LoadFromDirectory(service.ServiceDir); err != nil {
			return nil, fmt.Errorf("failed to load proto files for service %s: %w", service.FullName, err)
		}

		// Track packages and services
		packageServiceMap[service.Package] = append(packageServiceMap[service.Package], service.ServiceName)
	}

	// Build operations map for all services
	operationsMap, err := server.buildOperationsMap(discoveredServices)
	if err != nil {
		return nil, fmt.Errorf("failed to build operations map: %w", err)
	}

	// Count total operations
	totalOperations := 0
	for _, serviceOps := range operationsMap {
		totalOperations += len(serviceOps)
	}

	// Warn about services with no operations
	for _, service := range discoveredServices {
		if len(service.OperationFiles) == 0 {
			server.logger.Warn("no operations found for service",
				zap.String("service", service.FullName))
		}
	}

	// Create immutable operation registry with pre-built operations
	server.operationRegistry = NewOperationRegistry(operationsMap)

	// Initialize components (requires protoLoader and operationRegistry to be set)
	if err := server.initializeComponents(); err != nil {
		return nil, fmt.Errorf("failed to initialize components: %w", err)
	}

	// Create service wrapper
	vanguardService, err := NewVanguardService(VanguardServiceConfig{
		Handler:     server.rpcHandler,
		ProtoLoader: server.protoLoader,
		Logger:      server.logger,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create service wrapper: %w", err)
	}
	server.vanguardService = vanguardService

	// Create protocol transcoder
	vanguardServices := vanguardService.GetServices()
	transcoder, err := vanguard.NewTranscoder(vanguardServices)
	if err != nil {
		return nil, fmt.Errorf("failed to create protocol transcoder: %w", err)
	}
	server.transcoder = transcoder

	// Log consolidated initialization summary at DEBUG level
	// The main INFO log will be in router.go
	server.logger.Debug("ConnectRPC services loaded",
		zap.Int("packages", len(packageServiceMap)),
		zap.Int("services", len(discoveredServices)),
		zap.Int("operations", totalOperations),
		zap.Duration("duration", time.Since(startTime)))

	return server, nil
}

// Start starts the HTTP server (services must already be loaded via NewServer)
func (s *Server) Start() error {
	s.logger.Debug("starting ConnectRPC server",
		zap.String("listen_addr", s.config.ListenAddr),
		zap.String("services_dir", s.config.ServicesDir),
		zap.String("graphql_endpoint", s.config.GraphQLEndpoint))

	// Verify that services have been loaded
	if s.transcoder == nil {
		return fmt.Errorf("server not properly initialized - services not loaded")
	}

	// Create HTTP server with HTTP/2 support
	handler := s.createHandler()
	h2cHandler := h2c.NewHandler(handler, &http2.Server{})

	s.httpServer = &http.Server{
		Addr:         s.config.ListenAddr,
		Handler:      h2cHandler,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	s.logger.Debug("HTTP/2 (h2c) support enabled")

	// Create listener to get actual bound address
	listener, err := net.Listen("tcp", s.config.ListenAddr)
	if err != nil {
		return fmt.Errorf("failed to create listener: %w", err)
	}
	s.listener = listener

	// Start server in goroutine
	go func() {
		s.logger.Info("ConnectRPC server ready",
			zap.String("addr", s.listener.Addr().String()))

		if err := s.httpServer.Serve(s.listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
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

// Reload reloads the server configuration and operations.
// This creates entirely new instances of all components for atomic hot-reload.
func (s *Server) Reload() error {
	// Check if server has been started
	if s.httpServer == nil {
		return fmt.Errorf("server not started; call Start before Reload")
	}

	s.logger.Info("reloading ConnectRPC server")

	// Discover services from the services directory
	discoveredServices, err := DiscoverServices(ServiceDiscoveryConfig{
		ServicesDir: s.config.ServicesDir,
		Logger:      s.logger,
	})
	if err != nil {
		return fmt.Errorf("failed to discover services: %w", err)
	}

	// Create a fresh proto loader
	s.protoLoader = NewProtoLoader(s.logger)

	// Load proto files for each service
	for _, service := range discoveredServices {
		if err := s.protoLoader.LoadFromDirectory(service.ServiceDir); err != nil {
			return fmt.Errorf("failed to reload proto files for service %s: %w", service.FullName, err)
		}
	}

	// Build operations map for all services
	operationsMap, err := s.buildOperationsMap(discoveredServices)
	if err != nil {
		return fmt.Errorf("failed to build operations map: %w", err)
	}

	// Create new immutable operation registry with pre-built operations
	s.operationRegistry = NewOperationRegistry(operationsMap)

	// Reinitialize components with fresh proto loader and operation registry
	if err := s.initializeComponents(); err != nil {
		return fmt.Errorf("failed to reinitialize components: %w", err)
	}

	// Recreate service wrapper
	vanguardService, err := NewVanguardService(VanguardServiceConfig{
		Handler:     s.rpcHandler,
		ProtoLoader: s.protoLoader,
		Logger:      s.logger,
	})
	if err != nil {
		return fmt.Errorf("failed to recreate service wrapper: %w", err)
	}
	s.vanguardService = vanguardService

	// Recreate protocol transcoder
	transcoder, err := vanguard.NewTranscoder(vanguardService.GetServices())
	if err != nil {
		return fmt.Errorf("failed to recreate protocol transcoder: %w", err)
	}
	s.transcoder = transcoder

	// Update HTTP server handler with h2c wrapper for gRPC compatibility
	handler := s.createHandler()
	s.httpServer.Handler = h2c.NewHandler(handler, &http2.Server{})

	s.logger.Info("ConnectRPC server reloaded successfully")
	return nil
}

// initializeComponents initializes the server components using the caller-populated operation registry.
// The operation registry must be set by the caller before calling this method.
func (s *Server) initializeComponents() error {
	// Create RPC handler
	// Note: ProtoLoader and OperationRegistry must be set before calling this
	var err error
	s.rpcHandler, err = NewRPCHandler(HandlerConfig{
		GraphQLEndpoint:   s.config.GraphQLEndpoint,
		HTTPClient:        s.httpClient,
		Logger:            s.logger,
		OperationRegistry: s.operationRegistry,
		ProtoLoader:       s.protoLoader,
	})
	if err != nil {
		return fmt.Errorf("failed to create RPC handler: %w", err)
	}

	return nil
}

// buildOperationsMap builds the complete operations map for all services.
// This should be called after proto files are loaded.
func (s *Server) buildOperationsMap(discoveredServices []DiscoveredService) (map[string]map[string]*schemaloader.Operation, error) {
	allOperations := make(map[string]map[string]*schemaloader.Operation)

	for _, service := range discoveredServices {
		if len(service.OperationFiles) > 0 {
			serviceOps, err := LoadOperationsForService(service.FullName, service.OperationFiles, s.logger)
			if err != nil {
				return nil, fmt.Errorf("failed to load operations for service %s: %w", service.FullName, err)
			}
			allOperations[service.FullName] = serviceOps
		}
	}

	return allOperations, nil
}

// createHandler creates the HTTP handler.
// The transcoder is captured by value so in-flight requests use a stable
// instance and don't race with Reload() mutating s.transcoder.
func (s *Server) createHandler() http.Handler {
	mux := http.NewServeMux()

	transcoder := s.transcoder

	// Wrap transcoder with response writer that implements required interfaces
	wrappedTranscoder := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Create a response writer that implements required interfaces for gRPC streaming
		rw := &responseWriter{ResponseWriter: w}

		// The transcoder handles protocol translation and routing
		transcoder.ServeHTTP(rw, r)
	})

	// Apply CORS middleware if enabled
	var handler http.Handler = wrappedTranscoder
	if s.config.CorsConfig != nil && s.config.CorsConfig.Enabled {
		corsMiddleware := cors.New(*s.config.CorsConfig)
		handler = corsMiddleware(wrappedTranscoder)
	}

	// Mount handler at root
	mux.Handle("/", handler)

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

// responseWriter wraps http.ResponseWriter and implements required interfaces for gRPC streaming
type responseWriter struct {
	http.ResponseWriter
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.ResponseWriter.WriteHeader(code)
}

// Flush implements http.Flusher interface (required for gRPC streaming)
func (rw *responseWriter) Flush() {
	if f, ok := rw.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Push implements http.Pusher interface (for HTTP/2 server push)
func (rw *responseWriter) Push(target string, opts *http.PushOptions) error {
	if p, ok := rw.ResponseWriter.(http.Pusher); ok {
		return p.Push(target, opts)
	}
	return http.ErrNotSupported
}

// Hijack implements http.Hijacker interface (for connection hijacking)
func (rw *responseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if h, ok := rw.ResponseWriter.(http.Hijacker); ok {
		return h.Hijack()
	}
	return nil, nil, http.ErrNotSupported
}

// GetOperationCount returns the number of operations/methods available
func (s *Server) GetOperationCount() int {
	if s.rpcHandler == nil {
		return 0
	}
	return s.rpcHandler.GetOperationCount()
}

// Addr returns the server's actual listening address
func (s *Server) Addr() net.Addr {
	if s.listener == nil {
		return nil
	}
	return s.listener.Addr()
}
