package core

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"github.com/wundergraph/cosmo/router/pkg/health"
	"go.uber.org/zap"
	"net"
	"net/http"
	"sync"
	"time"
)

type httpServer struct {
	mu          sync.Mutex
	httpServer  *http.Server
	tlsConfig   *TlsConfig
	logger      *zap.Logger
	handler     http.Handler
	healthcheck health.Checker
	baseURL     string
}

type httpServerOptions struct {
	addr            string
	logger          *zap.Logger
	tlsConfig       *TlsConfig
	tlsServerConfig *tls.Config
	handler         http.Handler
	healthcheck     health.Checker
	baseURL         string
}

func newHttpServer(opts *httpServerOptions) *httpServer {
	s := &http.Server{
		Addr: opts.addr,
		// https://ieftimov.com/posts/make-resilient-golang-net-http-servers-using-timeouts-deadlines-context-cancellation/
		ReadTimeout:       1 * time.Minute,
		WriteTimeout:      2 * time.Minute,
		ReadHeaderTimeout: 20 * time.Second,
		ErrorLog:          zap.NewStdLog(opts.logger),
		TLSConfig:         opts.tlsServerConfig,
	}

	n := &httpServer{
		httpServer:  s,
		tlsConfig:   opts.tlsConfig,
		logger:      opts.logger,
		mu:          sync.Mutex{},
		healthcheck: opts.healthcheck,
		baseURL:     opts.baseURL,
	}

	s.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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

func (s *httpServer) ListenAndServe() error {
	return s.listenAndServe()
}

func (s *httpServer) SwapHandler(handler http.Handler) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.httpServer.ConnState = func(conn net.Conn, state http.ConnState) {
		fmt.Println("Connection state changed to: ", state)
	}

	s.httpServer.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handler.ServeHTTP(w, r)
	})
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
	if s.httpServer != nil {
		return s.httpServer.Shutdown(ctx)
	}
	return nil
}
