package mcpserver

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/cors"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"go.uber.org/zap"
)

// HostOptions configures the shared MCP listener.
type HostOptions struct {
	ListenAddr string
	Logger     *zap.Logger
	CorsConfig cors.Config
}

// Host owns the MCP listener and its mux. It serves one or more MCP servers,
// each on its own mount path. CORS is shared by every server on the host.
type Host struct {
	listenAddr string
	logger     *zap.Logger
	corsConfig cors.Config
	servers    []*GraphQLSchemaServer
	byPath     map[string]struct{}
	httpServer *http.Server
}

// NewHost creates a listener that has no servers registered yet.
//
// The CORS settings are normalized for MCP clients regardless of what the
// caller supplies, the same way WithCORS used to force them per server
// before CORS moved to the host: all origins are allowed, because an MCP
// client's origin is not known ahead of time, and the MCP-specific headers
// are always present.
func NewHost(opts HostOptions) *Host {
	logger := opts.Logger
	if logger == nil {
		logger = zap.NewNop()
	}

	corsConfig := opts.CorsConfig
	corsConfig.AllowOrigins = []string{"*"}
	corsConfig.AllowMethods = []string{"GET", "PUT", "POST", "DELETE", "OPTIONS"}
	corsConfig.AllowHeaders = append(corsConfig.AllowHeaders, "Content-Type", "Accept", "Authorization", "Last-Event-ID", "Mcp-Protocol-Version", "Mcp-Session-Id")
	corsConfig.ExposeHeaders = append(corsConfig.ExposeHeaders, "Mcp-Session-Id", "WWW-Authenticate")
	if corsConfig.MaxAge <= 0 {
		corsConfig.MaxAge = 24 * time.Hour
	}

	return &Host{
		listenAddr: opts.ListenAddr,
		logger:     logger,
		corsConfig: corsConfig,
		byPath:     make(map[string]struct{}),
	}
}

// Register adds a server to the host. The config validation in ValidateServers
// already rejects duplicate paths; this check keeps the host safe on its own,
// because ServeMux panics when one pattern is registered two times.
func (h *Host) Register(s *GraphQLSchemaServer) error {
	path := s.MountPath()
	if _, ok := h.byPath[path]; ok {
		return fmt.Errorf("an mcp server is already registered on path %q", path)
	}

	h.byPath[path] = struct{}{}
	h.servers = append(h.servers, s)

	return nil
}

// Servers returns the registered servers in registration order.
func (h *Host) Servers() []*GraphQLSchemaServer {
	return h.servers
}

func (h *Host) buildMux() *http.ServeMux {
	mux := http.NewServeMux()
	middleware := cors.New(h.corsConfig)

	for _, s := range h.servers {
		s.RegisterRoutes(mux, middleware)
	}

	return mux
}

// Start binds the listener and serves every registered server.
func (h *Host) Start() error {
	if len(h.servers) == 0 {
		h.logger.Debug("No MCP servers registered, skipping listener")
		return nil
	}

	h.httpServer = &http.Server{
		Addr:         h.listenAddr,
		Handler:      h.buildMux(),
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	for _, s := range h.servers {
		h.logger.Info("MCP server mounted",
			zap.String("listen_addr", h.listenAddr),
			zap.String("path", s.MountPath()),
			zap.String("graph_name", s.graphName),
			zap.String("operations_dir", s.operationsDir),
		)
	}

	go func() {
		defer h.logger.Info("MCP listener stopped")

		err := h.httpServer.ListenAndServe()
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			h.logger.Error("Failed to start MCP listener", zap.Error(err))
		}
	}()

	return nil
}

// Reload rebuilds the tools of every server from the shared schema document.
// One server that fails does not stop the others; the error is logged and the
// remaining servers keep their previous tools.
func (h *Host) Reload(schema *ast.Document, fieldConfigs []*nodev1.FieldConfiguration) error {
	for _, s := range h.servers {
		if err := s.Reload(schema, fieldConfigs); err != nil {
			h.logger.Error("Failed to reload MCP server",
				zap.String("path", s.MountPath()),
				zap.Error(err),
			)
		}
	}

	return nil
}

// Stop closes every server and shuts the listener down.
func (h *Host) Stop(ctx context.Context) error {
	for _, s := range h.servers {
		s.Close()
	}

	if h.httpServer == nil {
		return nil
	}

	shutdownCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if err := h.httpServer.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("failed to gracefully shutdown MCP listener: %w", err)
	}

	return nil
}
