package subgraphs

import (
	"context"
	"log"
	"net/http"
	"strconv"

	"github.com/99designs/gqlgen/graphql"
	"github.com/99designs/gqlgen/graphql/handler/debug"
	"github.com/99designs/gqlgen/graphql/playground"
	"golang.org/x/sync/errgroup"

	"github.com/wundergraph/cosmo/demo/pkg/injector"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/employees"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/family"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/hobbies"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/products"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/test1"
)

type Ports struct {
	Employees int
	Family    int
	Hobbies   int
	Products  int
	Test1     int
}

type Config struct {
	Ports       Ports
	EnableDebug bool
}

type Subgraphs struct {
	servers []*http.Server
	ports   Ports
}

func (s *Subgraphs) Ports() Ports {
	return s.ports
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

func newServer(name string, enableDebug bool, port int, schema graphql.ExecutableSchema) *http.Server {
	if port == 0 {
		return nil
	}
	srv := NewDemoServer(schema)
	if enableDebug {
		srv.Use(&debug.Tracer{})
	}
	log.Printf("%s listening at to http://localhost:%d/", name, port)
	mux := http.NewServeMux()
	mux.Handle("/", playground.Handler("GraphQL playground", "/graphql"))
	mux.Handle("/graphql", srv)
	return &http.Server{
		Addr:    ":" + strconv.Itoa(port),
		Handler: injector.HTTP(mux),
	}
}

func New(config *Config) (*Subgraphs, error) {
	var servers []*http.Server
	if srv := newServer("employees", config.EnableDebug, config.Ports.Employees, employees.NewSchema()); srv != nil {
		servers = append(servers, srv)
	}
	if srv := newServer("family", config.EnableDebug, config.Ports.Family, family.NewSchema()); srv != nil {
		servers = append(servers, srv)
	}
	if srv := newServer("hobbies", config.EnableDebug, config.Ports.Hobbies, hobbies.NewSchema()); srv != nil {
		servers = append(servers, srv)
	}
	if srv := newServer("products", config.EnableDebug, config.Ports.Products, products.NewSchema()); srv != nil {
		servers = append(servers, srv)
	}
	if srv := newServer("test1", config.EnableDebug, config.Ports.Test1, test1.NewSchema()); srv != nil {
		servers = append(servers, srv)
	}
	return &Subgraphs{
		servers: servers,
		ports:   config.Ports,
	}, nil
}
