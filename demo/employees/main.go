package main

import (
	"context"
	"fmt"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/99designs/gqlgen/graphql"
	"github.com/99designs/gqlgen/graphql/handler"
	"github.com/99designs/gqlgen/graphql/handler/extension"
	"github.com/99designs/gqlgen/graphql/handler/transport"
	"github.com/99designs/gqlgen/graphql/playground"
	"github.com/gorilla/websocket"
	"github.com/ravilushqa/otelgqlgen"
	"github.com/rs/cors"
	"github.com/wundergraph/cosmo/demo/employees/subgraph"
	"github.com/wundergraph/cosmo/demo/employees/subgraph/generated"
	"github.com/wundergraph/cosmo/demo/otel"
)

const (
	defaultPort = "4001"
	serviceName = "employees"
)

func main() {
	otel.InitTracing(context.Background(), otel.Options{ServiceName: serviceName})
	port := os.Getenv("PORT")
	if port == "" {
		port = defaultPort
	}

	srv := handler.New(generated.NewExecutableSchema(generated.Config{Resolvers: &subgraph.Resolver{}}))
	srv.AddTransport(transport.POST{})
	srv.AddTransport(transport.Websocket{
		KeepAlivePingInterval: 10 * time.Second,
		Upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true
			},
		},
	})
	srv.Use(extension.Introspection{})

	srv.Use(otelgqlgen.Middleware(otelgqlgen.WithCreateSpanFromFields(func(ctx *graphql.FieldContext) bool {
		return true
	})))

	c := cors.New(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedHeaders: []string{"*"},
	})

	http.Handle("/", c.Handler(playground.Handler("GraphQL playground", "/graphql")))
	http.HandleFunc("/graphql", func(writer http.ResponseWriter, request *http.Request) {
		time.Sleep(18 * time.Second)
		c.Handler(otelhttp.NewHandler(srv, "", otelhttp.WithSpanNameFormatter(func(_operation string, r *http.Request) string {
			return fmt.Sprintf("%s %s", r.Method, r.URL.Path)
		}))).ServeHTTP(writer, request)
	})

	log.Printf("connect to http://localhost:%s/ for GraphQL playground", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
