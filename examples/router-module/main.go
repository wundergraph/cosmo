package main

import (
	routercmd "github.com/wundergraph/cosmo/router/cmd"
	// Import your modules here
	_ "github.com/wundergraph/cosmo/examples/router-module/module"
)

func main() {
	routercmd.Main()
}
