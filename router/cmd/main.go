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

	// If not set by flag or normal environment variable, check again for dotenv loaded envar
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

	logger := logging.New(!result.Config.JSONLog, result.Config.DevelopmentMode, logLevel).
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
		syscall.SIGHUP,  // process is detached from terminal
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

	// TODO: Don't watch the default config file if it doesn't exist?
	// TODO: Send SIGHUP? to router thing for graceful restarts
	{
		watchFunc, err := watcher.New(watcher.Options{
			Interval: 10 * time.Second,
			Logger:   logger.With(zap.String("watcher_label", "router_config")),
			Path:     configPath,
			Callback: func() {
				logger.Info("Config file changed")
			},
		})
		if err != nil {
			logger.Error("Could not create watcher", zap.Error(err))
			return
		}

		watcherCtx, watcherCancel := context.WithCancel(context.Background())
		defer watcherCancel()

		go func() {
			if err := watchFunc(watcherCtx); err != nil {
				if err != context.Canceled {
					logger.Error("Error watching execution config", zap.Error(err))
				}
			}
		}()
	}

	// Start the router
	// TODO: do this in a loop with like sighup or something for graceful restarts
	{
		// Provide a way to cancel all running components of the router after graceful shutdown
		// Don't use the parent context that is canceled by the signal handler
		routerCtx, routerCancel := context.WithCancel(context.Background())
		defer routerCancel()

		router, err := NewRouter(routerCtx, Params{
			Config: &result.Config,
			Logger: logger,
		})
		if err != nil {
			logger.Fatal("Could not create router", zap.Error(err))
		}

		if err = router.Start(routerCtx); err != nil {
			logger.Fatal("Could not start router", zap.Error(err))
		}

		<-ctx.Done()

		logger.Info("Graceful shutdown of router initiated", zap.String("shutdown_delay", result.Config.ShutdownDelay.String()))

		// Enforce a maximum shutdown delay to avoid waiting forever
		// Don't use the parent context that is canceled by the signal handler
		shutdownCtx, cancel := context.WithTimeout(context.Background(), result.Config.ShutdownDelay)
		defer cancel()

		if err = router.Shutdown(shutdownCtx); err != nil {
			if errors.Is(err, context.DeadlineExceeded) {
				logger.Warn("Router shutdown deadline exceeded. Consider increasing the shutdown delay")
			}
			logger.Fatal("Could not shutdown router gracefully", zap.Error(err))
		} else {
			logger.Info("Router shutdown successfully")
		}

		logger.Debug("Router exiting")
	}
}
