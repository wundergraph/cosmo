package cmd

import (
	"fmt"

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

	logger := params.Logger

	if params.Config.RouterConfigPath != "" {
		routerConfig, err = core.SerializeConfigFromFile(params.Config.RouterConfigPath)
		if err != nil {
			logger.Fatal("Could not read router config", zap.Error(err), zap.String("path", params.Config.RouterConfigPath))
		}

		if params.Config.Graph.Token == "" {
			logger.Warn("Static router config file provided, but no graph token. Disabling schema usage tracking, thus breaking change detection. Not recommended for production use.")
			params.Config.GraphqlMetrics.Enabled = false

			// Only disable default tracing and metrics if no custom OTLP exporter is configured
			if params.Config.Telemetry.Tracing.Enabled && len(params.Config.Telemetry.Tracing.Exporters) == 0 {
				params.Config.Telemetry.Tracing.Enabled = false
			}
			if params.Config.Telemetry.Metrics.OTLP.Enabled && len(params.Config.Telemetry.Metrics.OTLP.Exporters) == 0 {
				params.Config.Telemetry.Metrics.OTLP.Enabled = false
			}

			// Show warning when no custom OTLP exporter is configured and default tracing/metrics are disabled
			// due to missing graph token
			if !params.Config.Telemetry.Tracing.Enabled && len(params.Config.Telemetry.Tracing.Exporters) == 0 {
				logger.Warn("Static router config file provided, but no graph token. Disabling default tracing. Not recommended for production use.")
			}
			if !params.Config.Telemetry.Metrics.OTLP.Enabled && len(params.Config.Telemetry.Metrics.OTLP.Exporters) == 0 {
				logger.Warn("Static router config file provided, but no graph token. Disabling default OTLP metrics. Not recommended for production use.")
			}
		}
	} else {
		cp = controlplane.New(
			controlplane.WithControlPlaneEndpoint(params.Config.ControlplaneURL),
			controlplane.WithFederatedGraph(params.Config.Graph.Name),
			controlplane.WithLogger(logger),
			controlplane.WithGraphApiToken(params.Config.Graph.Token),
			controlplane.WithPollInterval(params.Config.PollInterval),
		)
	}

	var authenticators []authentication.Authenticator
	for i, auth := range params.Config.Authentication.Providers {
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
		core.WithFederatedGraphName(params.Config.Graph.Name),
		core.WithListenerAddr(params.Config.ListenAddr),
		core.WithOverrideRoutingURL(params.Config.OverrideRoutingURL),
		core.WithLogger(logger),
		core.WithConfigFetcher(cp),
		core.WithIntrospection(params.Config.IntrospectionEnabled),
		core.WithPlayground(params.Config.PlaygroundEnabled),
		core.WithGraphApiToken(params.Config.Graph.Token),
		core.WithGraphQLPath(params.Config.GraphQLPath),
		core.WithModulesConfig(params.Config.Modules),
		core.WithGracePeriod(params.Config.GracePeriod),
		core.WithHealthCheckPath(params.Config.HealthCheckPath),
		core.WithLivenessCheckPath(params.Config.LivenessCheckPath),
		core.WithGraphQLMetrics(&core.GraphQLMetricsConfig{
			Enabled:           params.Config.GraphqlMetrics.Enabled,
			CollectorEndpoint: params.Config.GraphqlMetrics.CollectorEndpoint,
		}),
		core.WithReadinessCheckPath(params.Config.ReadinessCheckPath),
		core.WithHeaderRules(params.Config.Headers),
		core.WithStaticRouterConfig(routerConfig),
		core.WithRouterTrafficConfig(&params.Config.TrafficShaping.Router),
		core.WithSubgraphTransportOptions(&core.SubgraphTransportOptions{
			RequestTimeout:         params.Config.TrafficShaping.All.RequestTimeout,
			ResponseHeaderTimeout:  params.Config.TrafficShaping.All.ResponseHeaderTimeout,
			ExpectContinueTimeout:  params.Config.TrafficShaping.All.ExpectContinueTimeout,
			KeepAliveIdleTimeout:   params.Config.TrafficShaping.All.KeepAliveIdleTimeout,
			DialTimeout:            params.Config.TrafficShaping.All.DialTimeout,
			TLSHandshakeTimeout:    params.Config.TrafficShaping.All.TLSHandshakeTimeout,
			KeepAliveProbeInterval: params.Config.TrafficShaping.All.KeepAliveProbeInterval,
		}),
		core.WithSubgraphRetryOptions(
			params.Config.TrafficShaping.All.BackoffJitterRetry.Enabled,
			params.Config.TrafficShaping.All.BackoffJitterRetry.MaxAttempts,
			params.Config.TrafficShaping.All.BackoffJitterRetry.MaxDuration,
			params.Config.TrafficShaping.All.BackoffJitterRetry.Interval,
		),
		core.WithCors(&cors.Config{
			AllowOrigins:     params.Config.CORS.AllowOrigins,
			AllowMethods:     params.Config.CORS.AllowMethods,
			AllowCredentials: params.Config.CORS.AllowCredentials,
			AllowHeaders:     params.Config.CORS.AllowHeaders,
			MaxAge:           params.Config.CORS.MaxAge,
		}),
		core.WithTracing(traceConfig(&params.Config.Telemetry)),
		core.WithMetrics(metricsConfig(&params.Config.Telemetry)),
		core.WithEngineExecutionConfig(params.Config.EngineExecutionConfiguration),
		core.WithAccessController(core.NewAccessController(authenticators, params.Config.Authorization.RequireAuthentication)),
		core.WithLocalhostFallbackInsideDocker(params.Config.LocalhostFallbackInsideDocker),
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
