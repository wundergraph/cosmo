package mcpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/hashicorp/go-retryablehttp"
	"github.com/iancoleman/strcase"
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
	"github.com/santhosh-tekuri/jsonschema/v6"
	"github.com/wundergraph/cosmo/router/pkg/schemaloader"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astprinter"
	"go.uber.org/zap"
)

// authKey is a custom context key for storing the auth token.
type authKey struct{}

// withAuthKey adds an auth key to the context.
func withAuthKey(ctx context.Context, auth string) context.Context {
	return context.WithValue(ctx, authKey{}, auth)
}

// authFromRequest extracts the auth token from the request headers.
func authFromRequest(ctx context.Context, r *http.Request) context.Context {
	return withAuthKey(ctx, r.Header.Get("Authorization"))
}

// tokenFromContext extracts the auth token from the context.
// This can be used by clients to pass the auth token to the server.
func tokenFromContext(ctx context.Context) (string, error) {
	auth, ok := ctx.Value(authKey{}).(string)
	if !ok {
		return "", fmt.Errorf("missing auth")
	}
	return auth, nil
}

// Options represents configuration options for the GraphQLSchemaServer
type Options struct {
	// GraphName is the name of the graph to be served
	GraphName string
	// OperationsDir is the directory where GraphQL operations are stored
	OperationsDir string
	// Server contains server configuration options
	Server ServerOptions
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
}

// ServerOptions represents the server-specific configuration options
type ServerOptions struct {
	// Port is the port where the SSE server should listen
	Port int
}

// GraphQLSchemaServer represents an MCP server that works with GraphQL schemas and operations
type GraphQLSchemaServer struct {
	server                    *server.MCPServer
	graphName                 string
	operationsDir             string
	port                      int
	logger                    *zap.Logger
	httpClient                *http.Client
	requestTimeout            time.Duration
	routerGraphQLEndpoint     string
	httpServer                *http.Server
	sseServer                 *server.SSEServer
	excludeMutations          bool
	enableArbitraryOperations bool
	exposeSchema              bool
	operationsManager         *OperationsManager
	schemaCompiler            *SchemaCompiler
	registeredTools           []string
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
		GraphName:     "graph",
		OperationsDir: "operations",
		Server: ServerOptions{
			Port: 5025,
		},
		Enabled:        false,
		Logger:         zap.NewNop(),
		RequestTimeout: 30 * time.Second,
		ExposeSchema:   true,
	}

	// Apply all option functions
	for _, opt := range opts {
		opt(options)
	}

	// Create the MCP server
	mcpServer := server.NewMCPServer(
		"wundergraph-cosmo-"+strcase.ToKebab(options.GraphName),
		"0.0.1",
		// Prompt, Resources aren't supported yet in any of the popular platforms
		server.WithToolCapabilities(true),
		server.WithPaginationLimit(100),
		server.WithRecovery(),
	)

	retryClient := retryablehttp.NewClient()
	retryClient.Logger = nil
	httpClient := retryClient.StandardClient()
	httpClient.Timeout = 60 * time.Second

	gs := &GraphQLSchemaServer{
		server:                    mcpServer,
		graphName:                 options.GraphName,
		operationsDir:             options.OperationsDir,
		port:                      options.Server.Port,
		logger:                    options.Logger,
		httpClient:                httpClient,
		requestTimeout:            options.RequestTimeout,
		routerGraphQLEndpoint:     routerGraphQLEndpoint,
		excludeMutations:          options.ExcludeMutations,
		enableArbitraryOperations: options.EnableArbitraryOperations,
		exposeSchema:              options.ExposeSchema,
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

// WithServer sets the server configuration
func WithServer(server ServerOptions) func(*Options) {
	return func(o *Options) {
		o.Server = server
	}
}

// WithPort sets just the port
func WithPort(port int) func(*Options) {
	return func(o *Options) {
		o.Server.Port = port
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

// ServeSSE starts the server with SSE transport
func (s *GraphQLSchemaServer) ServeSSE() (*server.SSEServer, *http.Server, error) {
	listenAddr := "localhost:" + strconv.Itoa(s.port)

	// Create HTTP server with timeouts
	httpServer := &http.Server{
		Addr:         listenAddr,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  30 * time.Second,
	}

	sseServer := server.NewSSEServer(s.server,
		server.WithBaseURL(fmt.Sprintf("http://%s", listenAddr)),
		server.WithHTTPServer(httpServer),
		server.WithSSEEndpoint("/mcp"),
		server.WithSSEContextFunc(authFromRequest),
	)

	go func() {
		err := sseServer.Start(listenAddr)
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			s.logger.Error("failed to start SSE server", zap.Error(err))
		}
	}()

	return sseServer, httpServer, nil
}

// Start loads operations and starts the server
func (s *GraphQLSchemaServer) Start() error {

	sseServer, httpServer, err := s.ServeSSE()
	if err != nil {
		return fmt.Errorf("failed to create SSE server: %w", err)
	}

	s.sseServer = sseServer
	s.httpServer = httpServer

	return nil
}

// Reload reloads the operations and schema
func (s *GraphQLSchemaServer) Reload(schema *ast.Document) error {

	if s.server == nil {
		return fmt.Errorf("server is not started")
	}

	s.schemaCompiler = NewSchemaCompiler(s.logger)
	s.operationsManager = NewOperationsManager(schema, s.logger, s.excludeMutations)

	if err := s.operationsManager.LoadOperationsFromDirectory(s.operationsDir); err != nil {
		return fmt.Errorf("failed to load operations: %w", err)
	}

	s.server.DeleteTools(s.registeredTools...)

	s.registerTools()

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

	if err := s.sseServer.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("failed to gracefully shutdown SSE server: %w", err)
	}

	return nil
}

// registerTools registers all tools for the MCP server
func (s *GraphQLSchemaServer) registerTools() {

	s.server.AddTool(
		mcp.NewTool(
			"get_operation_info",
			mcp.WithDescription("Retrieve information about a specific GraphQL operation by name. It provides all the necessary details to understand how to execute the operation in a GraphQL request against the cosmo router. This is useful for custom app integration."),
			mcp.WithToolAnnotation(mcp.ToolAnnotation{
				Title: "Get GraphQL Operation Info",
			}),
			mcp.WithString("operationName",
				mcp.Required(),
				mcp.Description("The exact name of the GraphQL operation to retrieve information for."),
			),
		),
		s.handleGraphQLOperationInfo(),
	)

	s.registeredTools = append(s.registeredTools, "get_operation_info")

	// Only register the schema tool if exposeSchema is enabled
	if s.exposeSchema {
		s.server.AddTool(
			mcp.NewTool(
				"get_schema",
				mcp.WithDescription("Use this function to obtain the full introspection-based schema of the GraphQL API. This is useful for understanding the structure, available types, queries, mutations, and overall capabilities of the API."),
				mcp.WithToolAnnotation(mcp.ToolAnnotation{
					Title: "Get GraphQL Schema",
				}),
			),
			s.handleGetGraphQLSchema(),
		)

		s.registeredTools = append(s.registeredTools, "get_schema")
	}

	// Only register the execute_graphql tool if enableArbitraryOperations is enabled
	if s.enableArbitraryOperations {
		// Add a tool to execute arbitrary GraphQL queries
		executeGraphQLSchema := []byte(`{
			"type": "object",
			"description": "The query and variables to execute.",
			"properties": {
				"query": {
					"type": "string",
					"description": "The GraphQL query or mutation string to execute."
				},
				"variables": {
					"type": "object",
					"additionalProperties": true,
					"description": "The variables to pass to the GraphQL query as a JSON object."
				}
			},
			"additionalProperties": false,
			"required": ["query"]
		}`)

		tool := mcp.NewToolWithRawSchema(
			"execute_graphql",
			"Executes a GraphQL query or mutation.",
			executeGraphQLSchema,
		)

		tool.Annotations = mcp.ToolAnnotation{
			Title:         "Execute GraphQL Query",
			OpenWorldHint: true,
		}

		s.server.AddTool(
			tool,
			s.handleExecuteGraphQL(),
		)

		s.registeredTools = append(s.registeredTools, "execute_graphql")
	}

	// Get operations filtered by the excludeMutations setting
	operations := s.operationsManager.GetFilteredOperations()

	for _, op := range operations {
		var compiledSchema *jsonschema.Schema
		var err error

		if len(op.JSONSchema) > 0 {
			compiledSchema, err = s.schemaCompiler.CompileSchema(op)
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

		var toolDescription string

		if op.Description != "" {
			toolDescription = fmt.Sprintf("Executes the GraphQL operation '%s' of type %s. %s", op.Name, op.OperationType, op.Description)
		} else {
			toolDescription = fmt.Sprintf("Executes the GraphQL operation '%s' of type %s.", op.Name, op.OperationType)
		}

		toolName := fmt.Sprintf("execute_operation_%s", operationToolName)
		tool := mcp.NewToolWithRawSchema(
			toolName,
			toolDescription,
			op.JSONSchema,
		)

		tool.Annotations = mcp.ToolAnnotation{
			IdempotentHint: op.OperationType != "mutation",
			Title:          op.Name,
			ReadOnlyHint:   op.OperationType == "query",
			OpenWorldHint:  true,
		}

		s.server.AddTool(
			tool,
			s.handleOperation(handler),
		)

		s.registeredTools = append(s.registeredTools, toolName)
	}
}

// handleOperation handles a specific operation
func (s *GraphQLSchemaServer) handleOperation(handler *operationHandler) func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	return func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {

		jsonBytes, err := json.Marshal(request.Params.Arguments)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal arguments: %w", err)
		}

		// Validate the JSON input against the pre-compiled schema derived from the operation input type
		if handler.compiledSchema != nil {
			if err := s.schemaCompiler.ValidateInput(jsonBytes, handler.compiledSchema); err != nil {
				return mcp.NewToolResultErrorFromErr("Input validation Error", err), nil
			}
		}

		// Execute the operation with the provided variables
		return s.executeGraphQLQuery(ctx, handler.operation.OperationString, jsonBytes)
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

		targetOp := s.operationsManager.GetOperation(input.OperationName)
		if targetOp == nil {
			return nil, fmt.Errorf("operation '%s' not found or excluded by configuration", input.OperationName)
		}

		hasSideEffects := targetOp.OperationType == "mutation"
		executionTips := []string{
			fmt.Sprintf("Use the exact 'query' string provided for the '%s' operation.", input.OperationName),
			"The 'schema' describes the expected JSON format for the input variables. If 'schema' is null or empty, no variables are needed.",
			"Send a POST request to " + s.routerGraphQLEndpoint + " with 'Content-Type: application/json; charset=utf-8'.",
			"The request body should follow this structure: {\"query\": \"<operation_query>\", \"variables\": <your_variables_object>}",
			"If the operation requires no variables (schema is empty/null), send: {\"query\": \"<operation_query>\"}",
			fmt.Sprintf("You can also execute this operation by calling the tool 'execute_operation_%s' in the context of the session.", strcase.ToSnake(input.OperationName)),
			"IMPORTANT: Do not modify, reformat, or manipulate the query string in any way. Use it exactly as provided.",
		}

		// Add warning about side effects for mutations
		if hasSideEffects {
			executionTips = append(executionTips,
				"WARNING: This is a mutation operation that will modify data. Make sure you understand the consequences before executing it.")
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

	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json; charset=utf-8")

	token, err := tokenFromContext(ctx)
	if err != nil {
		s.logger.Debug("failed to get token from context", zap.Error(err))
	} else if token != "" {
		req.Header.Set("Authorization", token)
	}

	// Forward Authorization header if provided

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

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
			return mcp.NewToolResultErrorFromErr("Response Error", err), nil
		}

		// If we have both errors and data, include data in the error message
		dataString := string(graphqlResponse.Data)
		combinedErrorMsg := fmt.Sprintf("Response error with partial success, Error: %s, Data: %s)", errorMessage, dataString)
		return mcp.NewToolResultErrorFromErr(combinedErrorMsg, err), nil
	}

	return mcp.NewToolResultText(string(body)), nil
}

// handleExecuteGraphQL returns a handler function that executes arbitrary GraphQL queries
func (s *GraphQLSchemaServer) handleExecuteGraphQL() func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	return func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		// Parse the JSON input
		jsonBytes, err := json.Marshal(request.Params.Arguments)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal arguments: %w", err)
		}

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
func (s *GraphQLSchemaServer) handleGetGraphQLSchema() func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	return func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
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

		return mcp.NewToolResultText(schemaStr), nil
	}
}
