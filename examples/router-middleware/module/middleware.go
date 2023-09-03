package mymiddleware

import (
	"github.com/wundergraph/cosmo/router/pkg/app"
	"net/http"
)

// Interface guard
var _ app.MiddlewareHandler = (*Middleware)(nil)

func init() {
	// Register your module here
	app.RegisterModule(&Middleware{})
}

// Middleware is a simple middleware that adds a header to the response
// This is just an example, you can do whatever you want here
type Middleware struct{}

// ServeHTTP implements the MiddlewareHandler interface
func (m Middleware) ServeHTTP(writer http.ResponseWriter, request *http.Request, next http.Handler) {
	writer.Header().Add("X-Test", "1")

	next.ServeHTTP(writer, request)
}

func (m Middleware) Module() app.ModuleInfo {
	return app.ModuleInfo{
		ID: "http.handlers.addHeaders",
		New: func() app.Module {
			return new(Middleware)
		},
	}
}
