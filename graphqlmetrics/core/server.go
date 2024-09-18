package core

import (
	"context"
	"fmt"
	"github.com/KimMachineGun/automemlimit/memlimit"
	"github.com/dustin/go-humanize"
	"github.com/wundergraph/cosmo/graphqlmetrics/gen/proto/wg/cosmo/graphqlmetrics/v1/graphqlmetricsv1connect"
	"github.com/wundergraph/cosmo/graphqlmetrics/internal/logging"
	"github.com/wundergraph/cosmo/graphqlmetrics/internal/migration"
	"github.com/wundergraph/cosmo/graphqlmetrics/pkg/config"
	"github.com/wundergraph/cosmo/graphqlmetrics/pkg/telemetry"
	"go.uber.org/automaxprocs/maxprocs"
	"go.uber.org/zap"
	"os"
)

func NewServer(ctx context.Context, cfg *config.Config, ms graphqlmetricsv1connect.GraphQLMetricsServiceHandler) (*Collector, error) {
	cfg, err := config.LoadConfig()
	if err != nil {
		return nil, fmt.Errorf("could not load config: %w", err)
	}

	logLevel, err := logging.ZapLogLevelFromString(cfg.LogLevel)
	if err != nil {
		return nil, fmt.Errorf("could not parse log level: %w", err)
	}

	isDebug := cfg.LogLevel == "debug"
	logger := logging.New(!cfg.JSONLog, isDebug, logLevel).
		With(
			zap.String("component", "@wundergraph/graphqlmetrics"),
			zap.String("service_version", Version),
		)

	// Automatically set GOMAXPROCS to avoid CPU throttling on containerized environments
	_, err = maxprocs.Set(maxprocs.Logger(logger.Sugar().Debugf))
	if err != nil {
		return nil, fmt.Errorf("could not set max GOMAXPROCS: %w", err)
	}

	// Automatically set GOMEMLIMIT to 90% of the available memory.
	// This is an effort to prevent the router from being killed by OOM (Out Of Memory)
	// when the system is under memory pressure e.g. when GC is not able to free memory fast enough.
	// More details: https://tip.golang.org/doc/gc-guide#Memory_limit
	mLimit, err := memlimit.SetGoMemLimitWithOpts(
		memlimit.WithRatio(0.9),
		memlimit.WithProvider(
			memlimit.ApplyFallback(
				memlimit.FromCgroupHybrid,
				memlimit.FromSystem,
			),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("could not set memory limit: %w", err)
	}
	if mLimit > 0 {
		logger.Info("GOMEMLIMIT set automatically", zap.String("limit", humanize.Bytes(uint64(mLimit))))
	} else if os.Getenv("GOMEMLIMIT") != "" {
		logger.Info("GOMEMLIMIT set by user", zap.String("limit", os.Getenv("GOMEMLIMIT")))
	}

	// Database migrations

	if err := migration.Migrate(cfg.ClickHouseDSN, logger); err != nil {
		return nil, fmt.Errorf("could not migrate database: %w", err)
	}

	metricsConfig := telemetry.NewTelemetryConfig(
		Version,
		telemetry.PrometheusConfig{
			Enabled:    cfg.IsPrometheusEnabled,
			ListenAddr: cfg.PrometheusListenAddr,
			Path:       cfg.PrometheusPath,
		},
	)

	svr := NewCollector(
		ctx,
		ms,
		WithJwtSecret([]byte(cfg.IngestJWTSecret)),
		WithListenAddr(cfg.ListenAddr),
		WithLogger(logger),
		WithMetrics(metricsConfig),
	)

	return svr, nil
}
