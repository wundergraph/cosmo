package cmd

import (
	"fmt"

	_ "go.uber.org/automaxprocs" // Automatically set GOMAXPROCS to avoid CPU throttling on containerized environments

	"github.com/wundergraph/cosmo/router/authentication"
	"github.com/wundergraph/cosmo/router/config"
	"github.com/wundergraph/cosmo/router/core"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/internal/controlplane"
	"github.com/wundergraph/cosmo/router/internal/handler/cors"
	"github.com/wundergraph/cosmo/router/internal/metric"
	"github.com/wundergraph/cosmo/router/internal/trace"
	"go.uber.org/zap"
)

type Params struct {
	Config *config.Config
	Logger *zap.Logger
}

func NewRouter(params Params) (*core.Router, error) {
	var routerConfig *nodev1.RouterConfig
	var err error
	var cp controlplane.ConfigFetcher

	cfg := params.Config
	logger := params.Logger

	if cfg.RouterConfigPath != "" {
		routerConfig, err = core.SerializeConfigFromFile(cfg.RouterConfigPath)
		if err != nil {
			logger.Fatal("Could not read router config", zap.Error(err), zap.String("path", cfg.RouterConfigPath))
		}

		if cfg.Graph.Token == "" {
			logger.Warn("Static router config file provided, but no graph token. Disabling schema usage tracking, thus breaking change detection. Not recommended for production use.")
			cfg.GraphqlMetrics.Enabled = false

			// Only disable default tracing and metrics if no custom OTLP exporter is configured
			if cfg.Telemetry.Tracing.Enabled && len(cfg.Telemetry.Tracing.Exporters) == 0 {
				cfg.Telemetry.Tracing.Enabled = false
			}
			if cfg.Telemetry.Metrics.OTLP.Enabled && len(cfg.Telemetry.Metrics.OTLP.Exporters) == 0 {
				cfg.Telemetry.Metrics.OTLP.Enabled = false
			}

			// Show warning when no custom OTLP exporter is configured and default tracing/metrics are disabled
			// due to missing graph token
			if !cfg.Telemetry.Tracing.Enabled && len(cfg.Telemetry.Tracing.Exporters) == 0 {
				logger.Warn("Static router config file provided, but no graph token. Disabling default tracing. Not recommended for production use.")
			}
			if !cfg.Telemetry.Metrics.OTLP.Enabled && len(cfg.Telemetry.Metrics.OTLP.Exporters) == 0 {
				logger.Warn("Static router config file provided, but no graph token. Disabling default OTLP metrics. Not recommended for production use.")
			}
		}
	} else {
		cp = controlplane.New(
			controlplane.WithControlPlaneEndpoint(cfg.ControlplaneURL),
			controlplane.WithFederatedGraph(cfg.Graph.Name),
			controlplane.WithLogger(logger),
			controlplane.WithGraphApiToken(cfg.Graph.Token),
			controlplane.WithPollInterval(cfg.PollInterval),
		)
	}

	var authenticators []authentication.Authenticator
	for i, auth := range cfg.Authentication.Providers {
		if auth.JWKS != nil {
			name := auth.Name
			if name == "" {
				name = fmt.Sprintf("jwks-#%d", i)
			}
			opts := authentication.JWKSAuthenticatorOptions{
				Name:                name,
				URL:                 auth.JWKS.URL,
				HeaderNames:         auth.JWKS.HeaderNames,
				HeaderValuePrefixes: auth.JWKS.HeaderValuePrefixes,
				RefreshInterval:     auth.JWKS.RefreshInterval,
			}
			authenticator, err := authentication.NewJWKSAuthenticator(opts)
			if err != nil {
				logger.Fatal("Could not create JWKS authenticator", zap.Error(err), zap.String("name", name))
			}
			authenticators = append(authenticators, authenticator)
		}
	}

	return core.NewRouter(
		core.WithFederatedGraphName(cfg.Graph.Name),
		core.WithListenerAddr(cfg.ListenAddr),
		core.WithOverrideRoutingURL(cfg.OverrideRoutingURL),
		core.WithLogger(logger),
		core.WithConfigFetcher(cp),
		core.WithIntrospection(cfg.IntrospectionEnabled),
		core.WithPlayground(cfg.PlaygroundEnabled),
		core.WithGraphApiToken(cfg.Graph.Token),
		core.WithGraphQLPath(cfg.GraphQLPath),
		core.WithModulesConfig(cfg.Modules),
		core.WithGracePeriod(cfg.GracePeriod),
		core.WithHealthCheckPath(cfg.HealthCheckPath),
		core.WithLivenessCheckPath(cfg.LivenessCheckPath),
		core.WithGraphQLMetrics(&core.GraphQLMetricsConfig{
			Enabled:           cfg.GraphqlMetrics.Enabled,
			CollectorEndpoint: cfg.GraphqlMetrics.CollectorEndpoint,
		}),
		core.WithReadinessCheckPath(cfg.ReadinessCheckPath),
		core.WithHeaderRules(cfg.Headers),
		core.WithStaticRouterConfig(routerConfig),
		core.WithRouterTrafficConfig(&cfg.TrafficShaping.Router),
		core.WithSubgraphTransportOptions(&core.SubgraphTransportOptions{
			RequestTimeout:         cfg.TrafficShaping.All.RequestTimeout,
			ResponseHeaderTimeout:  cfg.TrafficShaping.All.ResponseHeaderTimeout,
			ExpectContinueTimeout:  cfg.TrafficShaping.All.ExpectContinueTimeout,
			KeepAliveIdleTimeout:   cfg.TrafficShaping.All.KeepAliveIdleTimeout,
			DialTimeout:            cfg.TrafficShaping.All.DialTimeout,
			TLSHandshakeTimeout:    cfg.TrafficShaping.All.TLSHandshakeTimeout,
			KeepAliveProbeInterval: cfg.TrafficShaping.All.KeepAliveProbeInterval,
		}),
		core.WithSubgraphRetryOptions(
			cfg.TrafficShaping.All.BackoffJitterRetry.Enabled,
			cfg.TrafficShaping.All.BackoffJitterRetry.MaxAttempts,
			cfg.TrafficShaping.All.BackoffJitterRetry.MaxDuration,
			cfg.TrafficShaping.All.BackoffJitterRetry.Interval,
		),
		core.WithCors(&cors.Config{
			AllowOrigins:     cfg.CORS.AllowOrigins,
			AllowMethods:     cfg.CORS.AllowMethods,
			AllowCredentials: cfg.CORS.AllowCredentials,
			AllowHeaders:     cfg.CORS.AllowHeaders,
			MaxAge:           cfg.CORS.MaxAge,
		}),
		core.WithTracing(traceConfig(&cfg.Telemetry)),
		core.WithMetrics(metricsConfig(&cfg.Telemetry)),
		core.WithEngineExecutionConfig(cfg.EngineExecutionConfiguration),
		core.WithAccessController(core.NewAccessController(authenticators, cfg.Authorization.RequireAuthentication)),
		core.WithLocalhostFallbackInsideDocker(cfg.LocalhostFallbackInsideDocker),
		core.WithCDNURL(cfg.CDN.URL),
	)
}

func traceConfig(cfg *config.Telemetry) *trace.Config {
	var exporters []*trace.Exporter
	for _, exp := range cfg.Tracing.Exporters {
		exporters = append(exporters, &trace.Exporter{
			Endpoint:      exp.Endpoint,
			Exporter:      exp.Exporter,
			BatchTimeout:  exp.BatchTimeout,
			ExportTimeout: exp.ExportTimeout,
			Headers:       exp.Headers,
			HTTPPath:      exp.HTTPPath,
		})
	}
	return &trace.Config{
		Enabled:   cfg.Tracing.Enabled,
		Name:      cfg.ServiceName,
		Sampler:   cfg.Tracing.SamplingRate,
		Exporters: exporters,
	}
}

func metricsConfig(cfg *config.Telemetry) *metric.Config {
	var openTelemetryExporters []*metric.OpenTelemetryExporter
	for _, exp := range cfg.Metrics.OTLP.Exporters {
		openTelemetryExporters = append(openTelemetryExporters, &metric.OpenTelemetryExporter{
			Endpoint: exp.Endpoint,
			Exporter: exp.Exporter,
			Headers:  exp.Headers,
			HTTPPath: exp.HTTPPath,
		})
	}

	return &metric.Config{
		Name: cfg.ServiceName,
		OpenTelemetry: metric.OpenTelemetry{
			Enabled:   cfg.Metrics.OTLP.Enabled,
			Exporters: openTelemetryExporters,
		},
		Prometheus: metric.Prometheus{
			Enabled:             cfg.Metrics.Prometheus.Enabled,
			ListenAddr:          cfg.Metrics.Prometheus.ListenAddr,
			Path:                cfg.Metrics.Prometheus.Path,
			ExcludeMetrics:      cfg.Metrics.Prometheus.ExcludeMetrics,
			ExcludeMetricLabels: cfg.Metrics.Prometheus.ExcludeMetricLabels,
		},
	}
}
