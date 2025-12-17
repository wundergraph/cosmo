package connectrpc

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"connectrpc.com/vanguard"
	"github.com/hashicorp/go-retryablehttp"
	"go.uber.org/zap"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
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

	if config.GraphQLEndpoint == "" {
		return nil, fmt.Errorf("graphql endpoint cannot be empty")
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

	// Initialize components (requires protoLoader to be set)
	if err := server.initializeComponents(); err != nil {
		return nil, fmt.Errorf("failed to initialize components: %w", err)
	}

	// Load proto files and operations for each discovered service
	totalOperations := 0
	packageServiceMap := make(map[string][]string) // package -> list of services

	for _, service := range discoveredServices {
		// Load proto files for this service
		if err := server.protoLoader.LoadFromDirectory(service.ServiceDir); err != nil {
			return nil, fmt.Errorf("failed to load proto files for service %s: %w", service.FullName, err)
		}

		// Load operations for this service
		if len(service.OperationFiles) > 0 {
			if err := server.operationRegistry.LoadOperationsForService(service.FullName, service.OperationFiles); err != nil {
				return nil, fmt.Errorf("failed to load operations for service %s: %w", service.FullName, err)
			}
			totalOperations += server.operationRegistry.CountForService(service.FullName)
		} else {
			server.logger.Warn("no operations found for service",
				zap.String("service", service.FullName))
		}

		// Track packages and services
		packageServiceMap[service.Package] = append(packageServiceMap[service.Package], service.ServiceName)
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

	// Log consolidated initialization summary
	server.logger.Info("services loaded",
		zap.Int("packages", len(packageServiceMap)),
		zap.Int("services", len(discoveredServices)),
		zap.Int("operations", totalOperations),
		zap.Duration("duration", time.Since(startTime)))

	return server, nil
}

// Start starts the HTTP server (services must already be loaded via NewServer)
func (s *Server) Start() error {
	s.logger.Info("starting ConnectRPC server",
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

	s.logger.Info("HTTP/2 (h2c) support enabled")

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

// Reload reloads the server configuration and operations
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

	// Create a fresh proto loader before initializing components
	// This ensures initializeComponents() (and the RPCHandler it constructs) receives the fresh ProtoLoader
	s.protoLoader = NewProtoLoader(s.logger)

	// Reinitialize components with the fresh proto loader
	if err := s.initializeComponents(); err != nil {
		return fmt.Errorf("failed to reinitialize components: %w", err)
	}

	// Reload proto files and operations for each service

	for _, service := range discoveredServices {
		// Load proto files for this service
		if err := s.protoLoader.LoadFromDirectory(service.ServiceDir); err != nil {
			return fmt.Errorf("failed to reload proto files for service %s: %w", service.FullName, err)
		}

		// Load operations for this service
		if len(service.OperationFiles) > 0 {
			if err := s.operationRegistry.LoadOperationsForService(service.FullName, service.OperationFiles); err != nil {
				return fmt.Errorf("failed to reload operations for service %s: %w", service.FullName, err)
			}
		}
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

// initializeComponents initializes the server components
func (s *Server) initializeComponents() error {
	// Create operation registry
	s.operationRegistry = NewOperationRegistry(s.logger)

	// Create RPC handler
	// Note: ProtoLoader must be set before calling this during NewServer()
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

// createHandler creates the HTTP handler
func (s *Server) createHandler() http.Handler {
	mux := http.NewServeMux()

	// Wrap transcoder to capture response status
	wrappedTranscoder := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Create a response writer that captures the status code and implements required interfaces
		rw := &responseWriter{ResponseWriter: w, statusCode: 200}

		// The transcoder handles protocol translation and routing
		s.transcoder.ServeHTTP(rw, r)
	})

	// Mount transcoder at root
	mux.Handle("/", wrappedTranscoder)

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

// responseWriter wraps http.ResponseWriter to capture status code
// and implements required interfaces for gRPC streaming
type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
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
