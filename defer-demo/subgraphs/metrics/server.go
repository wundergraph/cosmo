package main

import (
	"log"
	"net/http"
	"os"

	"deferdemo/metrics/graph"

	"github.com/99designs/gqlgen/graphql/handler"
	"github.com/99designs/gqlgen/graphql/handler/extension"
	"github.com/99designs/gqlgen/graphql/handler/transport"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "4105"
	}

	srv := handler.New(graph.NewExecutableSchema(graph.Config{Resolvers: &graph.Resolver{}}))
	srv.AddTransport(transport.POST{})
	srv.AddTransport(transport.GET{})
	srv.AddTransport(transport.Options{})
	srv.Use(extension.Introspection{})

	http.Handle("/graphql", srv)

	log.Printf("metrics subgraph listening on :%s/graphql", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatal(err)
	}
}
