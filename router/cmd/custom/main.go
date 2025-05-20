package main

import (
	"fmt"

	routercmd "github.com/wundergraph/cosmo/router/cmd"

	// Import your modules here
	_ "github.com/wundergraph/cosmo/router/cmd/custom/module"
)

func main() {
	fmt.Println("Starting custom router...")
	routercmd.Main()
}
