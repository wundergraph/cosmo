package main

import (
	routercmd "github.com/wundergraph/cosmo/router/cmd"
	// Import your modules here
	_ "github.com/wundergraph/cosmo/router/cmd/custom-set-scopes/module"
)

func main() {
	routercmd.Main()
}
