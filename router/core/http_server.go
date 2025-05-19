package core

import (
	"context"
	"crypto/tls"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/pkg/health"
)

type server struct {
	mu          sync.RWMutex
	httpServer  *http.Server
	tlsConfig   *TlsConfig
	logger      *zap.Logger
	handler     http.Handler
	healthcheck health.Checker
	baseURL     string
	graphServer *graphServer
}

type httpServerOptions struct {
	addr               string
	logger             *zap.Logger
	tlsConfig          *TlsConfig
	tlsServerConfig    *tls.Config
	healthcheck        health.Checker
	baseURL            string
	maxHeaderBytes     int
	livenessCheckPath  string
	readinessCheckPath string
	healthCheckPath    string
}

func newServer(opts *httpServerOptions) *server {
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
		tlsConfig:   opts.tlsConfig,
		logger:      opts.logger,
		mu:          sync.RWMutex{},
		healthcheck: opts.healthcheck,
		baseURL:     opts.baseURL,
		handler:     httpRouter,
	}

	httpServer.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Multiple requests can read the handler at the same time, but only one goroutine can write it.
		// When swapping the graph server there might be in-flight requests that are still being processed
		// but this is tolerable because we are waiting for them to finish before shutting down the old server.
		n.mu.RLock()
		handler := n.handler
		n.mu.RUnlock()

		handler.ServeHTTP(w, r)
	})

	return n
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
	s.mu.RLock()
	needsShutdown := s.handler != nil && s.graphServer != nil
	s.mu.RUnlock()

	// Swap the handler immediately, so we can shut down the old server in the same goroutine
	// and no other config changes can happen in the meantime.
	s.mu.Lock()
	s.handler = svr.mux
	s.mu.Unlock()

	// If the graph server is nil, we don't need to shutdown anything
	// This is the case when the router is starting for the first time
	if needsShutdown {
		if err := s.graphServer.Shutdown(ctx); err != nil {
			s.logger.Error("Failed to shutdown old graph", zap.Error(err))
		}
	}

	// Swap the graph server
	s.mu.Lock()
	s.graphServer = svr
	s.mu.Unlock()
}

// listenAndServe starts the server and blocks until the server is shutdown.
func (s *server) listenAndServe() error {
	if s.tlsConfig != nil && s.tlsConfig.Enabled {
		// Leave the cert and key empty to use the default ones
		if err := s.httpServer.ListenAndServeTLS("", ""); err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	} else {
		if err := s.httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	}
	return nil
}

func (s *server) Shutdown(ctx context.Context) error {
	var err error

	s.mu.RLock()

	httpServer := s.httpServer
	graphServer := s.graphServer

	s.mu.RUnlock()

	if httpServer != nil {
		err = errors.Join(err, httpServer.Shutdown(ctx))
	}

	if graphServer != nil {
		err = errors.Join(err, graphServer.Shutdown(ctx))
	}

	s.mu.Lock()
	s.graphServer = nil
	s.handler = nil
	s.mu.Unlock()

	return err
}
