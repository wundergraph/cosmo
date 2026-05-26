package generated

import (
	"context"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/cachegraph_ext/subgraph/model"
)

// PopulateArticleRequires is the requires populator for the Article entity.
func (ec *executionContext) PopulateArticleRequires(ctx context.Context, entity *model.Article, reps map[string]any) error {
	cv, ok := reps["currentViewer"]
	if !ok || cv == nil {
		return nil
	}
	cvMap, ok := cv.(map[string]any)
	if !ok {
		return nil
	}
	viewer := &model.Viewer{}
	if id, ok := cvMap["id"].(string); ok {
		viewer.ID = id
	}
	if name, ok := cvMap["name"].(string); ok {
		viewer.Name = name
	}
	entity.CurrentViewer = viewer
	return nil
}
