package routerconfig

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

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

	// Look for the demo directory to find the employeeupdated schema, since
	// we can't introspect that one because it is virtual
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}

	var demoDir string

	for {
		if dir == "/" {
			return "", errors.New("could not find demo directory")
		}
		if _, err := os.Stat(filepath.Join(dir, "demo")); err == nil {
			demoDir = dir
			break
		}
		dir = filepath.Dir(dir)
	}

	employeeUpdatedSchemaPath := filepath.Join(demoDir, "demo", "pkg", "subgraphs", "employeeupdated", "subgraph", "schema.graphqls")
	employeeUpdatedSchemaData, err := os.ReadFile(employeeUpdatedSchemaPath)
	if err != nil {
		return "", err
	}

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
		{
			Name: "availability",
			URL:  fmt.Sprintf("http://localhost:%d/graphql", ports.Availability),
		},
		{
			Name: "mood",
			URL:  fmt.Sprintf("http://localhost:%d/graphql", ports.Mood),
		},
		{
			Name:   "employeeupdated",
			Schema: string(employeeUpdatedSchemaData),
		},
	}
	return SerializeSubgraphs(subgraphs)
}
