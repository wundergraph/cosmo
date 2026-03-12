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
	"github.com/dgraph-io/ristretto/v2"
	"github.com/hashicorp/go-retryablehttp"
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
	toonformat "github.com/toon-format/toon-go"
	"github.com/wundergraph/cosmo/router/internal/headers"
	"github.com/wundergraph/cosmo/router/internal/llmcli"
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
	"go.uber.org/zap"
)

// CodeModeServerConfig holds all configuration for the Code Mode MCP server.
type CodeModeServerConfig struct {
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
	mcpServer       *server.MCPServer
	config          CodeModeServerConfig
	logger          *zap.Logger
	transpiler      *sandbox.Transpiler
	sandboxPool     *sandbox.Pool
	httpClient      *http.Client
	rawHTTPServer   *http.Server
	yokoClient      yokoclient.YokoClient
	tracer          trace.Tracer
	execCounter     otelmetric.Int64Counter
	execDuration    otelmetric.Float64Histogram
	validateExecute func(ctx context.Context, code string) error
	repairExecute   func(ctx context.Context, code string, compileErr error) (string, string, error)

	// queryCache maps xxhash64 hashes to query strings using ristretto for LRU eviction.
	// Populated by generateQueries, read by executeOperationByHashFunc.
	queryCache *ristretto.Cache[uint64, string]
}

// NewCodeModeServer creates a new Code Mode MCP server.
func NewCodeModeServer(cfg CodeModeServerConfig) (*CodeModeServer, error) {
	if cfg.RouterGraphQLEndpoint == "" {
		return nil, errors.New("router GraphQL endpoint is required")
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
	execCounter, err := meter.Int64Counter("mcp.code_mode.sandbox.executions",
		otelmetric.WithDescription("Total number of Code Mode sandbox executions"),
	)
	if err != nil {
		cfg.Logger.Warn("Failed to create sandbox execution counter", zap.Error(err))
	}
	execDuration, err := meter.Float64Histogram("mcp.code_mode.sandbox.duration",
		otelmetric.WithDescription("Duration of Code Mode sandbox executions in milliseconds"),
		otelmetric.WithUnit("ms"),
	)
	if err != nil {
		cfg.Logger.Warn("Failed to create sandbox execution duration histogram", zap.Error(err))
	}

	queryCache, err := ristretto.NewCache[uint64, string](&ristretto.Config[uint64, string]{
		MaxCost:            maxQueryCacheSize,
		NumCounters:        maxQueryCacheSize * 10,
		BufferItems:        64,
		IgnoreInternalCost: true,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create query cache: %w", err)
	}

	s := &CodeModeServer{
		mcpServer:       mcpSrv,
		config:          cfg,
		logger:          cfg.Logger,
		transpiler:      sandbox.NewTranspiler(),
		sandboxPool:     sandbox.NewPool(4, cfg.SandboxConfig),
		httpClient:      httpClient,
		tracer:          otel.Tracer("wundergraph.cosmo.router.mcp.code_mode"),
		execCounter:     execCounter,
		execDuration:    execDuration,
		validateExecute: newTypeScriptExecuteValidator(cfg.Logger),
		repairExecute: func(ctx context.Context, code string, compileErr error) (string, string, error) {
			return repairExecuteCode(ctx, sandbox.NewTranspiler(), code, compileErr)
		},
		queryCache: queryCache,
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
	s.queryCache.Close()

	return shutdownErr
}

func (s *CodeModeServer) registerTools() {
	// Search tool
	s.mcpServer.AddTool(
		mcp.NewTool(searchToolName,
			mcp.WithDescription(searchToolDescription),
			mcp.WithArray("prompts",
				mcp.Required(),
				mcp.Description("Natural language descriptions of the GraphQL operations you need."),
				mcp.WithStringItems(),
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
				mcp.Description("Async arrow function (NOT a hash). The ONLY global is executeOperationByHash(hash, variables?). Example: async () => { return await executeOperationByHash('hashFromSearch'); }"),
			),
			mcp.WithToolAnnotation(mcp.ToolAnnotation{
				Title:           "Execute GraphQL Operations",
				ReadOnlyHint:    mcp.ToBoolPtr(false),
				DestructiveHint: mcp.ToBoolPtr(true),
				IdempotentHint:  mcp.ToBoolPtr(false),
			}),
		),
		s.handleExecute(),
	)
}

func (s *CodeModeServer) registerResources() {
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

// handleSearch returns the MCP tool handler for the search tool.
func (s *CodeModeServer) handleSearch() server.ToolHandlerFunc {
	return func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		ctx, span := s.tracer.Start(ctx, "MCP Code Mode - Search",
			trace.WithSpanKind(trace.SpanKindServer),
			trace.WithAttributes(attribute.String("mcp.tool", "search_graphql")),
		)
		defer span.End()
		start := time.Now()
		status := "success"
		defer func() { s.recordMetrics(ctx, "search_graphql", status, start) }()

		prompts, err := request.RequireStringSlice("prompts")
		if err != nil || len(prompts) == 0 {
			status = "error"
			return mcp.NewToolResultError("'prompts' must be a non-empty array of strings"), nil
		}
		if len(prompts) > maxPrompts {
			status = "error"
			return mcp.NewToolResultError(fmt.Sprintf("too many prompts: %d (max %d) — pass all prompts in one call", len(prompts), maxPrompts)), nil
		}

		if s.yokoClient == nil {
			status = "error"
			return mcp.NewToolResultError("query generation is not available"), nil
		}

		results, err := s.generateQueries(ctx, prompts)
		if err != nil {
			status = "error"
			return mcp.NewToolResultError(fmt.Sprintf("Query generation failed: %v", err)), nil
		}

		encoded, err := json.Marshal(results)
		if err != nil {
			status = "error"
			return mcp.NewToolResultError("failed to encode results"), nil
		}

		return mcp.NewToolResultText(s.formatToolResult(encoded)), nil
	}
}

// handleExecute returns the MCP tool handler for the execute tool.
func (s *CodeModeServer) handleExecute() server.ToolHandlerFunc {
	return func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		ctx, span := s.tracer.Start(ctx, "MCP Code Mode - Execute",
			trace.WithSpanKind(trace.SpanKindServer),
			trace.WithAttributes(attribute.String("mcp.tool", "execute_graphql")),
		)
		defer span.End()
		start := time.Now()
		status := "success"
		defer func() { s.recordMetrics(ctx, "execute_graphql", status, start) }()

		args := request.GetArguments()
		code, ok := args["code"].(string)
		if !ok || strings.TrimSpace(code) == "" {
			status = "error"
			return mcp.NewToolResultError("'code' must be an async arrow function, e.g.: async () => { return await executeOperationByHash(\"hashFromSearch\"); }"), nil
		}
		if s.validateExecute != nil {
			if err := s.validateExecute(ctx, code); err != nil {
				if s.repairExecute != nil {
					repairedCode, runner, repairErr := s.repairExecute(ctx, code, err)
					if repairErr != nil {
						s.logger.Warn("failed to repair execute_graphql code after TypeScript validation error",
							zap.Error(err),
							zap.Error(repairErr),
						)
					} else if validateErr := s.validateExecute(ctx, repairedCode); validateErr != nil {
						err = validateErr
					} else {
						code = repairedCode
						err = nil
						s.logger.Info("repaired execute_graphql code after TypeScript validation error",
							zap.String("runner", runner),
						)
					}
				}
				if err != nil {
					status = "error"
					return mcp.NewToolResultError(formatTypeScriptValidationError(err)), nil
				}
			}
		}
		jsCode, err := s.transpiler.Transpile(code)
		if err != nil {
			if s.repairExecute != nil {
				repairedCode, runner, repairErr := s.repairExecute(ctx, code, err)
				if repairErr != nil {
					s.logger.Warn("failed to repair execute_graphql code after TypeScript compile error",
						zap.Error(err),
						zap.Error(repairErr),
					)
				} else {
					jsCode, err = s.transpiler.Transpile(repairedCode)
					if err == nil {
						s.logger.Info("repaired execute_graphql code after TypeScript compile error",
							zap.String("runner", runner),
						)
					}
				}
			}
			if err != nil {
				status = "error"
				return mcp.NewToolResultError(formatTypeScriptCompilationError(err)), nil
			}
		}

		// Create a context for async functions (like executeOperationByHash with mutation approval).
		// This context is cancelled after sandbox execution completes, ensuring
		// pending elicitation requests are cleaned up on sandbox timeout.
		asyncCtx, asyncCancel := context.WithCancel(ctx)
		defer asyncCancel()

		asyncFuncs := []sandbox.AsyncFunc{
			{
				Name: "executeOperationByHash",
				Fn:   s.executeOperationByHashFunc(asyncCtx),
			},
		}

		result, err := s.sandboxPool.Execute(ctx, jsCode, nil, asyncFuncs, nil)
		if err != nil {
			status = "error"
			return mcp.NewToolResultError(fmt.Sprintf("Sandbox execution error: %v", err)), nil
		}

		return mcp.NewToolResultText(s.formatToolResult(result.Value)), nil
	}
}

// executeOperationByHashFunc creates the async executeOperationByHash() host function for the execute sandbox.
// Signature: executeOperationByHash(hash: string, variables?: Record<string, any>): Promise<GraphQLResponse>
func (s *CodeModeServer) executeOperationByHashFunc(ctx context.Context) func(args []any) (any, error) {
	return func(args []any) (any, error) {
		if len(args) == 0 {
			return nil, errors.New("executeOperationByHash(hash, variables?) requires a hash string from search_graphql")
		}

		hashStr, ok := args[0].(string)
		if !ok {
			return nil, errors.New("executeOperationByHash(hash, variables?) — first argument must be a hash string from search_graphql")
		}

		queryStr, found := s.resolveQueryHash(hashStr)
		if !found {
			return nil, fmt.Errorf("query hash %q has expired from cache — please call search_graphql again to re-generate the query", hashStr)
		}

		// Optional variables as second argument
		var variables map[string]any
		if len(args) > 1 {
			variables, _ = args[1].(map[string]any)
		}

		// Check for mutation and require approval via MCP elicitation
		if s.config.RequireMutationApproval && isMutation(queryStr, "") {
			approved, reason, err := s.requestMutationApproval(ctx, queryStr, variables)
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
		if variables != nil {
			gqlReq["variables"] = variables
		}

		reqBody, err := json.Marshal(gqlReq)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal GraphQL request: %w", err)
		}

		httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, s.config.RouterGraphQLEndpoint, bytes.NewReader(reqBody))
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
func isMutation(queryStr, operationName string) bool {
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

func repairExecuteCode(ctx context.Context, transpiler *sandbox.Transpiler, code string, compileErr error) (string, string, error) {
	return llmcli.FirstDecoded(ctx, buildExecuteCodeRepairPrompt(code, compileErr), func(name, text string) (string, error) {
		fixed := llmcli.StripMarkdownCodeFences(text)
		if strings.TrimSpace(fixed) == "" {
			return "", errors.New("empty response")
		}
		if _, err := transpiler.Transpile(fixed); err != nil {
			return "", fmt.Errorf("generated code still does not compile: %w", err)
		}
		return fixed, nil
	}, llmcli.NewClaudeRunner(), llmcli.NewCodexRunner())
}

func buildExecuteCodeRepairPrompt(code string, compileErr error) string {
	return fmt.Sprintf(`You repair TypeScript snippets for a GraphQL execution sandbox.

Return ONLY the repaired async arrow function.
Do not return markdown, code fences, bullets, or explanation.

The repaired code must:
- remain an async arrow function expression
- look like: async () => { ... }
- use ES2020 only
- use no imports
- not wrap the function in an IIFE
- only use executeOperationByHash(hash, variables?) as its external global
- preserve the original intent unless the validation or compiler error forces a structural fix
- make the smallest valid fix that compiles

Validation or compiler error:
%s

Original code:
%s`, compileErr, code)
}

func formatTypeScriptCompilationError(err error) string {
	msg := err.Error()
	if strings.HasPrefix(msg, "TypeScript compilation error:") {
		return msg
	}
	return "TypeScript compilation error: " + msg
}

func formatTypeScriptValidationError(err error) string {
	msg := err.Error()
	if strings.HasPrefix(msg, "TypeScript validation error:") {
		return msg
	}
	return "TypeScript validation error: " + msg
}

// queryResultWithHash extends yokoclient.QueryResult with a server-computed hash
// and a ready-to-use JS snippet for execute_graphql.
type queryResultWithHash struct {
	Query       string         `json:"query"`
	Variables   map[string]any `json:"variables,omitempty"`
	Description string         `json:"description"`
	Hash        string         `json:"hash"`
	Execute     string         `json:"execute"`
}

// generateQueries calls the Yoko API for each prompt and returns results with hashes and snippets.
// Multiple prompts are executed in parallel; individual failures are tolerated.
func (s *CodeModeServer) generateQueries(ctx context.Context, prompts []string) ([]queryResultWithHash, error) {
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
		wg.Go(func() {
			results, err := s.yokoClient.Generate(ctx, p, schemaHash)
			ch <- indexedResult{index: i, results: results, err: err}
		})
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
		return nil, errors.New("all query generation prompts failed")
	}
	return all, nil
}

// toQueryResultsWithHash converts yokoclient results to queryResultWithHash, storing hashes.
func (s *CodeModeServer) toQueryResultsWithHash(results []yokoclient.QueryResult) []queryResultWithHash {
	out := make([]queryResultWithHash, len(results))
	for i, r := range results {
		hash := s.storeQueryHash(r.Query)
		out[i] = queryResultWithHash{
			Query:       r.Query,
			Variables:   r.Variables,
			Description: r.Description,
			Hash:        hash,
			Execute:     makeSnippet(hash, r.Variables),
		}
	}
	return out
}

// makeSnippet generates a JS code snippet showing how to call executeOperationByHash.
func makeSnippet(hash string, variables map[string]any) string {
	if len(variables) == 0 {
		return fmt.Sprintf(`await executeOperationByHash("%s")`, hash)
	}
	varsJSON, _ := json.Marshal(variables)
	return fmt.Sprintf(`await executeOperationByHash("%s", %s)`, hash, string(varsJSON))
}

// SetYokoClient allows setting a custom Yoko client (useful for testing).
func (s *CodeModeServer) SetYokoClient(client yokoclient.YokoClient) {
	s.yokoClient = client
}

const maxPrompts = 20
const maxQueryCacheSize = 1000

// storeQueryHash computes the xxhash64 of a query string, stores it
// in the ristretto cache, and returns the hex-encoded hash.
func (s *CodeModeServer) storeQueryHash(query string) string {
	h := xxhash.Sum64String(query)
	s.queryCache.Set(h, query, 1)
	s.queryCache.Wait()
	return strconv.FormatUint(h, 16)
}

// resolveQueryHash looks up a query string by its hex-encoded hash.
func (s *CodeModeServer) resolveQueryHash(hash string) (string, bool) {
	h, err := strconv.ParseUint(hash, 16, 64)
	if err != nil {
		return "", false
	}
	return s.queryCache.Get(h)
}

// formatToolResult encodes the result as TOON (Token-Oriented Object Notation)
// to reduce LLM token consumption. Falls back to raw JSON on encoding failure.
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
func (s *CodeModeServer) recordMetrics(ctx context.Context, tool, status string, start time.Time) {
	attrs := otelmetric.WithAttributes(
		attribute.String("mcp.tool", tool),
		attribute.String("mcp.status", status),
	)
	s.execCounter.Add(ctx, 1, attrs)
	s.execDuration.Record(ctx, float64(time.Since(start).Milliseconds()), attrs)
}
