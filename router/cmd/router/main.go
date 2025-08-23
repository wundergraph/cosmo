package main

import (
	"os"

	routercmd "github.com/wundergraph/cosmo/router/cmd"
	_ "github.com/wundergraph/cosmo/router/cmd/router/start-subscription"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "query-plan" {
		routercmd.PlanGenerator(os.Args[1:])
	} else {
		routercmd.Main()
	}
}
