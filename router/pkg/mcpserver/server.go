package mcpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/hashicorp/go-retryablehttp"
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
	"github.com/santhosh-tekuri/jsonschema/v6"
	"github.com/wundergraph/cosmo/router/pkg/schemaloader"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"go.uber.org/zap"
)

// Options represents configuration options for the GraphQLSchemaServer
type Options struct {
	// GraphName is the name of the graph to be served
	GraphName string
	// OperationsDir is the directory where GraphQL operations are stored
	OperationsDir string
	// ListenAddr is the address where the SSE server should listen
	ListenAddr string
	// Enabled determines whether the MCP server should be started
	Enabled bool
	// Logger is the logger to be used
	Logger *zap.Logger
	// RequestTimeout is the timeout for HTTP requests
	RequestTimeout time.Duration
}

// GraphQLSchemaServer represents an MCP server that works with GraphQL schemas and operations
type GraphQLSchemaServer struct {
	server                *server.MCPServer
	schemaDoc             *ast.Document
	operations            []schemaloader.Operation
	graphName             string
	operationsDir         string
	listenAddr            string
	logger                *zap.Logger
	httpClient            *http.Client
	requestTimeout        time.Duration
	routerGraphQLEndpoint string
}

type graphqlRequest struct {
	Query     string          `json:"query"`
	Variables json.RawMessage `json:"variables"`
}

// operationHandler holds an operation and its compiled JSON schema
type operationHandler struct {
	operation      schemaloader.Operation
	compiledSchema *jsonschema.Schema
}

// NewGraphQLSchemaServer creates a new GraphQL schema server
func NewGraphQLSchemaServer(routerGraphQLEndpoint string, schema *ast.Document, opts ...func(*Options)) (*GraphQLSchemaServer, error) {

	if routerGraphQLEndpoint == "" {
		return nil, fmt.Errorf("routerGraphQLEndpoint cannot be empty")
	}

	if schema == nil {
		return nil, fmt.Errorf("schema cannot be nil")
	}

	if !strings.Contains(routerGraphQLEndpoint, "://") {
		routerGraphQLEndpoint = "http://" + routerGraphQLEndpoint
	}

	// Default options
	options := &Options{
		GraphName:      "graph",
		OperationsDir:  "operations",
		ListenAddr:     ":5025",
		Enabled:        false,
		Logger:         zap.NewNop(),
		RequestTimeout: 30 * time.Second,
	}

	// Apply all option functions
	for _, opt := range opts {
		opt(options)
	}

	// Create the MCP server
	mcpServer := server.NewMCPServer(
		"wundergraph-cosmo-"+options.GraphName,
		"0.0.1",
		// Prompt, Resources aren't supported yet in any of the popular platforms
		server.WithToolCapabilities(true),
	)

	retryClient := retryablehttp.NewClient()
	retryClient.Logger = nil
	httpClient := retryClient.StandardClient()
	httpClient.Timeout = 60 * time.Second

	gs := &GraphQLSchemaServer{
		server:                mcpServer,
		schemaDoc:             schema,
		graphName:             options.GraphName,
		operationsDir:         options.OperationsDir,
		listenAddr:            options.ListenAddr,
		logger:                options.Logger,
		httpClient:            httpClient,
		requestTimeout:        options.RequestTimeout,
		routerGraphQLEndpoint: routerGraphQLEndpoint,
	}

	return gs, nil
}

// WithGraphName sets the graph name
func WithGraphName(graphName string) func(*Options) {
	return func(o *Options) {
		o.GraphName = graphName
	}
}

// WithOperationsDir sets the operations directory
func WithOperationsDir(operationsDir string) func(*Options) {
	return func(o *Options) {
		o.OperationsDir = operationsDir
	}
}

// WithListenAddr sets the listen address
func WithListenAddr(listenAddr string) func(*Options) {
	return func(o *Options) {
		o.ListenAddr = listenAddr
	}
}

func WithRequestTimeout(timeout time.Duration) func(*Options) {
	return func(o *Options) {
		o.RequestTimeout = timeout
	}
}

func WithLogger(logger *zap.Logger) func(*Options) {
	return func(o *Options) {
		o.Logger = logger
	}
}

// LoadOperations loads operations from the configured operations directory
func (s *GraphQLSchemaServer) LoadOperations() error {
	return s.LoadOperationsFromDirectory(s.operationsDir)
}

// LoadOperationsFromDirectory loads operations from a specified directory
func (s *GraphQLSchemaServer) LoadOperationsFromDirectory(operationsDir string) error {
	// Load operations
	loader := schemaloader.NewOperationLoader(s.schemaDoc)
	operations, err := loader.LoadOperationsFromDirectory(operationsDir)
	if err != nil {
		return fmt.Errorf("failed to load operations: %w", err)
	}

	// Build schemas for operations
	builder := schemaloader.NewSchemaBuilder(s.schemaDoc)
	err = builder.BuildSchemasForOperations(operations)
	if err != nil {
		return fmt.Errorf("failed to build schemas: %w", err)
	}

	s.operations = operations

	// Register tools
	s.registerTools()

	return nil
}

// ServeSSE starts the server with SSE transport
func (s *GraphQLSchemaServer) ServeSSE() (*server.SSEServer, *http.Server, error) {

	// Create HTTP server with timeouts
	httpServer := &http.Server{
		Addr:         s.listenAddr,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  30 * time.Second,
	}

	sseServer := server.NewSSEServer(s.server,
		server.WithBaseURL(fmt.Sprintf("http://localhost%s", s.listenAddr)),
		server.WithHTTPServer(httpServer),
	)
	return sseServer, httpServer, nil
}

// Start loads operations and starts the server
func (s *GraphQLSchemaServer) Start(ctx context.Context) error {

	if err := s.LoadOperations(); err != nil {
		return fmt.Errorf("failed to load operations: %w", err)
	}

	sseServer, httpServer, err := s.ServeSSE()
	if err != nil {
		return fmt.Errorf("failed to create SSE server: %w", err)
	}

	// Start server in a goroutine
	serverErrChan := make(chan error, 1)
	go func() {
		err := sseServer.Start(s.listenAddr)
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			s.logger.Error("failed to start SSE server", zap.Error(err))
		}
		serverErrChan <- err
	}()

	// Handle graceful shutdown on context cancellation
	go func() {
		select {
		case <-ctx.Done():
			s.logger.Info("context canceled, shutting down SSE server")

			// Create a shutdown context with timeout
			shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()

			// Shutdown the HTTP server
			if err := httpServer.Shutdown(shutdownCtx); err != nil {
				s.logger.Error("failed to gracefully shutdown server", zap.Error(err))
			}

		case err := <-serverErrChan:
			if err != nil && !errors.Is(err, http.ErrServerClosed) {
				s.logger.Error("SSE server error", zap.Error(err))
			}
		}
	}()

	return nil
}

// registerTools registers all tools for the MCP server
func (s *GraphQLSchemaServer) registerTools() {

	for _, op := range s.operations {
		var compiledSchema *jsonschema.Schema

		if len(op.JSONSchema) > 0 {
			c := jsonschema.NewCompiler()
			// Load the JSON schema from the operation
			schema, err := jsonschema.UnmarshalJSON(io.NopCloser(bytes.NewReader(op.JSONSchema)))
			if err != nil {
				s.logger.Error("failed to unmarshal JSON schema", zap.String("operation", op.Name), zap.Error(err))
				continue
			}

			sn := fmt.Sprintf("schema-%s.json", op.Name)
			err = c.AddResource(sn, schema)
			if err != nil {
				s.logger.Error("failed to add resource to JSON schema compiler", zap.String("operation", op.Name), zap.Error(err))
				continue
			}

			sch, err := c.Compile(sn)
			if err != nil {
				s.logger.Error("failed to compile JSON schema", zap.String("operation", op.Name), zap.Error(err))
				continue
			}

			compiledSchema = sch
		}

		// Create handler with pre-compiled schema
		handler := &operationHandler{
			operation:      op,
			compiledSchema: compiledSchema,
		}

		s.server.AddTool(
			mcp.NewToolWithRawSchema(
				op.Name,
				op.Description,
				op.JSONSchema,
			),
			s.handleOperation(handler),
		)
	}
}

// handleOperation handles a specific operation
func (s *GraphQLSchemaServer) handleOperation(handler *operationHandler) func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	return func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {

		// Parse the JSON input that was generated by the client from the operation input schema
		jsonBytes, err := json.Marshal(request.Params.Arguments)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal arguments: %w", err)
		}

		// Validate the JSON input against the pre-compiled schema derived from the operation input type
		if handler.compiledSchema != nil {
			var v interface{}
			if err := json.Unmarshal(jsonBytes, &v); err != nil {
				return nil, fmt.Errorf("failed to parse JSON input: %w", err)
			}

			if err := handler.compiledSchema.Validate(v); err != nil {
				var validationErr *jsonschema.ValidationError
				if errors.As(err, &validationErr) {
					// This helps the LLM to understand the error better
					return nil, fmt.Errorf("validation error: %s", validationErr.Error())
				}
				return nil, fmt.Errorf("schema validation failed: %w", err)
			}
		}

		graphqlRequest := graphqlRequest{
			Query:     handler.operation.OperationString,
			Variables: json.RawMessage(jsonBytes),
		}

		graphqlRequestBytes, err := json.Marshal(graphqlRequest)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal GraphQL request: %w", err)
		}

		req, err := http.NewRequest("POST", s.routerGraphQLEndpoint, bytes.NewReader(graphqlRequestBytes))
		if err != nil {
			return nil, fmt.Errorf("failed to create request: %w", err)
		}

		resp, err := s.httpClient.Do(req)
		if err != nil {
			return nil, fmt.Errorf("failed to send request: %w", err)
		}
		defer resp.Body.Close()

		body, err := io.ReadAll(resp.Body)
		if err != nil {
			return nil, fmt.Errorf("failed to read response body: %w", err)
		}

		return mcp.NewToolResultText(string(body)), nil
	}
}
