package main

import (
	"context"
	"errors"
	"fmt"
	"github.com/akrylysov/algnhsa"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/wundergraph/cosmo/aws-lambda-router/internal"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/logging"
	"go.uber.org/zap"
	"net/http"
	"os"
	"time"
)

const (
	telemetryServiceName = "aws-lambda-router"
	routerConfigPath     = "router.json"
)

var (
	defaultSampleRate = 0.2 // 20% of requests will be sampled
	enableTelemetry   = os.Getenv("DISABLE_TELEMETRY") != "true"
	devMode           = os.Getenv("DEV_MODE") == "true"
	stage             = os.Getenv("STAGE")
	graphApiToken     = os.Getenv("GRAPH_API_TOKEN")
	httpPort          = os.Getenv("HTTP_PORT")
)

func main() {
	ctx := context.Background()

	configPath := os.Getenv("CONFIG_PATH")
	if configPath == "" {
		configPath = "config.yaml" // Default config file path
	}

	result, err := config.LoadConfig(configPath, "")
	if err != nil {
		log.Fatalf("Could not load config: %v", err)
	}

	logLevel, err := logging.ZapLogLevelFromString(result.Config.LogLevel)
	if err != nil {
		log.Fatalf("Could not parse log level: %v", err)
	}

	loggerConfig := &logging.Config{
		PrettyLogging: !result.Config.JSONLog,
		Debug:         result.Config.LogLevel == "debug",
		LogLevel:      result.Config.LogLevel,
		LogFile:       result.Config.LogFile,
	}

	logger, err := logging.New(loggerConfig)
	if err != nil {
		log.Fatalf("Could not initialize logger: %v", err)
	}
	defer func() {
		if err := logger.Sync(); err != nil {
			fmt.Println("Could not sync logger", err)
		}
	}()

	logger = logger.With(
		zap.String("service_version", internal.Version),
	)

	r := internal.NewRouter(
		internal.WithGraphApiToken(graphApiToken),
		internal.WithLogger(logger),
		internal.WithRouterConfigPath(routerConfigPath),
		internal.WithTelemetryServiceName(telemetryServiceName),
		internal.WithStage(stage),
		internal.WithTraceSampleRate(defaultSampleRate),
		internal.WithEnableTelemetry(enableTelemetry),
		internal.WithHttpPort(httpPort),
		internal.WithRouterOpts(core.WithDevelopmentMode(devMode)),
		internal.WithRouterOpts(
			core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
				EnableSingleFlight:                     true,
				EnableRequestTracing:                   devMode,
				EnableExecutionPlanCacheResponseHeader: devMode,
				MaxConcurrentResolvers:                 1024,
			}),
		),
	)

	svr, err := r.NewServer(ctx)
	if err != nil {
		logger.Fatal("Could not create server", zap.Error(err))
	}

	// Set the server to ready
	svr.HealthChecks().SetReady(true)

	// If HTTP_PORT is set, we assume we are running the router without lambda
	if httpPort != "" {
		if err := svr.HttpServer().ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Fatal("Could not start server", zap.Error(err))
		}
		return
	}

	lambdaHandler := algnhsa.New(svr.HttpServer().Handler, nil)
	lambda.StartWithOptions(lambdaHandler,
		lambda.WithContext(ctx),
		// Registered an internal extension which gives us 500ms to shutdown
		// This mechanism does not replace telemetry flushing after a request
		// https://docs.aws.amazon.com/lambda/latest/dg/runtimes-extensions-api.html#runtimes-lifecycle-extensions-shutdown
		lambda.WithEnableSIGTERM(func() {
			logger.Debug("Server shutting down")
			sCtx, cancel := context.WithTimeout(context.Background(), 400*time.Millisecond)
			defer cancel()
			if err := r.Shutdown(sCtx); err != nil {
				panic(err)
			}
			logger.Debug("Server shutdown")
		}),
	)
}

