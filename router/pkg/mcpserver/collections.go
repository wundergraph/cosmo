package mcpserver

import (
	"context"
	"fmt"
	"net/http"
	"regexp"

	"github.com/go-chi/chi/v5"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/pkg/schemaloader"
)

// collectionSlugPattern validates URL-safe collection slugs.
var collectionSlugPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]*$`)

// collection is a named subset of operation-execution tools served by its own
// MCP server at /mcp/{slug}. It holds the desired set of operation names and
// the currently registered tools, which are replaced on reload.
type collection struct {
	server          *mcp.Server
	operationNames  map[string]struct{}
	registeredTools []string
}

// collectionKey is a context key for the collection resolved from the request path.
type collectionKey struct{}

// collectionFromContext returns the collection resolved by the collection middleware.
func collectionFromContext(ctx context.Context) (*collection, bool) {
	c, ok := ctx.Value(collectionKey{}).(*collection)
	return c, ok
}

// RegisterCollection registers a named collection of operations served at
// /mcp/{slug}. The collection's MCP server exposes only the operation-execution
// tools for the given operation names. The built-in tools (get_schema,
// execute_graphql, get_operation_info) remain available on /mcp only.
// Operation names that are not loaded are skipped with a warning and picked up
// on the next Reload, since collections may be registered before operations
// are loaded.
func (s *GraphQLSchemaServer) RegisterCollection(slug string, operationNames []string) error {
	if !collectionSlugPattern.MatchString(slug) {
		return fmt.Errorf("invalid collection slug %q: must match %s", slug, collectionSlugPattern)
	}

	s.collectionsMu.Lock()
	defer s.collectionsMu.Unlock()

	if _, exists := s.collections[slug]; exists {
		return fmt.Errorf("collection %q is already registered", slug)
	}

	c := &collection{
		server:         newMCPServer(s.graphName + "-" + slug),
		operationNames: make(map[string]struct{}, len(operationNames)),
	}
	for _, name := range operationNames {
		c.operationNames[name] = struct{}{}
	}

	s.collections[slug] = c

	s.reloadCollection(slug, c)

	return nil
}

// reloadCollections rebuilds the tools of every registered collection from the
// currently loaded operations.
func (s *GraphQLSchemaServer) reloadCollections() {
	s.collectionsMu.Lock()
	defer s.collectionsMu.Unlock()

	for slug, c := range s.collections {
		s.reloadCollection(slug, c)
	}
}

// reloadCollection rebuilds a single collection's tools. It is a no-op until
// operations have been loaded. Callers must hold collectionsMu.
func (s *GraphQLSchemaServer) reloadCollection(slug string, c *collection) {
	if s.operationsManager == nil {
		return
	}

	c.server.RemoveTools(c.registeredTools...)
	c.registeredTools = nil

	operations := s.operationsManager.GetFilteredOperations()
	selected := make([]schemaloader.Operation, 0, len(c.operationNames))
	found := make(map[string]struct{}, len(c.operationNames))
	for _, op := range operations {
		if _, ok := c.operationNames[op.Name]; ok {
			selected = append(selected, op)
			found[op.Name] = struct{}{}
		}
	}
	for name := range c.operationNames {
		if _, ok := found[name]; !ok {
			s.logger.Warn("operation not found for MCP collection, skipping",
				zap.String("collection", slug),
				zap.String("operation", name))
		}
	}

	registered, _ := s.registerOperationTools(c.server, selected)
	c.registeredTools = registered
}

// collectionMiddleware resolves the {collection} URL parameter against the
// registry, responding 404 for unknown slugs before the request reaches the
// streamable handler, whose getServer-nil path would yield a 400 instead.
func (s *GraphQLSchemaServer) collectionMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		slug := chi.URLParam(r, "collection")

		s.collectionsMu.RLock()
		c := s.collections[slug]
		s.collectionsMu.RUnlock()

		if c == nil {
			http.NotFound(w, r)
			return
		}

		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), collectionKey{}, c)))
	})
}
