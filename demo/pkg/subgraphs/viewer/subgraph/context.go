package subgraph

import (
	"context"
	"net/http"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/viewer/subgraph/model"
)

// viewerFromContext extracts the current viewer from the request's Authorization header.
func viewerFromContext(ctx context.Context) *model.Viewer {
	gc := ctx.Value(httpRequestKey{})
	if gc == nil {
		return defaultViewer
	}
	r, ok := gc.(*http.Request)
	if !ok {
		return defaultViewer
	}
	auth := r.Header.Get("Authorization")
	if v, found := viewersByToken[auth]; found {
		return v
	}
	return defaultViewer
}

type httpRequestKey struct{}

// WithHTTPRequest stores the HTTP request in context for resolver access.
func WithHTTPRequest(ctx context.Context, r *http.Request) context.Context {
	return context.WithValue(ctx, httpRequestKey{}, r)
}
