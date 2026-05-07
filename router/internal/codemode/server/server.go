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
	"github.com/wundergraph/cosmo/router/internal/codemode/server/descriptions"
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
	defaultListenAddr            = "localhost:5027"
	defaultExecuteTimeout        = 120 * time.Second
	defaultMaxResultBytes        = 32 << 10
	mcpPath                      = "/mcp"
	persistedOpsURI              = "yoko://persisted-ops.d.ts"
	statelessNamedOpsWarnMessage = "code mode named operations are disabled because MCP session stateless mode is enabled"
	namedOpsDisabledMessage      = "named operations are disabled"
)

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

	mcpServer   *mcp.Server
	searchGroup singleflight.Group
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

	// WriteTimeout must exceed executeTimeout — net/http enforces it as a
	// hard deadline on the whole response phase, which would cut off
	// legitimately long code_mode_run_js calls. ReadHeaderTimeout bounds the
	// header read separately so the listener still resists slow-loris clients.
	httpServer := &http.Server{
		Addr:              s.listenAddr,
		Handler:           s.handler(),
		ReadHeaderTimeout: 30 * time.Second,
		WriteTimeout:      s.executeTimeout + 30*time.Second,
		IdleTimeout:       60 * time.Second,
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
		// Eagerly index the new SDL in the background so the first user-facing
		// code_mode_search_tools call doesn't pay the IndexSchema round-trip
		// latency. Failures are logged and ignored — the lazy path inside
		// Search will retry on the next call.
		//
		// recover guard: an unrecovered panic here would bring the whole
		// router down because the goroutine runs outside any caller frame.
		// The warm-up is best-effort, so a panic must never escape.
		if sdl != "" {
			yokoClient := s.yokoClient
			logger := s.logger
			sdlBytes := len(sdl)
			go func() {
				start := time.Now()
				defer func() {
					if r := recover(); r != nil {
						logger.Error("code mode eager schema index panicked",
							zap.Any("panic", r),
							zap.Duration("duration", time.Since(start)),
						)
					}
				}()
				logger.Info("code mode eager schema index started",
					zap.Int("sdl_bytes", sdlBytes),
				)
				if err := yokoClient.EnsureIndexed(context.Background()); err != nil {
					logger.Warn("code mode eager schema index failed",
						zap.Error(err),
						zap.Duration("duration", time.Since(start)),
					)
					return
				}
				logger.Info("code mode eager schema index completed",
					zap.Duration("duration", time.Since(start)),
				)
			}()
		}
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
		Description: descriptions.SearchTool,
		InputSchema: searchAPIInputSchema(),
	}, s.handleSearch)

	s.mcpServer.AddTool(&mcp.Tool{
		Name:        "code_mode_run_js",
		Description: descriptions.ExecuteTool,
		InputSchema: executeAPIInputSchema(),
	}, s.handleExecute)
}

func (s *Server) registerPersistedOpsResource() {
	s.mcpServer.AddResource(&mcp.Resource{
		URI:         persistedOpsURI,
		Name:        "persisted-ops.d.ts",
		Title:       "Persisted operations TypeScript definitions",
		Description: descriptions.PersistedOpsResource,
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
				"description": descriptions.ExecuteSource,
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
