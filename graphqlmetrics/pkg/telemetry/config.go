package telemetry

import (
	"net/http"
	"regexp"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.opentelemetry.io/otel/attribute"
	"go.uber.org/zap"
)

const (
	DefaultServerName = "cosmo-graphqlmetrics"
	serviceVersion    = "dev"
)

// NewTelemetryConfig creates a rmetric.Config without the OTEL export enabled
// this is done to reuse the config from the cosmo-router which is already
// implementing OTEL data
func NewTelemetryConfig(prometheusConfig PrometheusConfig) *Config {
	return &Config{
		Name:       DefaultServerName,
		Version:    serviceVersion,
		Prometheus: prometheusConfig,
	}
}

type OpenTelemetry struct {
	Enabled bool
}

// Config represents the configuration for the agent.
type Config struct {
	// Name represents the service name for metrics. The default value is cosmo-router.
	Name string

	// Version represents the service version for metrics. The default value is dev.
	Version string

	// OpenTelemetry includes the OpenTelemetry configuration
	OpenTelemetry OpenTelemetry

	// Prometheus includes the Prometheus configuration
	Prometheus PrometheusConfig

	// AttributesMapper added to the global attributes for all metrics.
	AttributesMapper func(req *http.Request) []attribute.KeyValue

	// ResourceAttributes added to the global resource attributes for all metrics.
	ResourceAttributes []attribute.KeyValue
}

type PrometheusConfig struct {
	Enabled    bool
	ListenAddr string
	Path       string
	// Metrics to exclude from Prometheus exporter
	ExcludeMetrics []*regexp.Regexp
	// Metric labels to exclude from Prometheus exporter
	ExcludeMetricLabels []*regexp.Regexp
	// TestRegistry is used for testing purposes. If set, the registry will be used instead of the default one.
	TestRegistry *prometheus.Registry
}

func (c *Config) IsEnabled() bool {
	return c.Prometheus.Enabled
}

func NewPrometheusServer(logger *zap.Logger, listenAddr string, path string, registry *prometheus.Registry) *http.Server {
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Handle(path, promhttp.HandlerFor(registry, promhttp.HandlerOpts{
		EnableOpenMetrics: true,
		ErrorLog:          zap.NewStdLog(logger),
		Registry:          registry,
		Timeout:           10 * time.Second,
	}))

	svr := &http.Server{
		Addr:              listenAddr,
		ReadTimeout:       1 * time.Minute,
		WriteTimeout:      1 * time.Minute,
		ReadHeaderTimeout: 2 * time.Second,
		IdleTimeout:       30 * time.Second,
		ErrorLog:          zap.NewStdLog(logger),
		Handler:           r,
	}

	logger.Info("Prometheus metrics enabled", zap.String("listen_addr", svr.Addr), zap.String("endpoint", path))

	return svr
}
