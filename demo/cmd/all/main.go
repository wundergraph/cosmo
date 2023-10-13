package main

import (
	"context"
	"flag"
	"log"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs"
)

var (
	debug     = flag.Bool("debug", false, "Enable debug logging")
	employees = flag.Int("employees", 4001, "Port for employees subgraph")
	family    = flag.Int("family", 4002, "Port for family subgraph")
	hobbies   = flag.Int("hobbies", 4003, "Port for hobbies subgraph")
	products  = flag.Int("products", 4004, "Port for products subgraph")
)

func main() {
	flag.Parse()
	config := subgraphs.Config{
		Ports: subgraphs.Ports{
			Employees: *employees,
			Family:    *family,
			Hobbies:   *hobbies,
			Products:  *products,
		},
		EnableDebug: *debug,
	}
	subgraphs, err := subgraphs.New(&config)
	if err != nil {
		log.Fatal(err)
	}
	log.Fatal(subgraphs.ListenAndServe(context.Background()))
}
