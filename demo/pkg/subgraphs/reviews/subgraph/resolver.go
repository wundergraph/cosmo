package subgraph

import "github.com/wundergraph/cosmo/demo/pkg/subgraphs/deferdemo"

// This file will not be regenerated automatically.
//
// It serves as dependency injection for your app, add any dependencies you require here.

type Resolver struct {
	Latencies deferdemo.Latencies
}
