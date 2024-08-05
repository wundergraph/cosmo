package main

import (
	"context"
	"log"
	"net/url"
	"os"
	"os/signal"
	"sync"
	"syscall"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/amacneil/dbmate/v2/pkg/dbmate"
	_ "github.com/amacneil/dbmate/v2/pkg/driver/clickhouse"
	"github.com/wundergraph/cosmo/graphqlmetrics/config"
	"github.com/wundergraph/cosmo/graphqlmetrics/core"
	"github.com/wundergraph/cosmo/graphqlmetrics/internal/logging"
	"github.com/wundergraph/cosmo/graphqlmetrics/pkg/telemetry"
	"go.uber.org/automaxprocs/maxprocs"
	"go.uber.org/zap"
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

	// Automatically set GOMAXPROCS to avoid CPU throttling on containerized environments
	_, err = maxprocs.Set(maxprocs.Logger(logger.Sugar().Debugf))
	if err != nil {
		logger.Fatal("Could not set max GOMAXPROCS", zap.Error(err))
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt,
		syscall.SIGHUP,  // process is detached from terminal
		syscall.SIGTERM, // default for kill
		syscall.SIGKILL,
		syscall.SIGQUIT, // ctrl + \
		syscall.SIGINT,  // ctrl+c
	)
	defer stop()

	options, err := clickhouse.ParseDSN(cfg.ClickHouseDSN)
	if err != nil {
		logger.Fatal("Could not parse dsn", zap.Error(err))
	}

	options.Compression = &clickhouse.Compression{
		Method: clickhouse.CompressionLZ4,
	}
	if isDebug {
		options.Debug = true
		options.Debugf = func(format string, v ...any) {
			logger.Sugar().With(zap.String("subsystem", "clickhouse-go")).Debugf(format, v...)
		}
	}
	options.ClientInfo = clickhouse.ClientInfo{
		Products: []struct {
			Name    string
			Version string
		}{
			{Name: "graphqlmetrics", Version: core.Version},
		},
	}
	options.MaxIdleConns = 16
	options.MaxOpenConns = 32

	logger.Info("Connecting to clickhouse",
		zap.Int("maxOpenConns", options.MaxOpenConns),
		zap.Int("maxIdleConns", options.MaxIdleConns),
		zap.String("dialTimeout", options.DialTimeout.String()),
		zap.String("connMaxLifetime", options.ConnMaxLifetime.String()),
		zap.Any("settings", options.Settings),
	)

	conn, err := clickhouse.Open(options)
	if err != nil {
		logger.Fatal("Could not open clickhouse", zap.Error(err))
	}

	if err := conn.Ping(ctx); err != nil {
		logger.Fatal("Could not ping clickhouse", zap.Error(err))
	} else {
		logger.Info("Connected to clickhouse")
	}

	// Database migrations

	chDNS, _ := url.Parse(cfg.ClickHouseDSN)
	migrator := dbmate.New(chDNS)
	migrator.MigrationsDir = []string{"migrations"}
	migrator.AutoDumpSchema = false
	migrator.Log = zap.NewStdLog(logger).Writer()
	migrator.MigrationsTableName = "graphqlmetrics_schema_migrations"
	if err := migrator.CreateAndMigrate(); err != nil {
		log.Fatal("Could not migrate", zap.Error(err))
	} else {
		logger.Info("Migration is up to date")
	}

	ms := core.NewMetricsService(logger, conn)

	metricsConfig := telemetry.NewTelemetryConfig(
		core.Version,
		telemetry.PrometheusConfig{
			Enabled:    cfg.IsPrometheusEnabled,
			ListenAddr: cfg.PrometheusListenAddr,
			Path:       cfg.PrometheusPath,
		},
	)

	svr := core.NewServer(
		ctx,
		ms,
		core.WithJwtSecret([]byte(cfg.IngestJWTSecret)),
		core.WithListenAddr(cfg.ListenAddr),
		core.WithLogger(logger),
		core.WithMetrics(metricsConfig),
	)

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
		ms.Shutdown(cfg.ShutdownDelay)
	}()

	// enforce a maximum shutdown delay
	ctx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownDelay)
	defer cancel()

	if err := svr.Shutdown(ctx); err != nil {
		logger.Error("Could not shutdown server", zap.Error(err))
	}

	// Wait for all background tasks to finish (not coupled to the server)
	wg.Wait()

	logger.Debug("Server exiting")
	os.Exit(0)
}
