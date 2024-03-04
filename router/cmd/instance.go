package cmd

import (
	"fmt"

	"github.com/wundergraph/cosmo/router/internal/cdn"
	"github.com/wundergraph/cosmo/router/internal/controlplane/configpoller"
	"github.com/wundergraph/cosmo/router/internal/controlplane/selfregister"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/cors"
	"github.com/wundergraph/cosmo/router/pkg/metric"
	"github.com/wundergraph/cosmo/router/pkg/trace"
	"go.uber.org/automaxprocs/maxprocs"

	"github.com/wundergraph/cosmo/router/core"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"go.uber.org/zap"
)

// Params are all required for the router to start up
type Params struct {
	Config *config.Config
	Logger *zap.Logger
}

// NewRouter creates a new router instance.
//
// additionalOptions can be used to override default options or options provided in the config.
func NewRouter(params Params, additionalOptions ...core.Option) (*core.Router, error) {
	// Automatically set GOMAXPROCS to avoid CPU throttling on containerized environments
	_, err := maxprocs.Set(maxprocs.Logger(params.Logger.Sugar().Debugf))
	if err != nil {
		return nil, fmt.Errorf("could not set max GOMAXPROCS: %w", err)
	}

	var routerConfig *nodev1.RouterConfig
	var configPoller configpoller.ConfigPoller
	var selfRegister selfregister.SelfRegister

	cfg := params.Config
	logger := params.Logger

	if cfg.RouterConfigPath != "" {
		routerConfig, err = core.SerializeConfigFromFile(cfg.RouterConfigPath)
		if err != nil {
			logger.Fatal("Could not read router config", zap.Error(err), zap.String("path", cfg.RouterConfigPath))
		}
	} else if cfg.Graph.Token != "" {
		routerCDN, err := cdn.NewRouterConfigClient(cfg.CDN.URL, cfg.Graph.Token, cdn.PersistentOperationsOptions{
			CacheSize: cfg.CDN.CacheSize.Uint64(),
			Logger:    logger,
		})
		if err != nil {
			return nil, err
		}

		configPoller = configpoller.New(cfg.ControlplaneURL, cfg.Graph.Token,
			configpoller.WithLogger(logger),
			configpoller.WithPollInterval(cfg.PollInterval),
			configpoller.WithCDNClient(routerCDN),
		)
	}

	if cfg.RouterRegistration && cfg.Graph.Token != "" {
		selfRegister = selfregister.New(cfg.ControlplaneURL, cfg.Graph.Token,
			selfregister.WithLogger(logger),
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

	options := []core.Option{
		core.WithListenerAddr(cfg.ListenAddr),
		core.WithOverrideRoutingURL(cfg.OverrideRoutingURL),
		core.WithLogger(logger),
		core.WithConfigPoller(configPoller),
		core.WithSelfRegistration(selfRegister),
		core.WithIntrospection(cfg.IntrospectionEnabled),
		core.WithPlayground(cfg.PlaygroundEnabled),
		core.WithGraphApiToken(cfg.Graph.Token),
		core.WithGraphQLPath(cfg.GraphQLPath),
		core.WithModulesConfig(cfg.Modules),
		core.WithGracePeriod(cfg.GracePeriod),
		core.WithPlaygroundPath(cfg.PlaygroundPath),
		core.WithHealthCheckPath(cfg.HealthCheckPath),
		core.WithLivenessCheckPath(cfg.LivenessCheckPath),
		core.WithGraphQLMetrics(&core.GraphQLMetricsConfig{
			Enabled:           cfg.GraphqlMetrics.Enabled,
			CollectorEndpoint: cfg.GraphqlMetrics.CollectorEndpoint,
		}),
		core.WithAnonymization(&core.IPAnonymizationConfig{
			Enabled: cfg.Compliance.AnonymizeIP.Enabled,
			Method:  core.IPAnonymizationMethod(cfg.Compliance.AnonymizeIP.Method),
		}),
		core.WithClusterName(cfg.Cluster.Name),
		core.WithInstanceID(cfg.InstanceID),
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
		core.WithTLSConfig(&core.TlsConfig{
			Enabled:  cfg.TLS.Server.Enabled,
			CertFile: cfg.TLS.Server.CertFile,
			KeyFile:  cfg.TLS.Server.KeyFile,
		}),
		core.WithDevelopmentMode(cfg.DevelopmentMode),
		core.WithTracing(traceConfig(&cfg.Telemetry)),
		core.WithMetrics(metricsConfig(&cfg.Telemetry)),
		core.WithEngineExecutionConfig(cfg.EngineExecutionConfiguration),
		core.WithAuthorizationConfig(&cfg.Authorization),
		core.WithAccessController(core.NewAccessController(authenticators, cfg.Authorization.RequireAuthentication)),
		core.WithWebSocketConfiguration(&cfg.WebSocket),
		core.WithLocalhostFallbackInsideDocker(cfg.LocalhostFallbackInsideDocker),
		core.WithCDN(cfg.CDN),
		core.WithEvents(cfg.Events),
		core.WithRateLimitConfig(&cfg.RateLimit),
	}

	options = append(options, additionalOptions...)

	return core.NewRouter(options...)
}

func traceConfig(cfg *config.Telemetry) *trace.Config {
	var exporters []*trace.Exporter
	for _, exp := range cfg.Tracing.Exporters {
		exporters = append(exporters, &trace.Exporter{
			Disabled:      exp.Disabled,
			Endpoint:      exp.Endpoint,
			Exporter:      exp.Exporter,
			BatchTimeout:  exp.BatchTimeout,
			ExportTimeout: exp.ExportTimeout,
			Headers:       exp.Headers,
			HTTPPath:      exp.HTTPPath,
		})
	}

	var propagators []trace.Propagator

	if cfg.Tracing.Propagation.TraceContext {
		propagators = append(propagators, trace.PropagatorTraceContext)
	}
	if cfg.Tracing.Propagation.B3 {
		propagators = append(propagators, trace.PropagatorB3)
	}
	if cfg.Tracing.Propagation.Jaeger {
		propagators = append(propagators, trace.PropagatorJaeger)
	}
	if cfg.Tracing.Propagation.Baggage {
		propagators = append(propagators, trace.PropagatorBaggage)
	}

	return &trace.Config{
		Enabled:     cfg.Tracing.Enabled,
		Name:        cfg.ServiceName,
		Version:     core.Version,
		Sampler:     cfg.Tracing.SamplingRate,
		WithNewRoot: cfg.Tracing.WithNewRoot,
		ExportGraphQLVariables: trace.ExportGraphQLVariables{
			Enabled: cfg.Tracing.ExportGraphQLVariables,
		},
		Exporters:   exporters,
		Propagators: propagators,
	}
}

func metricsConfig(cfg *config.Telemetry) *metric.Config {
	var openTelemetryExporters []*metric.OpenTelemetryExporter
	for _, exp := range cfg.Metrics.OTLP.Exporters {
		openTelemetryExporters = append(openTelemetryExporters, &metric.OpenTelemetryExporter{
			Disabled: exp.Disabled,
			Endpoint: exp.Endpoint,
			Exporter: exp.Exporter,
			Headers:  exp.Headers,
			HTTPPath: exp.HTTPPath,
		})
	}

	return &metric.Config{
		Name:    cfg.ServiceName,
		Version: core.Version,
		OpenTelemetry: metric.OpenTelemetry{
			Enabled:       cfg.Metrics.OTLP.Enabled,
			RouterRuntime: cfg.Metrics.OTLP.RouterRuntime,
			Exporters:     openTelemetryExporters,
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
