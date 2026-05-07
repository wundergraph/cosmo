package server

import (
	"context"
	"net/http"
)

const mcpSessionIDHeader = "Mcp-Session-Id"

type sessionIDContextKey struct{}

// SessionIDFromContext returns the MCP Streamable-HTTP session ID stored on ctx.
// An empty value is meaningful: it indicates stateless mode or a request without
// Mcp-Session-Id, and callers must not synthesize a replacement.
func SessionIDFromContext(ctx context.Context) string {
	id, _ := ctx.Value(sessionIDContextKey{}).(string)
	return id
}

// WithSessionID stores id on ctx for Code Mode handlers.
func WithSessionID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, sessionIDContextKey{}, id)
}

// withSessionIDFromRequest reads Mcp-Session-Id directly from the HTTP request.
// The modelcontextprotocol/go-sdk exposes transport headers to MCP handlers as
// req.Extra.Header; handlers call WithSessionID(ctx, req.Extra.Header.Get(...)).
// This helper is used for HTTP middleware/tests where the raw request is known.
func withSessionIDFromRequest(ctx context.Context, req *http.Request) context.Context {
	if req == nil {
		return WithSessionID(ctx, "")
	}
	return WithSessionID(ctx, req.Header.Get(mcpSessionIDHeader))
}
