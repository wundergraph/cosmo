package cmd

import (
	"context"
	"flag"
	"log"
	"os"
	"os/signal"
	"runtime/pprof"
	"syscall"

	"github.com/wundergraph/cosmo/router/config"
	"github.com/wundergraph/cosmo/router/core"

	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/internal/logging"
)

var (
	overrideEnv = flag.String("override-env", "", "env file name to override env variables")
	memprofile  = flag.String("memprofile", "", "write memory profile to this file")
	cpuprofile  = flag.String("cpuprofile", "", "write cpu profile to file")
)

func Main() {
	flag.Parse()

	if *cpuprofile != "" {
		f, err := os.Create(*cpuprofile)
		if err != nil {
			log.Fatal("Could not create CPU profile", err)
		}
		defer f.Close()
		if err := pprof.StartCPUProfile(f); err != nil {
			log.Fatal("Could not start CPU profile", err)
		}
	}

	cfg, err := config.LoadConfig(*overrideEnv)
	if err != nil {
		log.Fatal("Could not load config", zap.Error(err))
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt,
		syscall.SIGHUP,  // process is detached from terminal
		syscall.SIGTERM, // default for kill
		syscall.SIGKILL,
		syscall.SIGQUIT, // ctrl + \
		syscall.SIGINT,  // ctrl+c
	)
	defer stop()

	logLevel, err := logging.ZapLogLevelFromString(cfg.LogLevel)
	if err != nil {
		log.Fatal("Could not parse log level", zap.Error(err))
	}

	logger := logging.New(!cfg.JSONLog, cfg.LogLevel == "debug", logLevel).
		With(
			zap.String("component", "@wundergraph/router"),
			zap.String("service_version", core.Version),
		)

	initPprofHandlers(logger)

	router, err := NewRouter(Params{
		Config: cfg,
		Logger: logger,
	})

	if err != nil {
		logger.Fatal("Could not create app", zap.Error(err))
	}

	go func() {
		if err := router.Start(ctx); err != nil {
			logger.Error("Could not start server", zap.Error(err))
			stop()
		}
	}()

	<-ctx.Done()

	logger.Info("Graceful shutdown ...", zap.String("shutdown_delay", cfg.ShutdownDelay.String()))

	// enforce a maximum shutdown delay
	ctx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownDelay)
	defer cancel()

	if err := router.Shutdown(ctx); err != nil {
		logger.Error("Could not shutdown server", zap.Error(err))
	}

	if *cpuprofile != "" {
		pprof.StopCPUProfile()
	}
	createMemprofile()

	logger.Debug("Server exiting")
	os.Exit(0)
}

func createMemprofile() {
	if *memprofile != "" {
		f, err := os.Create(*memprofile)
		if err != nil {
			log.Fatal(err)
		}
		defer f.Close()
		if err := pprof.WriteHeapProfile(f); err != nil {
			log.Fatal(err)
		}
	}
}
