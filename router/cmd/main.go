package cmd

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"github.com/grafana/pyroscope-go"
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
	routerVersion   = flag.Bool("version", false, "Prints the version and dependency information")
	pprofListenAddr = flag.String("pprof-addr", os.Getenv("PPROF_ADDR"), "Address to listen for pprof requests. e.g. :6060 for localhost:6060")
	pyroscopeAddr   = flag.String("pyroscope-addr", os.Getenv("PYROSCOPE_ADDR"), "Address to use for pyroscope continuous profiling. e.g. http://localhost:4040")

	memProfilePath = flag.String("memprofile", "", "Path to write memory profile. Memory is a snapshot taken at the time the program exits")
	cpuProfilePath = flag.String("cpuprofile", "", "Path to write cpu profile. CPU is measured from when the program starts until the program exits")
	help           = flag.Bool("help", false, "Prints the help message")

	// Register the custom flag types
	configPathFlag = newMultipleString("config", os.Getenv("CONFIG_PATH"), "Path to the router config file e.g. config.yaml, in case the path is a comma separated file list e.g. \"config.yaml,override.yaml\", the configs will be merged")
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

	// If not set by flag or normal environment variable, check again for dotenv override loaded envar
	if len(*configPathFlag) == 0 {
		configPathEnv := os.Getenv("CONFIG_PATH")
		err := configPathFlag.Set(configPathEnv)
		if err != nil {
			// This should be unreachable unless someone returns an non nil err
			log.Fatalf("Could not set config path from environment variable: %s", err)
		}
	}

	// If it is still not set, default to config paths
	if len(*configPathFlag) == 0 {
		*configPathFlag = multipleString{config.DefaultConfigPath}
	}

	result, err := config.LoadConfig(*configPathFlag)
	if err != nil {
		log.Fatalf("Could not load config: %s", err)
	}

	logLevelAtomic := zap.NewAtomicLevelAt(result.Config.LogLevel)

	baseLogger := logging.New(!result.Config.JSONLog, result.Config.DevelopmentMode, logLevelAtomic).
		With(
			zap.String("service", "@wundergraph/router"),
			zap.String("service_version", core.Version),
		)

	if *pprofListenAddr != "" && *pyroscopeAddr != "" {
		baseLogger.Fatal("Cannot use pprof and pyroscope at the same time")
	}

	if *pyroscopeAddr != "" && (*cpuProfilePath != "" || *memProfilePath != "") {
		baseLogger.Fatal("Cannot use --cpuprofile or --memprofile while Pyroscope is enabled")
	}

	// Start pprof server if address is provided
	if *pprofListenAddr != "" {
		pprofSvr := profile.NewServer(*pprofListenAddr, baseLogger)
		defer pprofSvr.Close()
		go pprofSvr.Listen()
	}

	// Start profiling if flags are set
	profiler := profile.Start(baseLogger, *cpuProfilePath, *memProfilePath)
	defer profiler.Finish()

	if *pyroscopeAddr != "" {
		runtime.SetMutexProfileFraction(5)
		runtime.SetBlockProfileRate(5)

		logger := baseLogger.With(zap.String("component", "pyroscope"))
		logger.Info("starting pyroscope server")

		pyro, err := pyroscope.Start(pyroscope.Config{
			ApplicationName: "wundergraph.cosmo.router",
			ServerAddress:   *pyroscopeAddr,
			Logger:          logger.Sugar(),
			Tags:            map[string]string{"hostname": os.Getenv("HOSTNAME")},

			ProfileTypes: []pyroscope.ProfileType{
				pyroscope.ProfileCPU,
				pyroscope.ProfileAllocObjects,
				pyroscope.ProfileAllocSpace,
				pyroscope.ProfileInuseObjects,
				pyroscope.ProfileInuseSpace,
				pyroscope.ProfileGoroutines,
				pyroscope.ProfileMutexCount,
				pyroscope.ProfileMutexDuration,
				pyroscope.ProfileBlockCount,
				pyroscope.ProfileBlockDuration,
			},
		})
		if err != nil {
			logger.Error("failed to start pyroscope", zap.Error(err))
		}
		if pyro != nil {
			defer pyro.Stop()
		}
	}

	rs, err := core.NewRouterSupervisor(&core.RouterSupervisorOpts{
		BaseLogger: baseLogger,
		ConfigFactory: func() (*config.Config, error) {
			result, err := config.LoadConfig(*configPathFlag)
			if err != nil {
				return nil, fmt.Errorf("could not load config: %w", err)
			}

			if !result.DefaultLoaded {
				baseLogger.Info(
					"Config file provided. Values in the config file have higher priority than environment variables",
					zap.Strings("config_file", *configPathFlag),
				)
			}

			logLevelAtomic.SetLevel(result.Config.LogLevel)

			return &result.Config, nil
		},
	})
	if err != nil {
		log.Fatalf("Could not create router supervisor: %s", err)
	}

	rootCtx, rootCancel := context.WithCancel(context.Background())
	defer rootCancel()

	// Handling shutdown signals
	{
		killChan := make(chan os.Signal, 1)

		signal.Notify(killChan, os.Interrupt,
			syscall.SIGTERM, // default for kill
			syscall.SIGQUIT, // ctrl + \
			syscall.SIGINT,  // ctrl+c
		)

		go func() {
			select {
			case <-rootCtx.Done():
				return
			case <-killChan:
				rs.Stop()
			}
		}()
	}

	// Handling reload signal
	{
		reloadChan := make(chan os.Signal, 1)

		signal.Notify(reloadChan, syscall.SIGHUP)

		go func() {
			for {
				select {
				case <-rootCtx.Done():
					return
				case <-reloadChan:
					rs.Reload()
				}
			}
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

		w, err := watcher.New(watcher.Options{
			Interval: result.Config.WatchConfig.Interval,
			Logger:   ll,
			Paths:    *configPathFlag,
			Callback: func() {
				ll.Info("Configuration changed, triggering reload")

				rs.Reload()
			},
		})
		if err != nil {
			baseLogger.Error("Could not create watcher", zap.Error(err))
			return
		}

		go func() {
			// Sleep for startupDelay to prevent synchronized reloads across
			// different instances of the router
			time.Sleep(startupDelay)

			if err := w(rootCtx); err != nil {
				if !errors.Is(err, context.Canceled) {
					ll.Error("Error watching router config", zap.Error(err))
				} else {
					ll.Debug("Watcher context cancelled, shutting down")
				}
			}
		}()

		ll.Info("Watching router config file",
			zap.Strings("config_file", *configPathFlag),
			zap.Duration("watch_interval", result.Config.WatchConfig.Interval),
		)
	} else {
		baseLogger.Info("Config file watching is disabled, you can still trigger reloads by sending SIGHUP to the router process")
	}

	// Start the router supervisor (blocking)
	if err := rs.Start(); err != nil {
		if errors.Is(err, core.ErrStartupFailed) {
			baseLogger.Error("Could not start router", zap.Error(err))
		} else {
			baseLogger.Error("Could not shutdown router gracefully", zap.Error(err))
		}
	}
}
