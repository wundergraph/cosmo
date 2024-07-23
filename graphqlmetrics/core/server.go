package core

import (
	"context"
	"errors"
	"github.com/wundergraph/cosmo/graphqlmetrics/gen/proto/wg/cosmo/graphqlmetrics/v1/graphqlmetricsv1connect"
	"go.uber.org/zap"
	brotli "go.withmatt.com/connect-brotli"
	"net/http"
	"time"
)

// Option defines the method to customize Server.
type Option func(s *Server)

type Server struct {
	server         *http.Server
	listenAddr     string
	logger         *zap.Logger
	jwtSecret      []byte
	metricsService graphqlmetricsv1connect.GraphQLMetricsServiceHandler

	metricConfig *rmetric.Config
	instanceID   string

	prometheusServer *http.Server
}

func NewServer(metricsService graphqlmetricsv1connect.GraphQLMetricsServiceHandler, opts ...Option) *Server {
	ctx := context.Background()
	s := &Server{
		metricsService: metricsService,
		listenAddr:     ":4005",
		logger:         zap.NewNop(),
	}

	for _, opt := range opts {
		opt(s)
	}

	s.bootstrap(ctx)

	return s
}

func (s *Server) bootstrap(ctx context.Context) {
	mux := http.NewServeMux()
	path, handler := graphqlmetricsv1connect.NewGraphQLMetricsServiceHandler(
		s.metricsService,
		// Brotli compression support.
		brotli.WithCompression(),
	)
	mux.Handle("/health", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	mux.Handle(path, authenticate(s.jwtSecret, s.logger, handler))

	s.server = &http.Server{
		Addr: s.listenAddr,
		// https://ieftimov.com/posts/make-resilient-golang-net-http-servers-using-timeouts-deadlines-context-cancellation/
		ReadTimeout:       1 * time.Minute,
		WriteTimeout:      2 * time.Minute,
		ReadHeaderTimeout: 20 * time.Second,
		Handler:           mux,
		ErrorLog:          zap.NewStdLog(s.logger),
	}

	if s.metricConfig.Prometheus.Enabled {
		s.instanceID = "graphqlmetrics"
		_, registry, err := rmetric.NewPrometheusMeterProvider(ctx, rmetric.DefaultConfig("dev"), s.instanceID)
		if err != nil {
			panic(fmt.Errorf("failed to create Prometheus exporter: %w", err))
		}

		s.prometheusServer = rmetric.NewPrometheusServer(s.logger, s.metricConfig.Prometheus.ListenAddr, s.metricConfig.Prometheus.Path, registry)
		go func() {
			if err := s.prometheusServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				s.logger.Error("Failed to start Prometheus server", zap.Error(err))
			}
		}()
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

func WithJwtSecret(secret []byte) Option {
	return func(s *Server) {
		s.jwtSecret = secret
	}
}

func WithMetrics(cfg *rmetric.Config) Option {
	return func(s *Server) {
		s.metricConfig = cfg
	}
}
