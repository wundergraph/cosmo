package main

import (
	"context"
	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/amacneil/dbmate/v2/pkg/dbmate"
	_ "github.com/amacneil/dbmate/v2/pkg/driver/clickhouse"
	"github.com/wundergraph/cosmo/graphqlmetrics"
	"github.com/wundergraph/cosmo/graphqlmetrics/config"
	"github.com/wundergraph/cosmo/graphqlmetrics/internal/logging"
	"go.uber.org/zap"
	"log"
	"net/url"
	"os"
	"os/signal"
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

	logger := logging.New(!cfg.JSONLog, cfg.LogLevel == "debug", logLevel).
		With(
			zap.String("component", "@wundergraph/graphqlmetrics"),
			zap.String("service_version", graphqlmetrics.Version),
		)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt,
		syscall.SIGHUP,  // process is detached from terminal
		syscall.SIGTERM, // default for kill
		syscall.SIGKILL,
		syscall.SIGQUIT, // ctrl + \
		syscall.SIGINT,  // ctrl+c
	)
	defer stop()

	options, err := clickhouse.ParseDSN(cfg.ClickHouseHttpDSN)
	if err != nil {
		log.Fatal("Could not parse dsn", zap.Error(err))
	}

	options.Compression = &clickhouse.Compression{
		Method: clickhouse.CompressionLZ4,
	}
	options.ClientInfo = clickhouse.ClientInfo{
		Products: []struct {
			Name    string
			Version string
		}{
			{Name: "graphqlmetrics", Version: graphqlmetrics.Version},
		},
	}

	db := clickhouse.OpenDB(options)
	db.SetMaxIdleConns(10)
	db.SetMaxOpenConns(15)

	if err := db.PingContext(ctx); err != nil {
		log.Fatal("Could not ping clickhouse", zap.Error(err))
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
	if err := migrator.Migrate(); err != nil {
		log.Fatal("Could not migrate", zap.Error(err))
	} else {
		logger.Info("Migration is up to date")
	}

	svr := graphqlmetrics.NewServer(
		graphqlmetrics.NewMetricsService(logger, db, []byte(cfg.IngestJWTSecret)),
		graphqlmetrics.WithListenAddr(cfg.ListenAddr),
		graphqlmetrics.WithLogger(logger),
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

	// enforce a maximum shutdown delay
	ctx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownDelay)
	defer cancel()

	if err := svr.Shutdown(ctx); err != nil {
		logger.Error("Could not shutdown server", zap.Error(err))
	}

	logger.Debug("Server exiting")
	os.Exit(0)
}
