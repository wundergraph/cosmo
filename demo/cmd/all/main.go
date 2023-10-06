package main

import "github.com/wundergraph/cosmo/demo/pkg/subgraphs"

func main() {
	config := subgraphs.Subgraphs{
		Ports: subgraphs.Ports{
			Employees: 4001,
			Family:    4002,
			Hobbies:   4003,
			Products:  4004,
		},
		EnableDebug: true,
	}
	subgraphs.Listen(config)
}
