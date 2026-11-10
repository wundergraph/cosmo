package main

import (
	routercmd "github.com/wundergraph/cosmo/router/cmd"
	_ "github.com/wundergraph/cosmo/router/cmd/custom-policy/module"
)

func main() {
	routercmd.Main()
}
