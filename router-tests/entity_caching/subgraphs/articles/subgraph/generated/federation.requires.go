package generated

import (
	"context"
	"fmt"

	"github.com/wundergraph/cosmo/router-tests/entity_caching/subgraphs/articles/subgraph/model"
)

// PopulateArticleRequires is the requires populator for the Article entity.
func (ec *executionContext) PopulateArticleRequires(ctx context.Context, entity *model.Article, reps map[string]any) error {
	rawViewer, ok := reps["currentViewer"]
	if !ok || rawViewer == nil {
		return nil
	}

	viewerMap, ok := rawViewer.(map[string]any)
	if !ok {
		return fmt.Errorf("expected currentViewer to be an object, got %T", rawViewer)
	}

	viewer := &model.Viewer{}
	if id, ok := viewerMap["id"].(string); ok {
		viewer.ID = id
	}
	if name, ok := viewerMap["name"].(string); ok {
		viewer.Name = name
	}
	if email, ok := viewerMap["email"].(string); ok {
		viewer.Email = email
	}

	entity.CurrentViewer = viewer
	return nil
}
