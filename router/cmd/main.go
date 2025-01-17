package cmd

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/internal/versioninfo"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/logging"
	"github.com/wundergraph/cosmo/router/pkg/profile"
	"log"
	"os"
	"os/signal"
	"syscall"

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

	result, err := config.LoadConfig(*configPathFlag, *overrideEnvFlag)
	if err != nil {
		log.Fatal("Could not load config", zap.Error(err))
	}

	logLevel, err := logging.ZapLogLevelFromString(result.Config.LogLevel)
	if err != nil {
		log.Fatal("Could not parse log level", zap.Error(err))
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
