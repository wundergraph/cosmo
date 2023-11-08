package subgraphs

import (
	"net/http"
	"time"

	"github.com/99designs/gqlgen/graphql"
	"github.com/99designs/gqlgen/graphql/handler"
	"github.com/99designs/gqlgen/graphql/handler/extension"
	"github.com/99designs/gqlgen/graphql/handler/transport"
	"github.com/gorilla/websocket"
	"github.com/wundergraph/cosmo/demo/pkg/injector"
)

func NewDemoServer(schema graphql.ExecutableSchema) *handler.Server {
	srv := handler.New(schema)
	// gqlgen requires SSE to be the first transport, see https://gqlgen.com/recipes/subscriptions/
	srv.AddTransport(transport.SSE{})
	srv.AddTransport(transport.Options{})
	srv.AddTransport(transport.GET{})
	srv.AddTransport(transport.POST{})
	srv.AddTransport(transport.MultipartForm{})
	srv.AddTransport(transport.Websocket{
		KeepAlivePingInterval: 10 * time.Second,
		Upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true
			},
		},
		InitFunc: injector.InitPayloadFunc,
	})
	srv.Use(extension.Introspection{})

	return srv
}
