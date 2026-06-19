package main

import (
	"log"
	"net/http"
	"os"

	"deferdemo/accounts/graph"

	"github.com/99designs/gqlgen/graphql/handler"
	"github.com/99designs/gqlgen/graphql/handler/extension"
	"github.com/99designs/gqlgen/graphql/handler/transport"
)

const defaultPort = "4101"

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

	http.Handle("/graphql", srv)

	log.Printf("accounts subgraph listening on :%s/graphql", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
