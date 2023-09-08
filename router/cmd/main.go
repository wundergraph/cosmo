package cmd

import (
	"context"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/app"
	"github.com/wundergraph/cosmo/router/pkg/controlplane"
	"github.com/wundergraph/cosmo/router/pkg/handler/cors"
	"github.com/wundergraph/cosmo/router/pkg/metric"
	"github.com/wundergraph/cosmo/router/pkg/trace"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/logging"
	"go.uber.org/zap"
)

func Main() {
	cfg, err := config.LoadConfig()
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
		controlplane.WithPollInterval(time.Duration(cfg.PollIntervalSeconds)*time.Second),
	)

	var routerConfig *nodev1.RouterConfig

	if cfg.RouterConfigPath != "" {
		routerConfig, err = app.SerializeConfigFromFile(cfg.RouterConfigPath)
		if err != nil {
			logger.Fatal("Could not read router config", zap.Error(err), zap.String("path", cfg.RouterConfigPath))
		}
	}

	rs, err := app.New(
		app.WithFederatedGraphName(cfg.Graph.Name),
		app.WithListenerAddr(cfg.ListenAddr),
		app.WithLogger(logger),
		app.WithConfigFetcher(cp),
		app.WithIntrospection(cfg.IntrospectionEnabled),
		app.WithPlayground(cfg.PlaygroundEnabled),
		app.WithGraphApiToken(cfg.Graph.Token),
		app.WithModulesConfig(cfg.Modules),
		app.WithGracePeriod(time.Duration(cfg.GracePeriodSeconds)*time.Second),
		app.WithHealthCheckPath(cfg.HealthCheckPath),
		app.WithLivenessCheckPath(cfg.LivenessCheckPath),
		app.WithReadinessCheckPath(cfg.ReadinessCheckPath),
		app.WithStaticRouterConfig(routerConfig),
		app.WithCors(&cors.Config{
			AllowOrigins:     cfg.CORS.AllowOrigins,
			AllowMethods:     cfg.CORS.AllowMethods,
			AllowCredentials: cfg.CORS.AllowCredentials,
			AllowHeaders:     cfg.CORS.AllowHeaders,
			MaxAge:           time.Duration(cfg.CORS.MaxAgeMinutes) * time.Minute,
		}),
		app.WithTracing(&trace.Config{
			Enabled:       cfg.Telemetry.Tracing.Enabled,
			Name:          cfg.Telemetry.ServiceName,
			Endpoint:      cfg.Telemetry.Endpoint,
			Sampler:       cfg.Telemetry.Tracing.Config.SamplingRate,
			Batcher:       trace.KindOtlpHttp,
			BatchTimeout:  time.Duration(cfg.Telemetry.Tracing.Config.BatchTimeoutSeconds) * time.Second,
			ExportTimeout: 30 * time.Second,
			OtlpHeaders:   cfg.Telemetry.Headers,
			OtlpHttpPath:  "/v1/traces",
		}),
		app.WithMetrics(&metric.Config{
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
	)

	if err != nil {
		logger.Fatal("Could not create app", zap.Error(err))
	}

	go func() {
		if err := rs.Start(ctx); err != nil {
			logger.Error("Could not start server", zap.Error(err))
			stop()
		}
	}()

	<-ctx.Done()

	shutdownDelayDuration := time.Duration(cfg.ShutdownDelaySeconds) * time.Second
	logger.Info("Graceful shutdown ...", zap.String("shutdownDelay", shutdownDelayDuration.String()))

	// enforce a maximum shutdown delay
	ctx, cancel := context.WithTimeout(context.Background(), shutdownDelayDuration)
	defer cancel()

	if err := rs.Shutdown(ctx); err != nil {
		logger.Error("Could not shutdown server", zap.Error(err))
	}

	logger.Debug("Router exiting")
	os.Exit(0)
}
