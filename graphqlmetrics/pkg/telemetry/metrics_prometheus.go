package telemetry

import (
	"context"
	"net/http"
	"time"

	"connectrpc.com/connect"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"

	sdkresource "go.opentelemetry.io/otel/sdk/resource"
	semconv "go.opentelemetry.io/otel/semconv/v1.17.0"
	"go.uber.org/zap"

	otelprom "go.opentelemetry.io/otel/exporters/prometheus"
)

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

func (c *Config) initializeCustomMetrics() {
	c.CustomMetrics.MetricsServiceAccessCounter = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "graphqlmetrics_http_requests_total",
			Help: "Total number of times an endpoint was accessed.",
		},
		[]string{Endpoint},
	)
}

func (c *Config) NewPrometheusMeterProvider(ctx context.Context) (*sdkmetric.MeterProvider, *prometheus.Registry, error) {
	var registry *prometheus.Registry

	if c.Prometheus.TestRegistry != nil {
		registry = c.Prometheus.TestRegistry
	} else {
		registry = prometheus.NewRegistry()
	}

	c.initializeCustomMetrics()

	// Default go process metrics
	registry.MustRegister(collectors.NewGoCollector())
	// Only available on Linux and Windows systems
	registry.MustRegister(collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))
	// Counter for how often the metrics service was called
	registry.MustRegister(c.CustomMetrics.MetricsServiceAccessCounter)

	promExporter, err := otelprom.New(
		otelprom.WithoutUnits(),
		otelprom.WithRegisterer(registry),
	)

	if err != nil {
		return nil, nil, err
	}

	resource, err := sdkresource.New(
		ctx,
		sdkresource.WithTelemetrySDK(),
		sdkresource.WithProcessPID(),
		sdkresource.WithOSType(),
		sdkresource.WithHost(),
		// sdkresource.WithSchemaURL(semconv.SchemaURL),
		sdkresource.WithAttributes(
			semconv.ServiceVersionKey.String(c.Version),
			semconv.ServiceNameKey.String(c.Name),
		),
	)

	if err != nil {
		return nil, nil, err
	}

	mp := sdkmetric.NewMeterProvider(
		sdkmetric.WithReader(promExporter),
		sdkmetric.WithResource(resource),
	)

	return mp, registry, nil
}

func (c *Config) PrometheusUnaryInterceptor() connect.UnaryInterceptorFunc {
	return connect.UnaryInterceptorFunc(
		func(next connect.UnaryFunc) connect.UnaryFunc {
			return connect.UnaryFunc(func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
				res, err := next(ctx, req)

				c.CustomMetrics.MetricsServiceAccessCounter.With(prometheus.Labels{
					Endpoint: req.Peer().Addr,
				}).Inc()
				return res, err
			})
		},
	)
}
