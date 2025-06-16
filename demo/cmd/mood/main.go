package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/mood"

	"github.com/99designs/gqlgen/graphql"
	"github.com/99designs/gqlgen/graphql/handler/debug"
	"github.com/99designs/gqlgen/graphql/playground"
	"github.com/ravilushqa/otelgqlgen"
	"github.com/rs/cors"
	"github.com/wundergraph/cosmo/demo/pkg/injector"
	"github.com/wundergraph/cosmo/demo/pkg/otel"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

const (
	defaultPort = "4008"
	serviceName = "mood"
)

func main() {
	otel.InitTracing(context.Background(), otel.Options{ServiceName: serviceName})
	port := os.Getenv("PORT")
	if port == "" {
		port = defaultPort
	}

	srv := subgraphs.NewDemoServer(mood.NewSchema(nil, func(name string) string {
		return name
	}))

	srv.Use(&debug.Tracer{})
	srv.Use(otelgqlgen.Middleware(otelgqlgen.WithCreateSpanFromFields(func(ctx *graphql.FieldContext) bool {
		return true
	})))

	c := cors.New(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedHeaders: []string{"*"},
	})

	http.Handle("/", c.Handler(playground.Handler("GraphQL playground", "/graphql")))
	http.Handle("/graphql", injector.HTTP(c.Handler(otelhttp.NewHandler(srv, "", otelhttp.WithSpanNameFormatter(func(_operation string, r *http.Request) string {
		return fmt.Sprintf("%s %s", r.Method, r.URL.Path)
	})))))

	log.Printf("connect to http://localhost:%s/ for GraphQL playground", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
