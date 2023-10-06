package cmd

import (
	"context"
	"flag"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

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
		With(zap.String("component", "@wundergraph/router"))

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

	router, err := core.NewRouter(
		core.WithFederatedGraphName(cfg.Graph.Name),
		core.WithListenerAddr(cfg.ListenAddr),
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
		core.WithReadinessCheckPath(cfg.ReadinessCheckPath),
		core.WithHeaderRules(cfg.Headers),
		core.WithStaticRouterConfig(routerConfig),
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
		core.WithTracing(&trace.Config{
			Enabled:       cfg.Telemetry.Tracing.Enabled,
			Name:          cfg.Telemetry.ServiceName,
			Endpoint:      cfg.Telemetry.Endpoint,
			Sampler:       cfg.Telemetry.Tracing.Config.SamplingRate,
			Batcher:       trace.KindOtlpHttp,
			BatchTimeout:  cfg.Telemetry.Tracing.Config.BatchTimeout,
			ExportTimeout: 30 * time.Second,
			OtlpHeaders:   cfg.Telemetry.Headers,
			OtlpHttpPath:  "/v1/traces",
		}),
		core.WithMetrics(&metric.Config{
			Enabled:     cfg.Telemetry.Metrics.Common.Enabled,
			Name:        cfg.Telemetry.ServiceName,
			Endpoint:    cfg.Telemetry.Endpoint,
			OtlpHeaders: cfg.Telemetry.Headers,
			Prometheus: metric.Prometheus{
				Enabled:    cfg.Telemetry.Metrics.Prometheus.Enabled,
				ListenAddr: cfg.Telemetry.Metrics.Prometheus.ListenAddr,
				Path:       cfg.Telemetry.Metrics.Prometheus.Path,
			},
			OtlpHttpPath: "/v1/metrics",
		}),
		core.WithEngineExecutionConfig(cfg.EngineExecutionConfiguration),
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

	logger.Info("Graceful shutdown ...", zap.String("shutdownDelay", cfg.ShutdownDelay.String()))

	// enforce a maximum shutdown delay
	ctx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownDelay)
	defer cancel()

	if err := router.Shutdown(ctx); err != nil {
		logger.Error("Could not shutdown server", zap.Error(err))
	}

	logger.Debug("Server exiting")
	os.Exit(0)
}
