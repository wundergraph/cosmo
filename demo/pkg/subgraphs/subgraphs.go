package subgraphs

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/products_fg"
	"github.com/wundergraph/cosmo/router/core"
	"go.uber.org/zap"

	"github.com/99designs/gqlgen/graphql"
	"github.com/99designs/gqlgen/graphql/handler/debug"
	"github.com/99designs/gqlgen/graphql/playground"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	natsPubsub "github.com/wundergraph/cosmo/router/pkg/pubsub/nats"
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
	ProductsFgDefaultDemoURL   = "http://localhost:4010/graphql"
	ProjectsDefaultDemoURL     = "dns:///localhost:4011"
)

type Ports struct {
	Employees    int
	Family       int
	Hobbies      int
	Products     int
	ProductsFG   int
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
		p.ProductsFG,
		p.Test1,
		p.Availability,
		p.Mood,
		p.Countries,
	}
}

type Config struct {
	Ports         Ports
	EnableDebug   bool
	PubSubPrefix  string
	GetPubSubName func(string) string
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
			if err != nil && !errors.Is(err, http.ErrServerClosed) {
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
	mux.Handle("/graphql", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Accept") == "text/event-stream" && r.Method == "GET" {
			r.Method = "POST"
			query := r.URL.Query().Get("query")
			variables := r.URL.Query().Get("variables")
			operationName := r.URL.Query().Get("operationName")
			gqlRequest := core.GraphQLRequest{
				Query:         query,
				OperationName: operationName,
				Variables:     []byte(variables),
			}
			data, err := json.Marshal(gqlRequest)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			r.Body = io.NopCloser(bytes.NewReader(data))
			r.ContentLength = int64(len(data))
			r.Header.Set("Content-Type", "application/json")
		}
		srv.ServeHTTP(w, r)
	}))
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
	NatsPubSubByProviderID map[string]natsPubsub.Adapter
	GetPubSubName          func(string) string
}

func EmployeesHandler(opts *SubgraphOptions) http.Handler {
	return subgraphHandler(employees.NewSchema(opts.NatsPubSubByProviderID))
}

func FamilyHandler(opts *SubgraphOptions) http.Handler {
	return subgraphHandler(family.NewSchema(opts.NatsPubSubByProviderID))
}

func HobbiesHandler(opts *SubgraphOptions) http.Handler {
	return subgraphHandler(hobbies.NewSchema(opts.NatsPubSubByProviderID))
}

func ProductsHandler(opts *SubgraphOptions) http.Handler {
	return subgraphHandler(products.NewSchema(opts.NatsPubSubByProviderID))
}

func ProductsFGHandler(opts *SubgraphOptions) http.Handler {
	return subgraphHandler(products_fg.NewSchema(opts.NatsPubSubByProviderID))
}

func Test1Handler(opts *SubgraphOptions) http.Handler {
	return subgraphHandler(test1.NewSchema(opts.NatsPubSubByProviderID))
}

func AvailabilityHandler(opts *SubgraphOptions) http.Handler {
	return subgraphHandler(availability.NewSchema(opts.NatsPubSubByProviderID, opts.GetPubSubName))
}

func MoodHandler(opts *SubgraphOptions) http.Handler {
	return subgraphHandler(mood.NewSchema(opts.NatsPubSubByProviderID, opts.GetPubSubName))
}

func CountriesHandler(opts *SubgraphOptions) http.Handler {
	return subgraphHandler(countries.NewSchema(opts.NatsPubSubByProviderID))
}

func New(ctx context.Context, config *Config) (*Subgraphs, error) {
	url := nats.DefaultURL
	if defaultSourceNameURL := os.Getenv("NATS_URL"); defaultSourceNameURL != "" {
		url = defaultSourceNameURL
	}

	natsPubSubByProviderID := map[string]natsPubsub.Adapter{}

	defaultAdapter, err := natsPubsub.NewAdapter(ctx, zap.NewNop(), url, []nats.Option{}, "hostname", "test")
	if err != nil {
		return nil, fmt.Errorf("failed to create default nats adapter: %w", err)
	}
	natsPubSubByProviderID["default"] = defaultAdapter

	myNatsAdapter, err := natsPubsub.NewAdapter(ctx, zap.NewNop(), url, []nats.Option{}, "hostname", "test")
	if err != nil {
		return nil, fmt.Errorf("failed to create my-nats adapter: %w", err)
	}
	natsPubSubByProviderID["my-nats"] = myNatsAdapter

	defaultConnection, err := nats.Connect(url)
	if err != nil {
		log.Printf("failed to connect to nats source \"nats\": %v", err)
	}
	defaultJetStream, err := jetstream.New(defaultConnection)
	if err != nil {
		return nil, err
	}

	_, err = defaultJetStream.CreateOrUpdateStream(ctx, jetstream.StreamConfig{
		Name:     "streamName",
		Subjects: []string{"employeeUpdated.>"},
	})
	if err != nil {
		return nil, err
	}

	var servers []*http.Server
	if srv := newServer("employees", config.EnableDebug, config.Ports.Employees, employees.NewSchema(natsPubSubByProviderID)); srv != nil {
		servers = append(servers, srv)
	}
	if srv := newServer("family", config.EnableDebug, config.Ports.Family, family.NewSchema(natsPubSubByProviderID)); srv != nil {
		servers = append(servers, srv)
	}
	if srv := newServer("hobbies", config.EnableDebug, config.Ports.Hobbies, hobbies.NewSchema(natsPubSubByProviderID)); srv != nil {
		servers = append(servers, srv)
	}
	if srv := newServer("products", config.EnableDebug, config.Ports.Products, products.NewSchema(natsPubSubByProviderID)); srv != nil {
		servers = append(servers, srv)
	}
	if srv := newServer("products_fg", config.EnableDebug, config.Ports.ProductsFG, products.NewSchema(natsPubSubByProviderID)); srv != nil {
		servers = append(servers, srv)
	}
	if srv := newServer("test1", config.EnableDebug, config.Ports.Test1, test1.NewSchema(natsPubSubByProviderID)); srv != nil {
		servers = append(servers, srv)
	}
	if srv := newServer("availability", config.EnableDebug, config.Ports.Availability, availability.NewSchema(natsPubSubByProviderID, config.GetPubSubName)); srv != nil {
		servers = append(servers, srv)
	}
	if srv := newServer("mood", config.EnableDebug, config.Ports.Mood, mood.NewSchema(natsPubSubByProviderID, config.GetPubSubName)); srv != nil {
		servers = append(servers, srv)
	}
	if srv := newServer("countries", config.EnableDebug, config.Ports.Countries, countries.NewSchema(natsPubSubByProviderID)); srv != nil {
		servers = append(servers, srv)
	}
	return &Subgraphs{
		servers: servers,
		ports:   config.Ports,
	}, nil
}
