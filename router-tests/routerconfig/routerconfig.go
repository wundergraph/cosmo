package routerconfig

import (
	"fmt"
	"os"

	"github.com/wundergraph/cosmo/composition-go"
	"github.com/wundergraph/cosmo/router-tests/runner"
)

type Subgraph = composition.Subgraph

// SerializeSubgraphs creates a static router configuration from the given subgraphs
func SerializeSubgraphs(subgraphs []*Subgraph) (string, error) {
	config, err := composition.BuildRouterConfiguration(subgraphs...)
	if err != nil {
		return "", err
	}
	outputConfigFile, err := os.CreateTemp("", "config-*.json")
	if err != nil {
		return "", err
	}
	outputConfigFile.Close()
	os.Remove(outputConfigFile.Name())
	if err := os.WriteFile(outputConfigFile.Name(), []byte(config), 0644); err != nil {
		return "", err
	}
	return outputConfigFile.Name(), nil
}

// SerializeRunner creates a static router configuration from the given SubgraphsRunner
func SerializeRunner(sg runner.SubgraphsRunner) (string, error) {
	ports := sg.Ports()

	subgraphs := []*Subgraph{
		{
			Name: "employees",
			URL:  fmt.Sprintf("http://localhost:%d/graphql", ports.Employees),
		},
		{
			Name: "family",
			URL:  fmt.Sprintf("http://localhost:%d/graphql", ports.Family),
		},
		{
			Name: "hobbies",
			URL:  fmt.Sprintf("http://localhost:%d/graphql", ports.Hobbies),
		},
		{
			Name: "products",
			URL:  fmt.Sprintf("http://localhost:%d/graphql", ports.Products),
		},
		{
			Name: "test1",
			URL:  fmt.Sprintf("http://localhost:%d/graphql", ports.Test1),
		},
	}
	return SerializeSubgraphs(subgraphs)
}
