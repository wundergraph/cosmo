package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"deferdemo/billing/graph"

	"github.com/99designs/gqlgen/graphql/handler"
	"github.com/99designs/gqlgen/graphql/handler/extension"
	"github.com/99designs/gqlgen/graphql/handler/transport"
)

const defaultPort = "4107"

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = defaultPort
	}

	srv := handler.New(graph.NewExecutableSchema(graph.Config{Resolvers: &graph.Resolver{}}))
	srv.AddTransport(transport.POST{})
	srv.AddTransport(transport.GET{})
	srv.AddTransport(transport.Options{})
	srv.Use(extension.Introspection{})

	mux := http.NewServeMux()
	mux.Handle("/graphql", srv)

	httpSrv := &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	log.Printf("billing subgraph listening on :%s/graphql", port)
	log.Fatal(httpSrv.ListenAndServe())
}
