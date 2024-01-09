package main

import (
	_ "embed"
	"log"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"

	"github.com/wundergraph/cosmo/composition-go"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs"
)

func main() {

	employees := subgraphs.EmployeesHandler(&subgraphs.SubgraphOptions{})

	family := subgraphs.FamilyHandler(&subgraphs.SubgraphOptions{})

	hobbies := subgraphs.HobbiesHandler(&subgraphs.SubgraphOptions{})

	products := subgraphs.ProductsHandler(&subgraphs.SubgraphOptions{})

	test1 := subgraphs.Test1Handler(&subgraphs.SubgraphOptions{})

	availability := subgraphs.AvailabilityHandler(&subgraphs.SubgraphOptions{})

	mood := subgraphs.MoodHandler(&subgraphs.SubgraphOptions{})

	employeesServer := httptest.NewServer(employees)
	defer employeesServer.Close()
	familyServer := httptest.NewServer(family)
	defer familyServer.Close()
	hobbiesServer := httptest.NewServer(hobbies)
	defer hobbiesServer.Close()
	productsServer := httptest.NewServer(products)
	defer productsServer.Close()
	test1Server := httptest.NewServer(test1)
	defer test1Server.Close()
	availabilityServer := httptest.NewServer(availability)
	defer availabilityServer.Close()
	moodServer := httptest.NewServer(mood)
	defer moodServer.Close()

	employeeUpdatedSchema, err := os.ReadFile(filepath.Join("..", "..", "pkg", "subgraphs", "employeeupdated", "subgraph", "schema.graphqls"))
	if err != nil {
		log.Fatal(err)
	}

	sgs := []*composition.Subgraph{
		{
			Name: "employees",
			URL:  gqlURL(employeesServer),
		},
		{
			Name: "family",
			URL:  gqlURL(familyServer),
		},
		{
			Name: "hobbies",
			URL:  gqlURL(hobbiesServer),
		},
		{
			Name: "products",
			URL:  gqlURL(productsServer),
		},
		{
			Name: "test1",
			URL:  gqlURL(test1Server),
		},
		{
			Name: "availability",
			URL:  gqlURL(availabilityServer),
		},
		{
			Name: "mood",
			URL:  gqlURL(moodServer),
		},
		{
			Name:   "employeeupdated",
			Schema: string(employeeUpdatedSchema),
		},
	}

	routerConfigJSON, err := composition.BuildRouterConfiguration(sgs...)
	if err != nil {
		log.Fatal(err)
	}

	// replace all occurrences of URLs with go template variables, e.g. http://localhost:4000/graphql -> {{ .EmployeesURL }}
	// regex to match URLs
	rex, err := regexp.Compile(`http://127.0.0.1:\d+/graphql`)
	if err != nil {
		log.Fatal(err)
	}
	// replace URLs with go template variables
	routerConfigJSON = rex.ReplaceAllStringFunc(routerConfigJSON, func(s string) string {
		switch s {
		case sgs[0].URL:
			return "{{ .EmployeesURL }}"
		case sgs[1].URL:
			return "{{ .FamilyURL }}"
		case sgs[2].URL:
			return "{{ .HobbiesURL }}"
		case sgs[3].URL:
			return "{{ .ProductsURL }}"
		case sgs[4].URL:
			return "{{ .Test1URL }}"
		case sgs[5].URL:
			return "{{ .AvailabilityURL }}"
		case sgs[6].URL:
			return "{{ .MoodURL }}"
		default:
			return s
		}
	})

	err = os.WriteFile(filepath.Join("..", "..", "..", "router-tests", "testenv", "testdata", "config.json"), []byte(routerConfigJSON), os.ModePerm)
	if err != nil {
		log.Fatal(err)
	}
}

func gqlURL(srv *httptest.Server) string {
	path, err := url.JoinPath(srv.URL, "/graphql")
	if err != nil {
		panic(err)
	}
	return path
}
