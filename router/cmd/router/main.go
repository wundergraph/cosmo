package main

import (
	"os"

	routercmd "github.com/wundergraph/cosmo/router/cmd"
)

func main() {
	switch {
	case len(os.Args) > 1 && os.Args[1] == "query-plan":
		routercmd.PlanGenerator(os.Args[1:])
	case len(os.Args) > 1 && os.Args[1] == routercmd.PlanWorkerCommand:
		routercmd.PlanWorker(os.Args[1:])
	default:
		routercmd.Main()
	}
}
