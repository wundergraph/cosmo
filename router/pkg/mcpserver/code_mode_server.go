package mcpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/cespare/xxhash/v2"
	"github.com/hashicorp/go-retryablehttp"
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
	"github.com/wundergraph/cosmo/router/internal/headers"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/cors"
	"github.com/wundergraph/cosmo/router/pkg/sandbox"
	"github.com/wundergraph/cosmo/router/pkg/yokoclient"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	otelmetric "go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
	toonformat "github.com/toon-format/toon-go"
	"go.uber.org/zap"
)

// CodeModeServerConfig holds all configuration for the Code Mode MCP server.
type CodeModeServerConfig struct {
	GraphName               string
	ListenAddr              string
	RequireMutationApproval bool
	SandboxConfig           sandbox.ExecutionConfig
	QueryGeneration         config.QueryGenerationConfiguration
	Logger                  *zap.Logger
	RouterGraphQLEndpoint   string
	Stateless               bool
	CorsConfig              *cors.Config
}

// CodeModeServer is the MCP server for Code Mode with search and execute tools.
type CodeModeServer struct {
	mcpServer      *server.MCPServer
	config         CodeModeServerConfig
	logger         *zap.Logger
	transpiler     *sandbox.Transpiler
	sandboxPool    *sandbox.Pool
	httpClient     *http.Client
	httpServer     *server.StreamableHTTPServer
	rawHTTPServer  *http.Server
	yokoClient     yokoclient.YokoClient
	tracer         trace.Tracer
	execCounter    otelmetric.Int64Counter
	execDuration   otelmetric.Float64Histogram

	// queryStore maps xxhash64 hex hashes to query strings.
	// Populated by generateQueriesFunc, read by graphqlFunc.
	// Bounded to maxQueryStoreSize entries; cleared entirely when full.
	queryStoreMu sync.RWMutex
	queryStore   map[string]string
}

// NewCodeModeServer creates a new Code Mode MCP server.
func NewCodeModeServer(cfg CodeModeServerConfig) (*CodeModeServer, error) {
	if cfg.RouterGraphQLEndpoint == "" {
		return nil, fmt.Errorf("router GraphQL endpoint is required")
	}
	if !strings.Contains(cfg.RouterGraphQLEndpoint, "://") {
		cfg.RouterGraphQLEndpoint = "http://" + cfg.RouterGraphQLEndpoint
	}
	if cfg.Logger == nil {
		cfg.Logger = zap.NewNop()
	}

	serverOpts := []server.ServerOption{
		server.WithToolCapabilities(true),
		server.WithResourceCapabilities(true, false),
		server.WithRecovery(),
	}
	if cfg.RequireMutationApproval {
		serverOpts = append(serverOpts, server.WithElicitation())
	}
	mcpSrv := server.NewMCPServer(
		"wundergraph-cosmo-code-mode",
		"0.0.1",
		serverOpts...,
	)

	retryClient := retryablehttp.NewClient()
	retryClient.Logger = nil
	retryClient.RetryMax = 3
	httpClient := retryClient.StandardClient()
	httpClient.Timeout = 60 * time.Second

	meter := otel.Meter("wundergraph.cosmo.router.mcp.code_mode")
	execCounter, _ := meter.Int64Counter("mcp.code_mode.sandbox.executions",
		otelmetric.WithDescription("Total number of Code Mode sandbox executions"),
	)
	execDuration, _ := meter.Float64Histogram("mcp.code_mode.sandbox.duration",
		otelmetric.WithDescription("Duration of Code Mode sandbox executions in milliseconds"),
		otelmetric.WithUnit("ms"),
	)

	s := &CodeModeServer{
		mcpServer:    mcpSrv,
		config:       cfg,
		logger:       cfg.Logger,
		transpiler:   sandbox.NewTranspiler(),
		sandboxPool:  sandbox.NewPool(4, cfg.SandboxConfig),
		httpClient:   httpClient,
		tracer:       otel.Tracer("wundergraph.cosmo.router.mcp.code_mode"),
		execCounter:  execCounter,
		execDuration: execDuration,
		queryStore:   make(map[string]string),
	}

	// Initialize Yoko client for query generation if enabled
	if cfg.QueryGeneration.Enabled && cfg.QueryGeneration.Endpoint != "" {
		s.yokoClient = yokoclient.NewClient(
			cfg.QueryGeneration.Endpoint,
			yokoclient.AuthConfig{
				Type:          cfg.QueryGeneration.Auth.Type,
				StaticToken:   cfg.QueryGeneration.Auth.StaticToken,
				TokenEndpoint: cfg.QueryGeneration.Auth.TokenEndpoint,
				ClientID:      cfg.QueryGeneration.Auth.ClientID,
				ClientSecret:  cfg.QueryGeneration.Auth.ClientSecret,
			},
			cfg.QueryGeneration.Timeout,
			cfg.Logger,
		)
	}

	s.registerTools()
	s.registerResources()

	return s, nil
}

// Start begins serving the Code Mode MCP server.
func (s *CodeModeServer) Start() error {
	ln, err := net.Listen("tcp", s.config.ListenAddr)
	if err != nil {
		return fmt.Errorf("failed to listen on %s: %w", s.config.ListenAddr, err)
	}

	httpSrv := &http.Server{
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	streamableHTTPServer := server.NewStreamableHTTPServer(s.mcpServer,
		server.WithStreamableHTTPServer(httpSrv),
		server.WithLogger(NewZapAdapter(s.logger.With(zap.String("component", "mcp-code-mode-server")))),
		server.WithStateLess(s.config.Stateless),
		server.WithHTTPContextFunc(requestHeadersFromRequest),
		server.WithHeartbeatInterval(10*time.Second),
	)

	mux := http.NewServeMux()
	mux.Handle("/mcp", http.HandlerFunc(streamableHTTPServer.ServeHTTP))

	var handler http.Handler = mux
	if s.config.CorsConfig != nil {
		handler = cors.New(*s.config.CorsConfig)(mux)
	}
	httpSrv.Handler = handler

	s.logger.Info("Code Mode MCP server started",
		zap.String("listen_addr", ln.Addr().String()),
		zap.String("path", "/mcp"),
	)

	go func() {
		defer s.logger.Info("Code Mode MCP server stopped")
		if err := httpSrv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			s.logger.Error("Code Mode HTTP server error", zap.Error(err))
		}
	}()

	s.httpServer = streamableHTTPServer
	s.rawHTTPServer = httpSrv
	return nil
}

// Stop gracefully shuts down the server.
func (s *CodeModeServer) Stop(ctx context.Context) error {
	var shutdownErr error
	if s.rawHTTPServer != nil {
		// Attempt graceful shutdown which waits for active connections to drain.
		// If the context deadline is exceeded (e.g. long-lived SSE connections),
		// force-close the server to avoid hanging the router shutdown.
		if err := s.rawHTTPServer.Shutdown(ctx); err != nil {
			s.logger.Warn("Graceful Code Mode server shutdown failed, forcing close", zap.Error(err))
			shutdownErr = s.rawHTTPServer.Close()
		}
	}

	s.sandboxPool.Close()

	return shutdownErr
}

func (s *CodeModeServer) registerTools() {
	// Search tool
	s.mcpServer.AddTool(
		mcp.NewTool(searchToolName,
			mcp.WithDescription(searchToolDescription),
			mcp.WithString("code",
				mcp.Required(),
				mcp.Description("An async arrow function. Example: async () => { return await generateQuery('find all users'); }"),
			),
			mcp.WithToolAnnotation(mcp.ToolAnnotation{
				Title:        "Search GraphQL Supergraph",
				ReadOnlyHint: mcp.ToBoolPtr(true),
			}),
		),
		s.handleSearch(),
	)

	// Execute tool
	s.mcpServer.AddTool(
		mcp.NewTool(executeToolName,
			mcp.WithDescription(executeToolDescription),
			mcp.WithString("code",
				mcp.Required(),
				mcp.Description("An async arrow function. Example: async () => { const { data } = await graphql({ query: '{ users { id } }' }); return data; }"),
			),
			),
		s.handleExecute(),
	)
}

func (s *CodeModeServer) registerResources() {
	s.mcpServer.AddResource(
		mcp.NewResource(searchAPIResourceURI, "Search API Type Definitions",
			mcp.WithResourceDescription("TypeScript type definitions for the search tool sandbox API"),
			mcp.WithMIMEType("text/typescript"),
		),
		func(ctx context.Context, request mcp.ReadResourceRequest) ([]mcp.ResourceContents, error) {
			return []mcp.ResourceContents{
				mcp.TextResourceContents{
					URI:      searchAPIResourceURI,
					MIMEType: "text/typescript",
					Text:     searchTypeDefs,
				},
			}, nil
		},
	)

	s.mcpServer.AddResource(
		mcp.NewResource(executeAPIResourceURI, "Execute API Type Definitions",
			mcp.WithResourceDescription("TypeScript type definitions for the execute tool sandbox API"),
			mcp.WithMIMEType("text/typescript"),
		),
		func(ctx context.Context, request mcp.ReadResourceRequest) ([]mcp.ResourceContents, error) {
			return []mcp.ResourceContents{
				mcp.TextResourceContents{
					URI:      executeAPIResourceURI,
					MIMEType: "text/typescript",
					Text:     executeTypeDefs,
				},
			}, nil
		},
	)
}

// searchPreamble is prepended to transpiled search code to expose generateQueries (and generateQuery alias).
const searchPreamble = `var generateQueries = function(...prompts) { return __generate_queries(...prompts); };
var generateQuery = function(prompt) { return __generate_queries(prompt); };
`

// handleSearch returns the MCP tool handler for the search tool.
func (s *CodeModeServer) handleSearch() server.ToolHandlerFunc {
	return func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		ctx, span := s.tracer.Start(ctx, "MCP Code Mode - Search",
			trace.WithSpanKind(trace.SpanKindServer),
			trace.WithAttributes(attribute.String("mcp.tool", "search")),
		)
		defer span.End()
		start := time.Now()
		status := "success"
		defer func() { s.recordMetrics(ctx, "search", status, start) }()

		args := request.GetArguments()
		code, ok := args["code"].(string)
		if !ok || strings.TrimSpace(code) == "" {
			status = "error"
			return mcp.NewToolResultError("'code' argument is required and must be a non-empty string"), nil
		}
		jsCode, err := s.transpiler.Transpile(code)
		if err != nil {
			status = "error"
			return mcp.NewToolResultError(fmt.Sprintf("TypeScript compilation error: %s", err.Error())), nil
		}

		var asyncFuncs []sandbox.AsyncFunc
		var preamble string
		if s.yokoClient != nil {
			asyncFuncs = append(asyncFuncs, sandbox.AsyncFunc{
				Name: "__generate_queries",
				Fn:   s.generateQueriesFunc(ctx),
			})
			preamble = searchPreamble
		}

		jsCode = "(async function(){" + preamble + "return " +
			strings.TrimRight(jsCode, "; \t\n\r") + ";})()"

		result, err := s.sandboxPool.Execute(ctx, jsCode, nil, asyncFuncs, nil)
		if err != nil {
			status = "error"
			return mcp.NewToolResultError(fmt.Sprintf("Sandbox execution error: %s", err.Error())), nil
		}

		return mcp.NewToolResultText(s.formatToolResult(result.Value)), nil
	}
}

// handleExecute returns the MCP tool handler for the execute tool.
func (s *CodeModeServer) handleExecute() server.ToolHandlerFunc {
	return func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		ctx, span := s.tracer.Start(ctx, "MCP Code Mode - Execute",
			trace.WithSpanKind(trace.SpanKindServer),
			trace.WithAttributes(attribute.String("mcp.tool", "execute")),
		)
		defer span.End()
		start := time.Now()
		status := "success"
		defer func() { s.recordMetrics(ctx, "execute", status, start) }()

		args := request.GetArguments()
		code, ok := args["code"].(string)
		if !ok || strings.TrimSpace(code) == "" {
			status = "error"
			return mcp.NewToolResultError("'code' argument is required and must be a non-empty string"), nil
		}
		jsCode, err := s.transpiler.Transpile(code)
		if err != nil {
			status = "error"
			return mcp.NewToolResultError(fmt.Sprintf("TypeScript compilation error: %s", err.Error())), nil
		}

		// Create a context for async functions (like graphql with mutation approval).
		// This context is cancelled after sandbox execution completes, ensuring
		// pending elicitation requests are cleaned up on sandbox timeout.
		asyncCtx, asyncCancel := context.WithCancel(ctx)
		defer asyncCancel()

		asyncFuncs := []sandbox.AsyncFunc{
			{
				Name: "graphql",
				Fn:   s.graphqlFunc(asyncCtx),
			},
		}

		result, err := s.sandboxPool.Execute(ctx, jsCode, nil, asyncFuncs, nil)
		if err != nil {
			status = "error"
			return mcp.NewToolResultError(fmt.Sprintf("Sandbox execution error: %s", err.Error())), nil
		}

		return mcp.NewToolResultText(s.formatToolResult(result.Value)), nil
	}
}

// graphqlFunc creates the async graphql() host function for the execute sandbox.
func (s *CodeModeServer) graphqlFunc(ctx context.Context) func(args []any) (any, error) {
	return func(args []any) (any, error) {
		if len(args) == 0 {
			return nil, fmt.Errorf("graphql requires an options argument")
		}

		optsMap, ok := args[0].(map[string]any)
		if !ok {
			return nil, fmt.Errorf("graphql requires an object argument with 'query' or 'hash' field")
		}

		queryStr, _ := optsMap["query"].(string)

		// Resolve query from hash if no query text provided
		if queryStr == "" {
			hashStr, _ := optsMap["hash"].(string)
			if hashStr == "" {
				return nil, fmt.Errorf("graphql options must include a 'query' string or a 'hash' from generateQuery")
			}
			resolved, found := s.resolveQueryHash(hashStr)
			if !found {
				return nil, fmt.Errorf("unknown query hash %q — hash may have expired or be from a different session", hashStr)
			}
			queryStr = resolved
		}

		// Check for mutation and require approval via MCP elicitation
		opName, _ := optsMap["operationName"].(string)
		if s.config.RequireMutationApproval && isMutation(queryStr, opName) {
			approved, reason, err := s.requestMutationApproval(ctx, queryStr, optsMap["variables"])
			if err != nil {
				// Elicitation not supported by client — decline with reason
				return map[string]any{
					"data":   nil,
					"errors": []map[string]any{{"message": "Mutation declined: " + err.Error()}},
					"declined": map[string]any{
						"reason": err.Error(),
					},
				}, nil
			}
			if !approved {
				return map[string]any{
					"data":   nil,
					"errors": []map[string]any{{"message": "Mutation declined by operator"}},
					"declined": map[string]any{
						"reason": reason,
					},
				}, nil
			}
			// Approved — proceed with execution
		}

		// Build the GraphQL request
		gqlReq := map[string]any{
			"query": queryStr,
		}
		if vars, ok := optsMap["variables"]; ok {
			gqlReq["variables"] = vars
		}
		if opName, ok := optsMap["operationName"].(string); ok {
			gqlReq["operationName"] = opName
		}

		reqBody, err := json.Marshal(gqlReq)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal GraphQL request: %w", err)
		}

		httpReq, err := http.NewRequestWithContext(ctx, "POST", s.config.RouterGraphQLEndpoint, bytes.NewReader(reqBody))
		if err != nil {
			return nil, fmt.Errorf("failed to create HTTP request: %w", err)
		}

		// Forward headers from MCP request
		if reqHeaders, err := headersFromContext(ctx); err == nil {
			for key, values := range reqHeaders {
				if _, skip := headers.SkippedHeaders[key]; skip {
					continue
				}
				for _, value := range values {
					httpReq.Header.Add(key, value)
				}
			}
		}

		httpReq.Header.Set("Accept", "application/json")
		httpReq.Header.Set("Content-Type", "application/json; charset=utf-8")

		resp, err := s.httpClient.Do(httpReq)
		if err != nil {
			return nil, fmt.Errorf("GraphQL request failed: %w", err)
		}
		defer func() { _ = resp.Body.Close() }()

		// Limit response body to 10MB to prevent OOM from unexpected large responses.
		body, err := io.ReadAll(io.LimitReader(resp.Body, 10*1024*1024))
		if err != nil {
			return nil, fmt.Errorf("failed to read GraphQL response: %w", err)
		}

		var result map[string]any
		if err := json.Unmarshal(body, &result); err != nil {
			return nil, fmt.Errorf("failed to parse GraphQL response: %w", err)
		}

		return result, nil
	}
}

// requestMutationApproval uses MCP elicitation to ask the human operator to approve a mutation.
// Returns (approved, reason, error). If elicitation is not supported, returns an error.
func (s *CodeModeServer) requestMutationApproval(ctx context.Context, queryStr string, variables any) (bool, string, error) {
	varsStr := "{}"
	if variables != nil {
		if data, err := json.Marshal(variables); err == nil {
			varsStr = string(data)
		}
	}

	elicitReq := mcp.ElicitationRequest{
		Params: mcp.ElicitationParams{
			Message: fmt.Sprintf(
				"The agent wants to execute a mutation. Please review and approve or reject.\n\nMutation:\n%s\n\nVariables: %s",
				queryStr, varsStr,
			),
			RequestedSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"approved": map[string]any{
						"type":        "boolean",
						"title":       "Approve Mutation",
						"description": "Approve this mutation for execution?",
						"default":     false,
					},
					"reason": map[string]any{
						"type":        "string",
						"title":       "Reason",
						"description": "Optional: reason for your decision",
						"maxLength":   500,
					},
				},
				"required": []string{"approved"},
			},
		},
	}

	result, err := s.mcpServer.RequestElicitation(ctx, elicitReq)
	if err != nil {
		return false, "", fmt.Errorf("mutation approval is required but the MCP client does not support elicitation: %w", err)
	}

	switch result.Action {
	case mcp.ElicitationResponseActionAccept:
		// Parse the form data
		content, ok := result.Content.(map[string]any)
		if !ok {
			return false, "", nil
		}
		approved, _ := content["approved"].(bool)
		reason, _ := content["reason"].(string)
		return approved, reason, nil

	case mcp.ElicitationResponseActionDecline, mcp.ElicitationResponseActionCancel:
		return false, "", nil

	default:
		return false, "", nil
	}
}

// isMutation checks if a GraphQL query string contains a mutation operation.
// If operationName is non-empty, only that operation is checked.
func isMutation(queryStr string, operationName string) bool {
	doc, report := astparser.ParseGraphqlDocumentString(queryStr)
	if report.HasErrors() {
		return false
	}
	for i, op := range doc.OperationDefinitions {
		if operationName != "" && doc.OperationDefinitionNameString(i) != operationName {
			continue
		}
		if op.OperationType == ast.OperationTypeMutation {
			return true
		}
	}
	return false
}

// queryResultWithHash extends yokoclient.QueryResult with a server-computed hash
// for use in the sandbox return value.
type queryResultWithHash struct {
	Query       string         `json:"query"`
	Variables   map[string]any `json:"variables,omitempty"`
	Description string         `json:"description"`
	Hash        string         `json:"hash"`
}

// generateQueriesFunc creates the async generateQueries() host function for the search sandbox.
// Accepts variadic prompt strings and fires Yoko API calls in parallel for multiple prompts.
// Individual prompt failures are tolerated — only fails if all prompts fail.
func (s *CodeModeServer) generateQueriesFunc(ctx context.Context) func(args []any) (any, error) {
	return func(args []any) (any, error) {
		if len(args) == 0 {
			return nil, fmt.Errorf("generateQueries requires at least one prompt string argument")
		}

		prompts := make([]string, len(args))
		for i, a := range args {
			p, ok := a.(string)
			if !ok || strings.TrimSpace(p) == "" {
				return nil, fmt.Errorf("generateQueries argument %d must be a non-empty string", i)
			}
			prompts[i] = p
		}

		schemaHash := "" // TODO: compute from schema document for cache invalidation

		// Single prompt — skip goroutine overhead
		if len(prompts) == 1 {
			results, err := s.yokoClient.Generate(ctx, prompts[0], schemaHash)
			if err != nil {
				return nil, fmt.Errorf("query generation failed: %w", err)
			}
			return s.toQueryResultsWithHash(results), nil
		}

		// Multiple prompts — parallel execution, individual failures tolerated
		type indexedResult struct {
			index   int
			results []yokoclient.QueryResult
			err     error
		}
		ch := make(chan indexedResult, len(prompts))
		var wg sync.WaitGroup
		for i, p := range prompts {
			wg.Add(1)
			go func(idx int, prompt string) {
				defer wg.Done()
				results, err := s.yokoClient.Generate(ctx, prompt, schemaHash)
				ch <- indexedResult{index: idx, results: results, err: err}
			}(i, p)
		}
		go func() { wg.Wait(); close(ch) }()

		ordered := make([][]yokoclient.QueryResult, len(prompts))
		for r := range ch {
			if r.err != nil {
				s.logger.Warn("query generation failed for prompt",
					zap.Int("index", r.index), zap.Error(r.err))
				continue
			}
			ordered[r.index] = r.results
		}

		var all []queryResultWithHash
		for _, results := range ordered {
			all = append(all, s.toQueryResultsWithHash(results)...)
		}
		if len(all) == 0 {
			return nil, fmt.Errorf("all query generation prompts failed")
		}
		return all, nil
	}
}

// toQueryResultsWithHash converts yokoclient results to queryResultWithHash, storing hashes.
func (s *CodeModeServer) toQueryResultsWithHash(results []yokoclient.QueryResult) []queryResultWithHash {
	out := make([]queryResultWithHash, len(results))
	for i, r := range results {
		out[i] = queryResultWithHash{
			Query:       r.Query,
			Variables:   r.Variables,
			Description: r.Description,
			Hash:        s.storeQueryHash(r.Query),
		}
	}
	return out
}

// SetHTTPClient allows setting a custom HTTP client (useful for testing).
func (s *CodeModeServer) SetHTTPClient(client *http.Client) {
	s.httpClient = client
}

// SetYokoClient allows setting a custom Yoko client (useful for testing).
func (s *CodeModeServer) SetYokoClient(client yokoclient.YokoClient) {
	s.yokoClient = client
}

const maxQueryStoreSize = 1000

// storeQueryHash computes the xxhash64 of a query string, stores the
// mapping, and returns the hex-encoded hash.
func (s *CodeModeServer) storeQueryHash(query string) string {
	hash := strconv.FormatUint(xxhash.Sum64String(query), 16)
	s.queryStoreMu.Lock()
	if len(s.queryStore) >= maxQueryStoreSize {
		clear(s.queryStore)
	}
	s.queryStore[hash] = query
	s.queryStoreMu.Unlock()
	return hash
}

// resolveQueryHash looks up a query string by its hash.
func (s *CodeModeServer) resolveQueryHash(hash string) (string, bool) {
	s.queryStoreMu.RLock()
	query, ok := s.queryStore[hash]
	s.queryStoreMu.RUnlock()
	return query, ok
}

// formatToolResult returns the sandbox result formatted for the MCP response.
// When toon is true, the result is encoded as TOON (Token-Oriented Object Notation).
// Falls back to JSON on encoding failure or when toon is false.
func (s *CodeModeServer) formatToolResult(raw json.RawMessage) string {
	var payload any
	if err := json.Unmarshal(raw, &payload); err == nil {
		if encoded, err := toonformat.MarshalString(payload, toonformat.WithLengthMarkers(true)); err == nil {
			return encoded
		}
	}
	return string(raw)
}

// recordMetrics records counter and histogram metrics for a sandbox execution.
func (s *CodeModeServer) recordMetrics(ctx context.Context, tool string, status string, start time.Time) {
	attrs := otelmetric.WithAttributes(
		attribute.String("mcp.tool", tool),
		attribute.String("mcp.status", status),
	)
	s.execCounter.Add(ctx, 1, attrs)
	s.execDuration.Record(ctx, float64(time.Since(start).Milliseconds()), attrs)
}
