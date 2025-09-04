package json_rpc_server

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"go.uber.org/zap"
)

// JSONRPCServerConfig holds configuration for the JSON-RPC server
type JSONRPCServerConfig struct {
	ListenAddr            string
	OperationsDir         string
	RouterGraphQLEndpoint string
	RequestTimeout        time.Duration
	Logger                *zap.Logger
	HTTPClient            *http.Client
}

// JSONRPCServer provides HTTP endpoints for GraphQL operations
type JSONRPCServer struct {
	config        *JSONRPCServerConfig
	server        *http.Server
	router        *chi.Mux
	mappingLoader *MappingLoader
	routes        []RouteOperationMap
}

// NewJSONRPCServer creates a new JSON-RPC server instance
func NewJSONRPCServer(config *JSONRPCServerConfig) *JSONRPCServer {
	r := chi.NewRouter()

	// Add basic middleware
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(config.RequestTimeout))

	return &JSONRPCServer{
		config: config,
		server: &http.Server{
			Addr:    config.ListenAddr,
			Handler: r,
		},
		router:        r,
		mappingLoader: NewMappingLoader(config.OperationsDir),
	}
}

// Start initializes the server by loading mappings and starting the HTTP server
func (s *JSONRPCServer) Start(ctx context.Context) error {
	s.config.Logger.Info("Starting JSON-RPC server", zap.String("addr", s.config.ListenAddr))

	// Load operation mappings
	if err := s.loadMappings(); err != nil {
		return fmt.Errorf("failed to load operation mappings: %w", err)
	}

	// Register routes
	if err := s.registerRoutes(); err != nil {
		return fmt.Errorf("failed to register routes: %w", err)
	}

	// Start server in goroutine
	go func() {
		if err := s.server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			s.config.Logger.Error("JSON-RPC server error", zap.Error(err))
		}
	}()

	s.config.Logger.Info("JSON-RPC server started successfully")
	return nil
}

// Stop gracefully shuts down the server
func (s *JSONRPCServer) Stop(ctx context.Context) error {
	s.config.Logger.Info("Stopping JSON-RPC server")
	return s.server.Shutdown(ctx)
}

// loadMappings loads all operation mappings from YAML files
func (s *JSONRPCServer) loadMappings() error {
	routes, err := s.mappingLoader.LoadMappings()
	if err != nil {
		return err
	}

	s.routes = routes
	s.config.Logger.Info("Loaded operation mappings", zap.Int("count", len(routes)))
	return nil
}

// registerRoutes registers HTTP routes using the existing RegisterRoutes function
func (s *JSONRPCServer) registerRoutes() error {
	// Create GraphQL client with the configured HTTP client and endpoint
	gqlClient := NewGraphQLClient(s.config.HTTPClient, s.config.RouterGraphQLEndpoint)

	// Use the upgraded RegisterRoutes function from operation_mapper.go
	RegisterRoutes(s.router, s.routes, gqlClient)
	return nil
}
