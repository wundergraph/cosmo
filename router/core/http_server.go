package core

import (
	"context"
	"crypto/tls"
	"errors"
	"github.com/wundergraph/cosmo/router/pkg/health"
	"go.uber.org/zap"
	"net/http"
	"sync"
	"time"
)

type httpServer struct {
	sync.Mutex
	httpServer  *http.Server
	tlsConfig   *TlsConfig
	logger      *zap.Logger
	handler     http.Handler
	healthcheck health.Checker
	baseURL     string
	graphServer *graphServer
}

type httpServerOptions struct {
	addr            string
	logger          *zap.Logger
	tlsConfig       *TlsConfig
	tlsServerConfig *tls.Config
	healthcheck     health.Checker
	baseURL         string
}

func newHttpServer(opts *httpServerOptions) *httpServer {
	server := &http.Server{
		Addr: opts.addr,
		// https://ieftimov.com/posts/make-resilient-golang-net-http-servers-using-timeouts-deadlines-context-cancellation/
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		ReadHeaderTimeout: 20 * time.Second,
		ErrorLog:          zap.NewStdLog(opts.logger),
		TLSConfig:         opts.tlsServerConfig,
	}

	n := &httpServer{
		httpServer:  server,
		tlsConfig:   opts.tlsConfig,
		logger:      opts.logger,
		Mutex:       sync.Mutex{},
		healthcheck: opts.healthcheck,
		baseURL:     opts.baseURL,
	}

	server.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n.handler.ServeHTTP(w, r)
	})

	return n
}

func (s *httpServer) HealthChecks() health.Checker {
	return s.healthcheck
}

func (s *httpServer) HttpServer() *http.Server {
	return s.httpServer
}

func (s *httpServer) BaseURL() string {
	return s.baseURL
}

func (s *httpServer) shutdownGraphServer(ctx context.Context) error {

	if s.handler == nil {
		return nil
	}

	return s.graphServer.Shutdown(ctx)
}

// SwapGraphServer swaps the current graph server with a new one. It will shut down the old server gracefully.
// Because we swap the handler immediately, we can guarantee that no new requests will be served by the old graph server.
// However, it is possible that there are still requests in flight that are being processed by the old graph server.
// We wait until all requests are processed or timeout before shutting down the old graph server forcefully.
// Websocket connections are closed after shutdown through context cancellation.
func (s *httpServer) SwapGraphServer(ctx context.Context, svr *graphServer) {
	s.graphServer = svr

	if s.handler != nil {
		if err := s.shutdownGraphServer(ctx); err != nil {
			s.logger.Error("Failed to shutdown old graph", zap.Error(err))
		}
	}

	s.Lock()
	s.handler = svr.mux
	s.Unlock()
}

// listenAndServe starts the server and blocks until the server is shutdown.
func (s *httpServer) listenAndServe() error {
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

func (s *httpServer) Shutdown(ctx context.Context) error {
	var err error

	if s.graphServer != nil {
		err = errors.Join(s.shutdownGraphServer(ctx))
	}
	if s.httpServer != nil {
		if err := s.httpServer.Shutdown(ctx); err != nil {
			err = errors.Join(err)
		}
	}

	s.graphServer = nil
	s.handler = nil

	return err
}
