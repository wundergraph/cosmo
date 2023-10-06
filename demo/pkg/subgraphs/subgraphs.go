package subgraphs

import (
	"context"
	"log"
	"net/http"
	"strconv"

	"github.com/99designs/gqlgen/graphql/playground"
	"golang.org/x/sync/errgroup"

	employees "github.com/wundergraph/cosmo/demo/pkg/subgraphs/employees/subgraph"
	family "github.com/wundergraph/cosmo/demo/pkg/subgraphs/family/subgraph"
	hobbies "github.com/wundergraph/cosmo/demo/pkg/subgraphs/hobbies/subgraph"
	products "github.com/wundergraph/cosmo/demo/pkg/subgraphs/products/subgraph"
)

type Ports struct {
	Employees int
	Family    int
	Hobbies   int
	Products  int
}

type Config struct {
	Ports       Ports
	EnableDebug bool
}

type Subgraphs struct {
	servers []*http.Server
}

func (s *Subgraphs) Shutdown(ctx context.Context) error {
	for _, srv := range s.servers {
		if err := srv.Shutdown(ctx); err != nil {
			return err
		}
	}
	return nil
}

func (s *Subgraphs) ListenAndServe(ctx context.Context) error {
	group, _ := errgroup.WithContext(ctx)
	for _, srv := range s.servers {
		group.Go(srv.ListenAndServe)
	}
	return group.Wait()
}

func newServer(name string, port int, graphQLHandler http.Handler) *http.Server {
	if port == 0 {
		return nil
	}
	log.Printf("%s listening at to http://localhost:%d/", name, port)
	mux := http.NewServeMux()
	mux.Handle("/", playground.Handler("GraphQL playground", "/graphql"))
	mux.Handle("/graphql", graphQLHandler)
	return &http.Server{
		Addr:    ":" + strconv.Itoa(port),
		Handler: mux,
	}
}

func New(config *Config) (*Subgraphs, error) {
	var servers []*http.Server
	if srv := newServer("employees", config.Ports.Employees, employees.GraphQLEndpointHandler(employees.EndpointOptions{EnableDebug: config.EnableDebug})); srv != nil {
		servers = append(servers, srv)
	}
	if srv := newServer("family", config.Ports.Family, family.GraphQLEndpointHandler(family.EndpointOptions{EnableDebug: config.EnableDebug})); srv != nil {
		servers = append(servers, srv)
	}
	if srv := newServer("hobbies", config.Ports.Hobbies, hobbies.GraphQLEndpointHandler(hobbies.EndpointOptions{EnableDebug: config.EnableDebug})); srv != nil {
		servers = append(servers, srv)
	}
	if srv := newServer("products", config.Ports.Products, products.GraphQLEndpointHandler(products.EndpointOptions{EnableDebug: config.EnableDebug})); srv != nil {
		servers = append(servers, srv)
	}
	return &Subgraphs{
		servers: servers,
	}, nil
}
