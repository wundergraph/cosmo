package server

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/wundergraph/cosmo/router/internal/codemode/calltrace"
	"github.com/wundergraph/cosmo/router/internal/codemode/harness"
	"github.com/wundergraph/cosmo/router/internal/codemode/observability"
	"github.com/wundergraph/cosmo/router/internal/codemode/sandbox"
	"github.com/wundergraph/cosmo/router/internal/codemode/storage"
	"github.com/wundergraph/cosmo/router/internal/codemode/tsgen"
	"github.com/wundergraph/cosmo/router/internal/codemode/yoko"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	otelmetric "go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
	"golang.org/x/sync/singleflight"
)

const (
	defaultListenAddr              = "localhost:5027"
	defaultExecuteTimeout          = 120 * time.Second
	defaultMaxResultBytes          = 32 << 10
	mcpPath                        = "/mcp"
	persistedOpsURI                = "yoko://persisted-ops.d.ts"
	statelessNamedOpsWarnMessage = "code mode named operations are disabled because MCP session stateless mode is enabled"
	namedOpsDisabledMessage      = "named operations are disabled"
)

const searchAPIDescription = "Plan ALL data shapes you need up front, then call ONCE with every prompt in a single batch. Each extra search is a round-trip you pay for.\n\nDEFAULT TO ONE PROMPT. If the entities are related in any way — same domain, joinable, fetched together to answer one question, traversed via the same parent, or the user mentioned them in the same breath — combine them into a SINGLE prompt that describes the complete joined shape. Multiple prompts should be the exception, not the default.\n\nWrite each prompt as the COMPLETE final shape of data you want, including joins and correlation IDs. Yoko writes GraphQL across federated subgraphs, so a single prompt like \"employees with id, first name, last name, and their pets (name, type)\" returns one joined operation — never split this into \"list employees\" + \"list pets with owner\" that you'd then have to correlate in JS. If you DO split, every prompt MUST include the join keys (IDs / foreign keys) needed to correlate the results — otherwise the operations come back un-joinable and you'll have to search again.\n\nBE PRECISE about what you need. Vague prompts produce vague operations and force re-searches. Always state:\n- The exact fields you need on each entity (\"id, forename, surname\" — not \"name info\").\n- The relationships to traverse and how deep (\"employees with their pets and each pet's owner's department\").\n- Any required filters/arguments and the values or variable names (\"by id=42\", \"where status=ACTIVE\", \"limit 50\").\n- The shape of nested/related entities, field by field — do not say \"with all their data\".\n- Concrete entity and relationship names from the domain when you know them; otherwise describe the relationship explicitly (\"the team an employee belongs to\").\nA precise prompt: \"employee by id (variable: $id) returning id, forename, surname, role, and pets { name, type, age }\". A vague prompt: \"get employee details with related stuff\" — this will come back missing fields you need.\n\nWhen to use multiple prompts (rare): genuinely unrelated operations on disjoint domains, different argument shapes that can't share a parent, or queries vs mutations. Never slice one joinable shape into fragments. When in doubt, combine.\n\nDo NOT issue prompts for derived/computed values: averages, medians, counts, filters, exclusions (\"without X\"), sorting, top-N. Fetch the raw rows once and compute in code_mode_run_js. Yoko exposes data; arithmetic and reshaping happen in your JS.\n\nAnti-pattern: search → inspect result → notice a field or ID is missing → search again. One well-formed prompt beats three round-trips.\n\nThe response appends newly registered TypeScript declarations for use as `await tools.<name>(vars)` inside code_mode_run_js; the cumulative bundle is available at `yoko://persisted-ops.d.ts`."

const executeAPISourceDescription = "JavaScript source containing a single async arrow function. The host wraps it as `(<source>)()` and awaits the resulting Promise; the resolved JSON-serializable value is the tool result."

const executeAPIDescription = "Run JavaScript source as a single async arrow function in the Code Mode sandbox. Use `await tools.<name>(vars)` for operations registered by code_mode_search_tools; the cumulative tools namespace is available at `yoko://persisted-ops.d.ts`.\n\nStyle: write compact source — single line if it fits, no // comments, no blank lines, short variable names. The JSON wrapping that encodes your source charges you for every newline and indent space.\n\nBatch everything into ONE code_mode_run_js call. ≥3 `tools.*` invocations per call is normal; over-fetch and decide in JS, don't round-trip. A failing inner call degrades the result, not the whole script — wrap with try/catch and surface the error in the return value.\n\nThe return value of your async arrow is the only output channel — `console` is not available. To surface intermediate state, include it in the returned object (e.g. `return { result, debug: { ... } }`). For resilient fan-out use `Promise.allSettled` — `Promise.all` rejects on first failure and discards partial results. Up to 256 `tools.*` invocations per call. Non-serializable leaves in the return value (`BigInt`, functions, symbols, `undefined`, circular refs) are replaced with the sentinel string `<<non-serializable: KIND>>` and listed in the response's `warnings: [{path, kind}]` field; the rest of the value still comes through.\n\nExample: `async()=>{const o=await tools.getOrders({customerId:\"c_1\"});if(o.errors?.length)throw new Error(o.errors[0].message);return o.data.orders;}`\n\nType declarations for reference (consumed via `yoko://persisted-ops.d.ts`):\n\n```ts\ntype GraphQLError = { message: string; path?: (string | number)[]; extensions?: Record<string, unknown> };\ntype R<T> = Promise<{ data: T | null; errors?: GraphQLError[] }>;\n\ndeclare const tools: {};\n\ndeclare function notNull<T>(value: T | null | undefined, message?: string): T;\ndeclare function compact<T>(value: T): T;\n```"

// Config configures the Code Mode MCP server.
type Config struct {
	ListenAddr        string
	CodeModeEnabled   bool
	NamedOpsEnabled   bool
	SessionStateless  bool
	Storage           storage.SessionStorage
	Pipeline          harness.Executor
	YokoClient        yoko.Searcher
	BundleRenderer    storage.Renderer
	ExecuteTimeout    time.Duration
	MaxResultBytes    int
	ApprovalGate      sandbox.ApprovalGate
	Logger            *zap.Logger
	MeterProvider     otelmetric.MeterProvider
	TracerProvider    trace.TracerProvider
	CallTraceRecorder calltrace.Recorder
}

// Server owns the Code Mode MCP server and its separate HTTP listener.
type Server struct {
	listenAddr        string
	codeModeEnabled   bool
	namedOpsEnabled   bool
	sessionStateless  bool
	storage           storage.SessionStorage
	pipeline          harness.Executor
	yokoClient        yoko.Searcher
	bundleRenderer    storage.Renderer
	executeTimeout    time.Duration
	maxResultBytes    int
	approvalGate      sandbox.ApprovalGate
	logger            *zap.Logger
	meter             *observability.Meter
	tracerProvider    trace.TracerProvider
	callTraceRecorder calltrace.Recorder

	mcpServer      *mcp.Server
	searchGroup    singleflight.Group
	newOpsFragment func([]storage.SessionOp, *ast.Document) (string, error)

	mu                      sync.Mutex
	httpServer              *http.Server
	actualAddr              string
	warnedStatelessNamedOps bool
	warnedMissingSessionID  bool
}

// New creates a Code Mode MCP server.
func New(cfg Config) (*Server, error) {
	if cfg.ListenAddr == "" {
		cfg.ListenAddr = defaultListenAddr
	}
	if cfg.Logger == nil {
		cfg.Logger = zap.NewNop()
	}
	if cfg.MeterProvider == nil {
		cfg.MeterProvider = otel.GetMeterProvider()
	}
	if cfg.TracerProvider == nil {
		cfg.TracerProvider = otel.GetTracerProvider()
	}
	if cfg.CallTraceRecorder == nil {
		cfg.CallTraceRecorder = calltrace.NopRecorder{}
	}
	if cfg.ExecuteTimeout <= 0 {
		cfg.ExecuteTimeout = defaultExecuteTimeout
	}
	if cfg.MaxResultBytes <= 0 {
		cfg.MaxResultBytes = defaultMaxResultBytes
	}
	if pipeline, ok := cfg.Pipeline.(*harness.Pipeline); ok {
		pipeline.MaxResultBytes = cfg.MaxResultBytes
	}
	meter, err := observability.NewMeter(cfg.MeterProvider)
	if err != nil {
		return nil, err
	}

	s := &Server{
		listenAddr:        cfg.ListenAddr,
		codeModeEnabled:   cfg.CodeModeEnabled,
		namedOpsEnabled:   cfg.NamedOpsEnabled,
		sessionStateless:  cfg.SessionStateless,
		storage:           cfg.Storage,
		pipeline:          cfg.Pipeline,
		yokoClient:        cfg.YokoClient,
		bundleRenderer:    cfg.BundleRenderer,
		executeTimeout:    cfg.ExecuteTimeout,
		maxResultBytes:    cfg.MaxResultBytes,
		approvalGate:      cfg.ApprovalGate,
		logger:            cfg.Logger,
		meter:             meter,
		tracerProvider:    cfg.TracerProvider,
		callTraceRecorder: cfg.CallTraceRecorder,
		newOpsFragment:    tsgen.NewOpsFragment,
	}

	s.mcpServer = mcp.NewServer(&mcp.Implementation{
		Name:    "yoko",
		Title:   "Yoko (Cosmo Code Mode)",
		Version: "v0.1.0",
	}, &mcp.ServerOptions{
		HasResources: true,
	})

	if cfg.CodeModeEnabled {
		s.registerTools()
		if cfg.NamedOpsEnabled && !cfg.SessionStateless {
			s.registerPersistedOpsResource()
		}
	}

	return s, nil
}

// Start binds the separate Code Mode MCP HTTP listener and serves until the
// server shuts down or ctx is canceled. When Code Mode is disabled it is a no-op.
func (s *Server) Start(ctx context.Context) error {
	if !s.codeModeEnabled {
		return nil
	}

	if s.storage != nil {
		if err := s.storage.Start(ctx); err != nil {
			return err
		}
	}

	listener, err := net.Listen("tcp", s.listenAddr)
	if err != nil {
		if s.storage != nil {
			_ = s.storage.Stop()
		}
		return err
	}

	httpServer := &http.Server{
		Addr:         s.listenAddr,
		Handler:      s.handler(),
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	s.mu.Lock()
	s.httpServer = httpServer
	s.actualAddr = listener.Addr().String()
	s.mu.Unlock()

	done := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = s.Stop(shutdownCtx)
		case <-done:
		}
	}()

	s.logger.Info("Code Mode MCP server started", zap.String("listen_addr", listener.Addr().String()), zap.String("path", mcpPath))
	err = httpServer.Serve(listener)
	close(done)
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

// Stop gracefully shuts down the Code Mode MCP HTTP server. Disabled or unstarted
// servers are no-ops.
func (s *Server) Stop(ctx context.Context) error {
	if !s.codeModeEnabled {
		return nil
	}

	s.mu.Lock()
	httpServer := s.httpServer
	s.mu.Unlock()
	if httpServer == nil {
		if s.storage != nil {
			return s.storage.Stop()
		}
		return nil
	}
	err := httpServer.Shutdown(ctx)
	if err == nil || errors.Is(err, http.ErrServerClosed) {
		s.mu.Lock()
		if s.httpServer == httpServer {
			s.httpServer = nil
		}
		s.mu.Unlock()
		if s.storage != nil {
			return s.storage.Stop()
		}
		return nil
	}
	return err
}

// Reload forwards schema state into Code Mode dependencies. Disabled servers
// ignore reloads.
func (s *Server) Reload(schema *ast.Document, sdl string) error {
	if !s.codeModeEnabled {
		return nil
	}
	if s.storage != nil {
		s.storage.SetSchema(schema)
	}
	if s.yokoClient != nil {
		s.yokoClient.SetSchema(sdl)
	}
	if s.sessionStateless && s.namedOpsEnabled {
		s.warnStatelessNamedOpsOnce()
	}
	observability.LogSessionLifecycle(s.logger, "schema_swap", "", zap.Int("sdl_bytes", len(sdl)))
	return nil
}

func (s *Server) registerTools() {
	s.mcpServer.AddTool(&mcp.Tool{
		Name:        "code_mode_search_tools",
		Description: searchAPIDescription,
		InputSchema: searchAPIInputSchema(),
	}, s.handleSearch)

	s.mcpServer.AddTool(&mcp.Tool{
		Name:        "code_mode_run_js",
		Description: executeAPIDescription,
		InputSchema: executeAPIInputSchema(),
	}, s.handleExecute)
}

func (s *Server) registerPersistedOpsResource() {
	s.mcpServer.AddResource(&mcp.Resource{
		URI:         persistedOpsURI,
		Name:        "persisted-ops.d.ts",
		Title:       "Persisted operations TypeScript definitions",
		Description: "Cumulative TypeScript definitions for the current Code Mode MCP session's named operations.",
		MIMEType:    "text/plain",
	}, s.handlePersistedOpsResource)
}

func (s *Server) handler() http.Handler {
	cop := http.NewCrossOriginProtection()
	cop.AddInsecureBypassPattern("/{path...}")

	streamableHTTPHandler := mcp.NewStreamableHTTPHandler(
		func(*http.Request) *mcp.Server {
			return s.mcpServer
		},
		&mcp.StreamableHTTPOptions{
			Stateless:             s.sessionStateless,
			CrossOriginProtection: cop,
		},
	)

	mux := http.NewServeMux()
	mux.Handle(mcpPath, http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		req = req.WithContext(withSessionIDFromRequest(req.Context(), req))
		streamableHTTPHandler.ServeHTTP(w, req)
	}))
	return mux
}

func (s *Server) handleSearch(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	return s.handleTool(ctx, req, "code_mode_search_tools", s.handleSearchAPI)
}

func (s *Server) handleExecute(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	return s.handleTool(ctx, req, "code_mode_run_js", s.handleExecuteAPI)
}

func (s *Server) handleTool(ctx context.Context, req *mcp.CallToolRequest, toolName string, next func(context.Context, *mcp.CallToolRequest) (*mcp.CallToolResult, error)) (result *mcp.CallToolResult, err error) {
	start := time.Now()
	ctx, span := observability.StartToolSpanWithProvider(ctx, s.tracerProvider, toolName)
	sessionID := sessionIDFromToolRequest(req)
	if calltrace.Enabled(s.callTraceRecorder) {
		s.callTraceRecorder.RecordRequest(toolName, toolRequestBody(req))
	}
	observability.LogSessionLifecycle(s.logger, toolName+".started", sessionID)
	defer func() {
		status := toolStatus(result, err)
		durationMs := float64(time.Since(start)) / float64(time.Millisecond)
		span.SetAttributes(attribute.String("mcp.status", status))
		s.meter.Record(ctx, toolName, status, durationMs)
		observability.LogSessionLifecycle(s.logger, toolName+".completed", sessionID,
			zap.String("status", status),
			zap.Float64("duration_ms", durationMs),
		)
		span.End()
	}()

	result, err = next(ctx, req)
	if calltrace.Enabled(s.callTraceRecorder) {
		if body, marshalErr := json.Marshal(result); marshalErr == nil {
			s.callTraceRecorder.RecordResponse(toolName, body)
		}
	}
	return result, err
}

func toolStatus(result *mcp.CallToolResult, err error) string {
	if err != nil || (result != nil && result.IsError) {
		return "error"
	}
	return "success"
}

func sessionIDFromToolRequest(req *mcp.CallToolRequest) string {
	if req == nil || req.GetExtra() == nil {
		return ""
	}
	return req.GetExtra().Header.Get(mcpSessionIDHeader)
}

func toolRequestBody(req *mcp.CallToolRequest) []byte {
	if req == nil || req.Params == nil || len(req.Params.Arguments) == 0 {
		return []byte(`null`)
	}
	return append([]byte(nil), req.Params.Arguments...)
}

func (s *Server) handlePersistedOpsResource(ctx context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
	ctx = contextWithSessionFromExtra(ctx, req.GetExtra())
	if s.storage == nil {
		return &mcp.ReadResourceResult{
			Contents: []*mcp.ResourceContents{{
				URI:      persistedOpsURI,
				MIMEType: "text/plain",
				Text:     "",
			}},
		}, nil
	}
	bundle, err := s.storage.Bundle(ctx, SessionIDFromContext(ctx))
	if err != nil {
		return nil, err
	}
	return &mcp.ReadResourceResult{
		Contents: []*mcp.ResourceContents{{
			URI:      persistedOpsURI,
			MIMEType: "text/plain",
			Text:     bundle,
		}},
	}, nil
}

func contextWithSessionFromExtra(ctx context.Context, extra *mcp.RequestExtra) context.Context {
	if extra == nil {
		return WithSessionID(ctx, "")
	}
	return WithSessionID(ctx, extra.Header.Get(mcpSessionIDHeader))
}

func toolErrorResult(message string) *mcp.CallToolResult {
	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: message}},
		IsError: true,
	}
}

func searchAPIInputSchema() map[string]any {
	return map[string]any{
		"type":     "object",
		"required": []any{"prompts"},
		"properties": map[string]any{
			"prompts": map[string]any{
				"type":     "array",
				"minItems": 1,
				"maxItems": 20,
				"items": map[string]any{
					"type":      "string",
					"minLength": 1,
				},
			},
		},
	}
}

func executeAPIInputSchema() map[string]any {
	return map[string]any{
		"type":     "object",
		"required": []any{"source"},
		"properties": map[string]any{
			"source": map[string]any{
				"type":        "string",
				"minLength":   1,
				"description": executeAPISourceDescription,
			},
		},
	}
}

func (s *Server) warnStatelessNamedOpsOnce() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.warnedStatelessNamedOps {
		return
	}
	s.warnedStatelessNamedOps = true
	s.logger.Warn(statelessNamedOpsWarnMessage)
}

// Addr returns the listener address once Start has bound it.
func (s *Server) Addr() string {
	return s.addr()
}

func (s *Server) addr() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.actualAddr
}
