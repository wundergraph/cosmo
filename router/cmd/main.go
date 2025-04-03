package cmd

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/internal/timex"
	"github.com/wundergraph/cosmo/router/internal/versioninfo"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/logging"
	"github.com/wundergraph/cosmo/router/pkg/profile"
	"github.com/wundergraph/cosmo/router/pkg/watcher"

	"go.uber.org/zap"
)

var (
	overrideEnvFlag = flag.String("override-env", os.Getenv("OVERRIDE_ENV"), "Path to .env file to override environment variables")
	configPathFlag  = flag.String("config", os.Getenv("CONFIG_PATH"), "Path to the router config file e.g. config.yaml")
	routerVersion   = flag.Bool("version", false, "Prints the version and dependency information")
	pprofListenAddr = flag.String("pprof-addr", os.Getenv("PPROF_ADDR"), "Address to listen for pprof requests. e.g. :6060 for localhost:6060")
	memProfilePath  = flag.String("memprofile", "", "Path to write memory profile. Memory is a snapshot taken at the time the program exits")
	cpuProfilePath  = flag.String("cpuprofile", "", "Path to write cpu profile. CPU is measured from when the program starts until the program exits")
	help            = flag.Bool("help", false, "Prints the help message")
)

func Main() {
	_ = godotenv.Load()
	_ = godotenv.Load(".env.local")

	// Parse flags before calling profile.Start(), since it may add flags
	flag.Parse()

	if *help {
		flag.PrintDefaults()
		os.Exit(0)
	} else if *routerVersion {
		bi := versioninfo.New(core.Version, core.Commit, core.Date)
		fmt.Println(bi.String())
		os.Exit(0)
	}

	// We load this after flag parse so that "OVERRIDE_ENV" can be set by dotenv OR the flag
	if *overrideEnvFlag != "" {
		_ = godotenv.Overload(*overrideEnvFlag)
	}

	/*
		Config path precedence:
		1. Flag
		2. Environment variable
		3. Dotenv loaded environment variable
		4. Default config file
	*/

	configPath := *configPathFlag

	// If not set by flag or normal environment variable, check again for dotenv override loaded envar
	if configPath == "" {
		configPath = os.Getenv("CONFIG_PATH")
	}

	// This is redundant with the check inside config.LoadConfig, but we need to have the path
	// here as well to watch it.
	if configPath == "" {
		configPath = config.DefaultConfigPath
	}

	result, err := config.LoadConfig(configPath)
	if err != nil {
		log.Fatalf("Could not load config: %s", err)
	}

	logLevel, err := logging.ZapLogLevelFromString(result.Config.LogLevel)
	if err != nil {
		log.Fatalf("Could not parse log level: %s", err)
	}

	logLevelAtomic := zap.NewAtomicLevelAt(logLevel)

	logger := logging.New(!result.Config.JSONLog, result.Config.DevelopmentMode, logLevelAtomic).
		With(
			zap.String("service", "@wundergraph/router"),
			zap.String("service_version", core.Version),
		)

	// Start pprof server if address is provided
	if *pprofListenAddr != "" {
		pprofSvr := profile.NewServer(*pprofListenAddr, logger)
		defer pprofSvr.Close()
		go pprofSvr.Listen()
	}

	// Start profiling if flags are set
	profiler := profile.Start(logger, *cpuProfilePath, *memProfilePath)
	defer profiler.Finish()

	// Handling shutdown
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt,
		syscall.SIGTERM, // default for kill
		syscall.SIGKILL,
		syscall.SIGQUIT, // ctrl + \
		syscall.SIGINT,  // ctrl+c
	)
	defer stop()

	if result.DefaultLoaded {
		if configPath == config.DefaultConfigPath {
			logger.Info("Found default config file. Values in the config file have higher priority than environment variables",
				zap.String("config_file", config.DefaultConfigPath),
			)
		} else {
			logger.Info(
				"Config file path provided. Values in the config file have higher priority than environment variables",
				zap.String("config_file", configPath),
			)
		}
	}

	reloadChan := make(chan os.Signal, 1)

	signal.Notify(reloadChan, syscall.SIGHUP)

	// Setup config file watcher if enabled
	if result.Config.WatchConfig.Enabled {
		startupDelay := 0 * time.Second

		// Apply startup delay if configured
		if result.Config.WatchConfig.StartupDelay.Enabled {
			startupDelay = timex.RandomDuration(result.Config.WatchConfig.StartupDelay.Maximum)

			logger.Info("Using startup delay before initializing config watcher",
				zap.Duration("delay", startupDelay),
			)
		}

		watchFunc, err := watcher.New(watcher.Options{
			Interval: result.Config.WatchConfig.Interval,
			Logger:   logger.With(zap.String("watcher_label", "router_config")),
			Path:     configPath,
			Callback: func() {
				logger.Debug("Configuration changed, triggering reload")

				// Just a hack to make channel code simpler
				reloadChan <- syscall.SIGHUP
			},
		})
		if err != nil {
			logger.Error("Could not create watcher", zap.Error(err))
			return
		}

		watcherCtx, watcherCancel := context.WithCancel(context.Background())
		defer watcherCancel()

		go func() {
			// Sleep for startupDelay to prevent synchronized reloads across
			// different instances of the router
			time.Sleep(startupDelay)

			if err := watchFunc(watcherCtx); err != nil {
				if err != context.Canceled {
					logger.Error("Error watching execution config", zap.Error(err))
				}
			}
		}()

		logger.Info("Watching router config file",
			zap.String("config_file", configPath),
			zap.Duration("watch_interval", result.Config.WatchConfig.Interval),
		)
	} else {
		logger.Info("Config file watching is disabled, you can still trigger reloads by sending SIGHUP to the router process")
	}

	// Start the router
	for {
		logger.Debug("Starting router")

		// Provide a way to cancel all running components of the router after graceful shutdown
		// Don't use the parent context that is canceled by the signal handler
		routerCtx, routerCancel := context.WithCancel(context.Background())
		defer routerCancel()

		// TODO: Test if this actually allows router failure and recovery
		router, err := NewRouter(routerCtx, Params{
			Config: &result.Config,
			Logger: logger,
		})
		if err != nil {
			logger.Error("Could not create router", zap.Error(err))
		}

		if err = router.Start(routerCtx); err != nil {
			logger.Error("Could not start router", zap.Error(err))
		}

		shutdown := false

		select {
		case <-ctx.Done():
			logger.Info("Graceful shutdown of router initiated", zap.String("shutdown_delay", result.Config.ShutdownDelay.String()))
			shutdown = true
		case <-reloadChan:
			logger.Info("Reload channel triggered")
		}

		// Enforce a maximum shutdown delay to avoid waiting forever
		// Don't use the parent context that is canceled by the signal handler
		shutdownCtx, cancel := context.WithTimeout(context.Background(), result.Config.ShutdownDelay)
		defer cancel()

		if err = router.Shutdown(shutdownCtx); err != nil {
			if errors.Is(err, context.DeadlineExceeded) {
				logger.Warn("Router shutdown deadline exceeded. Consider increasing the shutdown delay")
			}
			logger.Error("Could not shutdown router gracefully", zap.Error(err))
		} else {
			logger.Info("Router shutdown successfully")
		}

		if shutdown {
			logger.Debug("Router exiting")
			return
		}

		newConfig, err := config.LoadConfig(configPath)
		if err != nil {
			logger.Error("Could not load config", zap.Error(err))
			continue
		}

		result = newConfig

		logLevel, err := logging.ZapLogLevelFromString(result.Config.LogLevel)
		if err != nil {
			logger.Error("Could not parse log level", zap.Error(err))
			continue
		}

		// Update the log level atom
		logLevelAtomic.SetLevel(logLevel)
	}
}
