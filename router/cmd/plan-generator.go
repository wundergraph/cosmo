package cmd

import (
	"log"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/wundergraph/cosmo/router/core"
)

func planGenerator() {
	queriesPath, err := filepath.Abs(*queryPlanSourceOperationFoldersPath)
	if err != nil {
		log.Fatalf("failed to get absolute path for queries: %v", err)
	}

	outPath, err := filepath.Abs(*queryPlanPlansOutPath)
	if err != nil {
		log.Fatalf("failed to get absolute path for output: %v", err)
	}
	if err := os.MkdirAll(outPath, 0755); err != nil {
		log.Fatalf("failed to create output directory: %v", err)
	}

	supergraphConfigPath, err := filepath.Abs(*queryPlanExecutionConfigFilePath)
	log.Println("supergraphPath:", supergraphConfigPath)
	if err != nil {
		log.Fatalf("failed to get absolute path for supergraph: %v", err)
	}

	queries, err := os.ReadDir(queriesPath)
	if err != nil {
		log.Fatalf("failed to read queries directory: %v", err)
	}

	var filter []string
	if *queryPlanOperationFilterFilePath != "" {
		filterContent, err := os.ReadFile(*queryPlanOperationFilterFilePath)
		if err != nil {
			log.Fatalf("failed to read filter file: %v", err)
		}

		filter = strings.Split(string(filterContent), "\n")
	}

	queriesQueue := make(chan os.DirEntry, len(queries))
	for _, queryFile := range queries {
		queriesQueue <- queryFile
	}
	close(queriesQueue)

	t := time.Now()

	wg := sync.WaitGroup{}
	for i := 0; i < *queryPlanConcurrency; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			pg, err := core.NewPlanGenerator(supergraphConfigPath)
			if err != nil {
				log.Fatalf("failed to create plan generator: %v", err)
			}
			for {
				select {
				case queryFile, ok := <-queriesQueue:
					if !ok {
						return
					}
					if filepath.Ext(queryFile.Name()) != ".graphql" {
						continue
					}

					if len(filter) > 0 && !slices.Contains(filter, queryFile.Name()) {
						continue
					}

					queryFilePath := filepath.Join(queriesPath, queryFile.Name())

					outContent, err := pg.PlanOperation(queryFilePath)
					if err != nil {
						log.Printf("failed operation #%d: %s err: %v\n", i, queryFile.Name(), err.Error())
					}

					outFileName := filepath.Join(outPath, queryFile.Name())
					err = os.WriteFile(outFileName, []byte(outContent), 0644)
					if err != nil {
						log.Printf("failed to write file: %v", err)
					}
				}
			}
		}(i)
	}
	wg.Wait()
	log.Println("Total planning time:", time.Since(t))
}
