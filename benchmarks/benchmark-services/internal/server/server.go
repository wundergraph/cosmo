package server

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/99designs/gqlgen/graphql"
	"go.uber.org/zap"
)

type Server struct {
	listenAddr    string
	logger        *zap.Logger
	graphqlSchema graphql.ExecutableSchema
}

func NewServer(graphqlSchema graphql.ExecutableSchema, logger *zap.Logger) *Server {
	port := os.Getenv("port")

	if port == "" {
		port = "4004"
	}

	return &Server{listenAddr: fmt.Sprintf(":%s", port), graphqlSchema: graphqlSchema, logger: logger}
}

func (s *Server) Start(ctx context.Context) error {
	graphqlServer := NewGraphQLServer(s.graphqlSchema)

	mux := http.NewServeMux()
	mux.Handle("/graphql", graphqlServer)
	mux.Handle("/health", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("OK"))
		w.WriteHeader(http.StatusOK)
	}))

	server := &http.Server{
		Addr:    s.listenAddr,
		Handler: mux,
	}

	go func() {
		if err := server.ListenAndServe(); err != nil {
			s.logger.Error("Failed to start server", zap.Error(err))
		}
	}()

	s.logger.Info("Server started", zap.String("listenAddr", s.listenAddr))

	<-ctx.Done()

	s.logger.Info("Shutting down server")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	return server.Shutdown(ctx)
}
