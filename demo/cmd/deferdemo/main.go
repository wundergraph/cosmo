package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/deferdemo"
)

const (
	serverReadHeaderTimeout = 5 * time.Second
	serverReadTimeout       = 30 * time.Second
	serverIdleTimeout       = 60 * time.Second
	shutdownTimeout         = 5 * time.Second
)

type serverConfig struct {
	name    string
	addr    string
	handler http.Handler
}

type listeningServer struct {
	name     string
	server   *http.Server
	listener net.Listener
}

// Starts the three defer demo subgraphs (per-field artificial latency, see
// pkg/subgraphs/deferdemo). Composition source: demo/graph-defer-demo.yaml.
func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	exitCode := runMain(ctx)
	stop()
	os.Exit(exitCode)
}

func runMain(ctx context.Context) int {
	if err := run(ctx); err != nil {
		log.Printf("defer demo subgraphs stopped with an error: %v", err)
		return 1
	}
	return 0
}

func run(ctx context.Context) error {
	latencies, err := deferdemo.NewLatenciesFromEnv()
	if err != nil {
		return err
	}

	servers, err := listenServers(demoServerConfigs(latencies))
	if err != nil {
		return err
	}

	log.Println("defer demo subgraphs listening on localhost:4012-4014")
	return serveServers(ctx, servers, shutdownTimeout)
}

func demoServerConfigs(latencies deferdemo.Latencies) []serverConfig {
	options := &subgraphs.SubgraphOptions{DeferDemoLatencies: latencies}
	return []serverConfig{
		{name: "catalog", addr: "localhost:4012", handler: subgraphs.CatalogHandler(options)},
		{name: "pricing", addr: "localhost:4013", handler: subgraphs.PricingHandler(options)},
		{name: "reviews", addr: "localhost:4014", handler: subgraphs.ReviewsHandler(options)},
	}
}

func newHTTPServer(config serverConfig) *http.Server {
	mux := http.NewServeMux()
	mux.Handle("/graphql", config.handler)

	return &http.Server{
		Addr:              config.addr,
		Handler:           mux,
		ReadHeaderTimeout: serverReadHeaderTimeout,
		ReadTimeout:       serverReadTimeout,
		IdleTimeout:       serverIdleTimeout,
	}
}

func listenServers(configs []serverConfig) ([]listeningServer, error) {
	servers := make([]listeningServer, 0, len(configs))
	for _, config := range configs {
		listener, err := net.Listen("tcp", config.addr)
		if err != nil {
			for _, server := range servers {
				_ = server.listener.Close()
			}
			return nil, fmt.Errorf("listen for %s on %s: %w", config.name, config.addr, err)
		}
		servers = append(servers, listeningServer{
			name:     config.name,
			server:   newHTTPServer(config),
			listener: listener,
		})
	}
	return servers, nil
}

type serveResult struct {
	server listeningServer
	err    error
}

func serveServers(ctx context.Context, servers []listeningServer, gracefulTimeout time.Duration) error {
	if len(servers) == 0 {
		return nil
	}

	results := make(chan serveResult, len(servers))
	for _, server := range servers {
		server := server
		go func() {
			results <- serveResult{server: server, err: server.server.Serve(server.listener)}
		}()
	}

	remaining := len(servers)
	var serveErr error
	select {
	case <-ctx.Done():
	case result := <-results:
		remaining--
		serveErr = unexpectedServeError(result)
	}

	shutdownErr := shutdownServers(ctx, servers, gracefulTimeout)
	for range remaining {
		result := <-results
		if result.err != nil && !errors.Is(result.err, http.ErrServerClosed) {
			serveErr = errors.Join(serveErr, formatServeError(result))
		}
	}

	return errors.Join(serveErr, shutdownErr)
}

func unexpectedServeError(result serveResult) error {
	if result.err == nil || errors.Is(result.err, http.ErrServerClosed) {
		return fmt.Errorf("serve %s stopped unexpectedly", serverDescription(result.server))
	}
	return formatServeError(result)
}

func formatServeError(result serveResult) error {
	return fmt.Errorf("serve %s: %w", serverDescription(result.server), result.err)
}

func shutdownServers(ctx context.Context, servers []listeningServer, gracefulTimeout time.Duration) error {
	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), gracefulTimeout)
	defer cancel()

	var shutdownErr error
	for _, server := range servers {
		if err := server.server.Shutdown(shutdownCtx); err != nil {
			shutdownErr = errors.Join(shutdownErr, fmt.Errorf("shut down %s: %w", serverDescription(server), err))
		}
	}

	if shutdownErr != nil {
		for _, server := range servers {
			if err := server.server.Close(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				shutdownErr = errors.Join(shutdownErr, fmt.Errorf("close %s: %w", serverDescription(server), err))
			}
		}
	}

	return shutdownErr
}

func serverDescription(server listeningServer) string {
	if server.name != "" {
		return fmt.Sprintf("%s on %s", server.name, server.server.Addr)
	}
	return server.server.Addr
}
