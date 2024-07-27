package core

import (
	"context"
	"errors"
	"github.com/wundergraph/cosmo/graphqlmetrics/gen/proto/wg/cosmo/graphqlmetrics/v1/graphqlmetricsv1connect"
	"github.com/wundergraph/cosmo/graphqlmetrics/pkg/telemetry"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
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

	metricConfig     *telemetry.Config
	prometheusServer *http.Server
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

	path, handler := graphqlmetricsv1connect.NewGraphQLMetricsServiceHandler(
		s.metricsService,
		// Brotli compression support.
		brotli.WithCompression(),
	)
	healthHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	if s.metricConfig.OpenTelemetry.Enabled {
		tp, err := s.metricConfig.NewTracerProvider()
		if err != nil {
			s.logger.Error("Error creating tracing provider", zap.Error(err))
		}
		defer func() {
			if err := tp.Shutdown(context.Background()); err != nil {
				s.logger.Error("Error shutting down tracer provider", zap.Error(err))
			}
		}()
		handler = otelhttp.NewHandler(handler, "graphqlmetrics", otelhttp.WithTracerProvider(tp))
	}

	mux.Handle("/health", healthHandler)
	mux.Handle(path, authenticate(s.jwtSecret, s.logger, handler))

	if s.metricConfig.Prometheus.Enabled {
		mp, registry, err := s.metricConfig.NewPrometheusMeterProvider()
		if err != nil {
			s.logger.Error("Failed to create Prometheus exporter", zap.Error(err))
		}

		defer func() {
			if err := mp.Shutdown(context.Background()); err != nil {
				s.logger.Error("Error shutting down metrics provider", zap.Error(err))
			}
		}()

		s.prometheusServer = telemetry.NewPrometheusServer(s.logger, s.metricConfig.Prometheus.ListenAddr, s.metricConfig.Prometheus.Path, registry)
	}

	s.server = &http.Server{
		Addr: s.listenAddr,
		// https://ieftimov.com/posts/make-resilient-golang-net-http-servers-using-timeouts-deadlines-context-cancellation/
		ReadTimeout:       1 * time.Minute,
		WriteTimeout:      2 * time.Minute,
		ReadHeaderTimeout: 20 * time.Second,
		Handler:           mux,
		ErrorLog:          zap.NewStdLog(s.logger),
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

	if s.prometheusServer != nil {
		if err := s.shutdownPrometheusServer(ctx); err != nil {
			s.logger.Error("Could not shutdown prometheus server", zap.Error(err))
		}
	}

	return nil
}

func (s *Server) shutdownPrometheusServer(ctx context.Context) error {
	if s.prometheusServer == nil {
		return errors.New("prometheus server was not initialized")
	}

	if err := s.prometheusServer.Shutdown(ctx); err != nil {
		return err
	}

	return nil
}

func (s *Server) StartPrometheusServer() error {
	if s.prometheusServer == nil {
		return errors.New("prometheus server was not initialized")
	}

	if err := s.prometheusServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
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

func WithMetrics(cfg *telemetry.Config) Option {
	return func(s *Server) {
		s.metricConfig = cfg
	}
}
