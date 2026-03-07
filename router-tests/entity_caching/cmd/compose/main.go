package main

import (
	"fmt"
	"os"

	composition "github.com/wundergraph/cosmo/composition-go"
)

func main() {
	itemsSchema, err := os.ReadFile("subgraphs/items/subgraph/schema.graphqls")
	if err != nil {
		fmt.Fprintf(os.Stderr, "error reading items schema: %v\n", err)
		os.Exit(1)
	}
	detailsSchema, err := os.ReadFile("subgraphs/details/subgraph/schema.graphqls")
	if err != nil {
		fmt.Fprintf(os.Stderr, "error reading details schema: %v\n", err)
		os.Exit(1)
	}
	inventorySchema, err := os.ReadFile("subgraphs/inventory/subgraph/schema.graphqls")
	if err != nil {
		fmt.Fprintf(os.Stderr, "error reading inventory schema: %v\n", err)
		os.Exit(1)
	}

	result, err := composition.BuildRouterConfiguration(
		&composition.Subgraph{
			Name:   "items",
			Schema: string(itemsSchema),
			URL:    "http://items.entity-cache-test.local/graphql",
		},
		&composition.Subgraph{
			Name:   "details",
			Schema: string(detailsSchema),
			URL:    "http://details.entity-cache-test.local/graphql",
		},
		&composition.Subgraph{
			Name:   "inventory",
			Schema: string(inventorySchema),
			URL:    "http://inventory.entity-cache-test.local/graphql",
		},
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "composition error: %v\n", err)
		os.Exit(1)
	}

	if err := os.MkdirAll("testdata", 0o755); err != nil {
		fmt.Fprintf(os.Stderr, "error creating testdata dir: %v\n", err)
		os.Exit(1)
	}
	if err := os.WriteFile("testdata/config.json", []byte(result), 0o644); err != nil {
		fmt.Fprintf(os.Stderr, "error writing config: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("config written to testdata/config.json (%d bytes)\n", len(result))
}
