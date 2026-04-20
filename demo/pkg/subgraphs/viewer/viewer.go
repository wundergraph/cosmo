package viewer

import (
	"net/http"

	"github.com/99designs/gqlgen/graphql"
	"github.com/99designs/gqlgen/graphql/handler"
	"github.com/99designs/gqlgen/graphql/handler/transport"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/viewer/subgraph"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/viewer/subgraph/generated"
)

func NewSchema() graphql.ExecutableSchema {
	return generated.NewExecutableSchema(generated.Config{Resolvers: &subgraph.Resolver{}})
}

// NewHandler creates an HTTP handler that injects the request into context
// so resolvers can access the Authorization header.
func NewHandler() http.Handler {
	schema := NewSchema()
	srv := handler.New(schema)
	srv.AddTransport(transport.POST{})
	srv.AddTransport(transport.GET{})

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := subgraph.WithHTTPRequest(r.Context(), r)
		srv.ServeHTTP(w, r.WithContext(ctx))
	})
}
