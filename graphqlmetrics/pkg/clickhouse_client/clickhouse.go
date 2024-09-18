package clickhouse_client

import (
	"context"
	"fmt"
	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"go.uber.org/zap"
)

func CreateConnection(ctx context.Context, clickHouseDSN string, debug bool, serviceVersion string, logger *zap.Logger) (driver.Conn, error) {
	options, err := clickhouse.ParseDSN(clickHouseDSN)
	if err != nil {
		return nil, fmt.Errorf("could not parse dsn: %w", err)
	}

	options.Compression = &clickhouse.Compression{
		Method: clickhouse.CompressionLZ4,
	}
	if debug {
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
			{Name: "graphqlmetrics", Version: serviceVersion},
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
		return nil, fmt.Errorf("could not open clickhouse: %w", err)
	}

	if err := conn.Ping(ctx); err != nil {
		return nil, fmt.Errorf("could not ping clickhouse: %w", err)
	}

	return conn, nil
}
