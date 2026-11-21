package cmd

import (
	"context"
	"flag"
	"log"
	"os"
	"os/signal"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/logging"
)

// PlanWorkerCommand is the first argument of the router binary that makes it run as a plan worker.
const PlanWorkerCommand = core.PlanWorkerCommand

// PlanWorker runs the router binary as a plan worker. A plan worker plans operations
// for a router, which sends its requests to the standard input of the worker and reads
// the plans from its standard output. Everything a worker needs to know about a graph
// arrives over that stream, it reads no configuration file.
//
// The router starts its workers itself. The command is not meant to be run by hand.
func PlanWorker(args []string) {
	var logLevelFlag string

	f := flag.NewFlagSet("router "+args[0], flag.ExitOnError)
	f.StringVar(&logLevelFlag, "log-level", os.Getenv("LOG_LEVEL"), "the log level to use (debug, info, warn, error, panic, fatal)")
	if err := f.Parse(args[1:]); err != nil {
		log.Fatalf("Failed to parse flags: %v", err)
	}

	logLevel := zapcore.InfoLevel
	if logLevelFlag != "" {
		var err error
		logLevel, err = zapcore.ParseLevel(logLevelFlag)
		if err != nil {
			log.Fatalf("Could not parse log level: %s", err)
		}
	}

	// The standard output carries the protocol. Nothing else may write to it, so
	// everything that prints, like the debug output of the planner, goes to stderr.
	protocolOut := os.Stdout
	os.Stdout = os.Stderr

	logger := logging.New(os.Getenv("JSON_LOG") == "false", false, false, logLevel).
		With(
			zap.String("service", "@wundergraph/router-plan-worker"),
			zap.String("service_version", core.Version),
		)

	// A terminal delivers an interrupt to the router and its workers at the same
	// time. The router decides when its workers stop, so that it can finish the
	// requests it is still serving.
	signal.Ignore(os.Interrupt)

	err := core.RunPlanWorker(context.Background(), os.Stdin, protocolOut, logger, func() {
		// The router is gone. Whatever is being planned right now, nobody waits for it.
		os.Exit(0)
	})
	if err != nil {
		logger.Fatal("Plan worker failed", zap.Error(err))
	}
}
