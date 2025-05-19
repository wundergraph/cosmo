package cmd

import (
	"context"
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
	"github.com/wundergraph/cosmo/router/pkg/supervisor"
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

	logLevelAtomic := zap.NewAtomicLevelAt(result.Config.LogLevel)

	baseLogger := logging.New(!result.Config.JSONLog, result.Config.DevelopmentMode, logLevelAtomic).
		With(
			zap.String("service", "@wundergraph/router"),
			zap.String("service_version", core.Version),
		)

	// Start pprof server if address is provided
	if *pprofListenAddr != "" {
		pprofSvr := profile.NewServer(*pprofListenAddr, baseLogger)
		defer pprofSvr.Close()
		go pprofSvr.Listen()
	}

	// Start profiling if flags are set
	profiler := profile.Start(baseLogger, *cpuProfilePath, *memProfilePath)
	defer profiler.Finish()

	sl := baseLogger.With(zap.String("component", "supervisor"))

	rs := supervisor.NewRouterSupervisor(&supervisor.RouterSupervisorOpts{
		Logger: sl,

		LifecycleHooks: &supervisor.LifecycleHooks{
			LoadResources: func(rr *supervisor.RouterResources) error {
				result, err := config.LoadConfig(configPath)
				if err != nil {
					return fmt.Errorf("could not load config: %w", err)
				}

				if result.DefaultLoaded {
					if configPath == config.DefaultConfigPath {
						sl.Info("Found default config file. Values in the config file have higher priority than environment variables",
							zap.String("config_file", config.DefaultConfigPath),
						)
					} else {
						sl.Info(
							"Config file path provided. Values in the config file have higher priority than environment variables",
							zap.String("config_file", configPath),
						)
					}
				}

				rr.Config = &result.Config
				rr.Logger = baseLogger

				logLevelAtomic.SetLevel(rr.Config.LogLevel)

				return nil
			},
		},
	})

	// Handling shutdown signals
	{
		killChan := make(chan os.Signal, 1)

		signal.Notify(killChan, os.Interrupt,
			syscall.SIGTERM, // default for kill
			syscall.SIGQUIT, // ctrl + \
			syscall.SIGINT,  // ctrl+c
		)

		go func() {
			<-killChan
			rs.Stop()
		}()
	}

	// Handling reload signal
	{
		reloadChan := make(chan os.Signal, 1)

		signal.Notify(reloadChan, os.Interrupt,
			syscall.SIGHUP,
		)

		go func() {
			<-reloadChan
			rs.Reload()
		}()
	}

	// Setup config file watcher if enabled
	if result.Config.WatchConfig.Enabled {
		ll := baseLogger.With(zap.String("watcher_label", "router_config"))

		startupDelay := 0 * time.Second

		// Apply startup delay if configured
		if result.Config.WatchConfig.StartupDelay.Enabled {
			startupDelay = timex.RandomDuration(result.Config.WatchConfig.StartupDelay.Maximum)

			ll.Info("Using startup delay before initializing config watcher",
				zap.Duration("delay", startupDelay),
			)
		}

		watchFunc, err := watcher.New(watcher.Options{
			Interval: result.Config.WatchConfig.Interval,
			Logger:   ll,
			Path:     configPath,
			Callback: func() {
				ll.Debug("Configuration changed, triggering reload")

				rs.Reload()
			},
		})
		if err != nil {
			baseLogger.Error("Could not create watcher", zap.Error(err))
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
					ll.Error("Error watching execution config", zap.Error(err))
				}
			}
		}()

		ll.Info("Watching router config file",
			zap.String("config_file", configPath),
			zap.Duration("watch_interval", result.Config.WatchConfig.Interval),
		)
	} else {
		baseLogger.Info("Config file watching is disabled, you can still trigger reloads by sending SIGHUP to the router process")
	}

	// Start the router supervisor (blocking)
	if err := rs.Start(); err != nil {
		baseLogger.Error("Error starting supervisor", zap.Error(err))
	}
}
