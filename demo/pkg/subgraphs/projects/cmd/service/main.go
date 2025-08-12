// This file is used to spawn the projects service as a standalone gRPC service.
// In contrast to the main.go in src which is used for gRPC plugins in the router.
// This allows the service to be deployed independently and communicate via gRPC
// with other services in the federation.

package main

import (
	"context"
	"log"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	projects "github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects/generated"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects/src/service"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	port = ":4011"
)

func recoveryInterceptor(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("Recovered from panic: %v", r)
		}
	}()

	return handler(ctx, req)
}

func loggingInterceptor(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
	start := time.Now()

	resp, err := handler(ctx, req)

	// Log the request details
	log.Printf("Method: %s, Duration: %s, Error: %v",
		info.FullMethod,
		time.Since(start),
		err,
	)

	return resp, err
}

func errorInterceptor(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
	resp, err := handler(ctx, req)
	if err != nil {
		if _, ok := status.FromError(err); !ok {
			err = status.Errorf(codes.Internal, "internal server error: %v", err)
		}
	}

	return resp, err
}

func main() {
	// Create a listener on the specified port
	lis, err := net.Listen("tcp", port)
	if err != nil {
		log.Fatalf("failed to listen: %v", err)
	}

	// Create a new gRPC server
	s := grpc.NewServer(
		grpc.ChainUnaryInterceptor(
			recoveryInterceptor,
			loggingInterceptor,
			errorInterceptor,
		),
	)

	// Register the service
	projects.RegisterProjectsServiceServer(s, &service.ProjectsService{})

	// Create a context that will be canceled on OS signals
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Start the server in a goroutine
	go func() {
		log.Printf("Starting gRPC server on %s", port)
		if err := s.Serve(lis); err != nil {
			log.Fatalf("failed to serve: %v", err)
		}
	}()

	// Wait for interrupt signal
	<-ctx.Done()

	// Gracefully stop the server
	log.Println("Shutting down gRPC server...")
	s.GracefulStop()
	log.Println("Server stopped")
}
