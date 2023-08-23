package subgraph

import (
	"github.com/99designs/gqlgen/graphql/handler"
	"github.com/99designs/gqlgen/graphql/handler/debug"
	"github.com/wundergraph/comso/demo/employees/subgraph/generated"
	"net/http"
)

type EndpointOptions struct {
	EnableDebug bool
}

var TestOptions = EndpointOptions{
	EnableDebug: false,
}

func GraphQLEndpointHandler(opts EndpointOptions) http.Handler {
	srv := handler.NewDefaultServer(generated.NewExecutableSchema(generated.Config{Resolvers: &Resolver{}}))
	if opts.EnableDebug {
		srv.Use(&debug.Tracer{})
	}

	return srv
}
