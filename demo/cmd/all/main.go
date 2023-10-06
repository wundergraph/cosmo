package main

import (
	"context"
	"flag"
	"log"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs"
)

var (
	debug = flag.Bool("debug", false, "Enable debug logging")
)

func main() {
	flag.Parse()
	config := subgraphs.Config{
		Ports: subgraphs.Ports{
			Employees: 4001,
			Family:    4002,
			Hobbies:   4003,
			Products:  4004,
		},
		EnableDebug: *debug,
	}
	subgraphs, err := subgraphs.New(&config)
	if err != nil {
		log.Fatal(err)
	}
	log.Fatal(subgraphs.ListenAndServe(context.Background()))
}
