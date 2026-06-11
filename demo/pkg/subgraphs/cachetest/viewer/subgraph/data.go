package subgraph

import "github.com/wundergraph/cosmo/demo/pkg/subgraphs/cachetest/viewer/subgraph/model"

// defaultViewer returns a fresh Viewer instance. Returning a new pointer on
// each call prevents accidental aliasing between concurrent resolvers.
func defaultViewer() *model.Viewer {
	return &model.Viewer{
		ID:    "v1",
		Name:  "Alice",
		Email: "alice@example.com",
	}
}
