//go:generate ./generate.sh

// Package composition implements federation composition for GraphQL.
package composition

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
)

// Subgraph represents a graph to be federated. URL is optional.
type Subgraph struct {
	// Name is the name of the subgraph
	Name string `goja:"name"`
	// URL is the URL of the subgraph used for sending operations
	URL string `goja:"url"`
	// Schema is the SDL of the subgraph as a string
	Schema string `goja:"schema"`
}

type ArgumentConfiguration struct {
	ArgumentNames []string `goja:"argumentNames"`
	FieldName     string   `goja:"fieldName"`
	TypeName      string   `goja:"typeName"`
}

type FederatedGraph struct {
	ArgumentConfigurations []*ArgumentConfiguration `goja:"argumentConfigurations"`
	SDL                    string                   `goja:"sdl"`
}

const (
	// This is required because the polyfill for events
	// expects a browser environment and references navigator
	jsPrelude = `var navigator = {
		language: 'EN'
	};`

	sdlQuery = `{"query": "query {_service { sdl } }"}`
)

//go:embed index.global.js
var indexJs string

var (
	pool sync.Pool
)

func updateSchemas(subgraphs []*Subgraph) ([]*Subgraph, error) {
	updatedSubgraphs := make([]*Subgraph, 0, len(subgraphs))
	for _, subgraph := range subgraphs {
		if subgraph.Schema != "" {
			updatedSubgraphs = append(updatedSubgraphs, subgraph)
			continue
		}
		req, err := http.NewRequest("POST", subgraph.URL, strings.NewReader(sdlQuery))
		if err != nil {
			return nil, fmt.Errorf("could not create request retrieving schema for subgraph %s: %w", subgraph.Name, err)
		}
		req.Header.Add("Content-Type", "application/json")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return nil, fmt.Errorf("could not retrieve schema for subgraph %s: %w", subgraph.Name, err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("could not retrieve schema for subgraph %s: unexpected status code %d", subgraph.Name, resp.StatusCode)
		}
		var sdlResult struct {
			Data struct {
				Service struct {
					SDL string `json:"sdl"`
				} `json:"_service"`
			} `json:"data"`
			Errors []struct {
				Message string `json:"message"`
			} `json:"errors"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&sdlResult); err != nil {
			return nil, fmt.Errorf("could decode SDL response for subgraph %s: %w", subgraph.Name, err)
		}
		cpy := *subgraph
		cpy.Schema = sdlResult.Data.Service.SDL
		updatedSubgraphs = append(updatedSubgraphs, &cpy)
	}
	return updatedSubgraphs, nil
}

// Federate produces a federated graphs from the schemas and names
// of each of the subgraphs.
func Federate(subgraphs ...*Subgraph) (*FederatedGraph, error) {
	updatedSubgraphs, err := updateSchemas(subgraphs)
	if err != nil {
		return nil, err
	}
	vm, _ := pool.Get().(*vm)
	if vm == nil {
		var err error
		vm, err = newVM()
		if err != nil {
			return nil, err
		}
	}
	defer pool.Put(vm)
	return vm.FederateSubgraphs(updatedSubgraphs)
}

func BuildRouterConfiguration(subgraphs ...*Subgraph) (string, error) {
	updatedSubgraphs, err := updateSchemas(subgraphs)
	if err != nil {
		return "", err
	}
	vm, _ := pool.Get().(*vm)
	if vm == nil {
		var err error
		vm, err = newVM()
		if err != nil {
			return "", err
		}
	}
	defer pool.Put(vm)
	return vm.BuildRouterConfiguration(updatedSubgraphs)
}
