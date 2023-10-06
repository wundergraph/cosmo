package main

import (
	"context"
	"log"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs"
)

func main() {
	config := subgraphs.Config{
		Ports: subgraphs.Ports{
			Employees: 4001,
			Family:    4002,
			Hobbies:   4003,
			Products:  4004,
		},
		EnableDebug: true,
	}
	subgraphs, err := subgraphs.New(&config)
	if err != nil {
		log.Fatal(err)
	}
	log.Fatal(subgraphs.ListenAndServe(context.Background()))
}
