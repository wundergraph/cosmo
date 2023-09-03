package module

import (
	"github.com/wundergraph/cosmo/router/pkg/app"
	"net/http"
)

// Interface guard

var (
	_ app.MiddlewareHandler = (*MyModule)(nil)
)

func init() {
	// Register your module here
	app.RegisterModule(&MyModule{})
}

// MyModule is a simple middleware that adds a header to the response
// This is just an example, you can do whatever you want here
type MyModule struct{}

// ServeHTTP implements the MiddlewareHandler interface
func (m MyModule) ServeHTTP(writer http.ResponseWriter, request *http.Request, next http.Handler) {
	writer.Header().Add("X-Test", "1")

	next.ServeHTTP(writer, request)
}

func (m MyModule) Module() app.ModuleInfo {
	return app.ModuleInfo{
		// This is the ID of your module, it must be unique
		ID: "my-module",
		New: func() app.Module {
			return new(MyModule)
		},
	}
}
