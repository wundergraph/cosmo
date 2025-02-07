package main

import (
	"flag"
	"log"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/wundergraph/cosmo/router/core"
)

var (
	executionConfigFilePath    = flag.String("execution-config", "config.json", "execution config file location")
	sourceOperationFoldersPath = flag.String("operations", "operations", "source operations folder location")
	plansOutPath               = flag.String("plans", "plans", "output plans folder location")
	operationFilterFilePath    = flag.String("filter", "", "operation filter file location which should contain file names of operations to include")
)

func main() {
	flag.Parse()

	queriesPath, err := filepath.Abs(*sourceOperationFoldersPath)
	if err != nil {
		log.Fatalf("failed to get absolute path for queries: %v", err)
	}

	outPath, err := filepath.Abs(*plansOutPath)
	if err != nil {
		log.Fatalf("failed to get absolute path for output: %v", err)
	}
	if err := os.MkdirAll(outPath, 0755); err != nil {
		log.Fatalf("failed to create output directory: %v", err)
	}

	supergraphConfigPath, err := filepath.Abs(*executionConfigFilePath)
	log.Println("supergraphPath:", supergraphConfigPath)
	if err != nil {
		log.Fatalf("failed to get absolute path for supergraph: %v", err)
	}

	queries, err := os.ReadDir(queriesPath)
	if err != nil {
		log.Fatalf("failed to read queries directory: %v", err)
	}

	var filter []string
	if *operationFilterFilePath != "" {
		filterContent, err := os.ReadFile(*operationFilterFilePath)
		if err != nil {
			log.Fatalf("failed to read filter file: %v", err)
		}

		filter = strings.Split(string(filterContent), "\n")
	}

	pg, err := core.NewPlanGenerator(supergraphConfigPath)
	if err != nil {
		log.Fatalf("failed to create plan generator: %v", err)
	}

	t := time.Now()

	for i, queryFile := range queries {
		if filepath.Ext(queryFile.Name()) != ".graphql" {
			continue
		}

		if len(filter) > 0 && !slices.Contains(filter, queryFile.Name()) {
			continue
		}

		log.Println("Running query #", i, " name:", queryFile.Name())

		queryFilePath := filepath.Join(queriesPath, queryFile.Name())

		outContent, err := pg.PlanOperation(queryFilePath)
		if err != nil {
			log.Printf("failed operation #%d: %s err: %v\n", i, queryFile.Name(), err.Error())
		}

		outFileName := filepath.Join(outPath, queryFile.Name())
		err = os.WriteFile(outFileName, []byte(outContent), 0644)
		if err != nil {
			log.Fatalf("failed to write file: %v", err)
		}
	}

	log.Println("Total planning time:", time.Since(t))
}
