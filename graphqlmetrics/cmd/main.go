package main

import (
	"context"
	_ "github.com/amacneil/dbmate/v2/pkg/driver/clickhouse"
	"github.com/wundergraph/cosmo/graphqlmetrics/core"
	"github.com/wundergraph/cosmo/graphqlmetrics/internal/logging"
	"github.com/wundergraph/cosmo/graphqlmetrics/pkg/clickhouse_client"
	"github.com/wundergraph/cosmo/graphqlmetrics/pkg/clickhouse_metrics_service"
	"github.com/wundergraph/cosmo/graphqlmetrics/pkg/config"
	"go.uber.org/zap"
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"
)

func main() {
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatal("Could not load config", zap.Error(err))
	}

	logLevel, err := logging.ZapLogLevelFromString(cfg.LogLevel)
	if err != nil {
		log.Fatal("Could not parse log level", zap.Error(err))
	}

	isDebug := cfg.LogLevel == "debug"
	logger := logging.New(!cfg.JSONLog, isDebug, logLevel).
		With(
			zap.String("component", "@wundergraph/graphqlmetrics"),
			zap.String("service_version", core.Version),
		)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt,
		syscall.SIGHUP,  // process is detached from terminal
		syscall.SIGTERM, // default for kill
		syscall.SIGKILL,
		syscall.SIGQUIT, // ctrl + \
		syscall.SIGINT,  // ctrl+c
	)
	defer stop()

	chConn, err := clickhouse_client.CreateConnection(ctx, cfg.ClickHouseDSN, isDebug, core.Version, logger)
	if err != nil {
		logger.Fatal("Could not create clickhouse connection", zap.Error(err))
	}

	ms := clickhouse_metrics_service.New(logger, chConn)
	if err != nil {
		logger.Fatal("Could not create S3 metrics service", zap.Error(err))
	}

	svr, err := core.NewServer(ctx, cfg, ms)
	if err != nil {
		logger.Fatal("Could not create server", zap.Error(err))
	}

	go func() {
		if err := svr.Start(); err != nil {
			logger.Error("Could not start server", zap.Error(err))
			stop()
		}
	}()

	logger.Info("Server started", zap.String("listen_addr", cfg.ListenAddr))

	<-ctx.Done()

	logger.Info("Graceful shutdown ...", zap.String("shutdown_delay", cfg.ShutdownDelay.String()))

	var wg sync.WaitGroup

	wg.Add(1)
	go func() {
		defer wg.Done()
		if err := ms.Shutdown(cfg.ShutdownDelay); err != nil {
			logger.Error("Could not shutdown metrics service", zap.Error(err))
		}
	}()

	// Enforce a maximum shutdown delay
	ctx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownDelay)
	defer cancel()

	if err := svr.Shutdown(ctx); err != nil {
		logger.Error("Could not shutdown server", zap.Error(err))
	}

	// Wait for all background tasks to finish (not coupled to the server)
	wg.Wait()

	logger.Debug("Collector exiting")
	os.Exit(0)
}
