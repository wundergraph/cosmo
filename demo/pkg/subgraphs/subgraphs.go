package subgraphs

import (
	"log"
	"net/http"
	"strconv"
	"sync"

	"github.com/99designs/gqlgen/graphql/playground"
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

type Subgraphs struct {
	Ports       Ports
	EnableDebug bool
}

func server(name string, port int, graphQLHandler http.Handler) {
	if port == 0 {
		return
	}
	log.Printf("%s listening at to http://localhost:%d/", name, port)
	mux := http.NewServeMux()
	mux.Handle("/", playground.Handler("GraphQL playground", "/graphql"))
	mux.Handle("/graphql", graphQLHandler)
	log.Fatal(http.ListenAndServe(":"+strconv.Itoa(port), mux))
}

func Listen(subgraphs Subgraphs) {
	var wg sync.WaitGroup

	wg.Add(1)
	go func() {
		defer wg.Done()
		server("employees", subgraphs.Ports.Employees, employees.GraphQLEndpointHandler(employees.EndpointOptions{EnableDebug: subgraphs.EnableDebug}))
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		server("family", subgraphs.Ports.Family, family.GraphQLEndpointHandler(family.EndpointOptions{EnableDebug: subgraphs.EnableDebug}))
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		server("hobbies", subgraphs.Ports.Hobbies, hobbies.GraphQLEndpointHandler(hobbies.EndpointOptions{EnableDebug: subgraphs.EnableDebug}))
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		server("products", subgraphs.Ports.Products, products.GraphQLEndpointHandler(products.EndpointOptions{EnableDebug: subgraphs.EnableDebug}))
	}()

	wg.Wait()
}
