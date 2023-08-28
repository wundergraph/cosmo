package main

import (
	"context"
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

func main() {
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

	logger := logging.New(cfg.JSONLog, false, logLevel).
		With(zap.String("component", "@wundergraph/router"))

	cp := controlplane.New(
		controlplane.WithControlPlaneEndpoint(cfg.ControlplaneURL),
		controlplane.WithFederatedGraph(cfg.FederatedGraphName),
		controlplane.WithLogger(logger),
		controlplane.WithGraphApiToken(cfg.GraphApiToken),
		controlplane.WithPollInterval(time.Duration(cfg.PollIntervalSeconds)*time.Second),
		controlplane.WithConfigFilePath(cfg.ConfigFilePath),
	)

	rs, err := app.New(
		app.WithFederatedGraphName(cfg.FederatedGraphName),
		app.WithListenerAddr(cfg.ListenAddr),
		app.WithLogger(logger),
		app.WithConfigFetcher(cp),
		app.WithIntrospection(cfg.IntrospectionEnabled),
		app.WithPlayground(cfg.PlaygroundEnabled),
		app.WithGraphApiToken(cfg.GraphApiToken),
		app.WithGracePeriod(time.Duration(cfg.GracePeriodSeconds)*time.Second),
		app.WithCors(&cors.Config{
			AllowOrigins:     cfg.CORSAllowedOrigins,
			AllowMethods:     cfg.CORSAllowedMethods,
			AllowCredentials: cfg.CORSAllowCredentials,
			AllowHeaders:     cfg.CORSAllowedHeaders,
			MaxAge:           time.Duration(cfg.CORSMaxAgeMinutes) * time.Minute,
		}),
		app.WithTracing(&trace.Config{
			Enabled:      cfg.OTELTracingEnabled,
			Name:         cfg.OTELServiceName,
			Endpoint:     cfg.OTELCollectorEndpoint,
			Sampler:      cfg.OTELSampler,
			Batcher:      trace.KindOtlpHttp,
			BatchTimeout: time.Duration(cfg.OTELBatchTimeoutSeconds) * time.Second,
			OtlpHeaders:  cfg.OTELCollectorHeaders,
			OtlpHttpPath: "/v1/traces",
		}),
		app.WithMetrics(&metric.Config{
			Enabled:     cfg.OTELMetricsEnabled,
			Name:        cfg.OTELServiceName,
			Endpoint:    cfg.OTELCollectorEndpoint,
			OtlpHeaders: cfg.OTELCollectorHeaders,
			Prometheus: metric.Prometheus{
				Enabled:    cfg.PrometheusEnabled,
				ListenAddr: cfg.PrometheusHttpAddr,
				Path:       cfg.PrometheusHttpPath,
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

	// enforce a maximum timeout of 10 seconds
	ctx, cancel := context.WithTimeout(context.Background(), shutdownDelayDuration)
	defer cancel()

	if err := rs.Shutdown(ctx); err != nil {
		logger.Error("Could not shutdown server", zap.Error(err))
	}

	logger.Debug("Router exiting")
	os.Exit(0)
}
