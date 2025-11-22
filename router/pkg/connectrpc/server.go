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
	// ProtoDir is the directory containing proto files
	ProtoDir string
	// OperationsDir is the directory containing pre-defined GraphQL operations (required)
	OperationsDir string
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
	transcoder        *vanguard.Transcoder
	protoLoader       *ProtoLoader
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
		zap.String("operations_dir", s.config.OperationsDir),
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
	vanguardServices := vanguardService.GetServices()
	s.logger.Info("creating vanguard transcoder",
		zap.Int("service_count", len(vanguardServices)))
	
	// Log details about each service being passed to the transcoder
	for i, svc := range vanguardServices {
		s.logger.Info("vanguard service details",
			zap.Int("index", i),
			zap.String("type", fmt.Sprintf("%T", svc)))
	}
	
	transcoder, err := vanguard.NewTranscoder(vanguardServices)
	if err != nil {
		return fmt.Errorf("failed to create vanguard transcoder: %w", err)
	}
	s.transcoder = transcoder
	
	s.logger.Info("vanguard transcoder created successfully",
		zap.Int("registered_services", len(vanguardServices)))

	// Create HTTP server with HTTP/2 support
	// Use h2c (HTTP/2 Cleartext) to support HTTP/2 without TLS
	handler := s.createHandler()
	h2cHandler := h2c.NewHandler(handler, &http2.Server{})
	
	s.httpServer = &http.Server{
		Addr:         s.config.ListenAddr,
		Handler:      h2cHandler,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	s.logger.Info("HTTP/2 (h2c) support enabled for gRPC compatibility")

	// Start server in goroutine
	go func() {
		s.logger.Info("ConnectRPC server listening",
			zap.String("addr", s.config.ListenAddr),
			zap.Bool("http2_enabled", true))

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
func (s *Server) Reload() error {
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

	// Reload RPC handler operations if operations directory is configured
	if s.config.OperationsDir != "" {
		if err := s.rpcHandler.Reload(s.config.OperationsDir); err != nil {
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

// initializeComponents initializes the server components
func (s *Server) initializeComponents() error {
	// Create operation registry
	s.operationRegistry = NewOperationRegistry(s.logger)

	// Create RPC handler
	var err error
	s.rpcHandler, err = NewRPCHandler(HandlerConfig{
		GraphQLEndpoint:   s.config.GraphQLEndpoint,
		HTTPClient:        s.httpClient,
		Logger:            s.logger,
		OperationRegistry: s.operationRegistry,
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
