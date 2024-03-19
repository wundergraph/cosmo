package subgraphs

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"

	"github.com/99designs/gqlgen/graphql"
	"github.com/99designs/gqlgen/graphql/handler/debug"
	"github.com/99designs/gqlgen/graphql/playground"
	"github.com/nats-io/nats.go"
	"golang.org/x/sync/errgroup"

	"github.com/wundergraph/cosmo/demo/pkg/injector"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/availability"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/countries"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/employees"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/family"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/hobbies"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/mood"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/products"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/test1"
)

const (
	EmployeesDefaultDemoURL    = "http://localhost:4001/graphql"
	FamilyDefaultDemoURL       = "http://localhost:4002/graphql"
	HobbiesDefaultDemoURL      = "http://localhost:4003/graphql"
	ProductsDefaultDemoURL     = "http://localhost:4004/graphql"
	Test1DefaultDemoURL        = "http://localhost:4006/graphql"
	AvailabilityDefaultDemoURL = "http://localhost:4007/graphql"
	MoodDefaultDemoURL         = "http://localhost:4008/graphql"
	CountriesDefaultDemoURL    = "http://localhost:4009/graphql"
)

type Ports struct {
	Employees    int
	Family       int
	Hobbies      int
	Products     int
	Test1        int
	Availability int
	Mood         int
	Countries    int
}

func (p *Ports) AsArray() []int {
	return []int{
		p.Employees,
		p.Family,
		p.Hobbies,
		p.Products,
		p.Test1,
		p.Availability,
		p.Mood,
		p.Countries,
	}
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
		srv := srv
		group.Go(func() error {
			err := srv.ListenAndServe()
			if err != nil && err != http.ErrServerClosed {
				log.Printf("error listening and serving: %v", err)
				return err
			}
			return nil
		})
	}
	return group.Wait()
}

func newServer(name string, enableDebug bool, port int, schema graphql.ExecutableSchema) *http.Server {
	if port == 0 {
		panic(fmt.Errorf("port for %s is 0", name))
		return nil
	}
	srv := NewDemoServer(schema)
	if enableDebug {
		srv.Use(&debug.Tracer{})
	}
	mux := http.NewServeMux()
	mux.Handle("/", playground.Handler("GraphQL playground", "/graphql"))
	mux.Handle("/graphql", srv)
	return &http.Server{
		Addr:    ":" + strconv.Itoa(port),
		Handler: injector.HTTP(mux),
	}
}

func subgraphHandler(schema graphql.ExecutableSchema) http.Handler {
	srv := NewDemoServer(schema)
	mux := http.NewServeMux()
	mux.Handle("/graphql", srv)
	return injector.HTTP(mux)
}

type SubgraphOptions struct {
	NatsConnectionBySourceName map[string]*nats.Conn
}

func EmployeesHandler(opts *SubgraphOptions) http.Handler {
	return subgraphHandler(employees.NewSchema(opts.NatsConnectionBySourceName))
}

func FamilyHandler(opts *SubgraphOptions) http.Handler {
	return subgraphHandler(family.NewSchema(opts.NatsConnectionBySourceName))
}

func HobbiesHandler(opts *SubgraphOptions) http.Handler {
	return subgraphHandler(hobbies.NewSchema(opts.NatsConnectionBySourceName))
}

func ProductsHandler(opts *SubgraphOptions) http.Handler {
	return subgraphHandler(products.NewSchema(opts.NatsConnectionBySourceName))
}

func Test1Handler(opts *SubgraphOptions) http.Handler {
	return subgraphHandler(test1.NewSchema(opts.NatsConnectionBySourceName))
}

func AvailabilityHandler(opts *SubgraphOptions) http.Handler {
	return subgraphHandler(availability.NewSchema(opts.NatsConnectionBySourceName))
}

func MoodHandler(opts *SubgraphOptions) http.Handler {
	return subgraphHandler(mood.NewSchema(opts.NatsConnectionBySourceName))
}

func CountriesHandler(opts *SubgraphOptions) http.Handler {
	return subgraphHandler(countries.NewSchema(opts.NatsConnectionBySourceName))
}

func New(config *Config) (*Subgraphs, error) {
	url := nats.DefaultURL
	if defaultSourceNameURL := os.Getenv("NATS_URL"); defaultSourceNameURL != "" {
		url = defaultSourceNameURL
	}
	defaultConnection, err := nats.Connect(url)
	if err != nil {
		log.Printf("failed to connect to nats source \"default\": %v", err)
	}
	secondUrl := "nats://127.0.0.1:4223"
	if myNatsSourceNameURL := os.Getenv("NATS_URL_TWO"); myNatsSourceNameURL != "" && url != myNatsSourceNameURL {
		secondUrl = myNatsSourceNameURL
	}
	if url == secondUrl {
		log.Printf("both nats sources are configured to the same url: %s", url)
	}
	myNatsConnection, err := nats.Connect(secondUrl)
	if err != nil {
		log.Printf("failed to connect to nats source \"my-nats\": %v", err)
	}

	natsConnectionBySourceName := map[string]*nats.Conn{
		"default": defaultConnection,
		"my-nats": myNatsConnection,
	}
	var servers []*http.Server
	if srv := newServer("employees", config.EnableDebug, config.Ports.Employees, employees.NewSchema(natsConnectionBySourceName)); srv != nil {
		servers = append(servers, srv)
	}
	if srv := newServer("family", config.EnableDebug, config.Ports.Family, family.NewSchema(natsConnectionBySourceName)); srv != nil {
		servers = append(servers, srv)
	}
	if srv := newServer("hobbies", config.EnableDebug, config.Ports.Hobbies, hobbies.NewSchema(natsConnectionBySourceName)); srv != nil {
		servers = append(servers, srv)
	}
	if srv := newServer("products", config.EnableDebug, config.Ports.Products, products.NewSchema(natsConnectionBySourceName)); srv != nil {
		servers = append(servers, srv)
	}
	if srv := newServer("test1", config.EnableDebug, config.Ports.Test1, test1.NewSchema(natsConnectionBySourceName)); srv != nil {
		servers = append(servers, srv)
	}
	if srv := newServer("availability", config.EnableDebug, config.Ports.Availability, availability.NewSchema(natsConnectionBySourceName)); srv != nil {
		servers = append(servers, srv)
	}
	if srv := newServer("mood", config.EnableDebug, config.Ports.Mood, mood.NewSchema(natsConnectionBySourceName)); srv != nil {
		servers = append(servers, srv)
	}
	if srv := newServer("countries", config.EnableDebug, config.Ports.Countries, countries.NewSchema(natsConnectionBySourceName)); srv != nil {
		servers = append(servers, srv)
	}
	return &Subgraphs{
		servers: servers,
		ports:   config.Ports,
	}, nil
}
