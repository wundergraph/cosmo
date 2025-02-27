package cmd

import (
	"context"
	"flag"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/wundergraph/cosmo/router/pkg/plan_generator"
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

	err := plan_generator.PlanGenerator(ctxNotify, cfg)
	if err != nil {
		log.Fatalf("Error during command plan-generator: %s", err)
	}
}
