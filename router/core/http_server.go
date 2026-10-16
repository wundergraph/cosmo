package core

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
	"golang.org/x/net/http/httpguts"

	"github.com/wundergraph/cosmo/router/pkg/health"
)

// serverState holds the mux and graph server together for atomic swaps.
// This ensures both values are always consistent - a single atomic operation
// swaps both the handler and the graph server reference together.
// Storing *chi.Mux directly (instead of http.Handler interface) avoids vtable indirection.
type serverState struct {
	mux         *chi.Mux     // HTTP handler, never nil (uses newNotReadyMux as sentinel)
	graphServer *graphServer // graph server for shutdown, nil until first config loaded
}

// newNotReadyMux returns 503 Service Unavailable for all requests.
// Used as sentinel before server is ready or after shutdown.
func newNotReadyMux() *chi.Mux {
	mux := chi.NewMux()
	mux.HandleFunc("/*", func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "server not ready", http.StatusServiceUnavailable)
	})
	return mux
}

// notReadyState is the sentinel state used before initialization and after shutdown.
// Using a sentinel instead of nil eliminates nil checks on the hot path.
var notReadyState = &serverState{
	mux:         newNotReadyMux(),
	graphServer: nil,
}

type server struct {
	mu          sync.RWMutex
	httpServer  *http.Server
	logger      *zap.Logger
	state       atomic.Pointer[serverState]
	healthcheck health.Checker
	baseURL     string
	listener    net.Listener // Pre-bound listener for synchronous port check
	// draining makes every response carry "Connection: close" so clients retire their
	// keep-alive connections before the server shuts down. See drain.
	draining atomic.Bool
	// openConns counts the client connections the HTTP server still owns (not closed or hijacked).
	openConns atomic.Int64
	// drained is closed once the server is draining and no client connections are left.
	drained     chan struct{}
	drainedOnce sync.Once
}

type httpServerOptions struct {
	addr               string
	logger             *zap.Logger
	tlsServerConfig    *tls.Config
	healthcheck        health.Checker
	baseURL            string
	maxHeaderBytes     int
	livenessCheckPath  string
	readinessCheckPath string
	healthCheckPath    string
}

// newServer binds the listener synchronously, so port conflicts surface immediately, and builds
// the HTTP server with its handler chain.
func newServer(opts *httpServerOptions) (*server, error) {
	// Bind the port synchronously to detect port conflicts immediately
	listener, err := net.Listen("tcp", opts.addr)
	if err != nil {
		return nil, fmt.Errorf("failed to bind to address %s: %w", opts.addr, err)
	}

	httpServer := &http.Server{
		Addr:        opts.addr,
		ReadTimeout: 60 * time.Second,
		// Disable write timeout to keep the connection open until the client closes it
		// This is required for SSE (Server-Sent-Events) subscriptions to work correctly
		WriteTimeout:   0,
		ErrorLog:       zap.NewStdLog(opts.logger),
		TLSConfig:      opts.tlsServerConfig,
		MaxHeaderBytes: opts.maxHeaderBytes,
	}

	// Create default handler for liveness and readiness
	httpRouter := chi.NewMux()
	httpRouter.Get(opts.healthCheckPath, opts.healthcheck.Liveness())
	httpRouter.Get(opts.livenessCheckPath, opts.healthcheck.Liveness())
	httpRouter.Get(opts.readinessCheckPath, opts.healthcheck.Readiness())

	n := &server{
		httpServer:  httpServer,
		logger:      opts.logger,
		mu:          sync.RWMutex{},
		healthcheck: opts.healthcheck,
		baseURL:     opts.baseURL,
		listener:    listener, // Store the pre-bound listener
		drained:     make(chan struct{}),
	}

	// Store the initial state with health check mux (graphServer nil until first config)
	n.state.Store(&serverState{
		mux:         httpRouter,
		graphServer: nil,
	})

	httpServer.ConnState = func(_ net.Conn, state http.ConnState) {
		switch state {
		case http.StateNew:
			n.openConns.Add(1)
		case http.StateClosed, http.StateHijacked:
			remaining := n.openConns.Add(-1)
			// Only relevant while draining. drain stores draining before reading openConns, and we
			// decrement before reading draining, so one of the two sides always closes drained.
			if remaining == 0 && n.draining.Load() {
				n.markDrained()
			}
		}
	}

	httpServer.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Lock-free hot path: single atomic load gets both mux and graphServer.
		// The state is never nil (initialized with health mux, swapped to notReadyState on shutdown).
		// Direct method call on *chi.Mux avoids interface vtable indirection.
		// While draining, ask clients to retire the connection. Not on upgrade requests:
		// "Connection: close" on a 101 Switching Protocols response breaks WebSockets.
		if n.draining.Load() && !httpguts.HeaderValuesContainsToken(r.Header["Connection"], "upgrade") {
			w.Header().Set("Connection", "close")
		}
		n.state.Load().mux.ServeHTTP(w, r)
	})

	return n, nil
}

// drain marks the server as not ready and makes every subsequent response carry
// "Connection: close", so clients retire their pooled connections themselves. Unlike
// http.Server.SetKeepAlivesEnabled(false) it does not close idle connections, which would race
// the client's next write. It blocks until all client connections are closed, period has elapsed
// or ctx is done. Draining is not reversible.
func (s *server) drain(ctx context.Context, period time.Duration) {
	// Store draining before reading openConns, see ConnState in newServer.
	s.draining.Store(true)
	s.healthcheck.SetReady(false)

	// If there are no open connections, we can mark the server as drained immediately.
	// Otherwise, we wait for the httpServer.ConnState callback to mark the server as drained.
	if s.openConns.Load() == 0 {
		s.markDrained()
	}

	ctx, cancel := context.WithTimeout(ctx, period)
	defer cancel()

	select {
	case <-ctx.Done():
	case <-s.drained:
	}
}

// markDrained closes drained exactly once.
func (s *server) markDrained() {
	s.drainedOnce.Do(func() { close(s.drained) })
}

func (s *server) HealthChecks() health.Checker {
	return s.healthcheck
}

func (s *server) HttpServer() *http.Server {
	return s.httpServer
}

// SwapGraphServer swaps the current graph server with a new one. It will shut down the old server gracefully.
// Because we swap the handler immediately, we can guarantee that no new requests will be served by the old graph server.
// However, it is possible that there are still requests in flight that are being processed by the old graph server.
// We wait until all requests are processed or timeout before shutting down the old graph server forcefully.
// Websocket connections are closed after shutdown through context cancellation. In the future, we might want to send
// a complete message to the client and wait until in-flight messages are delivered before closing the connection.
// NOT SAFE FOR CONCURRENT USE.
func (s *server) SwapGraphServer(ctx context.Context, svr *graphServer) {
	// Single atomic swap of both mux and graphServer together.
	// This ensures consistency - both values change atomically.
	newState := &serverState{
		mux:         svr.mux,
		graphServer: svr,
	}
	oldState := s.state.Swap(newState)

	// Shutdown the old graph server if it exists.
	// On first startup, oldState.graphServer is nil.
	if oldState != nil && oldState.graphServer != nil {
		if err := oldState.graphServer.Shutdown(ctx); err != nil {
			s.logger.Error("Failed to shutdown old graph", zap.Error(err))
		}
	}
}

// listenAndServe starts the server using the pre-bound listener and blocks until shutdown.
// This method is called in a goroutine; the port was already bound in newServer().
func (s *server) listenAndServe() error {
	if s.httpServer.TLSConfig != nil {
		// Use TLS with the pre-bound listener
		if err := s.httpServer.ServeTLS(s.listener, "", ""); err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	} else {
		// Use plain HTTP with the pre-bound listener
		if err := s.httpServer.Serve(s.listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	}
	return nil
}

func (s *server) Shutdown(ctx context.Context) error {
	var err error

	// httpServer is not on the hot path, so we keep using the mutex for it
	s.mu.RLock()
	httpServer := s.httpServer
	s.mu.RUnlock()

	// Get current state and swap to notReadyState atomically
	// This ensures new requests get 503 immediately while we shut down
	oldState := s.state.Swap(notReadyState)

	if httpServer != nil {
		err = errors.Join(err, httpServer.Shutdown(ctx))
	}

	if oldState != nil && oldState.graphServer != nil {
		err = errors.Join(err, oldState.graphServer.Shutdown(ctx))
	}

	return err
}
