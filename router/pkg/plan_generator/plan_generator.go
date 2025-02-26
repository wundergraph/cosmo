package plan_generator

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wundergraph/cosmo/router/core"
)

const ResultsFileName = "results.json"

type QueryPlanConfig struct {
	ExecutionConfig string
	SourceDir       string
	OutDir          string
	Concurrency     int
	Filter          string
	Timeout         string
	OutputFiles     bool
	OutputResult    bool
	FailOnPlanError bool
	FailFast        bool
}

type QueryPlanResult struct {
	FileName string `json:"file_name"`
	Plan     string `json:"plan,omitempty"`
	Error    string `json:"error,omitempty"`
}

func PlanGenerator(cfg QueryPlanConfig) error {
	if cfg.Concurrency == 0 {
		cfg.Concurrency = runtime.GOMAXPROCS(0)
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

	resultsCh := make(chan QueryPlanResult, len(queries))
	var results []QueryPlanResult

	duration, parseErr := time.ParseDuration(cfg.Timeout)
	if parseErr != nil {
		return fmt.Errorf("failed to parse timeout: %v", parseErr)
	}
	ctx, cancel := context.WithTimeout(context.Background(), duration)
	defer cancel()

	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case res := <-resultsCh:
				results = append(results, res)
			}
		}
	}()

	var planError atomic.Bool
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

					if !slices.Contains([]string{".graphql", ".gql", ".graphqls"}, filepath.Ext(queryFile.Name())) {
						continue
					}

					if len(filter) > 0 && !slices.Contains(filter, queryFile.Name()) {
						continue
					}

					queryFilePath := filepath.Join(queriesPath, queryFile.Name())

					outContent, err := pg.PlanOperation(queryFilePath)
					res := QueryPlanResult{
						FileName: queryFile.Name(),
						Plan:     outContent,
					}
					if err != nil {
						res.Error = err.Error()
						outContent = fmt.Sprintf("Error: %v", err)
						planError.Store(true)
						if cfg.FailFast {
							cancel()
						}
					}

					if cfg.OutputFiles {
						outFileName := filepath.Join(outPath, queryFile.Name())
						err = os.WriteFile(outFileName, []byte(outContent), 0644)
						if err != nil {
							log.Printf("failed to write file: %v", err)
						}
					}
					resultsCh <- res
				}
			}
		}(i)
	}
	wg.Wait()

	if cfg.OutputResult && ctx.Err() == nil {
		resultsFilePath := filepath.Join(outPath, ResultsFileName)
		resultsFile, err := os.Create(resultsFilePath)
		if err != nil {
			cancel()
			log.Printf("failed to create results file: %v", err)
		}
		defer resultsFile.Close()
		slices.SortFunc(results, func(a, b QueryPlanResult) int {
			return strings.Compare(a.FileName, b.FileName)
		})
		data, jsonErr := json.Marshal(results)
		if jsonErr != nil {
			log.Printf("failed to marshal result: %v", jsonErr)
		}
		_, writeErr := resultsFile.WriteString(fmt.Sprintf("%s\n", data))
		if writeErr != nil {
			log.Printf("failed to write result: %v", writeErr)
		}
	}

	if cfg.FailOnPlanError && planError.Load() {
		return fmt.Errorf("some queries failed to generate plan")
	}

	return ctx.Err()
}
