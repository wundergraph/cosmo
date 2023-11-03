package cmd

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/wundergraph/cosmo/router/authentication"
	"github.com/wundergraph/cosmo/router/config"
	"github.com/wundergraph/cosmo/router/core"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/internal/controlplane"
	"github.com/wundergraph/cosmo/router/internal/handler/cors"
	"github.com/wundergraph/cosmo/router/internal/metric"
	"github.com/wundergraph/cosmo/router/internal/trace"

	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/internal/logging"
)

func Main() {
	var overrideEnv string
	flag.StringVar(&overrideEnv, "override-env", "", "env file name to override env variables")
	flag.Parse()

	cfg, err := config.LoadConfig(overrideEnv)
	if err != nil {
		log.Fatal("Could not load config", zap.Error(err))
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt,
		syscall.SIGHUP,  // process is detached from terminal
		syscall.SIGTERM, // default for kill
		syscall.SIGKILL,
		syscall.SIGQUIT, // ctrl + \
		syscall.SIGINT,  // ctrl+c
	)
	defer stop()

	logLevel, err := logging.ZapLogLevelFromString(cfg.LogLevel)
	if err != nil {
		log.Fatal("Could not parse log level", zap.Error(err))
	}

	logger := logging.New(!cfg.JSONLog, cfg.LogLevel == "debug", logLevel).
		With(
			zap.String("component", "@wundergraph/router"),
			zap.String("service_version", core.Version),
		)

	cp := controlplane.New(
		controlplane.WithControlPlaneEndpoint(cfg.ControlplaneURL),
		controlplane.WithFederatedGraph(cfg.Graph.Name),
		controlplane.WithLogger(logger),
		controlplane.WithGraphApiToken(cfg.Graph.Token),
		controlplane.WithPollInterval(cfg.PollInterval),
	)

	var routerConfig *nodev1.RouterConfig

	if cfg.RouterConfigPath != "" {
		routerConfig, err = core.SerializeConfigFromFile(cfg.RouterConfigPath)
		if err != nil {
			logger.Fatal("Could not read router config", zap.Error(err), zap.String("path", cfg.RouterConfigPath))
		}
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

	router, err := core.NewRouter(
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
		core.WithTranslateLocalhostInsideDocker(cfg.TranslateLocalhostInsideDocker),
	)

	if err != nil {
		logger.Fatal("Could not create app", zap.Error(err))
	}

	go func() {
		if err := router.Start(ctx); err != nil {
			logger.Error("Could not start server", zap.Error(err))
			stop()
		}
	}()

	<-ctx.Done()

	logger.Info("Graceful shutdown ...", zap.String("shutdown_delay", cfg.ShutdownDelay.String()))

	// enforce a maximum shutdown delay
	ctx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownDelay)
	defer cancel()

	if err := router.Shutdown(ctx); err != nil {
		logger.Error("Could not shutdown server", zap.Error(err))
	}

	logger.Debug("Server exiting")
	os.Exit(0)
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
