package main

import (
	_ "github.com/wundergraph/cosmo/router-tests/modules/tcpretransmits"
	routercmd "github.com/wundergraph/cosmo/router/cmd"
)

func main() {
	routercmd.Main()
}
