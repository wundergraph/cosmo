package main

import (
	"context"
	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/wundergraph/cosmo/graphqlmetrics"
	"github.com/wundergraph/cosmo/graphqlmetrics/config"
	"github.com/wundergraph/cosmo/graphqlmetrics/internal/logging"
	"go.uber.org/zap"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"
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

	options, err := clickhouse.ParseDSN(cfg.ClickHouseDSN)
	if err != nil {
		log.Fatal("Could not parse dsn", zap.Error(err))
	}

	chConn, err := clickhouse.Open(&clickhouse.Options{
		Addr: options.Addr,
		Auth: clickhouse.Auth{
			Database: options.Auth.Database,
			Username: options.Auth.Username,
			Password: options.Auth.Password,
		},
		Settings: clickhouse.Settings{
			"max_execution_time": 60,
		},
		Compression: &clickhouse.Compression{
			Method: clickhouse.CompressionLZ4,
		},
		DialTimeout:          time.Second * 30,
		ConnMaxLifetime:      time.Duration(10) * time.Minute,
		ConnOpenStrategy:     clickhouse.ConnOpenInOrder,
		BlockBufferSize:      10,
		MaxCompressionBuffer: 10240,
		ClientInfo: clickhouse.ClientInfo{ // optional, please see Client info section in the README.md
			Products: []struct {
				Name    string
				Version string
			}{
				{Name: "graphqlmetrics", Version: graphqlmetrics.Version},
			},
		},
	})

	if err != nil {
		log.Fatal("Could not connect to clickhouse", zap.Error(err))

	}

	if err := chConn.Ping(ctx); err != nil {
		log.Fatal("Could not ping clickhouse", zap.Error(err))
	} else {
		logger.Info("Connected to clickhouse")
	}

	svr := graphqlmetrics.NewServer(
		graphqlmetrics.NewMetricsService(logger, chConn),
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
