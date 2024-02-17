package cmd

import (
	"context"
	"flag"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/logging"
	"log"
	"os"
	"os/signal"
	"syscall"

	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/internal/profile"
)

var (
	overrideEnvFlag = flag.String("override-env", os.Getenv("OVERRIDE_ENV"), "env file name to override env variables")
	configPathFlag  = flag.String("config", os.Getenv("CONFIG_PATH"), "path to config file")
)

func Main() {
	// Parse flags before calling profile.Start(), since it may add flags
	flag.Parse()

	profiler := profile.Start()

	result, err := config.LoadConfig(*configPathFlag, *overrideEnvFlag)
	if err != nil {
		log.Fatal("Could not load config", zap.Error(err))
	}

	// Handling shutdown
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt,
		syscall.SIGHUP,  // process is detached from terminal
		syscall.SIGTERM, // default for kill
		syscall.SIGKILL,
		syscall.SIGQUIT, // ctrl + \
		syscall.SIGINT,  // ctrl+c
	)
	defer stop()

	logLevel, err := logging.ZapLogLevelFromString(result.Config.LogLevel)
	if err != nil {
		log.Fatal("Could not parse log level", zap.Error(err))
	}

	logger := logging.New(!result.Config.JSONLog, result.Config.LogLevel == "debug", logLevel).
		With(
			zap.String("component", "@wundergraph/router"),
			zap.String("service_version", core.Version),
		)

	if *configPathFlag != "" {
		logger.Info(
			"Config file path provided. Values in the config file have higher priority than environment variables",
			zap.String("config_file", *configPathFlag),
		)
	} else if result.DefaultLoaded {
		logger.Info("Found default config file. Values in the config file have higher priority than environment variables",
			zap.String("config_file", config.DefaultConfigPath),
		)
	}

	router, err := NewRouter(Params{
		Config: &result.Config,
		Logger: logger,
	})

	if err != nil {
		logger.Fatal("Could not create app", zap.Error(err))
	}

	go func() {
		if err := router.Start(ctx); err != nil {
			logger.Error("Could not start server", zap.Error(err))
			// Don't block and wait for shutdown. No fatal error because some sinks might be flushed.
			stop()
		}
	}()

	<-ctx.Done()

	logger.Info("Graceful shutdown ...", zap.String("shutdown_delay", result.Config.ShutdownDelay.String()))
	// Enforce a maximum shutdown delay to avoid waiting forever
	// Don't use the parent context that is canceled by the signal handler
	shutdownCtx, cancel := context.WithTimeout(context.Background(), result.Config.ShutdownDelay)
	defer cancel()

	if err := router.Shutdown(shutdownCtx); err != nil {
		logger.Error("Could not shutdown server", zap.Error(err))
	}

	profiler.Finish()

	logger.Debug("Server exiting")
	os.Exit(0)
}
