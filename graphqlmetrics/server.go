package graphqlmetrics

import (
	"context"
	"errors"
	"github.com/wundergraph/cosmo/graphqlmetrics/gen/proto/wg/cosmo/graphqlmetrics/v1/graphqlmetricsv1connect"
	"go.uber.org/zap"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
	"net/http"
	"time"
)

// Option defines the method to customize Server.
type Option func(s *Server)

type Server struct {
	server     *http.Server
	listenAddr string
	logger     *zap.Logger

	metricsService graphqlmetricsv1connect.GraphQLMetricsServiceHandler
}

func NewServer(metricsService graphqlmetricsv1connect.GraphQLMetricsServiceHandler, opts ...Option) *Server {
	s := &Server{
		metricsService: metricsService,
		listenAddr:     ":4005",
		logger:         zap.NewNop(),
	}

	for _, opt := range opts {
		opt(s)
	}

	s.bootstrap()

	return s
}

func (s *Server) bootstrap() {
	mux := http.NewServeMux()
	path, handler := graphqlmetricsv1connect.NewGraphQLMetricsServiceHandler(s.metricsService)
	mux.Handle(path, handler)

	s.server = &http.Server{
		Addr: s.listenAddr,
		// https://ieftimov.com/posts/make-resilient-golang-net-http-servers-using-timeouts-deadlines-context-cancellation/
		ReadTimeout:       1 * time.Minute,
		WriteTimeout:      2 * time.Minute,
		ReadHeaderTimeout: 20 * time.Second,
		// Use h2c so we can serve HTTP/2 without TLS.
		Handler:  h2c.NewHandler(mux, &http2.Server{}),
		ErrorLog: zap.NewStdLog(s.logger),
	}
}

func (s *Server) Start() error {
	if s.server == nil {
		return errors.New("server not initialized")
	}

	if err := s.server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}

	return nil
}

func (s *Server) Shutdown(ctx context.Context) error {
	if s.server == nil {
		return errors.New("server not initialized")
	}

	if err := s.server.Shutdown(ctx); err != nil {
		s.logger.Error("Could not shutdown server", zap.Error(err))
	}

	return nil
}

func WithLogger(logger *zap.Logger) Option {
	return func(s *Server) {
		s.logger = logger
	}
}

func WithListenAddr(addr string) Option {
	return func(s *Server) {
		s.listenAddr = addr
	}
}
