// cache-demo runs only the cache-related subgraphs without requiring NATS.
package main

import (
	"log"
	"net/http"
	"strconv"

	"github.com/99designs/gqlgen/graphql"
	"github.com/99designs/gqlgen/graphql/handler"
	"github.com/99designs/gqlgen/graphql/handler/transport"
	"github.com/99designs/gqlgen/graphql/playground"
	"golang.org/x/sync/errgroup"

	"github.com/wundergraph/cosmo/demo/pkg/injector"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/cachegraph"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/cachegraph_ext"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/viewer"
)

func main() {
	servers := []*http.Server{
		gqlServer("cachegraph", 4012, cachegraph.NewSchema()),
		gqlServer("cachegraph-ext", 4013, cachegraph_ext.NewSchema()),
		viewerServer(4014),
	}

	log.Println("Cache demo subgraphs starting (no NATS required):")
	log.Println("  cachegraph:     http://localhost:4012/")
	log.Println("  cachegraph-ext: http://localhost:4013/")
	log.Println("  viewer:         http://localhost:4014/")

	g := new(errgroup.Group)
	for _, srv := range servers {
		g.Go(srv.ListenAndServe)
	}
	log.Fatal(g.Wait())
}

func gqlServer(name string, port int, schema graphql.ExecutableSchema) *http.Server {
	srv := handler.New(schema)
	srv.AddTransport(transport.POST{})
	srv.AddTransport(transport.GET{})
	mux := http.NewServeMux()
	mux.Handle("/", playground.Handler(name, "/graphql"))
	mux.Handle("/graphql", srv)
	return &http.Server{Addr: ":" + strconv.Itoa(port), Handler: injector.Latency(injector.HTTP(mux))}
}

func viewerServer(port int) *http.Server {
	mux := http.NewServeMux()
	mux.Handle("/", playground.Handler("viewer", "/graphql"))
	mux.Handle("/graphql", viewer.NewHandler())
	return &http.Server{Addr: ":" + strconv.Itoa(port), Handler: injector.Latency(injector.HTTP(mux))}
}
