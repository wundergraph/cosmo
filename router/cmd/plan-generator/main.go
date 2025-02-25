package main

import (
	"flag"
	"log"

	"github.com/wundergraph/cosmo/router/cmd"
)

var (
	executionConfigFilePath    = flag.String("execution-config", "config.json", "execution config file location")
	sourceOperationFoldersPath = flag.String("operations", "operations", "source operations folder location")
	plansOutPath               = flag.String("plans", "plans", "output plans folder location")
	operationFilterFilePath    = flag.String("filter", "", "operation filter file location which should contain file names of operations to include")
	timeout                    = flag.String("timeout", "30s", "timeout")
)

func main() {
	flag.Parse()

	err := cmd.PlanGenerator(cmd.QueryPlanConfig{
		ExecutionConfig: *executionConfigFilePath,
		SourceDir:       *sourceOperationFoldersPath,
		OutDir:          *plansOutPath,
		Filter:          *operationFilterFilePath,
		Timeout:         *timeout,
	})
	if err != nil {
		log.Fatalf("Error during command plan-generator: %s", err)
	}
}
