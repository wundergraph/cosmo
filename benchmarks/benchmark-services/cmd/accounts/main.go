package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/wundergraph/benchmark-services/graphs/accounts/subgraph"
	"github.com/wundergraph/benchmark-services/internal/server"
	"go.uber.org/zap"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt,
		syscall.SIGHUP,  // process is detached from terminal
		syscall.SIGTERM, // default for kill
		syscall.SIGKILL,
		syscall.SIGQUIT, // ctrl + \
		syscall.SIGINT,  // ctrl+c
	)
	defer stop()

	logger, err := zap.NewProduction()
	if err != nil {
		log.Fatalf("Failed to create logger: %v", err)
	}

	userManager := subgraph.NewUserManager()

	schema := subgraph.NewSchema(userManager)

	server := server.NewServer(schema, logger)

	server.Start(ctx)
}
