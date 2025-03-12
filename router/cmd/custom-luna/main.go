package main

import (
	routercmd "github.com/wundergraph/cosmo/router/cmd"
	_ "github.com/wundergraph/cosmo/router/cmd/custom-luna/module"
)

func main() {
	routercmd.Main()
}
