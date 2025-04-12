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
	// ExcludeMutations determines whether mutation operations should be excluded
	ExcludeMutations bool
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
	httpServer            *http.Server
	sseServer             *server.SSEServer
	excludeMutations      bool
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

// SimpleOperationInfo contains basic information about a GraphQL operation for listing.
type SimpleOperationInfo struct {
	Name           string `json:"name"`
	Description    string `json:"description"`
	OperationType  string `json:"operationType"`
	HasSideEffects bool   `json:"hasSideEffects"`
}

// ListOperationsResponse is the response structure for the list_graphql_operations tool.
type ListOperationsResponse struct {
	Operations []SimpleOperationInfo `json:"operations"`
	LLMNote    string                `json:"llmNote"`
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
		excludeMutations:      options.ExcludeMutations,
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

// WithExcludeMutations sets the exclude mutations option
func WithExcludeMutations(excludeMutations bool) func(*Options) {
	return func(o *Options) {
		o.ExcludeMutations = excludeMutations
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

	go func() {
		err := sseServer.Start(s.listenAddr)
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			s.logger.Error("failed to start SSE server", zap.Error(err))
		}
	}()

	return sseServer, httpServer, nil
}

// Start loads operations and starts the server
func (s *GraphQLSchemaServer) Start() error {

	if err := s.LoadOperations(); err != nil {
		return fmt.Errorf("failed to load operations: %w", err)
	}

	sseServer, httpServer, err := s.ServeSSE()
	if err != nil {
		return fmt.Errorf("failed to create SSE server: %w", err)
	}

	// Store server references for Stop method
	s.sseServer = sseServer
	s.httpServer = httpServer

	return nil
}

// Stop gracefully shuts down the MCP server
func (s *GraphQLSchemaServer) Stop(ctx context.Context) error {
	if s.httpServer == nil {
		return nil
	}

	s.logger.Debug("shutting down MCP server")

	// Create a shutdown context with timeout
	shutdownCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	// Shutdown the HTTP server
	if err := s.httpServer.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("failed to gracefully shutdown MCP server: %w", err)
	}

	return nil
}

// registerTools registers all tools for the MCP server
func (s *GraphQLSchemaServer) registerTools() {

	// Add a tool to list all available operations (names and descriptions only)
	s.server.AddTool(
		mcp.NewTool(
			"list_graphql_operations",
			mcp.WithDescription("Lists all available GraphQL operations with their names and description about their purpose."),
		),
		s.handleListGraphQLOperations(),
	)

	s.server.AddTool(
		mcp.NewTool(
			"get_graphql_operation_info",
			mcp.WithDescription("Retrieves detailed information about a specific GraphQL operation, including its input schema, query structure, and execution guidance."),
			mcp.WithString("operationName",
				mcp.Required(),
				mcp.Description("The exact name of the GraphQL operation to retrieve information for."),
			),
		),
		s.handleGraphQLOperationInfo(),
	)

	for _, op := range s.operations {
		// Skip mutation operations if ExcludeMutations is enabled
		if op.OperationType == "mutation" && s.excludeMutations {
			s.logger.Debug("skipping mutation operation due to ExcludeMutations setting",
				zap.String("operation", op.Name))
			continue
		}

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

		// Convert operation name to snake_case for consistent tool naming
		toolName := toSnakeCase(op.Name)

		toolDescription := fmt.Sprintf("Executes the GraphQL operation '%s' with the provided input.", op.Name)

		// Add a warning for mutations
		if op.OperationType == "mutation" {
			toolDescription = fmt.Sprintf("Executes the GraphQL operation '%s' with the provided input. WARNING: This is a mutation operation that has side effects and can modify data.", op.Name)
		}

		s.server.AddTool(
			mcp.NewToolWithRawSchema(
				fmt.Sprintf("%s_%s", op.OperationType, toolName), //  Allows for tool filtering on the client side
				toolDescription,
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
				s.logger.Debug("failed to unmarshal JSON input", zap.Error(err))
				return nil, fmt.Errorf("failed to parse JSON input: %w", err)
			}

			if err := handler.compiledSchema.Validate(v); err != nil {
				var validationErr *jsonschema.ValidationError
				if errors.As(err, &validationErr) {
					s.logger.Debug("failed to validate JSON input", zap.Error(validationErr))
					// This helps the LLM to understand the error better
					return nil, fmt.Errorf("validation error: %s", validationErr.Error())
				}
				s.logger.Error("failed to validate JSON input", zap.Any("error", err))
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

// handleListGraphQLOperations returns a handler function that provides a list of all available operations.
func (s *GraphQLSchemaServer) handleListGraphQLOperations() func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	return func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		operations := make([]SimpleOperationInfo, 0, len(s.operations))
		for _, op := range s.operations {
			hasSideEffects := op.OperationType == "mutation"

			// Skip mutation operations if ExcludeMutations is enabled
			if hasSideEffects && s.excludeMutations {
				continue
			}

			operations = append(operations, SimpleOperationInfo{
				Name:           op.Name,
				Description:    op.Description,
				OperationType:  op.OperationType,
				HasSideEffects: hasSideEffects,
			})
		}

		response := ListOperationsResponse{
			Operations: operations,
			LLMNote:    "This list contains operation names and descriptions. To get execution details (query, schema, instructions) for a specific operation, use the 'graphql_operation_info' tool with the exact operation's name. Operations of type 'mutation' have side effects and can modify data.",
		}

		responseJSON, err := json.Marshal(response)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal operations list: %w", err)
		}

		return mcp.NewToolResultText(string(responseJSON)), nil
	}
}

// handleGraphQLOperationInfo returns a handler function that provides detailed info for a specific operation.
func (s *GraphQLSchemaServer) handleGraphQLOperationInfo() func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	return func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		var input GraphQLOperationInfoInput
		inputBytes, err := json.Marshal(request.Params.Arguments)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal input arguments: %w", err)
		}
		if err := json.Unmarshal(inputBytes, &input); err != nil {
			return nil, fmt.Errorf("failed to unmarshal input arguments: %w. Ensure you provide {\"operationName\": \"<n>\"}", err)
		}

		if input.OperationName == "" {
			return nil, fmt.Errorf("input validation failed: operationName is required")
		}

		var targetOp *schemaloader.Operation
		for i := range s.operations {
			if s.operations[i].Name == input.OperationName {
				targetOp = &s.operations[i]
				break
			}
		}

		if targetOp == nil {
			return nil, fmt.Errorf("operation '%s' not found", input.OperationName)
		}

		// If ExcludeMutations is enabled, prevent access to mutation operations
		if targetOp.OperationType == "mutation" && s.excludeMutations {
			return nil, fmt.Errorf("mutation operations are excluded by configuration")
		}

		hasSideEffects := targetOp.OperationType == "mutation"
		executionTips := []string{
			fmt.Sprintf("Use the exact 'query' string provided for the '%s' operation.", targetOp.Name),
			"The 'schema' describes the expected JSON format for the input variables. If 'schema' is null or empty, no variables are needed.",
			"Send a POST request to " + s.routerGraphQLEndpoint + " with 'Content-Type: application/json'.",
			fmt.Sprintf("The request body should follow this structure: {\"query\": \"<operation_query>\", \"variables\": <your_variables_object>}"),
			"If the operation requires no variables (schema is empty/null), send: {\"query\": \"<operation_query>\", \"variables\": {}}",
		}

		// Add warning about side effects for mutations
		if hasSideEffects {
			executionTips = append(executionTips,
				fmt.Sprintf("WARNING: This is a mutation operation that will modify data. Make sure you understand the consequences before executing it."))
		}

		response := GraphQLOperationInfoResponse{
			Name:           targetOp.Name,
			Description:    targetOp.Description,
			OperationType:  targetOp.OperationType,
			HasSideEffects: hasSideEffects,
			Schema:         targetOp.JSONSchema,
			Query:          targetOp.OperationString,
			LLMGuidance: LLMGuidance{
				HTTPUsage:      fmt.Sprintf("To execute this GraphQL operation ('%s'), send a POST request to the endpoint with a JSON body containing the query and variables.", targetOp.Name),
				GraphQLRequest: "The GraphQL request requires:\n1. The query string (provided in the 'query' field below)\n2. Variables matching the JSON schema structure (provided in the 'schema' field below, if applicable)",
				ExecutionTips:  executionTips,
			},
			Endpoint: s.routerGraphQLEndpoint,
		}

		responseJSON, err := json.MarshalIndent(response, "", "  ") // Use indent for better readability
		if err != nil {
			return nil, fmt.Errorf("failed to marshal operation info for '%s': %w", input.OperationName, err)
		}

		return mcp.NewToolResultText(string(responseJSON)), nil
	}
}
