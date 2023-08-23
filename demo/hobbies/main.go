package main

import (
	"github.com/99designs/gqlgen/graphql/playground"
	"github.com/wundergraph/comso/demo/hobbies/subgraph"
	"log"
	"net/http"
	"os"
)

const defaultPort = "4003"

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = defaultPort
	}

	http.Handle("/", playground.Handler("GraphQL playground", "/graphql"))
	http.Handle("/graphql", subgraph.GraphQLEndpointHandler(subgraph.EndpointOptions{EnableDebug: true}))

	log.Printf("connect to http://localhost:%s/ for GraphQL playground", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
