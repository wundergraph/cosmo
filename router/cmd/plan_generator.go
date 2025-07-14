package cmd

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/KimMachineGun/automemlimit/memlimit"
	"github.com/dustin/go-humanize"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/logging"
	"github.com/wundergraph/cosmo/router/pkg/plan_generator"
	"go.uber.org/automaxprocs/maxprocs"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

func PlanGenerator(args []string) {
	var planHelp bool

	cfg := plan_generator.QueryPlanConfig{}
	f := flag.NewFlagSet("router "+args[0], flag.ExitOnError)
	f.BoolVar(&planHelp, "help", false, "Prints the help message")
	f.StringVar(&cfg.ExecutionConfig, "execution-config", "", "required, execution config file location")
	f.StringVar(&cfg.SourceDir, "operations", "", "required, source operations folder location")
	f.StringVar(&cfg.OutDir, "plans", "", "required, output plans folder location")
	f.StringVar(&cfg.Filter, "filter", "", "operation filter file location which should contain file names of operations to include")
	f.StringVar(&cfg.Timeout, "timeout", "30s", "timeout")
	f.IntVar(&cfg.Concurrency, "concurrency", 0, "how many query plan run concurrently")
	f.BoolVar(&cfg.OutputFiles, "print-per-file", true, "write a file for each query, with inside the plan or the query plan error")
	f.BoolVar(&cfg.OutputReport, "print-report", false, "write a report.json file, with all the query plans and errors sorted by file name")
	f.BoolVar(&cfg.FailOnPlanError, "fail-on-error", false, "if at least one plan fails, the command exit code will be 1")
	f.BoolVar(&cfg.FailFast, "fail-fast", false, "stop as soon as possible if a plan fails")
	f.StringVar(&cfg.LogLevel, "log-level", "warn", "log level to use (debug, info, warn, error, panic, fatal)")
	f.UintVar(&cfg.MaxDataSourceCollectorsConcurrency, "max-collectors", 0, "max number of concurrent data source collectors, if unset or 0, no limit will be enforced")

	if err := f.Parse(args[1:]); err != nil {
		f.PrintDefaults()
		log.Fatalf("Failed to parse flags: %v", err)
	}

	if planHelp {
		f.PrintDefaults()
		return
	}
	if cfg.ExecutionConfig == "" || cfg.SourceDir == "" || cfg.OutDir == "" {
		f.PrintDefaults()
		log.Fatalf("missing required flags")
	}

	ctxNotify, stop := signal.NotifyContext(context.Background(), os.Interrupt,
		syscall.SIGHUP,  // process is detached from terminal
		syscall.SIGTERM, // default for kill
		syscall.SIGKILL,
		syscall.SIGQUIT, // ctrl + \
		syscall.SIGINT,  // ctrl+c
	)
	defer stop()

	logLevel, err := zapcore.ParseLevel(cfg.LogLevel)
	if err != nil {
		log.Fatalf("Could not parse log level: %s", err)
	}

	logger := logging.New(false, false, logLevel).
		With(
			zap.String("service", "@wundergraph/query-plan"),
			zap.String("service_version", core.Version),
		)
	cfg.Logger = logger

	// Automatically set GOMAXPROCS to avoid CPU throttling on containerized environments
	_, err = maxprocs.Set(maxprocs.Logger(func(msg string, args ...interface{}) {
		logger.Info(fmt.Sprintf(msg, args...))
	}))
	if err != nil {
		logger.Fatal("could not set max GOMAXPROCS", zap.Error(err))
	}

	if os.Getenv("GOMEMLIMIT") != "" {
		logger.Info("GOMEMLIMIT set by user", zap.String("gomemlimit", os.Getenv("GOMEMLIMIT")))
	} else {
		// Automatically set GOMEMLIMIT to 90% of the available memory.
		// This is an effort to prevent the router from being killed by OOM (Out Of Memory)
		// when the system is under memory pressure e.g. when GC is not able to free memory fast enough.
		// More details: https://tip.golang.org/doc/gc-guide#Memory_limit
		mLimit, err := memlimit.SetGoMemLimitWithOpts(
			memlimit.WithRatio(0.9),
			// FromCgroupHybrid retrieves the memory limit from the cgroup v2 and v1 controller sequentially
			memlimit.WithProvider(memlimit.FromCgroupHybrid),
		)
		if err == nil {
			logger.Info("GOMEMLIMIT set automatically", zap.String("size", humanize.Bytes(uint64(mLimit))))
		} else {
			logger.Info(
				"GOMEMLIMIT was not set. Please set it manually to around 90%% of the available memory to "+
					"prevent OOM kills",
				zap.Error(err),
			)
		}
	}

	err = plan_generator.PlanGenerator(ctxNotify, cfg)
	if err != nil {
		logger.Fatal("Error during command plan-generator: %s", zap.Error(err))
	}
}
