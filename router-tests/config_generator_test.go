package integration_test

import (
	"errors"
	"fmt"
	"os"
	"os/exec"

	"gopkg.in/yaml.v3"
)

type Subgraph struct {
	Name       string `yaml:"name"`
	RoutingURL string `yaml:"routing_url"`
}

type Config struct {
	Version   string     `yaml:"version"` // Must be 1
	Subgraphs []Subgraph `yaml:"subgraphs"`
}

func SerializeConfigFile(subgraphs []Subgraph) (string, error) {
	cfg := &Config{
		Version:   "1",
		Subgraphs: subgraphs,
	}
	// Serialize this to a temporary file
	yamlBytes, err := yaml.Marshal(cfg)
	if err != nil {
		return "", err
	}
	inputConfigFile, err := os.CreateTemp("", "config-*.yaml")
	if err != nil {
		return "", err
	}
	if _, err := inputConfigFile.Write(yamlBytes); err != nil {
		return "", err
	}
	if err := inputConfigFile.Close(); err != nil {
		return "", err
	}
	outputConfigFile, err := os.CreateTemp("", "config-*.json")
	if err != nil {
		return "", err
	}
	outputConfigFile.Close()
	os.Remove(outputConfigFile.Name())
	outputFilename := outputConfigFile.Name()
	// Call wgc to generate the config
	if _, err := exec.LookPath("wgc"); err != nil {
		return "", errors.New("could not find wgc, install it with npm -g wgc@latest")
	}
	var args []string
	var dir string
	// Optionally, use a locally installed wgc
	if wgcDist := os.Getenv("WGC_DIST_DIR"); wgcDist != "" {
		args = []string{"node", "index.js"}
		dir = wgcDist
	} else {
		args = []string{"wgc"}
	}
	args = append(args, "router", "compose", "-i", inputConfigFile.Name(), "-o", outputFilename)
	cmd := exec.Command(args[0], args[1:]...)
	cmd.Dir = dir
	cmd.Stderr = os.Stderr
	cmd.Stdout = os.Stdout
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("running wgc: %w", err)
	}
	return outputFilename, nil
}
