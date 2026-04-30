// This file is used to spawn the projects service as a standalone subgraph.
// In contrast to the main.go in src which is used for gRPC plugins in the
// router, this allows the service to be deployed independently and reached
// via the federation.
//
// The service is exposed through a ConnectRPC handler running over H2C, so
// the same endpoint accepts ConnectRPC, gRPC, and gRPC-Web traffic from the
// router on a single port. This means the demo subgraph can be exercised
// with whichever transport the router is configured to use via the
// `grpc_protocol` block.

package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"connectrpc.com/connect"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects/generated/projectsconnect"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects/src/service"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	addr = ":4011"
)

// recoveryInterceptor catches panics from RPC handlers so that one bad
// request cannot bring down the whole server.
func recoveryInterceptor() connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (resp connect.AnyResponse, err error) {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("Recovered from panic: %v", r)
					err = connect.NewError(connect.CodeInternal, status.Errorf(codes.Internal, "panic: %v", r))
				}
			}()
			return next(ctx, req)
		}
	}
}

// loggingInterceptor reports every RPC's procedure name, duration, and error.
func loggingInterceptor() connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			start := time.Now()
			resp, err := next(ctx, req)
			log.Printf("Method: %s, Duration: %s, Error: %v",
				req.Spec().Procedure,
				time.Since(start),
				err,
			)
			return resp, err
		}
	}
}

// errorInterceptor maps non-Connect errors to internal-server errors so
// clients always observe a structured error response.
func errorInterceptor() connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			resp, err := next(ctx, req)
			if err != nil {
				var connErr *connect.Error
				if !errors.As(err, &connErr) {
					if _, ok := status.FromError(err); !ok {
						err = connect.NewError(connect.CodeInternal, status.Errorf(codes.Internal, "internal server error: %v", err))
					}
				}
			}
			return resp, err
		}
	}
}

func main() {
	grpcImpl := &service.ProjectsService{}
	connectImpl := service.NewProjectsConnectService(grpcImpl)

	mux := http.NewServeMux()
	mux.Handle(projectsconnect.NewProjectsServiceHandler(
		connectImpl,
		connect.WithInterceptors(
			connect.UnaryInterceptorFunc(recoveryInterceptor()),
			connect.UnaryInterceptorFunc(loggingInterceptor()),
			connect.UnaryInterceptorFunc(errorInterceptor()),
		),
	))

	srv := &http.Server{
		Addr:    addr,
		Handler: h2c.NewHandler(mux, &http2.Server{}),
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("Starting projects subgraph on %s (Connect, gRPC, gRPC-Web over H2C)", addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server error: %v", err)
		}
	}()

	<-ctx.Done()

	log.Println("Shutting down projects subgraph...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("graceful shutdown failed: %v", err)
	}
	log.Println("Server stopped")
}
