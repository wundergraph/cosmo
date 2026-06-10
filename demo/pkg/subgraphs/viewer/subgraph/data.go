package subgraph

import "github.com/wundergraph/cosmo/demo/pkg/subgraphs/viewer/subgraph/model"

// Viewers keyed by auth token
var viewersByToken = map[string]*model.Viewer{
	"Bearer token-alice":   {ID: "v1", Name: "Alice", Email: "alice@example.com"},
	"Bearer token-bob":     {ID: "v2", Name: "Bob", Email: "bob@example.com"},
	"Bearer token-charlie": {ID: "v3", Name: "Charlie", Email: "charlie@example.com"},
}

// Viewers keyed by ID (for entity resolution)
var viewersByID = map[string]*model.Viewer{
	"v1": {ID: "v1", Name: "Alice", Email: "alice@example.com"},
	"v2": {ID: "v2", Name: "Bob", Email: "bob@example.com"},
	"v3": {ID: "v3", Name: "Charlie", Email: "charlie@example.com"},
}

// Default viewer when no auth token is provided
var defaultViewer = &model.Viewer{ID: "v0", Name: "Anonymous", Email: "anonymous@example.com"}
