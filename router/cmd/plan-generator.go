package cmd

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/caarlos0/env/v11"
	"github.com/joho/godotenv"
	"github.com/wundergraph/cosmo/router/core"
)

type QueryPlanConfig struct {
	ExecutionConfig string `env:"QUERY_PLAN_EXECUTION_CONFIG"`
	SourceDir       string `env:"QUERY_PLAN_SOURCE_DIR"`
	OutDir          string `env:"QUERY_PLAN_OUT_DIR"`
	Concurrency     int    `env:"QUERY_PLAN_CONCURRENCY" envDefault:"8" `
	Filter          string `env:"QUERY_PLAN_FILTER"`
	Timeout         string `env:"QUERY_PLAN_TIMEOUT" envDefault:"30s"`
}

func getParseGeneratorConfig() (QueryPlanConfig, error) {
	cfg := QueryPlanConfig{}
	_ = godotenv.Load(".env.local")
	_ = godotenv.Load()
	err := env.Parse(&cfg)
	if err != nil {
		return cfg, err
	}
	return cfg, nil
}

func planGeneratorCmd() error {
	cfg, err := getParseGeneratorConfig()
	if err != nil {
		return err
	}

	return PlanGenerator(cfg)
}

func PlanGenerator(cfg QueryPlanConfig) error {
	cfg, err := getParseGeneratorConfig()
	if err != nil {
		return err
	}

	queriesPath, err := filepath.Abs(cfg.SourceDir)
	if err != nil {
		return fmt.Errorf("failed to get absolute path for queries: %v", err)
	}

	outPath, err := filepath.Abs(cfg.OutDir)
	if err != nil {
		return fmt.Errorf("failed to get absolute path for output: %v", err)
	}
	if err := os.MkdirAll(outPath, 0755); err != nil {
		log.Fatalf("failed to create output directory: %v", err)
	}

	executionConfigPath, err := filepath.Abs(cfg.ExecutionConfig)
	if err != nil {
		return fmt.Errorf("failed to get absolute path for execution config: %v", err)
	}

	var filter []string
	if cfg.Filter != "" {
		filterContent, err := os.ReadFile(cfg.Filter)
		if err != nil {
			return fmt.Errorf("failed to read filter file: %v", err)
		}

		filter = strings.Split(string(filterContent), "\n")
	}

	queries, err := os.ReadDir(queriesPath)
	if err != nil {
		return fmt.Errorf("failed to read queries directory: %v", err)
	}

	queriesQueue := make(chan os.DirEntry, len(queries))
	for _, queryFile := range queries {
		queriesQueue <- queryFile
	}
	close(queriesQueue)

	duration, parseErr := time.ParseDuration(cfg.Timeout)
	if parseErr != nil {
		return fmt.Errorf("failed to parse timeout: %v", parseErr)
	}
	ctx, cancel := context.WithTimeout(context.Background(), duration)
	defer cancel()

	t := time.Now()
	wg := sync.WaitGroup{}
	wg.Add(cfg.Concurrency)
	for i := 0; i < cfg.Concurrency; i++ {
		go func(i int) {
			defer wg.Done()
			pg, err := core.NewPlanGenerator(executionConfigPath)
			if err != nil {
				log.Fatalf("failed to create plan generator: %v", err)
			}
			for {
				select {
				case <-ctx.Done():
					return
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

	return ctx.Err()
}
