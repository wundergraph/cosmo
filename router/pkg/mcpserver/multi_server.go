package mcpserver

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"go.uber.org/zap"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
)

// MultiServer hosts multiple MCP collections on a single shared HTTP listener.
// Each collection has its own URL path, operations directory, optional OAuth policy,
// and optional upstream override. Use NewMultiServer to construct, Start to bind the
// listener, Reload to fan out supergraph reloads, and Stop to shut down gracefully.
type MultiServer struct {
	listenAddr string
	logger     *zap.Logger
	handlers   []*GraphQLSchemaServer
	httpServer *http.Server
}

// NewMultiServer constructs a MultiServer that will mount the given handlers on
// listenAddr when Start is called. The handlers are not yet started.
func NewMultiServer(listenAddr string, logger *zap.Logger, handlers ...*GraphQLSchemaServer) (*MultiServer, error) {
	if listenAddr == "" {
		return nil, fmt.Errorf("listen_addr is required")
	}
	if len(handlers) == 0 {
		return nil, fmt.Errorf("at least one MCP server handler is required")
	}
	if logger == nil {
		logger = zap.NewNop()
	}
	seenPaths := make(map[string]struct{}, len(handlers))
	for _, h := range handlers {
		if _, dup := seenPaths[h.path]; dup {
			return nil, fmt.Errorf("duplicate MCP server path %q", h.path)
		}
		seenPaths[h.path] = struct{}{}
	}
	return &MultiServer{
		listenAddr: listenAddr,
		logger:     logger,
		handlers:   handlers,
	}, nil
}

// Start mounts every handler on a shared mux, primes upstream-bound handlers with
// their SDL-derived schema (so their tools are available immediately), and binds
// the HTTP listener. The listener runs in a background goroutine.
//
// Supergraph-bound handlers remain "empty" until Reload is called by the router
// with the federated schema — same lifecycle as the legacy single-server flow.
func (m *MultiServer) Start() error {
	mux := http.NewServeMux()
	for _, h := range m.handlers {
		h.RegisterRoutes(mux)

		// Upstream-bound handlers carry their own SDL — load it now so their
		// tools are ready before any client connects. Supergraph-bound handlers
		// wait for the router's Reload(supergraphSchema, ...) call.
		if h.HasUpstreamSchema() {
			doc, err := parseSDL(h.upstreamSchemaSDL)
			if err != nil {
				return fmt.Errorf("mcp server %q: parse upstream SDL: %w", h.graphName, err)
			}
			if err := h.Reload(doc, nil); err != nil {
				return fmt.Errorf("mcp server %q: initial reload: %w", h.graphName, err)
			}
		}

		// Per-collection operations directory watcher: hot-reloads tools when
		// .graphql / .gql files are added, modified, or removed.
		// Supergraph-bound handlers without an initial Reload yet still benefit —
		// the watcher is no-op until the first Reload populates a schema, after
		// which it picks up file changes on the next tick.
		watchEnabled, interval := h.WatchSettings()
		if watchEnabled && h.OperationsDir() != "" {
			handler := h // capture loop variable for the callback
			err := WatchOperationsDir(handler.Context(), handler.OperationsDir(), interval, func() {
				if err := handler.ReloadOperations(); err != nil {
					m.logger.Warn("hot-reload of MCP operations failed",
						zap.String("name", handler.graphName),
						zap.String("path", handler.path),
						zap.Error(err))
					return
				}
				m.logger.Info("MCP operations hot-reloaded",
					zap.String("name", handler.graphName),
					zap.String("path", handler.path))
			}, m.logger.With(zap.String("mcp_server_name", handler.graphName)))
			if err != nil {
				return fmt.Errorf("mcp server %q: start operations watcher: %w", h.graphName, err)
			}
		}
	}

	m.httpServer = &http.Server{
		Addr:         m.listenAddr,
		Handler:      mux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	paths := make([]string, 0, len(m.handlers))
	for _, h := range m.handlers {
		paths = append(paths, h.path)
	}
	m.logger.Info("MCP multi-server starting",
		zap.String("listen_addr", m.listenAddr),
		zap.Strings("paths", paths),
	)

	go func() {
		defer m.logger.Info("MCP multi-server stopped")
		if err := m.httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			m.logger.Error("MCP multi-server failed", zap.Error(err))
		}
	}()

	return nil
}

// Reload fans out a supergraph schema update to every handler that tracks the
// supergraph (i.e. has no upstream override). Upstream-bound handlers are skipped.
func (m *MultiServer) Reload(schema *ast.Document, fieldConfigs []*nodev1.FieldConfiguration) error {
	var firstErr error
	for _, h := range m.handlers {
		if h.HasUpstreamSchema() {
			continue
		}
		if err := h.Reload(schema, fieldConfigs); err != nil {
			m.logger.Error("MCP server reload failed",
				zap.String("name", h.graphName),
				zap.String("path", h.path),
				zap.Error(err))
			if firstErr == nil {
				firstErr = err
			}
		}
	}
	return firstErr
}

// Stop gracefully shuts down the HTTP listener and cancels every handler's
// background context (JWKS pollers, etc.).
func (m *MultiServer) Stop(ctx context.Context) error {
	for _, h := range m.handlers {
		if h.cancel != nil {
			h.cancel()
		}
	}
	if m.httpServer == nil {
		return nil
	}
	shutdownCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := m.httpServer.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("MCP multi-server shutdown: %w", err)
	}
	return nil
}

// parseSDL parses an SDL string into an *ast.Document.
func parseSDL(sdl string) (*ast.Document, error) {
	doc, report := astparser.ParseGraphqlDocumentString(sdl)
	if report.HasErrors() {
		return nil, fmt.Errorf("%s", report.Error())
	}
	return &doc, nil
}