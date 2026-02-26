package mcpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/hashicorp/go-retryablehttp"
	"github.com/iancoleman/strcase"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/santhosh-tekuri/jsonschema/v6"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/internal/headers"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/cors"
	"github.com/wundergraph/cosmo/router/pkg/schemaloader"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astprinter"
)

// requestHeadersKey is a custom context key for storing request headers.
type requestHeadersKey struct{}

// withRequestHeaders adds request headers to the context.
func withRequestHeaders(ctx context.Context, headers http.Header) context.Context {
	return context.WithValue(ctx, requestHeadersKey{}, headers)
}

// requestHeadersFromRequest extracts all headers from the request and stores them in context.
func requestHeadersFromRequest(ctx context.Context, r *http.Request) context.Context {
	// Clone the headers to avoid any mutation issues
	headers := r.Header.Clone()
	return withRequestHeaders(ctx, headers)
}


// headersFromContext extracts the request headers from the context.
func headersFromContext(ctx context.Context) (http.Header, error) {
	headers, ok := ctx.Value(requestHeadersKey{}).(http.Header)
	if !ok {
		return nil, fmt.Errorf("missing request headers")
	}
	return headers, nil
}

// Options represents configuration options for the GraphQLSchemaServer
type Options struct {
	// GraphName is the name of the graph to be served
	GraphName string
	// OperationsDir is the directory where GraphQL operations are stored
	OperationsDir string
	// ListenAddr is the address where the server should listen to
	ListenAddr string
	// Enabled determines whether the MCP server should be started
	Enabled bool
	// Logger is the logger to be used
	Logger *zap.Logger
	// RequestTimeout is the timeout for HTTP requests
	RequestTimeout time.Duration
	// ExcludeMutations determines whether mutation operations should be excluded
	ExcludeMutations bool
	// EnableArbitraryOperations determines whether arbitrary GraphQL operations can be executed
	EnableArbitraryOperations bool
	// ExposeSchema determines whether the GraphQL schema is exposed
	ExposeSchema bool
	// OmitToolNamePrefix removes the "execute_operation_" prefix from MCP tool names
	OmitToolNamePrefix bool
	// Stateless determines whether the MCP server should be stateless
	Stateless bool
	// CorsConfig is the CORS configuration for the MCP server
	CorsConfig cors.Config
	// OAuthConfig is the OAuth/JWKS configuration for authentication
	OAuthConfig *config.MCPOAuthConfiguration
	// ServerBaseURL is the base URL of this MCP server (for resource metadata)
	ServerBaseURL string
}

// GraphQLSchemaServer represents an MCP server that works with GraphQL schemas and operations
type GraphQLSchemaServer struct {
	server                    *mcp.Server
	graphName                 string
	operationsDir             string
	listenAddr                string
	logger                    *zap.Logger
	httpClient                *http.Client
	requestTimeout            time.Duration
	routerGraphQLEndpoint     string
	httpServer                *http.Server
	excludeMutations          bool
	enableArbitraryOperations bool
	exposeSchema              bool
	omitToolNamePrefix        bool
	stateless                 bool
	operationsManager         *OperationsManager
	schemaCompiler            *SchemaCompiler
	registeredTools           []string
	corsConfig                cors.Config
	ctx                       context.Context
	cancel                    context.CancelFunc
	oauthConfig               *config.MCPOAuthConfiguration
	serverBaseURL             string
	authMiddleware            *MCPAuthMiddleware
}

type graphqlRequest struct {
	Query     string          `json:"query"`
	Variables json.RawMessage `json:"variables"`
}

// ExecuteGraphQLInput defines the input structure for the execute_graphql tool
type ExecuteGraphQLInput struct {
	Query     string          `json:"query"`
	Variables json.RawMessage `json:"variables,omitempty"`
}

// operationHandler holds an operation and its compiled JSON schema
type operationHandler struct {
	operation      schemaloader.Operation
	compiledSchema *jsonschema.Schema
}

// OperationInfo contains metadata about a GraphQL operation
type OperationInfo struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Schema      json.RawMessage `json:"schema,omitempty"`
	Query       string          `json:"query"`
}

// OperationsResponse is the response structure for the listGraphQLOperations tool
type OperationsResponse struct {
	Operations  []OperationInfo `json:"operations"`
	Usage       string          `json:"usage"`
	LLMGuidance LLMGuidance     `json:"llmGuidance"`
	Endpoint    string          `json:"endpoint"`
}

// GraphQLOperationInfoResponse is the response structure for the graphql_operation_info tool.
type GraphQLOperationInfoResponse struct {
	Name           string          `json:"name"`
	Description    string          `json:"description"`
	OperationType  string          `json:"operationType"`
	HasSideEffects bool            `json:"hasSideEffects"`
	Schema         json.RawMessage `json:"schema,omitempty"`
	Query          string          `json:"query"`
	LLMGuidance    LLMGuidance     `json:"llmGuidance"`
	Endpoint       string          `json:"endpoint"`
}

// GraphQLOperationInfoInput defines the input structure for the graphql_operation_info tool.
type GraphQLOperationInfoInput struct {
	OperationName string `json:"operationName"`
}

// LLMGuidance provides guidance for LLMs on how to use the GraphQL operations
type LLMGuidance struct {
	HTTPUsage      string   `json:"httpUsage"`
	GraphQLRequest string   `json:"graphqlRequest"`
	ExecutionTips  []string `json:"executionTips"`
}

// GraphQLError represents an error returned in a GraphQL response
type GraphQLError struct {
	Message string `json:"message"`
}

// GraphQLResponse represents a GraphQL response structure
type GraphQLResponse struct {
	Errors []GraphQLError  `json:"errors"`
	Data   json.RawMessage `json:"data"`
}

// NewGraphQLSchemaServer creates a new GraphQL schema server
func NewGraphQLSchemaServer(routerGraphQLEndpoint string, opts ...func(*Options)) (*GraphQLSchemaServer, error) {
	if routerGraphQLEndpoint == "" {
		return nil, fmt.Errorf("routerGraphQLEndpoint cannot be empty")
	}

	if !strings.Contains(routerGraphQLEndpoint, "://") {
		routerGraphQLEndpoint = "http://" + routerGraphQLEndpoint
	}

	// Default options
	options := &Options{
		GraphName:      "graph",
		OperationsDir:  "operations",
		ListenAddr:     "0.0.0.0:5025",
		Enabled:        false,
		Logger:         zap.NewNop(),
		RequestTimeout: 30 * time.Second,
		ExposeSchema:   true,
		Stateless:      true,
	}

	// Apply all option functions
	for _, opt := range opts {
		opt(options)
	}

	// Create a cancellable context for managing the server lifecycle
	ctx, cancel := context.WithCancel(context.Background())

	// Add authentication middleware if OAuth is configured
	var authMiddleware *MCPAuthMiddleware
	if options.OAuthConfig != nil && options.OAuthConfig.Enabled {
		if len(options.OAuthConfig.JWKS) == 0 {
			cancel()
			return nil, fmt.Errorf("MCP OAuth is enabled but no JWKS providers are configured; this would start an unprotected endpoint")
		}
		// Convert config.JWKSConfiguration to authentication.JWKSConfig
		authConfigs := make([]authentication.JWKSConfig, 0, len(options.OAuthConfig.JWKS))
		for _, jwks := range options.OAuthConfig.JWKS {
			authConfigs = append(authConfigs, authentication.JWKSConfig{
				URL:               jwks.URL,
				RefreshInterval:   jwks.RefreshInterval,
				AllowedAlgorithms: jwks.Algorithms,
				Secret:            jwks.Secret,
				Algorithm:         jwks.Algorithm,
				KeyId:             jwks.KeyId,
				Audiences:         jwks.Audiences,
				RefreshUnknownKID: authentication.RefreshUnknownKIDConfig{
					Enabled:  jwks.RefreshUnknownKID.Enabled,
					MaxWait:  jwks.RefreshUnknownKID.MaxWait,
					Interval: jwks.RefreshUnknownKID.Interval,
					Burst:    jwks.RefreshUnknownKID.Burst,
				},
			})
		}

		// Create token decoder using the managed context for proper lifecycle management
		tokenDecoder, err := authentication.NewJwksTokenDecoder(
			ctx,
			options.Logger,
			authConfigs,
		)
		if err != nil {
			cancel() // Clean up the context if initialization fails
			return nil, fmt.Errorf("failed to create token decoder: %w", err)
		}

		// Build resource metadata URL for WWW-Authenticate header
		resourceMetadataURL := ""
		if options.ServerBaseURL != "" {
			resourceMetadataURL = fmt.Sprintf("%s/.well-known/oauth-protected-resource/mcp", options.ServerBaseURL)
		}

		// Create authentication middleware with scope configuration
		// The middleware checks scopes at three levels:
		// - initialize: scopes required for all HTTP requests
		// - tools_list: scopes required for tools/list method
		// - tools_call: scopes required for tools/call method (any tool)
		scopeConfig := MCPScopeConfig{
			Initialize: options.OAuthConfig.Scopes.Initialize,
			ToolsList:  options.OAuthConfig.Scopes.ToolsList,
			ToolsCall:  options.OAuthConfig.Scopes.ToolsCall,
		}
		authMiddleware, err = NewMCPAuthMiddleware(tokenDecoder, true, resourceMetadataURL, scopeConfig, options.OAuthConfig.ScopeChallengeMode)
		if err != nil {
			cancel() // Clean up the context if initialization fails
			return nil, fmt.Errorf("failed to create auth middleware: %w", err)
		}

		// Store auth middleware for HTTP-level protection
		// Note: We don't use tool middleware here because per MCP spec,
		// ALL HTTP requests must be authenticated, not just tool calls
		options.Logger.Info("MCP OAuth authentication enabled",
			zap.Int("jwks_providers", len(options.OAuthConfig.JWKS)),
			zap.String("authorization_server", options.OAuthConfig.AuthorizationServerURL))
	}

	// Create the MCP server with all options
	mcpServer := mcp.NewServer(
		&mcp.Implementation{
			Name:    "wundergraph-cosmo-" + strcase.ToKebab(options.GraphName),
			Version: "0.0.1",
		},
		&mcp.ServerOptions{
			PageSize: 100,
		},
	)

	retryClient := retryablehttp.NewClient()
	retryClient.Logger = nil
	httpClient := retryClient.StandardClient()
	httpClient.Timeout = 60 * time.Second

	gs := &GraphQLSchemaServer{
		server:                    mcpServer,
		graphName:                 options.GraphName,
		operationsDir:             options.OperationsDir,
		listenAddr:                options.ListenAddr,
		logger:                    options.Logger,
		httpClient:                httpClient,
		requestTimeout:            options.RequestTimeout,
		routerGraphQLEndpoint:     routerGraphQLEndpoint,
		excludeMutations:          options.ExcludeMutations,
		enableArbitraryOperations: options.EnableArbitraryOperations,
		exposeSchema:              options.ExposeSchema,
		omitToolNamePrefix:        options.OmitToolNamePrefix,
		stateless:                 options.Stateless,
		corsConfig:                options.CorsConfig,
		ctx:                       ctx,
		cancel:                    cancel,
		oauthConfig:               options.OAuthConfig,
		serverBaseURL:             options.ServerBaseURL,
		authMiddleware:            authMiddleware,
	}

	return gs, nil
}

// SetHTTPClient allows setting a custom HTTP client (useful for testing)
func (s *GraphQLSchemaServer) SetHTTPClient(client *http.Client) {
	s.httpClient = client
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

// WithEnableArbitraryOperations sets the enable arbitrary operations option
func WithEnableArbitraryOperations(enableArbitraryOperations bool) func(*Options) {
	return func(o *Options) {
		o.EnableArbitraryOperations = enableArbitraryOperations
	}
}

// WithExposeSchema sets the expose schema option
func WithExposeSchema(exposeSchema bool) func(*Options) {
	return func(o *Options) {
		o.ExposeSchema = exposeSchema
	}
}

// WithStateless sets the stateless option
func WithStateless(stateless bool) func(*Options) {
	return func(o *Options) {
		o.Stateless = stateless
	}
}

// WithOmitToolNamePrefix sets the omit tool name prefix option
func WithOmitToolNamePrefix(omitToolNamePrefix bool) func(*Options) {
	return func(o *Options) {
		o.OmitToolNamePrefix = omitToolNamePrefix
	}
}

func WithCORS(corsCfg cors.Config) func(*Options) {
	return func(o *Options) {
		// Force specific CORS settings for MCP server
		corsCfg.AllowOrigins = []string{"*"}
		corsCfg.AllowMethods = []string{"GET", "PUT", "POST", "DELETE", "OPTIONS"}
		corsCfg.AllowHeaders = append(corsCfg.AllowHeaders, "Content-Type", "Accept", "Authorization", "Last-Event-ID", "Mcp-Protocol-Version", "Mcp-Session-Id")
		if corsCfg.MaxAge <= 0 {
			corsCfg.MaxAge = 24 * time.Hour
		}
		o.CorsConfig = corsCfg
	}
}

// WithOAuth sets the OAuth configuration
func WithOAuth(oauthCfg *config.MCPOAuthConfiguration) func(*Options) {
	return func(o *Options) {
		o.OAuthConfig = oauthCfg
	}
}

// WithServerBaseURL sets the server base URL for OAuth discovery
func WithServerBaseURL(baseURL string) func(*Options) {
	return func(o *Options) {
		o.ServerBaseURL = baseURL
	}
}

// Serve starts the server with the configured options and returns the HTTP server.
func (s *GraphQLSchemaServer) Serve() (*http.Server, error) {
	// Create custom HTTP server
	httpServer := &http.Server{
		Addr:         s.listenAddr,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Create MCP streamable HTTP handler
	// The getServer function returns our MCP server instance for each request
	streamableHTTPHandler := mcp.NewStreamableHTTPHandler(
		func(req *http.Request) *mcp.Server {
			// Add request headers to context for tool handlers
			return s.server
		},
		nil, // Use default options
	)

	middleware := cors.New(s.corsConfig)

	mux := http.NewServeMux()

	// OAuth 2.0 Protected Resource Metadata endpoint (RFC 9728 Section 3.1)
	// This endpoint is required for MCP clients to discover the authorization server.
	// This endpoint is NOT protected by authentication (it's public discovery).
	//
	// Per RFC 9728, when a resource is served at a path other than /, the well-known
	// URI must include the path suffix: /.well-known/oauth-protected-resource/mcp
	if s.oauthConfig != nil && s.oauthConfig.Enabled && s.oauthConfig.AuthorizationServerURL != "" {
		mux.Handle("/.well-known/oauth-protected-resource/mcp", middleware(http.HandlerFunc(s.handleProtectedResourceMetadata)))
		s.logger.Info("OAuth 2.0 Protected Resource Metadata endpoint enabled (RFC 9728 path-aware)",
			zap.String("path", "/.well-known/oauth-protected-resource/mcp"),
			zap.String("authorization_server", s.oauthConfig.AuthorizationServerURL))
	}

	// MCP endpoint with HTTP-level authentication
	// Per MCP spec: "authorization MUST be included in every HTTP request from client to server"
	mcpHandler := http.Handler(streamableHTTPHandler)

	// Apply authentication middleware if OAuth is enabled
	if s.authMiddleware != nil {
		mux.Handle("/mcp", middleware(s.authMiddleware.HTTPMiddleware(mcpHandler)))
		s.logger.Info("MCP endpoint protected with OAuth authentication at HTTP level")
	} else {
		mux.Handle("/mcp", middleware(mcpHandler))
	}

	// Set the handler for the custom HTTP server
	httpServer.Handler = mux

	logger := []zap.Field{
		zap.String("listen_addr", s.listenAddr),
		zap.String("path", "/mcp"),
		zap.String("operations_dir", s.operationsDir),
		zap.String("graph_name", s.graphName),
		zap.Bool("exclude_mutations", s.excludeMutations),
		zap.Bool("enable_arbitrary_operations", s.enableArbitraryOperations),
		zap.Bool("expose_schema", s.exposeSchema),
	}

	s.logger.Info("MCP server started", logger...)

	go func() {
		defer s.logger.Info("MCP server stopped")

		err := httpServer.ListenAndServe()
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			s.logger.Error("failed to start HTTP server", zap.Error(err))
		}
	}()

	return httpServer, nil
}

// Start loads operations and starts the server
func (s *GraphQLSchemaServer) Start() error {
	ss, err := s.Serve()
	if err != nil {
		return fmt.Errorf("failed to create HTTP server: %w", err)
	}

	s.httpServer = ss

	return nil
}

// Reload reloads the operations and schema
func (s *GraphQLSchemaServer) Reload(schema *ast.Document) error {
	if s.server == nil {
		return fmt.Errorf("server is not started")
	}

	s.schemaCompiler = NewSchemaCompiler(s.logger)
	s.operationsManager = NewOperationsManager(schema, s.logger, s.excludeMutations)

	if s.operationsDir != "" {
		if err := s.operationsManager.LoadOperationsFromDirectory(s.operationsDir); err != nil {
			return fmt.Errorf("failed to load operations: %w", err)
		}
	}

	s.server.RemoveTools(s.registeredTools...)

	if err := s.registerTools(); err != nil {
		return fmt.Errorf("failed to register tools: %w", err)
	}

	return nil
}

// Stop gracefully shuts down the MCP server
func (s *GraphQLSchemaServer) Stop(ctx context.Context) error {
	if s.httpServer == nil {
		return fmt.Errorf("server is not started")
	}

	s.logger.Debug("shutting down MCP server")

	// Cancel the server's context to stop background operations (e.g., JWKS key refresh)
	if s.cancel != nil {
		s.cancel()
	}

	// Create a shutdown context with timeout
	shutdownCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if err := s.httpServer.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("failed to gracefully shutdown MCP server: %w", err)
	}

	return nil
}

// registerTools registers all tools for the MCP server
func (s *GraphQLSchemaServer) registerTools() error {
	// Only register the schema tool if exposeSchema is enabled
	if s.exposeSchema {
		// Create a schema with empty properties since get_schema takes no input
		getSchemaInputSchema := map[string]any{
			"type":       "object",
			"properties": map[string]any{},
		}

		tool := &mcp.Tool{
			Name:        "get_schema",
			Description: "Provides the full GraphQL schema of the API.",
			InputSchema: getSchemaInputSchema,
			Annotations: &mcp.ToolAnnotations{
				Title:        "Get GraphQL Schema",
				ReadOnlyHint: true,
			},
		}

		s.server.AddTool(tool, s.handleGetGraphQLSchema())
		s.registeredTools = append(s.registeredTools, "get_schema")
	}

	// Only register the execute_graphql tool if enableArbitraryOperations is enabled
	if s.enableArbitraryOperations {
		// Add a tool to execute arbitrary GraphQL queries
		executeGraphQLSchema := map[string]any{
			"type":        "object",
			"description": "The query and variables to execute.",
			"properties": map[string]any{
				"query": map[string]any{
					"type":        "string",
					"description": "The GraphQL query or mutation string to execute.",
				},
				"variables": map[string]any{
					"type":                 "object",
					"additionalProperties": true,
					"description":          "The variables to pass to the GraphQL query as a JSON object.",
				},
			},
			"additionalProperties": false,
			"required":             []string{"query"},
		}

		destructiveHint := true
		openWorldHint := true
		tool := &mcp.Tool{
			Name:        "execute_graphql",
			Description: "Executes a GraphQL query or mutation.",
			InputSchema: executeGraphQLSchema,
			Annotations: &mcp.ToolAnnotations{
				Title:           "Execute GraphQL Query",
				DestructiveHint: &destructiveHint,
				IdempotentHint:  false,
				OpenWorldHint:   &openWorldHint,
			},
		}

		s.server.AddTool(tool, s.handleExecuteGraphQL())
		s.registeredTools = append(s.registeredTools, "execute_graphql")
	}

	// Get operations filtered by the excludeMutations setting
	operations := s.operationsManager.GetFilteredOperations()

	graphqlOperationNames := make([]string, 0, len(operations))

	for _, op := range operations {
		var compiledSchema *jsonschema.Schema
		var err error

		graphqlOperationNames = append(graphqlOperationNames, op.Name)

		if len(op.JSONSchema) > 0 {
			// Validate the JSON schema before compiling it
			if err := s.schemaCompiler.ValidateJSONSchema(op.JSONSchema); err != nil {
				s.logger.Error("invalid schema for operation",
					zap.String("operation", op.Name),
					zap.Error(err))
				continue
			}

			// Now compile the validated schema
			schemaName := fmt.Sprintf("schema-%s.json", op.Name)
			compiledSchema, err = s.schemaCompiler.CompileJSONSchema(op.JSONSchema, schemaName)
			if err != nil {
				s.logger.Error("failed to compile schema for operation",
					zap.String("operation", op.Name),
					zap.Error(err))
				continue
			}
		}

		// Create handler with pre-compiled schema
		handler := &operationHandler{
			operation:      op,
			compiledSchema: compiledSchema,
		}

		// Convert the operation name to snake_case for consistent tool naming
		operationToolName := strcase.ToSnake(op.Name)

		// Use the operation description directly if provided, otherwise generate a default description
		var toolDescription string
		if op.Description != "" {
			toolDescription = op.Description
		} else {
			toolDescription = fmt.Sprintf("Executes the GraphQL operation '%s' of type %s.", op.Name, op.OperationType)
		}

		toolName := operationToolName
		if !s.omitToolNamePrefix {
			toolName = fmt.Sprintf("execute_operation_%s", operationToolName)
		} else if slices.Contains(s.registeredTools, operationToolName) {
			s.logger.Warn("Operation name collides with built-in MCP tool, using prefixed name",
				zap.String("operation", op.Name),
				zap.String("conflicting_tool", operationToolName),
				zap.String("using_name", fmt.Sprintf("execute_operation_%s", operationToolName)),
			)
			toolName = fmt.Sprintf("execute_operation_%s", operationToolName)
		}
		// Parse JSON schema into map for the official SDK
		var inputSchema any
		if len(op.JSONSchema) > 0 {
			if err := json.Unmarshal(op.JSONSchema, &inputSchema); err != nil {
				s.logger.Error("failed to parse JSON schema for operation",
					zap.String("operation", op.Name),
					zap.Error(err))
				continue
			}
		} else {
			inputSchema = map[string]any{"type": "object", "properties": map[string]any{}}
		}

		idempotent := op.OperationType != "mutation"
		openWorld := true
		tool := &mcp.Tool{
			Name:        toolName,
			Description: toolDescription,
			InputSchema: inputSchema,
			Annotations: &mcp.ToolAnnotations{
				IdempotentHint: op.OperationType != "mutation",
				Title:          fmt.Sprintf("Execute operation %s", op.Name),
				ReadOnlyHint:   op.OperationType == "query",
				OpenWorldHint:  &openWorld,
			},
		}

		// IdempotentHint uses the plain bool value, but keep it for later if needed
		_ = idempotent

		s.server.AddTool(tool, s.handleOperation(handler))

		s.registeredTools = append(s.registeredTools, toolName)
	}

	getOperationInfoTool := &mcp.Tool{
		Name:        "get_operation_info",
		Description: "Provides instructions on how to execute the GraphQL operation via HTTP and how to integrate it into your application.",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"operationName": map[string]any{
					"type":        "string",
					"description": "The exact name of the GraphQL operation to retrieve information for.",
					"enum":        graphqlOperationNames,
				},
			},
			"required": []string{"operationName"},
		},
		Annotations: &mcp.ToolAnnotations{
			Title:        "Get GraphQL Operation Info",
			ReadOnlyHint: true,
		},
	}

	s.server.AddTool(getOperationInfoTool, s.handleGraphQLOperationInfo())

	s.registeredTools = append(s.registeredTools, "get_operation_info")

	return nil
}

// handleOperation handles a specific operation
func (s *GraphQLSchemaServer) handleOperation(handler *operationHandler) func(ctx context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	return func(ctx context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		// Log authenticated user if OAuth is enabled
		if claims, ok := GetClaimsFromContext(ctx); ok {
			s.logger.Debug("operation called by authenticated user",
				zap.String("sub", getClaimString(claims, "sub")),
				zap.String("email", getClaimString(claims, "email")),
				zap.String("operation", handler.operation.Name))
		}

		jsonBytes := request.Params.Arguments

		// Validate the JSON input against the pre-compiled schema derived from the operation input type
		if handler.compiledSchema != nil {
			if err := s.schemaCompiler.ValidateInput(jsonBytes, handler.compiledSchema); err != nil {
				return &mcp.CallToolResult{
					Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf("Input validation error: %v", err)}},
					IsError: true,
				}, nil
			}
		}

		// Execute the operation with the provided variables
		return s.executeGraphQLQuery(ctx, handler.operation.OperationString, jsonBytes)
	}
}

// handleGraphQLOperationInfo returns a handler function that provides detailed info for a specific operation.
func (s *GraphQLSchemaServer) handleGraphQLOperationInfo() func(ctx context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	return func(ctx context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		var input GraphQLOperationInfoInput
		inputBytes := request.Params.Arguments
		if err := json.Unmarshal(inputBytes, &input); err != nil {
			return nil, fmt.Errorf("failed to unmarshal input arguments: %w. Ensure you provide {\"operationName\": \"<n>\"}", err)
		}

		if input.OperationName == "" {
			return nil, fmt.Errorf("input validation failed: operationName is required")
		}

		targetOp := s.operationsManager.GetOperation(input.OperationName)
		if targetOp == nil {
			return nil, fmt.Errorf("operation '%s' not found or excluded by configuration", input.OperationName)
		}

		// Operation overview section
		overview := fmt.Sprintf("Operation: %s\nType: %s\n", targetOp.Name, targetOp.OperationType)
		if targetOp.Description != "" {
			overview += fmt.Sprintf("Description: %s\n", targetOp.Description)
		}

		// Schema information section
		var schemaInfo string
		if len(targetOp.JSONSchema) > 0 {
			schemaInfo = fmt.Sprintf("\nInput Schema:\n```json\n%s\n```\n", targetOp.JSONSchema)
		} else {
			schemaInfo = "\nThis operation does not require any input variables.\n"
		}

		// Query section
		queryInfo := fmt.Sprintf("\nGraphQL Query:\n```\n%s\n```\n", targetOp.OperationString)

		// Usage instructions section
		usageInstructions := fmt.Sprintf(`
Usage Instructions:
1. Endpoint: %s
2. HTTP Method: POST
3. Headers Required:
   - Content-Type: application/json; charset=utf-8
`, s.routerGraphQLEndpoint)

		// Request format section
		requestFormat := "\nRequest Format:\n```json\n"
		if len(targetOp.JSONSchema) > 0 {
			requestFormat += `{
  "query": "<operation_query>",
  "variables": <your_variables_object>
}
`
		} else {
			requestFormat += `{
  "query": "<operation_query>"
}
`
		}
		requestFormat += "```"

		// Important notes section
		importantNotes := `

Important Notes:
1. Use the query string exactly as provided above
2. Do not modify or reformat the query string`

		// Combine all sections
		response := overview + schemaInfo + queryInfo + usageInstructions + requestFormat + importantNotes

		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: response}},
		}, nil
	}
}

// executeGraphQLQuery executes a GraphQL query against the router endpoint
func (s *GraphQLSchemaServer) executeGraphQLQuery(ctx context.Context, query string, variables json.RawMessage) (*mcp.CallToolResult, error) {
	// Create the GraphQL request
	graphqlRequest := graphqlRequest{
		Query:     query,
		Variables: variables,
	}

	graphqlRequestBytes, err := json.Marshal(graphqlRequest)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal GraphQL request: %w", err)
	}

	req, err := http.NewRequest("POST", s.routerGraphQLEndpoint, bytes.NewReader(graphqlRequestBytes))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	// Forward all headers from the original MCP request to the GraphQL server
	// The router's header forwarding rules will then determine what gets sent to subgraphs
	reqHeaders, err := headersFromContext(ctx)
	if err != nil {
		s.logger.Debug("failed to get headers from context", zap.Error(err))
	} else {
		// Copy all headers from the MCP request
		for key, values := range reqHeaders {
			// Skip headers that should not be forwarded
			if _, ok := headers.SkippedHeaders[key]; ok {
				continue
			}
			for _, value := range values {
				req.Header.Add(key, value)
			}
		}
	}

	// Override specific headers that must be set for GraphQL requests
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json; charset=utf-8")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	// Parse the GraphQL response
	var graphqlResponse GraphQLResponse

	if err := json.Unmarshal(body, &graphqlResponse); err == nil && len(graphqlResponse.Errors) > 0 {
		// Concatenate all error messages
		var errorMessages []string
		for _, gqlErr := range graphqlResponse.Errors {
			errorMessages = append(errorMessages, gqlErr.Message)
		}

		errorMessage := strings.Join(errorMessages, "; ")

		// If there are errors but no data, return only the errors
		if len(graphqlResponse.Data) == 0 || string(graphqlResponse.Data) == "null" {
			return &mcp.CallToolResult{
				Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf("Response error: %s", errorMessage)}},
				IsError: true,
			}, nil
		}

		// If we have both errors and data, include data in the error message
		dataString := string(graphqlResponse.Data)
		combinedErrorMsg := fmt.Sprintf("Response error with partial success, Error: %s, Data: %s)", errorMessage, dataString)
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: combinedErrorMsg}},
			IsError: true,
		}, nil
	}

	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: string(body)}},
	}, nil
}

// handleExecuteGraphQL returns a handler function that executes arbitrary GraphQL queries
func (s *GraphQLSchemaServer) handleExecuteGraphQL() func(ctx context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	return func(ctx context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		// Log authenticated user if OAuth is enabled
		if claims, ok := GetClaimsFromContext(ctx); ok {
			s.logger.Debug("arbitrary GraphQL query called by authenticated user",
				zap.String("sub", getClaimString(claims, "sub")),
				zap.String("email", getClaimString(claims, "email")))
		}

		// Parse the JSON input
		jsonBytes := request.Params.Arguments

		var input ExecuteGraphQLInput
		if err := json.Unmarshal(jsonBytes, &input); err != nil {
			return nil, fmt.Errorf("failed to unmarshal input arguments: %w", err)
		}

		if input.Query == "" {
			return nil, fmt.Errorf("input validation failed: query is required")
		}

		return s.executeGraphQLQuery(ctx, input.Query, input.Variables)
	}
}

// handleGetGraphQLSchema returns a handler function that returns the full GraphQL schema
func (s *GraphQLSchemaServer) handleGetGraphQLSchema() func(ctx context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	return func(ctx context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		// Get the schema from the operations manager
		schema := s.operationsManager.GetSchema()
		if schema == nil {
			return nil, fmt.Errorf("GraphQL schema is not available")
		}

		// Convert the AST document to a string representation
		schemaStr, err := astprinter.PrintString(schema)
		if err != nil {
			return nil, fmt.Errorf("failed to convert schema to string: %w", err)
		}

		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: schemaStr}},
		}, nil
	}
}

// getClaimString safely extracts a string value from claims
func getClaimString(claims authentication.Claims, key string) string {
	if val, ok := claims[key]; ok {
		if str, ok := val.(string); ok {
			return str
		}
	}
	return ""
}

// ProtectedResourceMetadata represents the OAuth 2.0 Protected Resource Metadata (RFC 9728)
type ProtectedResourceMetadata struct {
	Resource               string   `json:"resource"`
	AuthorizationServers   []string `json:"authorization_servers"`
	BearerMethodsSupported []string `json:"bearer_methods_supported,omitempty"`
	ResourceDocumentation  string   `json:"resource_documentation,omitempty"`
	ScopesSupported        []string `json:"scopes_supported"`
}

// handleProtectedResourceMetadata handles the OAuth 2.0 Protected Resource Metadata endpoint
// as specified in RFC 9728. This endpoint allows MCP clients to discover the authorization
// server(s) associated with this resource server.
func (s *GraphQLSchemaServer) handleProtectedResourceMetadata(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Determine the resource URL (this MCP server's base URL)
	resourceURL := s.serverBaseURL
	if resourceURL == "" {
		// Fallback: construct from request if not configured
		scheme := "http"
		if r.TLS != nil {
			scheme = "https"
		}
		resourceURL = fmt.Sprintf("%s://%s", scheme, r.Host)
	}

	// Build scopes_supported from all configured scopes (union across all levels)
	scopesSet := make(map[string]bool)
	for _, scopeList := range [][]string{
		s.oauthConfig.Scopes.Initialize,
		s.oauthConfig.Scopes.ToolsList,
		s.oauthConfig.Scopes.ToolsCall,
	} {
		for _, scope := range scopeList {
			scopesSet[scope] = true
		}
	}

	// Convert set to sorted slice for consistent output
	scopes := make([]string, 0, len(scopesSet))
	for scope := range scopesSet {
		scopes = append(scopes, scope)
	}
	if len(scopes) == 0 {
		scopes = []string{} // Ensure non-nil for JSON encoding
	}

	metadata := ProtectedResourceMetadata{
		Resource:               resourceURL,
		AuthorizationServers:   []string{s.oauthConfig.AuthorizationServerURL},
		BearerMethodsSupported: []string{"header"},
		ResourceDocumentation:  fmt.Sprintf("%s/mcp", resourceURL),
		ScopesSupported:        scopes, // Automatically derived from required scopes
	}

	// Encode to buffer first so we can handle errors before writing headers
	data, err := json.Marshal(metadata)
	if err != nil {
		s.logger.Error("failed to encode protected resource metadata", zap.Error(err))
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// GetResourceMetadataURL returns the URL for the OAuth 2.0 Protected Resource Metadata endpoint
func (s *GraphQLSchemaServer) GetResourceMetadataURL() string {
	if s.serverBaseURL != "" {
		return fmt.Sprintf("%s/.well-known/oauth-protected-resource/mcp", s.serverBaseURL)
	}
	return ""
}
