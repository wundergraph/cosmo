package main

import (
	"context"
	"log"
	"net/http"
	"os"

	"github.com/99designs/gqlgen/graphql/playground"
	"github.com/wundergraph/cosmo/demo/otel"
	"github.com/wundergraph/cosmo/demo/products/subgraph"
)

const (
	defaultPort = "4004"
	serviceName = "products"
)

func main() {
	otel.InitTracing(context.Background(), otel.Options{ServiceName: serviceName})

	port := os.Getenv("PORT")
	if port == "" {
		port = defaultPort
	}

	http.Handle("/", playground.Handler("GraphQL playground", "/graphql"))
	http.Handle("/graphql", subgraph.GraphQLEndpointHandler(subgraph.EndpointOptions{EnableDebug: true}))

	log.Printf("connect to http://localhost:%s/ for GraphQL playground", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
