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
	// Schema is the SDL of the subgraph as a string. If empty, the schema
	// is retrieved from the URL using the _service query.
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

type sdlResponse struct {
	Data struct {
		Service struct {
			SDL string `json:"sdl"`
		} `json:"_service"`
	} `json:"data"`
	Errors []struct {
		Message string `json:"message"`
	} `json:"errors"`
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

func introspectSubgraph(URL string) (string, error) {
	if URL == "" {
		return "", fmt.Errorf("no URL provided")
	}
	req, err := http.NewRequest("POST", URL, strings.NewReader(sdlQuery))
	if err != nil {
		return "", fmt.Errorf("could not create request: %w", err)
	}
	req.Header.Add("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("could not retrieve schema: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("could not retrieve schema: unexpected status code %d", resp.StatusCode)
	}
	var response sdlResponse
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return "", fmt.Errorf("could not decode SDL response: %w", err)
	}
	if len(response.Errors) > 0 {
		var errorMessages []string
		for _, err := range response.Errors {
			errorMessages = append(errorMessages, err.Message)
		}
		return "", fmt.Errorf("SDL query returned errors: %s", strings.Join(errorMessages, ", "))
	}
	return response.Data.Service.SDL, nil
}

func updateSchemas(subgraphs []*Subgraph) ([]*Subgraph, error) {
	updatedSubgraphs := make([]*Subgraph, 0, len(subgraphs))
	for _, subgraph := range subgraphs {
		if subgraph.Schema != "" {
			updatedSubgraphs = append(updatedSubgraphs, subgraph)
			continue
		}
		sdl, err := introspectSubgraph(subgraph.URL)
		if err != nil {
			return nil, fmt.Errorf("error introspecting subgraph %s: %w", subgraph.Name, err)
		}
		cpy := *subgraph
		cpy.Schema = sdl
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

// BuildRouterConfiguration produces a federated router configuration
// as a string that can be saved to a file and used to configure the
// router data sources.
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
