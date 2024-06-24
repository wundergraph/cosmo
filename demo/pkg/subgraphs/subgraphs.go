package subgraphs

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"go.uber.org/zap"

	"github.com/99designs/gqlgen/graphql"
	"github.com/99designs/gqlgen/graphql/handler/debug"
	"github.com/99designs/gqlgen/graphql/playground"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	natsPubsub "github.com/wundergraph/cosmo/router/pkg/pubsub/nats"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/pubsub_datasource"
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
	Ports             Ports
	EnableDebug       bool
	ArtificialLatency time.Duration
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

func newServer(name string, enableDebug bool, port int, artificialLatency time.Duration, schema graphql.ExecutableSchema) *http.Server {
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
	if artificialLatency > 0 {
		mux.HandleFunc("/graphql", func(w http.ResponseWriter, r *http.Request) {
			time.Sleep(artificialLatency)
			srv.ServeHTTP(w, r)
		})
	} else {
		mux.Handle("/graphql", srv)
	}
	return &http.Server{
		Addr:    ":" + strconv.Itoa(port),
		Handler: injector.HTTP(mux),
	}
}

func subgraphHandler(schema graphql.ExecutableSchema, options *SubgraphOptions) http.Handler {
	srv := NewDemoServer(schema)
	mux := http.NewServeMux()
	if options.ArtificialLatency > 0 {
		mux.HandleFunc("/graphql", func(w http.ResponseWriter, r *http.Request) {
			time.Sleep(options.ArtificialLatency)
			srv.ServeHTTP(w, r)
		})
	} else {
		mux.Handle("/graphql", srv)
	}
	return injector.HTTP(mux)
}

type SubgraphOptions struct {
	NatsPubSubByProviderID map[string]pubsub_datasource.NatsPubSub
	ArtificialLatency      time.Duration
}

func EmployeesHandler(opts *SubgraphOptions) http.Handler {
	return subgraphHandler(employees.NewSchema(opts.NatsPubSubByProviderID), opts)
}

func FamilyHandler(opts *SubgraphOptions) http.Handler {
	return subgraphHandler(family.NewSchema(opts.NatsPubSubByProviderID), opts)
}

func HobbiesHandler(opts *SubgraphOptions) http.Handler {
	return subgraphHandler(hobbies.NewSchema(opts.NatsPubSubByProviderID), opts)
}

func ProductsHandler(opts *SubgraphOptions) http.Handler {
	return subgraphHandler(products.NewSchema(opts.NatsPubSubByProviderID), opts)
}

func Test1Handler(opts *SubgraphOptions) http.Handler {
	return subgraphHandler(test1.NewSchema(opts.NatsPubSubByProviderID), opts)
}

func AvailabilityHandler(opts *SubgraphOptions) http.Handler {
	return subgraphHandler(availability.NewSchema(opts.NatsPubSubByProviderID), opts)
}

func MoodHandler(opts *SubgraphOptions) http.Handler {
	return subgraphHandler(mood.NewSchema(opts.NatsPubSubByProviderID), opts)
}

func CountriesHandler(opts *SubgraphOptions) http.Handler {
	return subgraphHandler(countries.NewSchema(opts.NatsPubSubByProviderID), opts)
}

func New(ctx context.Context, config *Config) (*Subgraphs, error) {
	url := nats.DefaultURL
	if defaultSourceNameURL := os.Getenv("NATS_URL"); defaultSourceNameURL != "" {
		url = defaultSourceNameURL
	}
	defaultConnection, err := nats.Connect(url)
	if err != nil {
		log.Printf("failed to connect to nats source \"nats\": %v", err)
	}

	myNatsConnection, err := nats.Connect(url)
	if err != nil {
		log.Printf("failed to connect to nats source \"my-nats\": %v", err)
	}

	defaultJetStream, err := jetstream.New(defaultConnection)
	if err != nil {
		return nil, err
	}

	myNatsJetStream, err := jetstream.New(myNatsConnection)
	if err != nil {
		return nil, err
	}

	natsPubSubByProviderID := map[string]pubsub_datasource.NatsPubSub{
		"default": natsPubsub.NewConnector(zap.NewNop(), defaultConnection, defaultJetStream).New(ctx),
		"my-nats": natsPubsub.NewConnector(zap.NewNop(), myNatsConnection, myNatsJetStream).New(ctx),
	}

	_, err = defaultJetStream.CreateOrUpdateStream(ctx, jetstream.StreamConfig{
		Name:     "streamName",
		Subjects: []string{"employeeUpdated.>"},
	})
	if err != nil {
		return nil, err
	}

	var servers []*http.Server
	if srv := newServer("employees", config.EnableDebug, config.Ports.Employees, config.ArtificialLatency, employees.NewSchema(natsPubSubByProviderID)); srv != nil {
		servers = append(servers, srv)
	}
	if srv := newServer("family", config.EnableDebug, config.Ports.Family, config.ArtificialLatency, family.NewSchema(natsPubSubByProviderID)); srv != nil {
		servers = append(servers, srv)
	}
	if srv := newServer("hobbies", config.EnableDebug, config.Ports.Hobbies, config.ArtificialLatency, hobbies.NewSchema(natsPubSubByProviderID)); srv != nil {
		servers = append(servers, srv)
	}
	if srv := newServer("products", config.EnableDebug, config.Ports.Products, config.ArtificialLatency, products.NewSchema(natsPubSubByProviderID)); srv != nil {
		servers = append(servers, srv)
	}
	if srv := newServer("test1", config.EnableDebug, config.Ports.Test1, config.ArtificialLatency, test1.NewSchema(natsPubSubByProviderID)); srv != nil {
		servers = append(servers, srv)
	}
	if srv := newServer("availability", config.EnableDebug, config.Ports.Availability, config.ArtificialLatency, availability.NewSchema(natsPubSubByProviderID)); srv != nil {
		servers = append(servers, srv)
	}
	if srv := newServer("mood", config.EnableDebug, config.Ports.Mood, config.ArtificialLatency, mood.NewSchema(natsPubSubByProviderID)); srv != nil {
		servers = append(servers, srv)
	}
	if srv := newServer("countries", config.EnableDebug, config.Ports.Countries, config.ArtificialLatency, countries.NewSchema(natsPubSubByProviderID)); srv != nil {
		servers = append(servers, srv)
	}
	return &Subgraphs{
		servers: servers,
		ports:   config.Ports,
	}, nil
}
