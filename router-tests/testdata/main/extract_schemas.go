package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"slices"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"

	"gopkg.in/yaml.v3"
)

type CosmoGraph struct {
	Version   int
	Subgraphs []CosmoSubgraph
}

type CosmoSubgraph struct {
	Name       string
	RoutingURL string `yaml:"routing_url"`
	Schema     Schema
}

type Schema struct {
	File string
}

func main() {
	routerConfigs := "routerconfigs"
	entries, _ := os.ReadDir(routerConfigs)
	for i := 0; i < len(entries); i++ {
		entry := entries[i]
		if entry.Name() == ".DS_Store" || !entry.IsDir() {
			continue
		}

		orgDir := filepath.Join(routerConfigs, entry.Name())

		log.Println("Processing ", orgDir, " i:", i, "out of ", len(entries))

		cfgsDirs, err := os.ReadDir(orgDir)
		if err != nil {
			log.Fatal(orgDir, err)
		}

		if len(cfgsDirs) == 0 || !cfgsDirs[0].IsDir() {
			log.Println("Skipping ", orgDir)
			continue
		}

		configPath := filepath.Join(orgDir, cfgsDirs[0].Name(), "routerconfigs", "latest.json")

		if _, err := os.Stat(configPath); os.IsNotExist(err) {
			log.Println("No latest.json file found in ", orgDir)
			continue
		}

		createYaml(orgDir, configPath)

		orgPathAbs, err := filepath.Abs(orgDir)
		if err != nil {
			log.Fatal("bad org path", err)
		}

		cliPath, err := filepath.Abs("../../../cli")
		if err != nil {
			log.Fatal("bad cli path", err)
		}

		inPath := filepath.Join(orgPathAbs, "graph.yaml")
		outPath := filepath.Join(orgPathAbs, "config.json")
		cmdOutPath := filepath.Join(orgPathAbs, "out.txt")

		cmdText := fmt.Sprintf("pnpm run wgc router compose -i %s -o %s > %s", inPath, outPath, cmdOutPath)

		cmd := exec.Command("sh", "-c", cmdText)
		cmd.Dir = cliPath

		if err = cmd.Run(); err != nil {
			log.Println("execute err", err, orgPathAbs)
			log.Printf("\nCOMPOSITION FAILURE\n\n%s\n\n", cmdText)
		}
	}
}

func createYaml(orgPath string, cfgPath string) {
	cosmoGraph := CosmoGraph{
		Version:   1,
		Subgraphs: make([]CosmoSubgraph, 0),
	}

	// read config.json file into Configuration struct
	var config nodev1.RouterConfig

	cfgContent, err := os.ReadFile(cfgPath)
	if err != nil {
		log.Fatal(err)
	}

	err = json.Unmarshal(cfgContent, &config)
	if err != nil {
		log.Fatal(err)
	}

	for _, ds := range config.EngineConfig.DatasourceConfigurations {
		idx := slices.IndexFunc(config.Subgraphs, func(s *nodev1.Subgraph) bool {
			return s.Id == ds.Id
		})
		if idx == -1 {
			log.Fatalf("subgraph %s not found", ds.Id)
		}
		subgraph := config.Subgraphs[idx]

		subgraphsPath := filepath.Join(orgPath, "subgraphs")

		subgraphFilePath := filepath.Join(subgraphsPath, subgraph.Name+".graphql")
		subgraphSchema := ds.CustomGraphql.Federation.ServiceSdl

		err = os.MkdirAll(subgraphsPath, os.ModePerm)
		if err != nil {
			log.Fatal(err)
		}

		err = os.WriteFile(subgraphFilePath, []byte(subgraphSchema), os.ModePerm)
		if err != nil {
			log.Fatal(err)
		}

		cosmoSubgraph := CosmoSubgraph{
			Name:       subgraph.Name,
			RoutingURL: subgraph.RoutingUrl,
			Schema: Schema{
				File: filepath.Join("subgraphs", subgraph.Name+".graphql"),
			},
		}

		cosmoGraph.Subgraphs = append(cosmoGraph.Subgraphs, cosmoSubgraph)
	}

	cosmoGraphContent, err := yaml.Marshal(cosmoGraph)
	if err != nil {
		log.Fatal(err)
	}

	graphPath := filepath.Join(orgPath, "graph.yaml")

	if err := os.WriteFile(graphPath, cosmoGraphContent, os.ModePerm); err != nil {
		log.Fatal(err)
	}

	schemaPath := filepath.Join(orgPath, "schema.graphql")
	if err := os.WriteFile(schemaPath, []byte(config.EngineConfig.GraphqlSchema), os.ModePerm); err != nil {
		log.Fatal(err)
	}
}
