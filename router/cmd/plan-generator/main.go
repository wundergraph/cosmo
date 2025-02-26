package main

import (
	"flag"
	"log"

	"github.com/wundergraph/cosmo/router/pkg/plan_generator"
)

var (
	executionConfigFilePath    = flag.String("execution-config", "config.json", "execution config file location")
	sourceOperationFoldersPath = flag.String("operations", "operations", "source operations folder location")
	plansOutPath               = flag.String("plans", "plans", "output plans folder location")
	operationFilterFilePath    = flag.String("filter", "", "operation filter file location which should contain file names of operations to include")
	timeout                    = flag.String("timeout", "30s", "timeout")
	concurrency                = flag.Int("concurrency", 0, "how many query plan run concurrently")
	help                       = flag.Bool("help", false, "Prints the help message")
)

func main() {
	flag.Parse()

	if *help {
		flag.PrintDefaults()
		return
	}

	err := plan_generator.PlanGenerator(plan_generator.QueryPlanConfig{
		ExecutionConfig: *executionConfigFilePath,
		SourceDir:       *sourceOperationFoldersPath,
		OutDir:          *plansOutPath,
		Filter:          *operationFilterFilePath,
		Timeout:         *timeout,
		Concurrency:     *concurrency,
	})
	if err != nil {
		log.Fatalf("Error during command plan-generator: %s", err)
	}
}
